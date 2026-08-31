import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { expand, bindings } from "../plugins/input-knockout/expand.js";
import { readViewModel } from "../plugins/input-knockout/index.js";
import { readSpec, crossCheck } from "../plugins/input-openapi/index.js";
import { readViews, readSync } from "../plugins/input-backbone/index.js";
import { translate } from "../plugins/output-react/template.js";
import { runPipeline } from "./helpers.js";

/* --------------------------------------------------------- input-knockout */

test("a binding list splits on the commas that are not inside anything", () => {
  assert.deepEqual(
    bindings(`text: name, css: { hot: a, cold: b }, click: pick`).map((b) => b.name),
    ["text", "css", "click"]
  );
});

// The semantic this guards: foreach repeats what is inside the element, not
// the element. Getting it wrong multiplies the container instead of the rows.
test("foreach repeats the children, never the container", () => {
  const jsx = translate(expand(`<ul data-bind="foreach: { data: xs, as: 'o' }"><li data-bind="text: o.n"></li></ul>`), { indent: 0 }).jsx;
  assert.match(jsx.replace(/\s+/g, " "), /<ul> \{xs\.map\(\(o\) => \( <li key=/);
});

test("a bare handler is called, and what knockout passed it is reported", () => {
  const r = translate(expand(`<button data-bind="click: pick">x</button>`), { indent: 0 });
  assert.match(r.jsx, /onClick=\{\(event\) => pick\(event\)\}/);
  assert.ok(r.notes.some((n) => /wire it through by hand/.test(n)));
});

test("a foreach without an alias is a warning, not a guess", () => {
  const notes = [];
  expand(`<ul data-bind="foreach: xs"><li data-bind="text: n"></li></ul>`, (n) => notes.push(n));
  assert.ok(notes.some((n) => /alias the loop/.test(n)));
});

test("observables and handlers are read off the viewmodel", () => {
  const vm = readViewModel(`
    function Desk() { var self = this;
      self.q = ko.observable(""); self.orders = ko.observableArray([]);
      self.reload = function () { $.getJSON("/api/x", function () {}); };
    }`, "app.js");
  assert.deepEqual(vm.observables.map((o) => o.name), ["q", "orders"]);
  assert.deepEqual(vm.handlers, ["reload"]);
  assert.deepEqual(vm.calls.map((c) => c.path), ["/api/x"]);
});

test("a knockout app ports end to end", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ src: join(process.cwd(), "example/legacy-knockout") });
  t.after(cleanup);
  assert.equal(error, null);
  assert.equal(ctx.screens[0].readBy, "knockout");
  const source = await readFile(join(out, ctx.written.find((f) => f.endsWith(".jsx"))), "utf8");
  assert.match(source, /orders\.map\(\(o\)/);
  assert.doesNotMatch(source, /data-bind/, "no knockout syntax survived");
});

/* ---------------------------------------------------------- input-openapi */

test("the spec and the traffic are cross checked, in both directions", () => {
  const operations = readSpec({
    openapi: "3.0.0",
    paths: {
      "/api/orders": { get: {}, post: { deprecated: true } },
      "/api/orders/{id}": { get: { operationId: "getOrder" } },
      "/api/unused": { get: {} },
    },
  });
  const { uncalled, undocumented, deprecatedInUse } = crossCheck(operations, [
    { method: "GET", path: "/api/orders", file: "a.ts" },
    { method: "POST", path: "/api/orders", file: "a.ts" },
    { method: "GET", path: "/api/orders/${id}", file: "a.ts" },
    { method: "GET", path: "/api/secret", file: "a.ts" },
  ]);
  assert.deepEqual(uncalled.map((o) => o.path), ["/api/unused"]);
  assert.deepEqual(undocumented.map((c) => c.path), ["/api/secret"]);
  assert.deepEqual(deprecatedInUse.map((o) => `${o.method} ${o.path}`), ["POST /api/orders"]);
});

test("a literal id and a templated id are one shape", () => {
  const operations = readSpec({ openapi: "3.0.0", paths: { "/api/orders/{id}": { get: {} } } });
  const { undocumented } = crossCheck(operations, [{ method: "GET", path: "/api/orders/42", file: "a.js" }]);
  assert.equal(undocumented.length, 0);
});

/* --------------------------------------------------------- input-backbone */

test("a View is a boundary somebody drew, and it is read as one", () => {
  const views = readViews(`
    var OrderRow = Backbone.View.extend({
      tagName: "tr",
      events: { "click .name": "select", "submit": "save" },
      render: function () { this.$el.html(this.template(this.model.toJSON())); return this; },
      template: _.template($("#row-tpl").html()),
    });
    var Toolbar = Backbone.View.extend({ el: "#toolbar", events: { "click .refresh": "reload" } });
  `, "views.js");
  assert.equal(views.length, 2);
  assert.deepEqual(views[0].events.map((e) => `${e.event} ${e.selector ?? ""}`.trim()), ["click .name", "submit"]);
  assert.equal(views[0].rendersWithTemplate, true);
  assert.equal(views[1].selector, "#toolbar");
});

test("a model's url is the read, and the write is marked assumed", () => {
  const calls = readSync(`var Orders = Backbone.Collection.extend({ url: "/api/orders" });`, "models.js");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/orders", "POST /api/orders"]);
  assert.ok(calls[1].assumed);
});
