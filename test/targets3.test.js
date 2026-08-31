import assert from "node:assert/strict";
import test from "node:test";

import { qualify, toSolid } from "../plugins/output-solid/index.js";
import { toAlpine } from "../plugins/output-alpine/index.js";
import { manifestFor } from "../plugins/output-cem/index.js";
import { buildCollection } from "../plugins/output-postman/index.js";
import { buildScript } from "../plugins/output-curl/index.js";
import { buildFixtures } from "../plugins/output-fixtures/index.js";
import { workflow } from "../plugins/output-ci/index.js";

/* ----------------------------------------------------------- output-solid */

test("solid spells props and signals so they stay reactive", () => {
  const r = toSolid(`<div *ngIf="loading">L</div><li *ngFor="let o of orders">{{o.id}} {{label}}</li><input [(ngModel)]="q">`);
  assert.match(r.body, /<Show when=\{props\.loading\}>/);
  assert.match(r.body, /<For each=\{props\.orders\}>\{\(o\) =>/);
  assert.match(r.body, /\{o\.id\}/, "the loop item is local, never props");
  assert.match(r.body, /\{props\.label\}/);
  assert.match(r.body, /value=\{q\(\)\}/, "the signal read is a call");
});

test("qualify leaves strings, keys and locals alone", () => {
  const map = new Map([["status", "props.status"], ["total", "props.total"]]);
  assert.equal(qualify(`status === "status" && total > 0`, map), `props.status === "status" && props.total > 0`);
  assert.equal(qualify(`{ status: total }`, map), `{ status: props.total }`);
  assert.equal(qualify(`status`, map, new Set(["status"])), `status`);
});

/* ---------------------------------------------------------- output-alpine */

test("alpine writes behavior on the markup and vendors its runtime", () => {
  const r = toAlpine(`<div *ngIf="busy">B</div><li *ngFor="let o of orders">{{o.id}}</li><input [(ngModel)]="q" (click)="go()">`);
  assert.match(r.markup, /<template x-if="busy">/);
  assert.match(r.markup, /<template x-for="o in orders"/);
  assert.match(r.markup, /x-model="q"/);
  assert.match(r.markup, /@click="go\(\)"/);
  assert.match(r.markup, /<span x-text="o\.id"><\/span>/);
});

/* ------------------------------------------------------------- output-cem */

test("the manifest describes what the port has, tags dashed", () => {
  const manifest = manifestFor([{
    selector: "orders", className: "Orders", file: "o.html", inputs: ["items"], outputs: ["pick"],
    template: `<li *ngFor="let o of rows">{{o.id}}</li><input [(ngModel)]="q">`,
  }]);
  const decl = manifest.modules[0].declarations[0];
  assert.equal(decl.tagName, "ported-orders", "a dashless selector gets a valid custom element name");
  assert.ok(decl.attributes.some((a) => a.fieldName === "items"));
  assert.ok(decl.events.some((e) => e.name === "pick"));
  assert.ok(decl.members.some((m) => m.name === "q"));
});

/* --------------------------------------------------------- output-postman */

test("the collection has requests, variables, and no responses", () => {
  const c = buildCollection([
    { method: "GET", path: "/api/orders/${orderId}", file: "a.ts" },
    { method: "GET", path: "/api/orders/${orderId}", file: "b.ts" },
    { method: "POST", path: "/api/orders", file: "a.ts" },
  ]);
  assert.equal(c.item.length, 2, "duplicates collapse");
  assert.equal(c.item[0].request.url.raw, "{{baseUrl}}/api/orders/:orderId");
  assert.deepEqual(c.item[0].request.url.variable, [{ key: "orderId", value: "" }]);
  assert.ok(c.item.every((i) => !("response" in i)), "no invented responses");
});

/* ------------------------------------------------------------ output-curl */

test("the smoke script takes GETs only and counts what it refused", () => {
  const { gets, skipped } = buildScript([
    { method: "GET", path: "/api/orders" },
    { method: "DELETE", path: "/api/orders/1" },
    { method: "POST", path: "/api/orders" },
  ]);
  assert.deepEqual(gets, ["/api/orders"]);
  assert.equal(skipped, 2);
});

/* -------------------------------------------------------- output-fixtures */

test("fixtures carry types, and an unobserved shape says so in its payload", () => {
  const fixtures = buildFixtures({
    api: { calls: [{ method: "GET", path: "/api/orders" }, { method: "GET", path: "/api/customers" }] },
    model: { endpoints: [{ method: "GET", path: "/api/orders", observedBody: { id: "number", customer: "string" } }] },
  });
  const orders = fixtures.find((f) => f.path === "/api/orders");
  assert.deepEqual(orders.body, { id: 0, customer: "<customer>" }, "types, never captured values");
  const blind = fixtures.find((f) => f.path === "/api/customers");
  assert.match(blind.body._portamp, /never|No response/);
});

/* -------------------------------------------------------------- output-ci */

test("the port's workflow keeps the endpoint rule", () => {
  const yml = workflow(["src/features/Orders/Orders.jsx", "src/api/endpoints.js"]);
  assert.match(yml, /node --check/);
  assert.match(yml, /no component carries a URL/);
  assert.match(yml, /endpoints live in src\/api\/endpoints\.js/);
});
