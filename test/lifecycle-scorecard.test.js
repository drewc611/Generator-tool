import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../plugins/vis-lifecycle/index.js";

/**
 * vis-lifecycle gathers what the three cleanup analyzers measured into one
 * scorecard. It invents nothing: every number is another plugin's, an axis whose
 * plugin did not run is "not measured", and it writes nothing when none ran.
 */

function run(ctx) {
  const handlers = {};
  plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
  ctx.written = {};
  ctx.write = async (rel, contents) => { ctx.written[rel] = contents; };
  return handlers.verify(ctx).then(() => ctx);
}

test("it is a vis plugin that runs at verify", () => {
  assert.equal(plugin.class, "vis");
});

test("it sums each analyzer's own leak count and names the source files", async () => {
  const ctx = await run({
    timers: { findings: [{}, {}, {}], byKind: {}, uncleared: 2 },
    events: { findings: [{}, {}], byEvent: {}, unremoved: 1 },
    observers: { findings: [{}], byKind: {}, unclosed: 1 },
  });
  // 2 uncleared timers + 1 unremoved listener + 1 unclosed observer = 4
  assert.equal(ctx.lifecycleScorecard.total, 4);
  assert.equal(ctx.lifecycleScorecard.measured, 3);
  assert.ok(ctx.written["LIFECYCLE_SCORECARD.md"], "it wrote the scorecard");
  assert.match(ctx.written["LIFECYCLE_SCORECARD.md"], /\*\*4\*\* leak\(s\) flagged across \*\*3\*\*/);
  assert.match(ctx.written["LIFECYCLE_SCORECARD.md"], /Timers \| 2 \/ 3/, "each row carries the count of those scheduled");
  assert.match(ctx.written["LIFECYCLE_SCORECARD.md"], /EVENTS.md/, "it points at the per-axis reports");
});

test("an axis whose plugin did not run is 'not measured', never scored zero", async () => {
  const ctx = await run({ events: { findings: [{}], byEvent: {}, unremoved: 1 } });
  assert.equal(ctx.lifecycleScorecard.measured, 1);
  assert.equal(ctx.lifecycleScorecard.total, 1);
  assert.match(ctx.written["LIFECYCLE_SCORECARD.md"], /Timers \| not measured/);
  assert.match(ctx.written["LIFECYCLE_SCORECARD.md"], /Observers \| not measured/);
});

test("storage writes are deliberately not counted as leaks", async () => {
  const ctx = await run({ storage: { findings: [{}, {}], byStore: {} }, timers: { findings: [], byKind: {}, uncleared: 0 } });
  assert.equal(ctx.lifecycleScorecard.total, 0, "a storage write is a persistence surface, not a teardown");
  assert.doesNotMatch(ctx.written["LIFECYCLE_SCORECARD.md"], /\| Storage \|/, "storage has no row in the leak table");
});

test("when no analyzer ran, it writes nothing", async () => {
  const ctx = await run({});
  assert.deepEqual(ctx.written, {}, "no cleanup data, no scorecard");
  assert.equal(ctx.lifecycleScorecard, undefined);
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/vis-lifecycle/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:\/\//, "the plugin does not reach the network");
});
