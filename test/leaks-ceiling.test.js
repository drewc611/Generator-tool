import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { leaksTotal } from "../plugins/vis-lifecycle/index.js";
import { runPipeline } from "./helpers.js";

/**
 * --max-leaks turns the lifecycle scorecard into a ceiling the run enforces,
 * the same shape as --max-security, --max-perf, --max-a11y, --max-kb and
 * --max-unverified: it only ever adds a gate. The gate reckons the total through
 * vis-lifecycle's own function, from what the analyzers left at plan, so it
 * agrees with the scorecard and does not depend on which verify handler ran
 * first.
 */

async function leakyScript() {
  const dir = await mkdtemp(join(tmpdir(), "leakceil-"));
  // One unremoved listener (dsp-events), one uncleared interval (dsp-timers)
  // and one undisconnected observer (dsp-observers): three leaks the scorecard
  // counts.
  await writeFile(
    join(dir, "widget.js"),
    'window.addEventListener("resize", onResize);\nsetInterval(tick, 1000);\nconst io = new IntersectionObserver(onSee);\n'
  );
  return dir;
}

test("the total the gate uses is the scorecard's own reckoning", () => {
  const ctx = {
    timers: { findings: [{}, {}], byKind: {}, uncleared: 1 },
    events: { findings: [{}], byEvent: {}, unremoved: 1 },
    storage: { findings: [{}, {}], byStore: {} },
  };
  assert.equal(leaksTotal(ctx), 2, "1 uncleared timer + 1 unremoved listener; storage writes are not leaks");
  assert.equal(leaksTotal({}), 0, "nothing measured, nothing counted");
});

test("a ceiling of zero fails a script with leaks; a high ceiling passes it", async (t) => {
  const src = await leakyScript();
  t.after(() => rm(src, { recursive: true, force: true }));

  const over = await runPipeline({ src, maxLeaks: 0 });
  t.after(over.cleanup);
  assert.ok(over.error, "a ceiling of zero fails a script with an unremoved listener, an uncleared timer and an open observer");
  assert.match(over.error.message, /leak\(s\) against a ceiling of 0/);
  assert.match(over.error.message, /LIFECYCLE_SCORECARD\.md/, "the failure names where each item is listed");

  const under = await runPipeline({ src, maxLeaks: 99 });
  t.after(under.cleanup);
  assert.equal(under.error, null, "under the ceiling the run passes");
});

test("the ceiling is opt in and never relaxes a gate: no flag, no check", async (t) => {
  const src = await leakyScript();
  t.after(() => rm(src, { recursive: true, force: true }));
  const run = await runPipeline({ src });
  t.after(run.cleanup);
  assert.equal(run.error, null, "with no ceiling set, leaks are reported, not enforced");
  assert.ok(run.ctx.written.includes("LIFECYCLE_SCORECARD.md"), "the scorecard still reports them");
});

test("a ceiling that is not a number is refused out loud", async (t) => {
  const src = await leakyScript();
  t.after(() => rm(src, { recursive: true, force: true }));
  const run = await runPipeline({ src, maxLeaks: "lots" });
  t.after(run.cleanup);
  assert.ok(run.error);
  assert.match(run.error.message, /--max-leaks needs a number/);
});
