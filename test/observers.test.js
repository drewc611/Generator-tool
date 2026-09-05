import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readObservers } from "../plugins/dsp-observers/index.js";

/**
 * dsp-observers names the IntersectionObserver, ResizeObserver, MutationObserver
 * and PerformanceObserver a legacy app constructed and whether a disconnect()
 * appears in the same file, so the port knows which subscriptions it inherits
 * and which already leaked. These hold its edges.
 */

const LEAKY = [
  'const io = new IntersectionObserver(onSee);',
  'const ro = new ResizeObserver(onResize);',
  'io.observe(el);',
].join("\n");

const CLEANED = [
  'const mo = new MutationObserver(onChange);',
  'mo.observe(root, { childList: true });',
  'function teardown(){ mo.disconnect(); }',
].join("\n");

test("it finds each observer, its kind and line, ordered by line", () => {
  const f = readObservers(LEAKY, "widget.js");
  assert.equal(f.length, 2);
  assert.equal(f[0].kind, "IntersectionObserver");
  assert.equal(f[1].kind, "ResizeObserver");
  assert.equal(f[0].line, 1);
  assert.equal(f[1].line, 2);
});

test("a disconnect anywhere in the file clears the observers in it; its absence flags them", () => {
  const leaky = readObservers(LEAKY, "a.js");
  assert.equal(leaky.every((x) => x.cleaned === false), true, "no disconnect, every observer is flagged");
  const cleaned = readObservers(CLEANED, "b.js");
  assert.equal(cleaned[0].kind, "MutationObserver");
  assert.equal(cleaned[0].cleaned, true, "a disconnect in the file marks it as having a teardown");
});

test("the plugin writes a report only when an observer was constructed, and flags the unclosed", async () => {
  assert.equal(plugin.class, "dsp");
  const dir = await mkdtemp(join(tmpdir(), "observers-"));
  try {
    await writeFile(join(dir, "widget.js"), LEAKY);
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
    assert.ok(ctx.written["OBSERVERS.md"], "it wrote the report");
    assert.match(ctx.written["OBSERVERS.md"], /IntersectionObserver/);
    assert.match(ctx.written["OBSERVERS.md"], /no `disconnect\(\)` in this file/, "the unclosed observer is called out");
    assert.equal(ctx.observers.unclosed, 2, "both have no disconnect beside them");
    assert.match(ctx.note, /disconnect|leak|unmount|observer/i);

    const clean = { sources: { files: [{ path: join(dir, "pure.js"), rel: "pure.js" }] }, written: {}, write: async (r, c) => (clean.written[r] = c), unverified: () => {} };
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    await handlers.plan(clean);
    await handlers.emit(clean);
    assert.deepEqual(clean.written, {}, "no observers, no report");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only the four observer constructors count, not a look-alike name", () => {
  const f = readObservers('const x = new MyObserver(cb); const io = new IntersectionObserver(cb);', "x.js");
  assert.equal(f.length, 1, "a user class named ...Observer is not one of the four DOM observers");
  assert.equal(f[0].kind, "IntersectionObserver");
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/dsp-observers/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the analyzer does not reach the network");
});
