import assert from "node:assert/strict";
import test from "node:test";

import { checkStructure } from "../plugins/dsp-a11y/index.js";
import { fieldsRead } from "../plugins/dsp-apimap/index.js";
import { unmatchedSelectors, auditCss } from "../plugins/dsp-css/index.js";
import { templateWeight } from "../plugins/dsp-perf/index.js";
import { auditDates } from "../plugins/dsp-dates/index.js";
import { inferEntities, inferRelations } from "../plugins/dsp-entities/index.js";
import { persistedKeys } from "../plugins/dsp-state/index.js";
import { readStyle } from "../plugins/dsp-apistyle/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";

test("a heading ladder that skips a rung is named, screen and levels", () => {
  const findings = checkStructure([
    { selector: "report", template: `<h1>Title</h1><h4>Detail</h4>` },
    { selector: "clean", template: `<h1>Title</h1><h2>Part</h2>` },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].screen, "report");
  assert.match(findings[0].evidence, /h1 is followed by an h4/);
});

test("an aria reference with no id in the same screen is a candidate, said as one", () => {
  const findings = checkStructure([
    { selector: "form", template: `<input aria-labelledby="name-label" /><span id="other"></span>` },
  ]);
  assert.equal(findings[0].kind, "dangling-aria");
  assert.match(findings[0].evidence, /#name-label/);
  assert.match(findings[0].evidence, /another screen/);
});

test("fieldsRead narrows a response to what the template touches", () => {
  const ir = buildIr(`<li v-for="o in orders" :key="o.id" :class="{ late: o.overdue }">{{o.name}}</li>`);
  const fields = fieldsRead(ir);
  assert.deepEqual([...fields.get("orders")].sort(), ["id", "name", "overdue"]);
});

test("a selector matching nothing in any template is a candidate", () => {
  const audits = [auditCss(`.used { color: red } .ghost-panel .ghost-row { color: blue } h1 { margin: 0 }`, "app.css")];
  const found = unmatchedSelectors(audits, [`<div class="used">x</div>`]);
  assert.equal(found.length, 1);
  assert.match(found[0].selector, /ghost/);
});

test("templateWeight counts nodes and sees the loop inside the loop", () => {
  const ir = buildIr(`<table><tr v-for="r in rows"><td v-for="c in r.cells" @click="pick(c)">{{c.v}}</td></tr></table>`);
  const w = templateWeight(ir, "grid");
  assert.equal(w.maxLoopDepth, 2);
  assert.equal(w.handlersInNestedLoop, 1);
  assert.ok(w.nodes >= 4);
});

test("angular's lowercase digit order and epoch seconds are both caught", () => {
  const findings = auditDates(`x = format(d, 'dd/MM/yyyy'); y = new Date(row.created * 1000);`, "app.js");
  assert.ok(findings.some((f) => f.kind === "ambiguous-format"));
  assert.ok(findings.some((f) => f.kind === "epoch-seconds"));
});

test("customerId on an order points at the customer entity", () => {
  const entities = inferEntities([
    { endpoint: "GET /api/orders", properties: { id: "number", customerId: "number", total: "number" } },
    { endpoint: "GET /api/customers", properties: { id: "number", name: "string", region: "string" } },
  ]);
  const relations = inferRelations(entities);
  assert.equal(relations.length, 1);
  assert.equal(relations[0].from, "order");
  assert.equal(relations[0].to, "customer");
  assert.equal(relations[0].property, "customerId");
  assert.equal(relations[0].many, false);
});

test("persisted keys are read as names only, values untouched", () => {
  const found = persistedKeys(
    `localStorage.setItem("authToken", token); const draft = localStorage.getItem("cart-draft"); sessionStorage["tab"] = "2";`,
    "app.js",
  );
  assert.deepEqual(found.map((f) => f.key).sort(), ["authToken", "cart-draft", "tab"]);
  assert.ok(found.every((f) => !String(f).includes("token")));
});

test("a verb in the path is read as RPC and kept as written", () => {
  const style = readStyle([
    { method: "POST", path: "/api/orders/deleteOrder" },
    { method: "GET", path: "/api/customers" },
  ]);
  assert.equal(style.rpc.length, 1);
  assert.equal(style.rpc[0].segment, "deleteOrder");
});
