import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readEvents } from "../plugins/dsp-events/index.js";

/**
 * dsp-events names the global event listeners a legacy app attached and whether
 * a matching remove appears in the same file, so the port knows which
 * subscriptions it inherits and which already leaked. These hold its edges.
 */

const SRC = [
  'window.addEventListener("resize", onResize);',
  'document.addEventListener("keydown", onKey);',
  'el.addEventListener("click", onClick);',
  'function teardown(){ window.removeEventListener("resize", onResize); }',
].join("\n");

test("it finds each listener, its target and whether a remove appears in the file", () => {
  const f = readEvents(SRC, "app.js");
  const ev = (e) => f.find((x) => x.event === e);
  assert.equal(ev("resize").target, "window");
  assert.equal(ev("resize").removed, true, "resize is removed in the file");
  assert.equal(ev("keydown").target, "document");
  assert.equal(ev("keydown").removed, false, "keydown has no remove");
  assert.equal(ev("click").target, "an element", "a non-global target is not named literally");
  assert.equal(ev("click").removed, false);
  assert.equal(f.length, 3);
});

test("a remove for a different event does not count as removing this one", () => {
  const f = readEvents('window.addEventListener("scroll", a); window.removeEventListener("resize", b);', "x.js");
  assert.equal(f[0].event, "scroll");
  assert.equal(f[0].removed, false, "removing resize does not clear the scroll listener");
});

test("the plugin writes a report only when a listener was attached, and flags the unremoved", async () => {
  assert.equal(plugin.class, "dsp");
  const dir = await mkdtemp(join(tmpdir(), "events-"));
  try {
    await writeFile(join(dir, "widget.js"), SRC);
    await writeFile(join(dir, "pure.js"), "export const add = (a, b) => a + b;");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "widget.js"), rel: "widget.js" },
        { path: join(dir, "pure.js"), rel: "pure.js" },
      ] },
      written: {},
      write: async (rel, contents) => { ctx.written[rel] = contents; },
      unverified: (t) => (ctx.note = t),
    };
    await handlers.plan(ctx);
    await handlers.emit(ctx);
    assert.ok(ctx.written["EVENTS.md"], "it wrote the report");
    assert.match(ctx.written["EVENTS.md"], /keydown/);
    assert.match(ctx.written["EVENTS.md"], /no matching `removeEventListener` in this file/, "the unremoved listener is called out");
    assert.equal(ctx.events.unremoved, 2, "two of the three have no remove beside them");
    assert.match(ctx.note, /remove|leak|unmount|listener/i);

    const clean = { sources: { files: [{ path: join(dir, "pure.js"), rel: "pure.js" }] }, written: {}, write: async (r, c) => (clean.written[r] = c), unverified: () => {} };
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    await handlers.plan(clean);
    await handlers.emit(clean);
    assert.deepEqual(clean.written, {}, "no listeners, no report");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/dsp-events/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the analyzer does not reach the network");
});
