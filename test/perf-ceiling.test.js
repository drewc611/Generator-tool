import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { perfTotal } from "../plugins/vis-perf/index.js";
import { runPipeline } from "./helpers.js";

/**
 * --max-perf turns the performance scorecard into a ceiling the run enforces,
 * the same shape as --max-security, --max-a11y, --max-kb and --max-unverified:
 * it only ever adds a gate. The gate reckons the total through vis-perf's own
 * function from what the analyzers left at plan, so it agrees with the
 * scorecard and does not depend on which verify handler ran first. The port's
 * size is never in the count; a byte is not a defect.
 */

async function heavyPage() {
  const dir = await mkdtemp(join(tmpdir(), "perfceil-"));
  // A render-blocking head script (dsp-render-blocking) and an image with no
  // srcset, lazy loading or dimensions (dsp-images): items the scorecard counts.
  await writeFile(join(dir, "page.html"), '<html><head><script src="a.js"></script></head><body><img src="hero.jpg"></body></html>');
  return dir;
}

test("the total the gate uses is the scorecard's own reckoning, and size is not in it", () => {
  const ctx = {
    perf: [{}],
    renderBlocking: { findings: [{}, {}], byKind: {} },
    images: [{ wants: ["a srcset"] }, { wants: [] }],
    size: { total: 1024 * 1024, kinds: [], componentBytes: 0, files: [] },
  };
  assert.equal(perfTotal(ctx), 4, "1 perf + 2 blocking + 1 needy image; a megabyte of size adds nothing");
  assert.equal(perfTotal({}), 0, "nothing measured, nothing counted");
});

test("a ceiling of zero fails a heavy page; a high ceiling passes it", async (t) => {
  const src = await heavyPage();
  t.after(() => rm(src, { recursive: true, force: true }));

  const over = await runPipeline({ src, maxPerf: 0 });
  t.after(over.cleanup);
  assert.ok(over.error, "a ceiling of zero fails a page with a blocking script and an unlazy image");
  assert.match(over.error.message, /performance item\(s\) against a ceiling of 0/);
  assert.match(over.error.message, /PERFORMANCE\.md/, "the failure names where each item is listed");

  const under = await runPipeline({ src, maxPerf: 99 });
  t.after(under.cleanup);
  assert.equal(under.error, null, "under the ceiling the run passes");
});

test("the ceiling is opt in and never relaxes a gate: no flag, no check", async (t) => {
  const src = await heavyPage();
  t.after(() => rm(src, { recursive: true, force: true }));
  const run = await runPipeline({ src });
  t.after(run.cleanup);
  assert.equal(run.error, null, "with no ceiling set, performance items are reported, not enforced");
  assert.ok(run.ctx.written.includes("PERFORMANCE.md"), "the scorecard still reports them");
});

test("a ceiling that is not a number is refused out loud", async (t) => {
  const src = await heavyPage();
  t.after(() => rm(src, { recursive: true, force: true }));
  const run = await runPipeline({ src, maxPerf: "fast" });
  t.after(run.cleanup);
  assert.ok(run.error);
  assert.match(run.error.message, /--max-perf needs a number/);
});
