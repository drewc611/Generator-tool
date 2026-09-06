import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { securityTotal } from "../plugins/vis-security/index.js";
import { runPipeline } from "./helpers.js";

/**
 * --max-security turns the security scorecard into a ceiling the run enforces,
 * the same shape as --max-unverified, --max-kb and --max-a11y: it only ever adds
 * a gate. The gate reckons the total through vis-security's own function, from
 * what the analyzers left at plan, so it agrees with the scorecard and does not
 * depend on which verify handler ran first.
 */

async function leakyPage() {
  const dir = await mkdtemp(join(tmpdir(), "secceil-"));
  // One inline handler (dsp-security) and one unpinned third-party script
  // (dsp-supplychain): two items the scorecard counts.
  await writeFile(join(dir, "page.html"), '<a href="x" onclick="go()">x</a><script src="https://cdn.example.com/a.js"></script>');
  return dir;
}

test("the total the gate uses is the scorecard's own reckoning", () => {
  const ctx = {
    security: { findings: [{}, {}], byKind: {} },
    supplychain: { deps: [{ sri: false }] },
    cookies: { cookies: [{}], consent: ["OneTrust"] },
  };
  assert.equal(securityTotal(ctx), 3, "2 findings + 1 unpinned dep; consented cookies are not counted");
  assert.equal(securityTotal({}), 0, "nothing measured, nothing counted");
});

test("a ceiling of zero fails a page with security items; a high ceiling passes it", async (t) => {
  const src = await leakyPage();
  t.after(() => rm(src, { recursive: true, force: true }));

  const over = await runPipeline({ src, maxSecurity: 0 });
  t.after(over.cleanup);
  assert.ok(over.error, "a ceiling of zero fails a page with an inline handler and an unpinned script");
  assert.match(over.error.message, /security item\(s\) against a ceiling of 0/);
  assert.match(over.error.message, /SECURITY_SCORECARD\.md/, "the failure names where each item is listed");

  const under = await runPipeline({ src, maxSecurity: 99 });
  t.after(under.cleanup);
  assert.equal(under.error, null, "under the ceiling the run passes");
});

test("the ceiling is opt in and never relaxes a gate: no flag, no check", async (t) => {
  const src = await leakyPage();
  t.after(() => rm(src, { recursive: true, force: true }));
  const run = await runPipeline({ src });
  t.after(run.cleanup);
  assert.equal(run.error, null, "with no ceiling set, security items are reported, not enforced");
  assert.ok(run.ctx.written.includes("SECURITY_SCORECARD.md"), "the scorecard still reports them");
});

test("a ceiling that is not a number is refused out loud", async (t) => {
  const src = await leakyPage();
  t.after(() => rm(src, { recursive: true, force: true }));
  const run = await runPipeline({ src, maxSecurity: "lots" });
  t.after(run.cleanup);
  assert.ok(run.error);
  assert.match(run.error.message, /--max-security needs a number/);
});
