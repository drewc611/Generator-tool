import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { findTemplate, readProperties, readOutputs, lowerLit, readComponent } from "../plugins/input-lit/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";

/**
 * input-lit reads a LitElement onto the same dialect every other reader targets,
 * the inverse of output-lit. These hold its edges: the html template is matched
 * to its closing backtick through nested templates, the reactive properties are
 * the top level keys and not the { type } inside them, the bindings lower
 * (@event, ?boolean, .value, a mapped loop, a conditional), what has no honest
 * equivalent is noted, and the result parses into the IR. Fixtures are built
 * from line arrays so the test file itself carries no template interpolation.
 */

// Lit source assembled without a template literal, so `${` stays literal here.
const LIT = [
  'import { LitElement, html } from "lit";',
  "class OrdersList extends LitElement {",
  "  static properties = { orders: { type: Array }, loading: { type: Boolean } };",
  '  remove(o){ this.dispatchEvent(new CustomEvent("removed", { detail: o })); fetch("/api/orders"); }',
  "  render() {",
  "    return html`",
  "      <table>",
  "        ${this.orders.map((o) => html`<tr><td>${o.id}</td><td><button @click=${() => this.remove(o)} ?disabled=${this.loading}>Delete</button></td></tr>`)}",
  "      </table>",
  "      ${this.loading ? html`<p>Loading</p>` : ''}",
  "      <input .value=${this.query} @input=${(e) => this.query = e.target.value}>",
  "    `;",
  "  }",
  "}",
].join("\n");

test("the html template is matched through its nested templates", () => {
  const tpl = findTemplate(LIT);
  assert.ok(tpl, "a template was found");
  assert.match(tpl, /<table>/);
  assert.match(tpl, /<input /);
  assert.doesNotMatch(tpl, /return html/, "the match stopped at the outer closing backtick");
});

test("the reactive properties are the top level keys, not the nested type", () => {
  assert.deepEqual(readProperties(LIT), ["orders", "loading"]);
  const decorated = "class X { @property({type:String}) name; @state() count; render(){ return html``; } }";
  assert.deepEqual(readProperties(decorated), ["name", "count"]);
});

test("dispatched custom events are the outputs", () => {
  assert.deepEqual(readOutputs(LIT), ["removed"]);
});

test("bindings lower: event, boolean attr, model, mapped loop, conditional", () => {
  const out = lowerLit(findTemplate(LIT));
  assert.match(out, /<tr ng-repeat="o in orders">/, "the map is a repeat");
  assert.match(out, /ng-click="remove\(o\)"/, "the arrow reduced to its call, this stripped");
  assert.match(out, /ng-disabled="loading"/, "the boolean attribute became a directive");
  assert.match(out, /<p ng-if="loading">/, "the ternary with an empty else is a conditional");
  assert.match(out, /<input ng-model="query"/, "the .value binding is a model");
  assert.match(out, /\{\{ o\.id \}\}/, "an interpolation came across");
});

test("Lit's repeat() directive is read as a loop, like map", () => {
  const src = [
    "class Grid extends LitElement { render(){ return html`",
    "  <ul>${repeat(this.rows ?? [], (r) => r.id, (r) => html`<li @click=${() => this.pick(r)}>${r.name}</li>`)}</ul>",
    "`; } }",
  ].join("\n");
  const out = lowerLit(findTemplate(src));
  assert.match(out, /<li ng-repeat="r in rows"/, "the repeat list is read, this and the ?? default stripped");
  assert.match(out, /ng-click="pick\(r\)"/, "the item template's bindings lower");
  assert.match(out, /\{\{ r\.name \}\}/, "the item interpolation comes across");
});

test("a two branch ternary and an unknown event are noted, not guessed", () => {
  const notes = [];
  const src = [
    "class Y extends LitElement { render(){ return html`",
    "  <div>${this.ok ? html`<a>yes</a>` : html`<b>no</b>`}</div>",
    "  <x @gesture=${this.go}></x>",
    "`; } }",
  ].join("\n");
  lowerLit(findTemplate(src), (t) => notes.push(t));
  assert.ok(notes.some((n) => /ternary/i.test(n)), "the two branch ternary is named");
  assert.ok(notes.some((n) => /@gesture/.test(n)), "the unknown event is named");
});

test("a whole component reads and parses into the IR", () => {
  const { screen, calls } = readComponent(LIT, "orders-list.js");
  assert.equal(screen.className, "OrdersList");
  assert.deepEqual(screen.inputs, ["orders", "loading"]);
  assert.deepEqual(screen.outputs, ["removed"]);
  assert.equal(screen.readBy, "lit");
  assert.ok(screen.usesNgFor && screen.usesNgIf && screen.usesTwoWay);
  assert.deepEqual(calls.map((c) => c.path), ["/api/orders"]);
  const ir = buildIr(screen.template);
  const kinds = [];
  const walk = (n) => { if (!n) return; kinds.push(n.kind); (n.children ?? []).forEach(walk); };
  walk(ir.root);
  assert.ok(kinds.includes("each") && kinds.includes("when"), "the loop and the conditional reached the IR");
});

test("the plugin reads Lit files off the source and skips non Lit scripts", async () => {
  assert.equal(plugin.class, "input");
  const dir = await mkdtemp(join(tmpdir(), "lit-"));
  try {
    await writeFile(join(dir, "Widget.js"), LIT.replace("OrdersList", "Widget"));
    await writeFile(join(dir, "util.js"), "export function add(a, b){ return a + b; }");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "Widget.js"), rel: "Widget.js" },
        { path: join(dir, "util.js"), rel: "util.js" },
      ] },
      screens: [],
      api: { calls: [] },
      unverified: () => {},
    };
    await handlers.extract(ctx);
    assert.equal(ctx.screens.length, 1, "only the Lit file became a screen");
    assert.equal(ctx.screens[0].className, "Widget");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/input-lit/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:|from "\.\.\//, `${line.trim()} is not a builtin or a local import`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the reader does not reach the network");
});
