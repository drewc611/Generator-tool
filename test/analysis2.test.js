import assert from "node:assert/strict";
import test from "node:test";

import { findReferences } from "../plugins/dsp-assets/index.js";
import { auditCss } from "../plugins/dsp-css/index.js";
import { shannon, findCandidates } from "../plugins/dsp-entropy/index.js";
import { readStyle } from "../plugins/dsp-apistyle/index.js";
import { readAuth } from "../plugins/dsp-auth/index.js";
import { skeleton, similarity } from "../plugins/dsp-duplication/index.js";
import { weigh } from "../plugins/dsp-weight/index.js";
import { findIssues } from "../plugins/dsp-improve/findings.js";

/* ------------------------------------------------------------ dsp-assets */

test("asset references are found in markup and css, urls and templates excluded", () => {
  const refs = findReferences(
    `<img src="logo.png"><a href="page.html">x</a><img src="https://cdn.example/x.png">` +
    `<img src="{{ o.avatar }}.png"><style>.a { background: url("bg.jpg"); }</style>`,
    "index.html"
  );
  assert.deepEqual(refs.map((r) => r.target), ["logo.png", "bg.jpg"]);
});

/* --------------------------------------------------------------- dsp-css */

test("the stylesheet audit counts what makes a cascade heavy", () => {
  const audit = auditCss(
    `/* !important in a comment does not count */
    #app .nav ul li a { color: red !important; }
    .btn { padding: 4px; } .card { padding: 4px; } .row { padding: 4px; } .x { padding: 4px; }`,
    "style.css"
  );
  assert.equal(audit.important.length, 1);
  assert.equal(audit.ids.length, 1);
  assert.equal(audit.deep.length, 1, "the five level selector is deep");
  assert.deepEqual(audit.repeated, [["padding: 4px", 4]]);
});

/* ----------------------------------------------------------- dsp-entropy */

test("a generated string is flagged by entropy and its value never surfaces", () => {
  // Deliberately shaped like no real provider's key: GitHub's push protection
  // reads a recognisable prefix as the credential it imitates, and it is
  // right to. Entropy alone carries this test.
  const secretish = "Qz9mK2xW7pL4dR8vN3tB6yH1cJ5gF0sD";
  const found = findCandidates(`const key = "${secretish}";\nconst label = "customer-orders-list-heading";`, "config.js");
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.ok(found[0].entropy > 4.2);
  assert.ok(!JSON.stringify(found).includes(secretish.slice(0, 8)), "no fragment of the value is in the finding");
});

test("entropy is what it says", () => {
  assert.equal(shannon("aaaa"), 0);
  assert.ok(shannon("aQ3$xZ9!mK2#") > 3);
});

/* ---------------------------------------------------------- dsp-apistyle */

test("the house style is read off the traffic", () => {
  const style = readStyle([
    { method: "GET", path: "/v1/order_items?page=2&per_page=50" },
    { method: "GET", path: "/v1/orders/123" },
    { method: "POST", path: "/v1/orders" },
  ]);
  assert.deepEqual(style.versions, ["v1"]);
  assert.ok(style.cases.some(([kind]) => kind === "snake_case"));
  assert.deepEqual(style.pagination.map(([kind]) => kind), ["page number"]);
});

/* -------------------------------------------------------------- dsp-auth */

test("the auth scheme and the storage are read, never the value", () => {
  const { found, storage } = readAuth(
    `req.headers["Authorization"] = "Bearer " + localStorage.getItem("auth_token");`,
    "auth.js"
  );
  assert.deepEqual(found.map((f) => f.kind), ["bearer"]);
  assert.deepEqual(storage.map((s) => [s.where, s.key]), [["localStorage", "auth_token"]]);
});

/* ------------------------------------------------------- dsp-duplication */

test("two screens that differ only in words are the same skeleton", () => {
  const a = skeleton(`<div class="card"><h2>Orders</h2><ul><li *ngFor="let o of orders">{{o.id}}</li></ul></div>`);
  const b = skeleton(`<div class="card"><h2>Invoices</h2><ul><li *ngFor="let i of invoices">{{i.ref}}</li></ul></div>`);
  assert.ok(similarity(a, b) >= 0.9);
  const c = skeleton(`<form><input><button>Go</button></form>`);
  assert.ok(similarity(a, c) < 0.3);
});

/* ------------------------------------------------------------ dsp-weight */

test("the weight formula counts what the template holds", () => {
  const screen = {
    selector: "orders",
    file: "orders.html",
    template: `<div *ngIf="loading">L</div><li *ngFor="let o of orders" (click)="pick(o)">{{o.id}}</li><input [(ngModel)]="q">`,
  };
  const w = weigh(screen, [{ method: "GET", path: "/x", file: "orders.html" }], ["orders never shows its empty state"]);
  assert.equal(w.whens, 1);
  assert.equal(w.eaches, 1);
  assert.equal(w.models, 1);
  assert.equal(w.events, 1);
  assert.equal(w.calls, 1);
  assert.ok(w.score > 10);
});

/* ----------------------------------------------- dsp-improve focus order */

const shell = (elements) => ({
  screens: [{ id: "s1", pageBackground: "rgb(255,255,255)", elements, sample: [] }],
});

const el = (selector, x, y, extra = {}) => ({
  tag: "input", type: "text", selector, name: selector, labelled: true, disabled: false,
  box: { x, y, w: 100, h: 44 }, color: "rgb(0,0,0)", background: "rgb(255,255,255)", fontSize: 14,
  tabindex: null, ...extra,
});

test("a tab order that fights the reading order is a finding", () => {
  const model = { screens: [], wiring: [] };
  const straight = findIssues(shell([el("#a", 10, 10), el("#b", 10, 60)]), model);
  assert.ok(!straight.some((f) => f.kind === "focus-order"), "document order matching visual order is silent");

  const crossed = findIssues(shell([el("#b", 10, 60), el("#a", 10, 10)]), model);
  const finding = crossed.find((f) => f.kind === "focus-order");
  assert.ok(finding, "DOM order against visual order is named");
  assert.match(finding.evidence, /#b/);
});

test("a positive tabindex is its own finding, and no positions means no guess", () => {
  const model = { screens: [], wiring: [] };
  const explicit = findIssues(shell([el("#a", 10, 10, { tabindex: 3 }), el("#b", 10, 60)]), model);
  assert.ok(explicit.some((f) => f.kind === "focus-order" && /tabindex above zero/.test(f.evidence)));

  const old = shell([el("#a", 10, 10), el("#b", 10, 60)]);
  for (const e of old.screens[0].elements) e.box = { w: 100, h: 44 };
  assert.ok(!findIssues(old, model).some((f) => f.kind === "focus-order"), "a recording without positions measures nothing");
});
