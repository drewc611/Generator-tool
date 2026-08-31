import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildConfig } from "../plugins/output-tailwind/index.js";
import { buildDocument } from "../plugins/output-design-tokens/index.js";
import { renderRecord } from "../plugins/output-adr/index.js";
import { planSteps } from "../plugins/output-migration/index.js";
import { runPipeline } from "./helpers.js";

const TOKENS = {
  size: { md: 14, lg: 18 }, weight: { regular: 400 }, space: [4, 8],
  radius: { control: 6 }, color: { accent: "#004B87", ink: "#111111" },
};

/* ------------------------------------------------------ output-tailwind */

test("the tailwind config extends, never replaces", () => {
  const source = buildConfig(TOKENS, "test");
  assert.match(source, /extend:/);
  assert.doesNotMatch(source, /theme:\s*\{\s*colors:/, "colors sit under extend, not under theme");
  assert.match(source, /"accent": "#004B87"/);
  assert.match(source, /"md": "14px"/);
});

/* -------------------------------------------------- output-design-tokens */

test("every design token carries its type, and the document says what it is", () => {
  const doc = buildDocument(TOKENS, "measured");
  assert.equal(doc.$description, "measured");
  assert.deepEqual(doc.color.accent, { $type: "color", $value: "#004B87" });
  assert.deepEqual(doc.font.size.md, { $type: "dimension", $value: "14px" });
  assert.equal(doc.font.weight.regular.$value, 400, "weight did not overwrite size");
});

test("measured and proposed tokens are two documents, never one", async (t) => {
  const { ctx, out, cleanup } = await runPipeline({ designTokens: true });
  t.after(cleanup);
  const measured = JSON.parse(await readFile(join(out, "design/tokens.json"), "utf8"));
  const proposed = JSON.parse(await readFile(join(out, "design/tokens.modern.json"), "utf8"));
  assert.match(measured.$description, /Measured/);
  assert.match(proposed.$description, /Proposed/);
});

/* ----------------------------------------------------------- output-i18n */

test("a split sentence arrives as one ICU message", async (t) => {
  const { ctx, out, cleanup } = await runPipeline({ icu: true, src: join(process.cwd(), "test/fixtures/icu") });
  t.after(cleanup);
  const messages = JSON.parse(await readFile(join(out, "src/i18n/en.icu.json"), "utf8"));
  const values = Object.values(messages);
  assert.ok(values.some((v) => /\{count\}/.test(v)), "the placeholder kept its name");
  assert.ok(values.every((v) => !/\{\{/.test(v)), "no template syntax survived");
});

test("an unnameable placeholder is numbered and reported", async (t) => {
  const { ctx, cleanup } = await runPipeline({ icu: true, src: join(process.cwd(), "test/fixtures/icu") });
  t.after(cleanup);
  assert.ok(ctx.report.unverified.some((u) => /cannot reorder a placeholder/.test(u)));
});

/* ------------------------------------------------------------ output-adr */

test("every record is proposed, and carries its premise", () => {
  const record = renderRecord(
    { title: "Do the thing", because: "the legacy fact", instead: "the better shape", source: "crud-table" },
    3, "crud-table"
  );
  assert.match(record, /^# 3\. Do the thing/m);
  assert.match(record, /Status: proposed/);
  assert.match(record, /the legacy fact/);
  assert.match(record, /premise goes with it/);
});

/* ------------------------------------------------------ output-migration */

test("provable steps go first and unported routes go last", () => {
  const steps = planSteps(
    [
      { fullPath: "/unported", screen: null, component: "GhostComponent" },
      { fullPath: "/proven", screen: "app-a" },
      { fullPath: "/home", redirectTo: "/proven" },
    ],
    [{ selector: "app-a" }],
    { hasConformance: true }
  );
  assert.deepEqual(steps.map((s) => s.route), ["/proven", "/unported"]);
  assert.equal(steps[0].proof, "conformance suite");
  assert.equal(steps[1].proof, null, "an unported route has no proof to claim");
});

test("a migration plan without routes refuses to guess", async (t) => {
  const { ctx, cleanup } = await runPipeline({ migration: true, src: join(process.cwd(), "example/legacy-vue") });
  t.after(cleanup);
  assert.ok(!ctx.written.includes("MIGRATION.md"));
});

/* ------------------------------------------------- msw failure scenarios */

test("the scenarios cover slow, failing and empty, from the same endpoints", async (t) => {
  const { out, cleanup } = await runPipeline({ msw: true });
  t.after(cleanup);
  const source = await readFile(join(out, "src/mocks/scenarios.js"), "utf8");
  assert.match(source, /export const slow/);
  assert.match(source, /export const failing/);
  assert.match(source, /export const empty/);
  assert.match(source, /\/api\/v1\/orders/);
});
