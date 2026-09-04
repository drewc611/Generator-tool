import assert from "node:assert/strict";
import test from "node:test";

import { decodeEntities, parse } from "../plugins/dsp-ir/parse.js";
import { DIALECTS } from "../plugins/dsp-ir/ir.js";
import { translate } from "../plugins/output-react/template.js";
import { toVue } from "../plugins/output-vue/print.js";
import { renderScenarios } from "../plugins/output-msw/index.js";
import { workflow } from "../plugins/output-ci/index.js";
import { buildDocument } from "../plugins/output-design-tokens/index.js";
import { buildConfig } from "../plugins/output-tailwind/index.js";

test("entities in attribute values and text decode once, and only once", () => {
  assert.equal(decodeEntities("&quot;a&quot; &amp;quot; &lt;b&gt;"), '"a" &quot; <b>');
  const [el] = parse(`<button title="Save &amp; close">Fish &amp; chips</button>`);
  assert.equal(el.attrs[0].value, "Save & close");
  assert.equal(el.children[0].text, "Fish & chips");
});

test("$emit and EventEmitter.emit both become the callback prop", () => {
  const vue = translate(`<button @click="$emit('pick', row)">go</button>`, { indent: 0, dialect: DIALECTS.vue });
  assert.match(vue.jsx, /onClick=\{\(\) => onPick\(row\)\}/);
  assert.ok(vue.reads.includes("onPick"), "the callback arrives as a prop");
  const ng = translate(`<button (click)="saved.emit(order)">go</button>`, { indent: 0, dialect: DIALECTS.angular });
  assert.match(ng.jsx, /onSaved\(order\)/);
});

test("the rejecting scenario refuses writes in the app's own words", () => {
  const script = renderScenarios(
    [{ method: "POST", path: "/api/orders" }, { method: "GET", path: "/api/orders" }],
    ["Customer is required"],
  );
  assert.match(script, /export const rejecting/);
  assert.match(script, /Customer is required/);
  assert.match(script, /method !== "get"/);
});

test("the port CI runs the states suite when one was emitted", () => {
  const withSuite = workflow(["src/features/A/A.jsx", "tests/states.test.js"]);
  assert.match(withSuite, /node --test tests\/states\.test\.js/);
  const without = workflow(["src/features/A/A.jsx"]);
  assert.doesNotMatch(without, /states\.test\.js/);
});

test("design tokens carry their evidence in $extensions", () => {
  const doc = buildDocument({ color: { ink: "#111111" } }, "measured", ["colors from 40 sampled pixels"]);
  assert.deepEqual(doc.$extensions["dev.portamp.evidence"], ["colors from 40 sampled pixels"]);
  const bare = buildDocument({ color: { ink: "#111111" } }, "measured");
  assert.equal(bare.$extensions, undefined);
});

test("the tailwind config says where each scale came from", () => {
  const config = buildConfig({ color: { ink: "#111" } }, "the measured legacy design", ["spacing from recorded element gaps"]);
  assert.match(config, /spacing from recorded element gaps/);
  assert.match(config, /a default the/);
});

test("v-model modifiers survive the trip back into vue", () => {
  const out = toVue(`<input v-model.trim.number="amount" />`, { dialect: DIALECTS.vue }).markup;
  assert.match(out, /v-model\.trim\.number="amount"/);
});
