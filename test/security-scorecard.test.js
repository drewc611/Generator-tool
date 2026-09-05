import assert from "node:assert/strict";
import test from "node:test";

import plugin from "../plugins/vis-security/index.js";

/**
 * vis-security gathers what the security analyzers measured into one scorecard.
 * It invents nothing: every number is another plugin's, a concern whose plugin
 * did not run is "not measured", and it writes nothing when none ran.
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
    security: { findings: [{}, {}], byKind: {} },
    supplychain: { deps: [{ sri: true }, { sri: false }, { sri: false }] },
    iframes: { findings: [{}], thirdParty: 2, unsandboxedThirdParty: 1, noTitle: 0, hosts: [] },
    cookies: { cookies: [{}, {}], consent: [] },
    analytics: [{}, {}, {}],
  });
  // 2 security + 2 unpinned deps + 1 unsandboxed iframe + 2 cookies (no consent) + 3 trackers = 10
  assert.equal(ctx.securityScorecard.total, 10);
  assert.equal(ctx.securityScorecard.measured, 5);
  assert.ok(ctx.written["SECURITY_SCORECARD.md"], "it wrote the scorecard");
  assert.match(ctx.written["SECURITY_SCORECARD.md"], /\*\*10\*\* item\(s\) flagged across \*\*5\*\*/);
  assert.match(ctx.written["SECURITY_SCORECARD.md"], /SUPPLYCHAIN.md/, "it points at the per-concern reports");
});

test("cookies with a consent mechanism are not counted as a definite gap", async () => {
  const ctx = await run({ cookies: { cookies: [{}, {}, {}], consent: ["OneTrust"] } });
  assert.equal(ctx.securityScorecard.total, 0, "a consent mechanism means ordering is the reviewer's to confirm, not a counted gap");
  assert.match(ctx.written["SECURITY_SCORECARD.md"], /consent mechanism is present/);
});

test("a concern whose plugin did not run is 'not measured', never scored zero", async () => {
  const ctx = await run({ security: { findings: [{}] } });
  assert.equal(ctx.securityScorecard.measured, 1);
  assert.match(ctx.written["SECURITY_SCORECARD.md"], /Supply chain \| not measured/);
  assert.match(ctx.written["SECURITY_SCORECARD.md"], /Trackers \| not measured/);
});

test("when no analyzer ran, it writes nothing", async () => {
  const ctx = await run({});
  assert.deepEqual(ctx.written, {}, "no security data, no scorecard");
  assert.equal(ctx.securityScorecard, undefined);
});

test("it does not collide with dsp-security's own SECURITY.md and adds no dependency", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/vis-security/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /ctx\.write\("SECURITY\.md"/, "the scorecard uses SECURITY_SCORECARD.md, not dsp-security's SECURITY.md");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:\/\//, "the plugin does not reach the network");
});
