import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readFocus } from "../plugins/dsp-focus/index.js";

/**
 * dsp-focus names the focus-management habits a legacy app carried: a positive
 * tabindex, autofocus, accesskey, and a programmatic .focus(). These hold its
 * edges, including what it deliberately leaves alone.
 */

const MARKUP = [
  '<div tabindex="3">jumps the queue</div>',
  '<input autofocus>',
  '<a href="/x" accesskey="s">Search</a>',
  '<button tabindex="0">fine</button>',
  '<div tabindex="-1">also fine</div>',
].join("\n");

test("it flags a positive tabindex, autofocus and accesskey, and leaves 0 and -1 alone", () => {
  const f = readFocus(MARKUP, "page.html");
  const kinds = f.map((x) => x.kind);
  assert.equal(kinds.filter((k) => k === "positive-tabindex").length, 1, "only the positive tabindex is flagged");
  assert.equal(f.find((x) => x.kind === "positive-tabindex").detail, "tabindex 3");
  assert.equal(kinds.includes("autofocus"), true);
  assert.equal(kinds.includes("accesskey"), true);
});

test("a programmatic focus call is found in script", () => {
  const f = readFocus('el.focus(); input.value = 1;', "widget.js");
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "programmatic-focus");
  assert.equal(f[0].detail, ".focus()");
});

test("more than one autofocus in a file is counted as a conflict", async () => {
  const dir = await mkdtemp(join(tmpdir(), "focus-"));
  try {
    await writeFile(join(dir, "form.html"), '<input autofocus><textarea autofocus></textarea>');
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [{ path: join(dir, "form.html"), rel: "form.html" }] },
      written: {},
      write: async (rel, contents) => { ctx.written[rel] = contents; },
      unverified: (t) => (ctx.note = t),
    };
    await handlers.plan(ctx);
    await handlers.emit(ctx);
    assert.equal(ctx.focus.multiAutofocus, 1, "the file with two autofocus is a conflict");
    assert.match(ctx.written["FOCUS.md"], /more than one `autofocus`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the plugin writes a report only when a signal was found", async () => {
  assert.equal(plugin.class, "dsp");
  const dir = await mkdtemp(join(tmpdir(), "focus-"));
  try {
    await writeFile(join(dir, "page.html"), MARKUP);
    await writeFile(join(dir, "pure.js"), "export const add = (a, b) => a + b;");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "page.html"), rel: "page.html" },
        { path: join(dir, "pure.js"), rel: "pure.js" },
      ] },
      written: {},
      write: async (rel, contents) => { ctx.written[rel] = contents; },
      unverified: (t) => (ctx.note = t),
    };
    await handlers.plan(ctx);
    await handlers.emit(ctx);
    assert.ok(ctx.written["FOCUS.md"], "it wrote the report");
    assert.match(ctx.written["FOCUS.md"], /positive tabindex/);
    assert.match(ctx.note, /tabindex|autofocus|focus|keyboard/i);

    const clean = { sources: { files: [{ path: join(dir, "pure.js"), rel: "pure.js" }] }, written: {}, write: async (r, c) => (clean.written[r] = c), unverified: () => {} };
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    await handlers.plan(clean);
    await handlers.emit(clean);
    assert.deepEqual(clean.written, {}, "no signals, no report");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/dsp-focus/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the analyzer does not reach the network");
});
