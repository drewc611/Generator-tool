import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { toVue } from "../plugins/output-vue/print.js";
import { toHtml } from "../plugins/output-html/print.js";
import { toSvelte } from "../plugins/output-svelte/print.js";
import { buildDocument } from "../plugins/output-openapi/index.js";
import { buildHandlers, renderHandlers } from "../plugins/output-msw/index.js";
import { readScript } from "../plugins/input-jquery/index.js";
import { extractStrings } from "../plugins/dsp-i18n/index.js";
import { classesUsed, findDeadClasses } from "../plugins/dsp-deadcode/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";
import { runPipeline } from "./helpers.js";

const tidy = (s) => s.replace(/\s+/g, " ").trim();

/* ----------------------------------------------------------- output-vue */

test("Angular prints as Vue, and the directives survive the trip", () => {
  const out = tidy(toVue(`<li *ngFor="let o of xs" [class.hot]="o.hot" [title]="o.t">{{o.n}}</li>`).markup);
  assert.match(out, /v-for="o in xs"/);
  assert.match(out, /:key="o\.id \?\? o"/);
  assert.match(out, /:class="\{ hot: o\.hot \}"/);
  assert.match(out, /:title="o\.t"/);
  assert.match(out, /\{\{ o\.n \}\}/);
});

// The bug this guards: :class="{ "is-x": ... }" ends the attribute at the
// first inner quote and the template stops parsing there.
test("a class name that is not an identifier is quoted so it cannot close the attribute", () => {
  const out = toVue(`<p [ngClass]="{'is-late': late, ok: fine}">x</p>`).markup;
  assert.match(out, /:class="\{ 'is-late': late, ok: fine \}"/);
  assert.equal((out.match(/"/g) || []).length % 2, 0, "every quote is paired");
});

// The bug this guards: an expression carrying a double quote silently ends the
// attribute, which v-show does on every template it touches.
test("a double quote inside an expression is escaped, not emitted raw", () => {
  const out = toVue(`<span v-show="open">x</span>`).markup;
  assert.match(out, /&quot;none&quot;/);
  assert.doesNotMatch(out, /: "none"/);
});

test("$event is spelled the way Vue spells it", () => {
  assert.match(toVue(`<input (input)="go($event)">`).markup, /@input="go\(\$event\)"/);
});

test("a condition on a node that cannot carry one gets a template wrapper", () => {
  const out = toVue(`<li *ngFor="let o of xs" *ngIf="o.on">x</li>`).markup;
  assert.match(out, /<template v-if=/);
});

/* -------------------------------------------- the IR claim, checked twice */

test("the same markup in either dialect produces byte identical output", () => {
  const angular = `<ul><li *ngFor="let o of xs" [class.hot]="o.hot">{{o.name}}</li></ul>`;
  const vue = `<ul><li v-for="o in xs" :class="{hot: o.hot}">{{o.name}}</li></ul>`;
  assert.equal(toVue(angular).markup, toVue(vue).markup);
  assert.equal(toSvelte(angular).markup, toSvelte(vue).markup);
  assert.equal(toHtml(angular).markup, toHtml(vue).markup);
});

/* ---------------------------------------------------------- output-html */

test("every interpolation in a string renderer is escaped", () => {
  const out = toHtml(`<p>{{ body }}</p>`).markup;
  assert.match(out, /\$\{esc\(body\)\}/);
});

// The one exception, and it is the node the IR already labelled raw.
test("the raw node is the only thing not escaped, and it is reported", () => {
  const result = toHtml(`<div [innerHTML]="body"></div>`);
  assert.match(result.markup, /\$\{body \?\? ""\}/);
  assert.ok(result.notes.some((n) => /trust decision/.test(n)));
});

// The bug this guards: a delegated handler fires after the row that owns it
// was printed, so without an index it acts on the wrong item or none.
test("a handler inside a loop carries the row it belongs to", () => {
  const result = toHtml(`<li *ngFor="let o of xs" (click)="pick(o)">x</li>`);
  assert.match(result.markup, /data-i="\$\{__i\}"/);
  assert.equal(result.handlers[0].scope.item, "o");
  assert.equal(result.handlers[0].scope.list, "xs");
});

test("a handler outside a loop carries no row", () => {
  const result = toHtml(`<button (click)="go()">x</button>`);
  assert.equal(result.handlers[0].scope, null);
  assert.doesNotMatch(result.markup, /data-i=/);
});

test("nested loops are named as the case only the inner row survives", () => {
  const result = toHtml(`<ul *ngFor="let g of gs"><li *ngFor="let o of g.xs" (click)="pick(o)">x</li></ul>`);
  assert.ok(result.notes.some((n) => /nested loops/.test(n)));
});

test("a backtick in literal text cannot end the template it is printed into", () => {
  const out = toHtml("<p>a ` b ${c} d</p>").markup;
  assert.match(out, /\\`/);
  assert.match(out, /\\\$\{/);
});

/* ------------------------------------------------------- output-openapi */

test("the document describes requests and refuses to describe responses", () => {
  const { document, gaps } = buildDocument({
    api: { calls: [{ method: "POST", path: "/api/v1/orders", file: "a.ts", body: "unknown", name: "createOrders" }] },
  });
  const operation = document.paths["/api/v1/orders"].post;
  assert.equal(document.openapi, "3.0.3");
  assert.ok(operation.requestBody, "the request is described");
  assert.equal(operation.responses["200"].schema, undefined, "the response is not");
  assert.ok(gaps.some((g) => /Response body/.test(g)));
});

test("a path parameter is templated however the source spelled it", () => {
  const { document } = buildDocument({
    api: { calls: [
      { method: "GET", path: "/api/v1/orders/${id}", file: "a.ts", body: null },
      { method: "DELETE", path: "/api/v2/orders/:key", file: "a.ts", body: null },
    ] },
  });
  assert.ok(document.paths["/api/v1/orders/{id}"], "a template literal became a parameter");
  assert.ok(document.paths["/api/v2/orders/{key}"], "a colon became a parameter");
  assert.equal(document.paths["/api/v1/orders/{id}"].get.parameters[0].name, "id");
});

test("what was watched is marked apart from what was only read", () => {
  const { document } = buildDocument({
    api: { calls: [{ method: "GET", path: "/api/v1/orders", file: "a.ts", body: null }] },
    model: { endpoints: [{ method: "GET", path: "/api/v1/orders", query: ["region"], statuses: [200, 503] }] },
  });
  const operation = document.paths["/api/v1/orders"].get;
  assert.match(operation.description, /Seen against the running system/);
  assert.deepEqual(Object.keys(operation.responses), ["200", "503"]);
  assert.equal(operation.parameters[0].name, "region");
});

/* ----------------------------------------------------------- output-msw */

// The rule this guards: recorded traffic is somebody's real data, and a mock
// that carries it is a copy of that data in a repository.
test("a recorded body contributes its shape and never its values", () => {
  const { handlers } = buildHandlers({
    api: { calls: [{ method: "GET", path: "/api/v1/orders" }] },
    model: { endpoints: [{ method: "GET", path: "/api/v1/orders", statuses: [200], observedBody: { id: "string", total: "number", paid: "boolean" } }] },
  });
  const source = renderHandlers(handlers);
  assert.match(source, /"id": "<id>"/);
  assert.match(source, /"total": 0/);
  assert.match(source, /"paid": false/);
});

test("an endpoint nobody watched returns a placeholder that says so", () => {
  const { handlers, unverified } = buildHandlers({ api: { calls: [{ method: "POST", path: "/api/v1/orders" }] } });
  assert.match(renderHandlers(handlers), /_portamp/);
  assert.ok(unverified.some((u) => /was ever observed/.test(u)));
});

test("one endpoint reached from both sources is mocked once", () => {
  const { handlers } = buildHandlers({
    api: { calls: [{ method: "GET", path: "/api/v1/orders" }] },
    model: { endpoints: [{ method: "GET", path: "/api/v1/orders", statuses: [200] }] },
  });
  assert.equal(handlers.length, 1);
});

/* --------------------------------------------------------- input-jquery */

test("the three shapes a jQuery app calls out with are all found", () => {
  const { calls } = readScript(`
    $.ajax({ url: "/api/a", type: "POST" });
    $.get("/api/b");
    fetch("/api/c", { method: "PUT" });
  `, "app.js");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`).sort(), ["GET /api/b", "POST /api/a", "PUT /api/c"]);
});

test("a selector is inventoried by what is done to it", () => {
  const { widgets } = readScript(`
    $("#refresh").on("click", load);
    $("#rows").html(markup);
    $("#count").text(n);
    document.getElementById("status").textContent = "ready";
  `, "app.js");
  const by = Object.fromEntries(widgets.map((w) => [w.selector, w]));
  assert.deepEqual(by["#refresh"].events, ["click"]);
  assert.deepEqual(by["#rows"].writes, ["html"]);
  assert.deepEqual(by["#count"].writes, ["text"]);
  assert.deepEqual(by["status"].writes, ["text"]);
});

// The rule this guards: jQuery declares no components, so portamp must not
// invent any.
test("no component is invented from a jQuery source", () => {
  const { widgets } = readScript(`$("#a").on("click", go); $("#a").html(x);`, "app.js");
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0].selector, "#a");
  assert.ok(!("template" in widgets[0]), "a widget is not a screen");
});

/* ------------------------------------------------------------- dsp-i18n */

test("copy is extracted and a value is not", () => {
  const found = extractStrings(buildIr(`<h2>Open orders</h2><span>{{ count }}</span><em>42</em>`), "s");
  assert.deepEqual(found.map((f) => f.value), ["Open orders"]);
});

test("a translatable attribute counts and a data attribute does not", () => {
  const found = extractStrings(buildIr(`<input placeholder="Filter by region" name="region">`), "s");
  assert.deepEqual(found.map((f) => f.where), ["@placeholder"]);
});

// The bug this guards: a sentence split around a value only reads correctly in
// the word order it was written in.
test("a sentence with a value in the middle is flagged as one string, not two", () => {
  const [found] = extractStrings(buildIr(`<p>You have {{ n }} unread messages</p>`), "s");
  assert.equal(found.interpolated, true);
  assert.equal(found.value, "You have unread messages");
});

test("a short button label is copy, because somebody has to translate it", () => {
  assert.deepEqual(extractStrings(buildIr(`<button>OK</button>`), "s").map((f) => f.value), ["OK"]);
});

/* --------------------------------------------------------- dsp-deadcode */

test("a class is used whether it is literal, conditional or built", () => {
  const { used, dynamic } = classesUsed(buildIr(`<p class="a b" [class.c]="on" [ngClass]="theme"></p>`));
  assert.deepEqual([...used].sort(), ["a", "b", "c"]);
  assert.deepEqual(dynamic, ["theme"]);
});

// The rule this guards: a name assembled at runtime looks unused and is not.
test("a rule named anywhere in the source is not called dead", () => {
  assert.deepEqual(findDeadClasses(["a", "b"], new Set(["a"]), ""), ["b"]);
  assert.deepEqual(findDeadClasses(["a", "b"], new Set(["a"]), `el.classList.add("b")`), []);
});

/* ------------------------------------------------------------ end to end */

test("four targets emit from one run, and none of them is React", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ vue: true, html: true, svelte: true, openapi: true, msw: true });
  t.after(cleanup);
  assert.equal(error, null);

  const written = ctx.written.join("\n");
  assert.match(written, /\.vue$/m);
  assert.match(written, /src\/elements\/.*\.js$/m);
  assert.match(written, /\.svelte$/m);
  assert.match(written, /openapi\.json$/m);
  assert.match(written, /src\/mocks\/handlers\.js$/m);

  const spec = JSON.parse(await readFile(join(out, "openapi.json"), "utf8"));
  assert.equal(spec.openapi, "3.0.3");
  assert.ok(Object.keys(spec.paths).length >= 1);
});

test("a target that was not asked for writes nothing", async (t) => {
  const { ctx, cleanup } = await runPipeline();
  t.after(cleanup);
  assert.ok(!ctx.written.some((f) => /\.vue$|src\/elements\/|openapi\.json|src\/mocks\//.test(f)));
});

// The rule this guards: an emitted component never holds a URL.
test("no emitted target writes an endpoint into a component", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ vue: true, html: true, svelte: true });
  t.after(cleanup);
  assert.equal(error, null, String(error));

  const components = ctx.written.filter((f) => /\.(vue|svelte)$|src\/elements\//.test(f));
  assert.ok(components.length >= 3, "all three targets emitted");
  for (const file of components) {
    const source = await readFile(join(out, file), "utf8");
    for (const call of ctx.api.calls) {
      assert.doesNotMatch(source, new RegExp(call.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${file} holds an endpoint`);
    }
  }
});
