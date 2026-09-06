import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readTimers } from "../plugins/dsp-timers/index.js";

/**
 * dsp-timers names the timers and animation loops a legacy app scheduled, and
 * whether a matching clear appears in the same file, so the port knows which
 * loops it inherits and which already leaked. These hold its edges.
 */

const SRC = [
  "setInterval(fetchData, 5000);",
  "const t = setTimeout(retry, 1000); clearTimeout(t);",
  "requestAnimationFrame(frame);",
  "requestIdleCallback(work);",
].join("\n");

test("it finds every scheduler and whether a clear appears in the file", () => {
  const f = readTimers(SRC, "app.js");
  const kind = (s) => f.find((x) => x.scheduler === s);
  assert.equal(kind("setInterval").cleared, false, "no clearInterval in the file");
  assert.equal(kind("setTimeout").cleared, true, "clearTimeout is in the file");
  assert.equal(kind("requestAnimationFrame").cleared, false, "no cancelAnimationFrame");
  assert.equal(kind("requestIdleCallback").cleared, false, "no cancelIdleCallback");
  assert.equal(f.length, 4);
});

test("a scheduler is paired with its own clear, not any clear", () => {
  const f = readTimers("setInterval(a, 1); clearTimeout(b);", "x.js");
  // clearTimeout is present but it does not clear a setInterval.
  assert.equal(f[0].scheduler, "setInterval");
  assert.equal(f[0].cleared, false, "clearTimeout does not count as clearing setInterval");
});

test("the plugin writes a report only when a timer was scheduled, and flags the uncleared", async () => {
  assert.equal(plugin.class, "dsp");
  const dir = await mkdtemp(join(tmpdir(), "timers-"));
  try {
    await writeFile(join(dir, "poll.js"), SRC);
    await writeFile(join(dir, "pure.js"), "export const add = (a, b) => a + b;");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "poll.js"), rel: "poll.js" },
        { path: join(dir, "pure.js"), rel: "pure.js" },
      ] },
      written: {},
      write: async (rel, contents) => { ctx.written[rel] = contents; },
      unverified: (t) => (ctx.note = t),
    };
    await handlers.plan(ctx);
    await handlers.emit(ctx);
    assert.ok(ctx.written["TIMERS.md"], "it wrote the report");
    assert.match(ctx.written["TIMERS.md"], /setInterval/);
    assert.match(ctx.written["TIMERS.md"], /no `clearInterval` in this file/, "the uncleared interval is called out");
    assert.equal(ctx.timers.uncleared, 3, "three of the four have no clear beside them");
    assert.match(ctx.note, /clean|leak|timer/i);

    const clean = { sources: { files: [{ path: join(dir, "pure.js"), rel: "pure.js" }] }, written: {}, write: async (r, c) => (clean.written[r] = c), unverified: () => {} };
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    await handlers.plan(clean);
    await handlers.emit(clean);
    assert.deepEqual(clean.written, {}, "no timers, no report");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/dsp-timers/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the analyzer does not reach the network");
});
