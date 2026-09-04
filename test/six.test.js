import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readSfc, sfcBlock, propNames } from "../plugins/input-vue/index.js";
import { measureSpacing } from "../plugins/dsp-tokens/measure.js";
import { pseudoLocalize } from "../plugins/output-i18n/index.js";
import { readSpec, declaredShape } from "../plugins/input-openapi/index.js";
import { buildFixtures } from "../plugins/output-fixtures/index.js";
import { pixelDiff } from "../plugins/vis-parity/pixels.js";
import { runPipeline } from "./helpers.js";

/* ------------------------------------------- the structural Vue reader */

test("a template containing a template is read whole, not truncated", () => {
  const sfc = `<template><div><template v-if="a"><p>A</p></template><p>after</p></div></template>`;
  const { screen } = readSfc(sfc, "Deep.vue");
  assert.match(screen.template, /<p>after<\/p>/, "the lazy regex used to stop at the inner close tag");
  assert.equal(sfcBlock(sfc, "template").body, screen.template);
});

test("a nested default object no longer swallows the props after it", () => {
  const { screen } = readSfc(
    `<template><p/></template><script>export default { props: { rows: { type: Array, default: () => ({ a: 1 }) }, q: String } }</script>`,
    "x.vue"
  );
  assert.deepEqual(screen.inputs.sort(), ["q", "rows"]);
});

test("all three props spellings still read, which is the byte identical gate", () => {
  assert.deepEqual(propNames(`['a', 'b']`), ["a", "b"]);
  assert.deepEqual(propNames(`{ a: String, b: { type: Number } }`), ["a", "b"]);
  const { screen } = readSfc(`<template><p/></template><script setup>const p = defineProps({ region: String })</script>`, "y.vue");
  assert.deepEqual(screen.inputs, ["region"]);
});

/* -------------------------------------------------- measured spacing */

const box = (x, y, w, h) => ({ box: { x, y, w, h }, tag: "div", disabled: false });

test("spacing is measured from gaps between recorded boxes and clustered", () => {
  const exploration = {
    screens: [{
      elements: [
        box(10, 10, 200, 30), box(10, 48, 200, 30), box(10, 86, 200, 30),   // 8px vertical rhythm
        box(10, 140, 60, 30), box(86, 140, 60, 30), box(162, 140, 60, 30), // 16px horizontal rhythm
      ],
    }],
  };
  const spacing = measureSpacing(exploration, [4, 8, 12, 16, 24, 32, 48]);
  assert.ok(spacing, "enough gaps to measure");
  assert.ok(spacing.scale.includes(8), "the vertical rhythm is a rung");
  assert.ok(spacing.scale.includes(16), "the horizontal rhythm is a rung");
  assert.equal(spacing.scale.length, 7, "the ladder keeps seven rungs for the components that index it");
  assert.match(spacing.evidence, /measured/);
});

test("a recording without positions measures nothing", () => {
  const old = { screens: [{ elements: [{ box: { w: 100, h: 30 } }, { box: { w: 100, h: 30 } }] }] };
  assert.equal(measureSpacing(old, [4, 8]), null);
});

/* --------------------------------------------------- the pseudo locale */

test("the pseudo locale accents, brackets and expands, placeholders untouched", () => {
  const out = pseudoLocalize("You have {count} unread messages");
  assert.ok(out.startsWith("⟦") && out.endsWith("⟧"));
  assert.match(out, /\{count\}/, "the placeholder survives byte for byte");
  assert.match(out, /Ýóú/);
  assert.ok(out.length > "You have {count} unread messages".length * 1.2, "a third longer, roughly");
});

/* -------------------------------------- spec declared shapes, labeled */

const SPEC = {
  openapi: "3.0.0",
  components: { schemas: { Order: { type: "object", properties: { id: { type: "number" }, customer: { type: "string" } } } } },
  paths: {
    "/api/orders": { get: { responses: { 200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Order" } } } } } } } },
    "/api/ping": { get: { responses: { 200: {} } } },
  },
};

test("a declared response shape is read through its local ref", () => {
  const operations = readSpec(SPEC);
  const orders = operations.find((op) => op.path === "/api/orders");
  assert.deepEqual(orders.declaredShape, { kind: "array", props: { id: "number", customer: "string" } });
  assert.equal(operations.find((op) => op.path === "/api/ping").declaredShape, null);
});

test("a fixture from the spec is typed, and says whose claim it is", () => {
  const fixtures = buildFixtures({
    api: { calls: [{ method: "GET", path: "/api/orders" }] },
    model: null,
    spec: { operations: readSpec(SPEC) },
  });
  const orders = fixtures.find((f) => f.path === "/api/orders");
  assert.ok(orders.fromSpec);
  assert.ok(Array.isArray(orders.body));
  assert.deepEqual(orders.body[0], { id: 0, customer: "<customer>" }, "types, never values");
  assert.match(JSON.stringify(orders.body), /document's claim/);
});

test("an observed shape still outranks the spec's claim", () => {
  const fixtures = buildFixtures({
    api: { calls: [{ method: "GET", path: "/api/orders" }] },
    model: { endpoints: [{ method: "GET", path: "/api/orders", observedBody: { total: "number" } }] },
    spec: { operations: readSpec(SPEC) },
  });
  assert.deepEqual(fixtures[0].body, { total: 0 });
  assert.ok(fixtures[0].observed && !fixtures[0].fromSpec);
});

/* --------------------------------------------- provenance in the index */

test("PORT_README names the plugin behind every artifact", async (t) => {
  const { out, error, cleanup } = await runPipeline({ src: join(process.cwd(), "example/legacy") });
  t.after(cleanup);
  assert.equal(error, null);
  const readme = await readFile(join(out, "PORT_README.md"), "utf8");
  assert.match(readme, /\*\(dsp-apistyle\)\*/);
  assert.match(readme, /\*\(dsp-archetype\)\*/);
  assert.match(readme, /portamp explain/);
});

/* ------------------------------------------------------ the pixel diff */

test("the pixel diff is zero against itself and honest about what it cannot do", async (t) => {
  const { out, error, cleanup } = await runPipeline({ src: join(process.cwd(), "example/legacy"), html: true });
  t.after(cleanup);
  assert.equal(error, null);

  const probe = await pixelDiff({ outDir: out, elementRel: "src/elements/AppOrders.js", shotPath: join(out, "does-not-exist.png") });
  assert.match(probe.skipped ?? "", /empty|screenshot/, "a missing recording is a named skip");

  // The self diff needs a browser; without one the skip must say so.
  const temp = await mkdtemp(join(tmpdir(), "portamp-px-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  let chromium = null;
  try {
    chromium = (await import("playwright")).chromium;
  } catch { /* optional */ }
  if (!chromium) return t.skip("playwright not installed");

  let browser;
  try {
    const executablePath = process.env.PORTAMP_CHROMIUM || undefined;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch {
    return t.skip("no browser binary; set PORTAMP_CHROMIUM to run this");
  }
  const page = await browser.newPage();
  const runtime = (await readFile(join(out, "src/elements/runtime.js"), "utf8")).replace(/^export /gm, "");
  const element = (await readFile(join(out, "src/elements/AppOrders.js"), "utf8")).replace(/^import[^\n]*from "\.\/runtime\.js";\n?/m, "");
  await page.setContent(`<body style="margin:0;background:#fff"><app-orders id="el"></app-orders></body>`);
  await page.addScriptTag({ content: runtime + "\n" + element, type: "module" });
  await page.waitForTimeout(150);
  const shotPath = join(temp, "orders.png");
  await writeFile(shotPath, await page.locator("#el").screenshot());
  await browser.close();

  const same = await pixelDiff({ outDir: out, elementRel: "src/elements/AppOrders.js", shotPath });
  assert.equal(same.pct, 0, "the element against its own render differs nowhere");
});
