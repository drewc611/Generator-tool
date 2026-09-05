import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readStorage } from "../plugins/dsp-storage/index.js";

/**
 * dsp-storage names the browser storage a legacy app kept state in, so the port
 * can carry it. These hold its edges: it finds the reads, writes, removes,
 * clears and IndexedDB opens and names the keys; it never reads a value; a
 * computed key is not captured as a literal; and a run with no storage writes
 * no report.
 */

const SRC = [
  'const theme = localStorage.getItem("theme");',
  'localStorage.setItem("user-prefs", JSON.stringify(prefs));',
  'sessionStorage.setItem("csrf", secretToken);',
  'const draft = localStorage["draft-" + id];',
  'localStorage.removeItem("stale");',
  "sessionStorage.clear();",
  'const db = indexedDB.open("app-cache", 2);',
].join("\n");

test("it finds each storage operation and names the key, not the value", () => {
  const f = readStorage(SRC, "app.js");
  const has = (store, op, key) => f.some((x) => x.store === store && x.op === op && x.key === key);
  assert.ok(has("localStorage", "read", "theme"));
  assert.ok(has("localStorage", "write", "user-prefs"));
  assert.ok(has("sessionStorage", "write", "csrf"));
  assert.ok(has("localStorage", "remove", "stale"));
  assert.ok(has("sessionStorage", "clear", null));
  assert.ok(has("indexedDB", "open", "app-cache"));
  // The value written is never captured; only the key appears. secretToken and
  // JSON.stringify(prefs) are the values here and must not reach a finding.
  assert.doesNotMatch(JSON.stringify(f), /secretToken|JSON\.stringify|stringify/, "no value or value expression is read into a finding");
});

test("a computed key is not captured as a literal", () => {
  const f = readStorage(SRC, "app.js");
  assert.ok(!f.some((x) => /draft-/.test(x.key ?? "")), "the computed bracket key is skipped, not guessed");
});

test("a bracket access with a literal key is captured", () => {
  const f = readStorage('const v = sessionStorage["token"];', "x.js");
  assert.equal(f.length, 1);
  assert.equal(f[0].store, "sessionStorage");
  assert.equal(f[0].key, "token");
});

test("the plugin writes a report only when the app touched storage", async () => {
  assert.equal(plugin.class, "dsp");
  const dir = await mkdtemp(join(tmpdir(), "storage-"));
  try {
    await writeFile(join(dir, "app.js"), SRC);
    await writeFile(join(dir, "plain.js"), "export const add = (a, b) => a + b;");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "app.js"), rel: "app.js" },
        { path: join(dir, "plain.js"), rel: "plain.js" },
      ] },
      written: {},
      write: async (rel, contents) => { ctx.written[rel] = contents; },
      unverified: (t) => (ctx.note = t),
    };
    await handlers.plan(ctx);
    await handlers.emit(ctx);
    assert.ok(ctx.written["STORAGE.md"], "it wrote the report");
    assert.match(ctx.written["STORAGE.md"], /localStorage/);
    assert.match(ctx.written["STORAGE.md"], /`theme`/, "a key is listed");
    assert.doesNotMatch(ctx.written["STORAGE.md"], /secretToken/, "no value reaches the report");
    assert.match(ctx.note, /storage|carry|migrat/i);

    // A run with no storage writes nothing.
    const clean = { sources: { files: [{ path: join(dir, "plain.js"), rel: "plain.js" }] }, written: {}, write: async (r, c) => (clean.written[r] = c), unverified: () => {} };
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    await handlers.plan(clean);
    await handlers.emit(clean);
    assert.deepEqual(clean.written, {}, "no storage, no report");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/dsp-storage/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:/, `${line.trim()} is not a node builtin`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the analyzer does not reach the network");
});
