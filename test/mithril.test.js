import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { lowerChild, lowerCall, parseSelector, readComponents, splitArgs } from "../plugins/input-mithril/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Mithril writes markup as calls. The reader walks the calls the way the
 * runtime would and prints the dialect, naming what it cannot map.
 */

test("a hyperscript selector gives its tag, id, classes and bracket attributes", () => {
  assert.deepEqual(parseSelector("section.orders#main[role=region]"), { tag: "section", classes: ["orders"], id: "main", attrs: [["role", "region"]] });
  assert.deepEqual(parseSelector(".a.b"), { tag: "div", classes: ["a", "b"], id: null, attrs: [] });
  assert.deepEqual(splitArgs(`"a, b", { x: [1, 2], y: "c,d" }, m("i", "z")`), [`"a, b"`, `{ x: [1, 2], y: "c,d" }`, `m("i", "z")`]);
});

test("attrs, events, models, conditionals, loops and trusted html lower onto the dialect", () => {
  const notes = [];
  const note = (t) => notes.push(t);
  assert.equal(lowerCall(`m("a.link", { href: url, onclick: go }, "Go")`, note), `<a class="link" ng-href="{{ url }}" ng-click="go($event)">Go</a>`);
  assert.equal(lowerCall(`m("input", { value: q, oninput: (e) => { q = e.target.value; } })`, note), `<input ng-model="q">`);
  assert.equal(lowerChild(`ok ? m("p", "yes") : null`, note), `<p ng-if="ok">yes</p>`);
  assert.equal(lowerChild(`ok && m("p", "yes")`, note), `<p ng-if="ok">yes</p>`);
  assert.equal(lowerChild(`rows.map((r, i) => m("li", r.name, i))`, note), `<li ng-repeat="r in rows track by $index">{{ r.name }}{{ $index }}</li>`);
  assert.equal(lowerChild(`rows.map(r => [m("dt", r.k), m("dd", r.v)])`, note), `<ng-container ng-repeat="r in rows"><dt>{{ r.k }}</dt><dd>{{ r.v }}</dd></ng-container>`);
  assert.equal(lowerChild(`m.trust(html)`, note), `<span ng-bind-html="html"></span>`);
  assert.equal(lowerCall(`m("li", { class: late ? "late" : "" }, "x")`, note), `<li ng-class="late ? 'late' : ''">x</li>`);
  assert.equal(lowerCall(`m(Badge, { label: s, onClear: () => clear(s) })`, note), `<badge ng-attr-label="{{ s }}" ng-clear="clear(s)"></badge>`);
  assert.equal(notes.length, 0, "nothing here needed a note");
});

test("what has no honest lowering is named, never approximated", () => {
  const notes = [];
  const note = (t) => notes.push(t);
  assert.equal(lowerChild(`n > 1 ? "many" : "one"`, note), `{{ n > 1 ? "many" : "one" }}`);
  assert.ok(notes.some((n) => /ternary/.test(n)));
  assert.equal(lowerCall(`m(tagName, "x")`, note), "");
  assert.ok(notes.some((n) => /cannot be named/.test(n)));
  lowerCall(`m("div", { ...rest, onwheel: spin })`, note);
  assert.ok(notes.some((n) => /spread/.test(n)) && notes.some((n) => /onwheel/.test(n)));
});

test("a component's inputs are the attrs it reads, its outputs the attrs it calls, and its requests reach the API surface", () => {
  const { screens, calls } = readComponents(
    `import m from "mithril";\nexport const Card = { oninit() { m.request({ url: "/api/cards", method: "POST" }); }, view(vnode) { return m("div", [m("h2", vnode.attrs.title), m("button", { onclick: () => vnode.attrs.onClose() }, "x")]); } };\n` +
    `export function Row() { return { view: ({ attrs }) => m("tr", m("td", attrs.cell)) }; }`,
    "cards.js"
  );
  assert.equal(screens.length, 2);
  const [card, row] = screens;
  assert.equal(card.className, "Card"); assert.equal(card.selector, "card");
  assert.deepEqual(card.inputs, ["title"]); assert.deepEqual(card.outputs, ["close"]);
  assert.equal(card.template, `<div><h2>{{ title }}</h2><button ng-click="onClose()">x</button></div>`, "an attrs read is the input");
  assert.equal(row.className, "Row"); assert.deepEqual(row.inputs, ["cell"]);
  assert.equal(row.template, `<tr><td>{{ cell }}</td></tr>`, "an arrow view with an expression body is read");
  assert.deepEqual(calls, [{ method: "POST", path: "/api/cards", file: "cards.js", headers: null, body: null }]);
});

test("a run reads the Mithril app onto screens and ports them to React", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/mithril") });
  try {
    assert.equal(run.error, null);
    const list = run.ctx.screens.find((s) => s.selector === "order-list");
    assert.ok(list, "OrderList is a screen");
    assert.equal(list.readBy, "mithril");
    assert.deepEqual(list.inputs, ["title"]);
    assert.deepEqual(list.outputs, ["clear", "pick", "refresh"]);
    assert.ok(list.usesNgIf && list.usesNgFor && list.usesTwoWay);
    assert.match(list.template, /<section id="main" class="orders" role="region">/);
    assert.match(list.template, /<li ng-repeat="order in state\.orders track by \$index"/);
    assert.match(list.template, /<badge ng-attr-label="\{\{ order\.status \}\}" ng-clear=/);
    assert.match(list.template, /<em ng-if="order\.note">/);
    assert.match(list.template, /<h1>\{\{ title \}\}<\/h1>/);
    assert.match(list.template, /ng-click="onPick\(order\)"/);
    assert.ok(run.ctx.screens.some((s) => s.selector === "badge" && s.readBy === "mithril"));
    assert.ok(run.ctx.api.calls.some((c) => c.path === "/api/orders" && c.method === "GET"));
    assert.ok(run.ctx.written.some((f) => /src\/features\/OrderList\/OrderList\.jsx$/.test(f)), "ported to React");
    assert.ok(run.ctx.written.some((f) => /src\/features\/Badge\/Badge\.jsx$/.test(f)));
  } finally {
    await run.cleanup();
  }
});

test("an event wired on a child component is that component's output in the IR, and a ternary class is an expression", async () => {
  const { translate } = await import("../plugins/output-react/template.js");
  const { DIALECTS } = await import("../plugins/dsp-ir/ir.js");
  const dialect = DIALECTS.angularjs;
  const components = new Map([["badge", { name: "Badge" }]]);
  const one = translate(`<badge ng-clear="clear(x)"></badge>`, { indent: 0, components, dialect });
  assert.match(one.jsx, /<Badge onClear=\{\(\) => clear\(x\)\} \/>/, "a one word child tag the run knows carries its event");
  const two = translate(`<user-badge ng-pick="pick(u)"></user-badge>`, { indent: 0, dialect });
  assert.match(two.jsx, /onPick=\{\(\) => pick\(u\)\}/, "a custom tag carries its event without being asked");
  const plain = translate(`<div ng-wobble="x()"></div>`, { indent: 0, dialect });
  assert.doesNotMatch(plain.jsx, /onWobble/, "an unknown directive on a plain element is not guessed to be an event");
  const cls = translate(`<li ng-class="late ? 'late' : ''">x</li>`, { indent: 0, dialect });
  assert.match(cls.jsx, /className=\{late \? 'late' : ''\}/, "a ternary is used as the expression it is");
  assert.ok(cls.notes.some((n) => /not an object literal/.test(n)), "and the reader is told to confirm it");
});
