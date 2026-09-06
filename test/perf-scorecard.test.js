import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../plugins/vis-perf/index.js";

/**
 * vis-perf gathers what the performance analyzers measured into one scorecard.
 * It invents nothing: every number is another plugin's, a concern whose plugin
 * did not run is "not measured", the port's size is shown but never summed into
 * the flagged items, and it writes nothing when none ran.
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

test("it sums each analyzer's own count and shows size without summing it", async () => {
  const ctx = await run({
    perf: [{}, {}],
    renderBlocking: { findings: [{}], byKind: {} },
    inline: { pages: [], totals: { styleAttrs: 3, styleBlocks: 1, scriptBlocks: 1 } },
    images: [{ wants: ["a srcset"] }, { wants: [] }],
    fonts: { faces: [{ formats: ["woff2"], display: "swap" }, { formats: ["ttf"], display: null }], googleFonts: [], fontFiles: 0 },
    size: { total: 20480, kinds: [], componentBytes: 0, files: [] },
  });
  // 2 perf + 1 blocking + 5 inline + 1 needy image + 1 gapped font = 10; size is not summed
  assert.equal(ctx.perfScorecard.total, 10);
  assert.equal(ctx.perfScorecard.measured, 5);
  assert.equal(ctx.perfScorecard.sizeKb, 20, "20480 bytes is 20 KB");
  assert.ok(ctx.written["PERFORMANCE.md"], "it wrote the scorecard");
  assert.match(ctx.written["PERFORMANCE.md"], /\*\*10\*\* item\(s\) flagged across \*\*5\*\*/);
  assert.match(ctx.written["PERFORMANCE.md"], /weighs \*\*20 KB\*\*/);
  assert.match(ctx.written["PERFORMANCE.md"], /not summed/, "size is named as a measurement, not a defect");
});

test("a font with woff2 and a display strategy is clear; one missing either is a gap", async () => {
  const ctx = await run({ fonts: { faces: [{ formats: ["woff2"], display: "swap" }], googleFonts: [], fontFiles: 0 } });
  assert.equal(ctx.perfScorecard.total, 0, "a fully-served face is not a gap");
  const gapped = await run({ fonts: { faces: [{ formats: ["woff2"], display: null }], googleFonts: [], fontFiles: 0 } });
  assert.equal(gapped.perfScorecard.total, 1, "font-display unset is a gap even with woff2");
});

test("a concern whose plugin did not run is 'not measured', never scored zero", async () => {
  const ctx = await run({ perf: [{}] });
  assert.equal(ctx.perfScorecard.measured, 1);
  assert.match(ctx.written["PERFORMANCE.md"], /Images \| not measured/);
  assert.match(ctx.written["PERFORMANCE.md"], /Fonts \| not measured/);
  assert.match(ctx.written["PERFORMANCE.md"], /weight was not measured/);
});

test("when no analyzer ran and no size was measured, it writes nothing", async () => {
  const ctx = await run({});
  assert.deepEqual(ctx.written, {}, "no performance data, no scorecard");
  assert.equal(ctx.perfScorecard, undefined);
});

test("it does not collide with PERF.md or SIZE.md and adds no dependency", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/vis-perf/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ctx\.write\("(PERF|SIZE)\.md"/, "the scorecard uses PERFORMANCE.md");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:\/\//, "the plugin does not reach the network");
});
