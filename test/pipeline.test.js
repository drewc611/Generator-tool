import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { PolicyViolation } from "../src/core/policy.js";
import { ROOT, runPipeline } from "./helpers.js";

test("the example runs end to end and writes the port", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline();
  t.after(cleanup);
  assert.equal(error, null);

  assert.deepEqual(ctx.written.sort(), [
    "A11Y.md",
    "ARCHITECTURE.md",
    "COVERAGE.md",
    "DEAD_CODE.md",
    "DESIGN_UPLIFT.md",
    "MODERNIZATION.md",
    "PORT_NOTES.md",
    "ROUTES.md",
    "src/api/client.js",
    "src/api/endpoints.js",
    "src/features/AppOrders/AppOrders.jsx",
    "src/i18n/README.md",
    "src/i18n/en.json",
    "src/tokens.js",
    "src/tokens.modern.css",
    "src/tokens.modern.js",
  ]);
  for (const file of ctx.written) {
    const text = await readFile(join(out, file), "utf8");
    assert.ok(text.length > 0, `${file} is empty`);
  }
});

test("it reads what the example actually contains", async (t) => {
  const { ctx, cleanup } = await runPipeline();
  t.after(cleanup);

  assert.equal(ctx.screens.length, 1);
  assert.equal(ctx.screens[0].selector, "app-orders");
  assert.equal(ctx.api.calls.length, 3);
  assert.equal(ctx.api.interceptors.length, 2, "auth and error, not the unused import");
  assert.equal(ctx.sources.screenshots.length, 2);
});

test("the emitted component carries every state and the translated body", async (t) => {
  const { out, cleanup } = await runPipeline();
  t.after(cleanup);
  const jsx = await readFile(join(out, "src/features/AppOrders/AppOrders.jsx"), "utf8");

  assert.match(jsx, /if \(loading\)/, "loading");
  assert.match(jsx, /if \(error\)/, "error");
  assert.match(jsx, /length === 0\)/, "empty");
  assert.match(jsx, /orders\.map\(/, "the ngFor was translated, not left as a TODO");
  assert.match(jsx, /setQuery\(event\.target\.value\)/, "the two way binding became controlled");
  assert.ok(!/TODO port the template/.test(jsx), "the body is no longer a placeholder");
});

test("no URL literal reaches a component", async (t) => {
  const { out, ctx, cleanup } = await runPipeline();
  t.after(cleanup);
  for (const file of ctx.written.filter((f) => f.endsWith(".jsx"))) {
    const text = await readFile(join(out, file), "utf8");
    assert.doesNotMatch(text, /https?:\/\//, `${file} carries a URL`);
    assert.doesNotMatch(text, /\/api\//, `${file} carries an endpoint path`);
  }
  const endpoints = await readFile(join(out, "src/api/endpoints.js"), "utf8");
  assert.match(endpoints, /\/api\/v1\/orders/, "the paths live in exactly one module");
});

test("tokens record what was measured and what was defaulted", async (t) => {
  const { out, ctx, cleanup } = await runPipeline();
  t.after(cleanup);
  assert.equal(ctx.tokens.color.accent, "#004B87", "recovered from --brand in the stylesheet");
  const tokens = await readFile(join(out, "src/tokens.js"), "utf8");
  assert.match(tokens, /accent from \$brand/);
  assert.ok(!/provenance/.test(tokens), "the evidence is a comment, not a token");
});

test("replaying a recording measures the type scale and density", async (t) => {
  const { ctx, out, cleanup } = await runPipeline({ shots: join(ROOT, "test/fixtures/recorded") });
  t.after(cleanup);

  assert.ok(ctx.sources.observedStyles.length > 0, "the recording was replayed");
  assert.equal(ctx.tokens.size.md, 15);
  assert.equal(ctx.tokens.density, "comfortable");
  assert.equal(ctx.tokens.color.ink, "#1C1B19");
  assert.equal(ctx.tokens.color.accent, "#004B87", "a declared name still beats an observed value");

  const tokens = await readFile(join(out, "src/tokens.js"), "utf8");
  assert.match(tokens, /type scale from/);
  assert.match(tokens, /density from/);
});

test("what could not be verified is written down rather than dropped", async (t) => {
  const { ctx, out, cleanup } = await runPipeline();
  t.after(cleanup);
  assert.ok(ctx.report.unverified.length > 0);
  const notes = await readFile(join(out, "PORT_NOTES.md"), "utf8");
  for (const item of ctx.report.unverified) {
    assert.ok(notes.includes(item.slice(0, 40)), `the notes omit: ${item.slice(0, 60)}`);
  }
});

// The gate runs at verify, so unlike the secret gate it cannot stop the write.
// It fails the run and names the file, which is what verify is for.
test("an endpoint baked into a component fails the run", async (t) => {
  const { error, cleanup } = await runPipeline({ src: join(ROOT, "test/fixtures/hardcoded") });
  t.after(cleanup);

  assert.ok(error instanceof PolicyViolation, "the run should have been stopped by policy");
  assert.equal(error.rule, "no-endpoints-in-components");
  assert.equal(error.path, "/api/v1/orders");
  assert.match(error.file, /\.jsx$/);
});

test("a component that only links somewhere external is left alone", async (t) => {
  const { ctx, error, cleanup } = await runPipeline({ src: join(ROOT, "test/fixtures/externallink") });
  t.after(cleanup);

  assert.equal(error, null, "a documentation link is not an endpoint");
  assert.ok(ctx.written.some((f) => f.endsWith(".jsx")));
});

test("a credential in the legacy source stops the run before anything is written", async (t) => {
  const { ctx, error, cleanup } = await runPipeline({ src: join(ROOT, "test/fixtures/leaky") });
  t.after(cleanup);

  assert.ok(error instanceof PolicyViolation, "the run should have been stopped by policy");
  assert.equal(error.rule, "no-credentials-in-source");
  assert.deepEqual(ctx.written, [], "nothing is written once a credential is found");
  assert.ok(!error.message.includes("AKIAIOSFODNN7EXAMPLE"), "the value never reaches the message");
  assert.match(error.message, /config\.ts:5/);
});

test("the run is deterministic", async (t) => {
  const first = await runPipeline();
  const second = await runPipeline();
  t.after(() => Promise.all([first.cleanup(), second.cleanup()]));

  assert.deepEqual(first.ctx.written.sort(), second.ctx.written.sort());
  for (const file of first.ctx.written) {
    assert.equal(
      await readFile(join(first.out, file), "utf8"),
      await readFile(join(second.out, file), "utf8"),
      `${file} differs between runs`
    );
  }
});
