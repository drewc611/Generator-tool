import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  buildModel, classifyScreen, extractRule, generaliseName, inferEndpoints, inferFields, observedStates,
} from "../plugins/dsp-behavior/model.js";
import { generalise, signatureOf } from "../plugins/input-explore/index.js";
import { ROOT } from "./helpers.js";

const exploration = JSON.parse(
  await readFile(join(ROOT, "test/fixtures/explored/exploration.json"), "utf8")
);
const model = buildModel(exploration);

test("the fixture is a real recording of the example app", () => {
  assert.equal(exploration.screens.length, 3);
  assert.ok(exploration.steps.length > 10);
  assert.ok(exploration.requests.length > 10);
});

// The bug this guards: one screen per record. A detail view showing order
// A-1001 and one showing A-1002 are the same screen.
test("anything that looks like an identifier is generalised before screens are counted", () => {
  assert.equal(generalise("Order A-1001"), "Order :id");
  assert.equal(generalise("/orders/8f14e45f-ceea-467a-9f8a-6f2c1d0b1a11"), "/orders/:id");
  assert.equal(generalise("Total 4210.5"), "Total :n");
  assert.equal(generalise("New order"), "New order");
  assert.notEqual(
    signatureOf({ url: "/a", regions: ["main"], headings: ["Order A-1"] }),
    signatureOf({ url: "/b", regions: ["main"], headings: ["Order A-1"] })
  );
  assert.equal(
    signatureOf({ url: "/o/1", regions: ["main"], headings: ["Order A-1001"] }),
    signatureOf({ url: "/o/2", regions: ["main"], headings: ["Order A-1002"] })
  );
});

test("a screen showing one record is not named after that record", () => {
  assert.equal(generaliseName("Order A-1001"), "Order");
  assert.equal(generaliseName("New order"), "New order");
  assert.equal(generaliseName("A-1001"), "A-1001", "a name that is only an id keeps it rather than becoming empty");
});

test("several paths differing in the last segment are one endpoint with a parameter", () => {
  const endpoints = inferEndpoints([
    { method: "GET", path: "/api/v1/orders/A-1001", status: 200, query: [] },
    { method: "GET", path: "/api/v1/orders/A-1002", status: 200, query: [] },
    { method: "GET", path: "/api/v1/orders", status: 200, query: ["q"] },
  ]);
  const paths = endpoints.map((e) => `${e.method} ${e.path}`);
  assert.ok(paths.includes("GET /api/v1/orders/:id"));
  assert.ok(paths.includes("GET /api/v1/orders"));
  assert.deepEqual(endpoints.find((e) => e.path.includes(":id")).params, ["id"]);
});

test("a single example is a path, not a pattern", () => {
  const endpoints = inferEndpoints([{ method: "GET", path: "/api/v1/settings", status: 200, query: [] }]);
  assert.deepEqual(endpoints.map((e) => e.path), ["/api/v1/settings"]);
  assert.deepEqual(endpoints[0].params, []);
});

// Somebody's test data is not part of the model.
test("a request body is recorded as a shape, never as values", () => {
  const [endpoint] = inferEndpoints([
    { method: "POST", path: "/api/v1/orders", status: 201, query: [], body: '{"customer":"Jane Smith","total":99}' },
  ]);
  assert.deepEqual(endpoint.observedBody, { customer: "string", total: "number" });
  assert.ok(!JSON.stringify(endpoint).includes("Jane Smith"));
});

test("the model recovered from the fixture is the app that was explored", () => {
  assert.deepEqual(model.screens.map((s) => s.kind).sort(), ["detail", "form", "list"]);
  const paths = model.endpoints.map((e) => `${e.method} ${e.path}`).sort();
  assert.deepEqual(paths, ["GET /api/v1/orders", "GET /api/v1/orders/:id", "POST /api/v1/orders"]);
  assert.deepEqual(model.endpoints.find((e) => e.method === "POST").observedBody, { customer: "string" });
  assert.deepEqual(model.endpoints.find((e) => e.path === "/api/v1/orders" && e.method === "GET").query, ["q"]);
});

test("a screen is classified by what it showed", () => {
  assert.equal(classifyScreen({ collection: { columns: ["a"] }, elements: [] }), "list");
  assert.equal(
    classifyScreen({ elements: [{ tag: "input" }, { tag: "button", name: "Create order" }] }),
    "form"
  );
  assert.equal(classifyScreen({ elements: [{ tag: "button", name: "Back" }] }), "detail");
});

test("a required field is one the app said was required", () => {
  const screen = {
    id: "s1",
    elements: [{ tag: "input", id: "customer", name: "Customer", labelled: true, type: "text" }],
  };
  const steps = [{ from: "s1", messages: ["Orders Portal New order Customer Customer is required Create order"] }];
  const [field] = inferFields(screen, steps);
  assert.equal(field.required, true);
  assert.equal(field.validation, "Customer is required");
});

test("a field the app never complained about is not marked required", () => {
  const screen = { id: "s1", elements: [{ tag: "input", id: "note", name: "Note", labelled: true }] };
  const [field] = inferFields(screen, [{ from: "s1", messages: ["Saved"] }]);
  assert.equal(field.required, false);
  assert.equal(field.validation, null);
});

test("a rule is the sentence, not the whole page it was found on", () => {
  assert.equal(extractRule("Orders Portal New order Customer Customer is required Create order Cancel"), "Customer is required");
  assert.equal(extractRule("Email address is invalid try again"), "Email address is invalid");
  assert.equal(extractRule("Please enter a valid postcode before continuing"), "Please enter a valid postcode");
  assert.equal(extractRule("nothing matches here"), "nothing matches here");
});

test("the customer field recovered from the fixture carries the rule the app stated", () => {
  const form = model.screens.find((s) => s.kind === "form");
  assert.equal(form.fields.length, 1);
  assert.equal(form.fields[0].required, true);
  assert.equal(form.fields[0].validation, "Customer is required");
});

test("a state that was never seen is reported as unseen, not as absent", () => {
  const seen = observedStates("s1", [{ id: "s1", text: "Loading orders" }], []);
  assert.equal(seen.loading, true);
  assert.equal(seen.error, false);
  const empty = observedStates("s2", [{ id: "s2", text: "x", collection: { rows: 0 } }], []);
  assert.equal(empty.empty, true);
});

test("a control labelled with the record it sits on becomes one control", () => {
  const rows = model.transitions.filter((t) => t.via === "a row");
  assert.equal(rows.length, 1, "three rows are one control, not three");
  assert.ok(!JSON.stringify(model.transitions).includes("Northwind"), "no customer name reaches the model");
});

test("the flow the explorer walked is recorded", () => {
  const vias = model.transitions.map((t) => t.via);
  assert.ok(vias.includes("New order"));
  assert.ok(vias.includes("Back to orders"));
  assert.ok(vias.includes("Cancel"));
});

test("each request is attributed to the control that fired it", () => {
  const row = model.wiring.find((w) => w.via === "a row");
  assert.equal(row.endpoint, "GET /api/v1/orders/:id");
  assert.ok(model.wiring.some((w) => w.endpoint === "POST /api/v1/orders"));
});
