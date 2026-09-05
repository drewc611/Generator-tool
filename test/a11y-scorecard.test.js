import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../plugins/vis-a11y/index.js";

/**
 * vis-a11y gathers what the seven accessibility analyzers measured into one
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

test("it sums each analyzer's own count and names the source files", async () => {
  const ctx = await run({
    landmarks: [{ rel: "a.html", issues: ["no main"] }, { rel: "b.html", issues: [] }],
    labels: { findings: [{}, {}] },
    a11y: [{ severity: "high" }],
    focus: { findings: [{}, {}, {}], byKind: {}, multiAutofocus: 0 },
    media: { findings: [{}], videos: 1, audios: 0, noCaptions: 1, withIssues: 1 },
    tables: { findings: [{}], dataTables: 1, noCaption: 1, noScope: 1, withIssues: 1 },
    iframes: { findings: [{}], thirdParty: 1, noTitle: 1, unsandboxedThirdParty: 1, hosts: ["v.com"] },
  });
  // 1 landmark page with a gap + 2 labels + 1 contrast + 3 focus + 1 media + 2 table gaps + 1 iframe = 11
  assert.equal(ctx.a11yScorecard.total, 11);
  assert.equal(ctx.a11yScorecard.measured, 7);
  assert.ok(ctx.written["ACCESSIBILITY.md"], "it wrote the scorecard");
  assert.match(ctx.written["ACCESSIBILITY.md"], /\*\*11\*\* item\(s\) flagged across \*\*7\*\*/);
  assert.match(ctx.written["ACCESSIBILITY.md"], /FOCUS.md/, "it points at the per-axis reports");
});

test("an axis whose plugin did not run is 'not measured', never scored zero", async () => {
  const ctx = await run({ labels: { findings: [{}] } });
  assert.equal(ctx.a11yScorecard.measured, 1);
  assert.equal(ctx.a11yScorecard.total, 1);
  assert.match(ctx.written["ACCESSIBILITY.md"], /Landmarks \| not measured/);
  assert.match(ctx.written["ACCESSIBILITY.md"], /Media captions \| not measured/);
});

test("when no analyzer ran, it writes nothing", async () => {
  const ctx = await run({});
  assert.deepEqual(ctx.written, {}, "no accessibility data, no scorecard");
  assert.equal(ctx.a11yScorecard, undefined);
});

test("it does not collide with dsp-a11y's own A11Y.md and adds no dependency", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/vis-a11y/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ctx\.write\("A11Y\.md"/, "the scorecard uses ACCESSIBILITY.md, not dsp-a11y's A11Y.md");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:/, `${line.trim()} is not a node builtin`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:\/\//, "the plugin does not reach the network");
});
