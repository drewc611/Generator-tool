import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readTables } from "../plugins/dsp-tables/index.js";

/**
 * dsp-tables names the tables a legacy app drew and whether a screen reader can
 * read them: caption, header cells, scope, and a presentational role for layout
 * tables. These hold its edges, including that a fully marked-up table is clear.
 */

const GOOD = '<table><caption>Sales</caption><tr><th scope="col">Q</th></tr><tr><td>1</td></tr></table>';
const NO_CAPTION = '<table><tr><th scope="col">Q</th></tr><tr><td>1</td></tr></table>';
const LAYOUT = '<table><tr><td>left</td><td>right</td></tr></table>';
const PRESENTATION = '<table role="presentation"><tr><td>left</td><td>right</td></tr></table>';

test("a fully marked-up data table has no gap", () => {
  const f = readTables(GOOD, "page.html");
  assert.equal(f.length, 1);
  assert.equal(f[0].caption, true);
  assert.equal(f[0].th, true);
  assert.equal(f[0].scope, true);
  assert.deepEqual(f[0].issues, []);
});

test("a data table with headers but no caption is flagged", () => {
  const f = readTables(NO_CAPTION, "page.html");
  assert.ok(f[0].issues.some((i) => /no caption/.test(i)));
});

test("a table with no headers and no presentational role is flagged; role=presentation clears it", () => {
  const layout = readTables(LAYOUT, "x.html");
  assert.ok(layout[0].issues.some((i) => /no header cells/.test(i)));
  const pres = readTables(PRESENTATION, "y.html");
  assert.deepEqual(pres[0].issues, [], "a presentational table is not a data-table gap");
});

test("a nested table is measured on its own, not merged into the outer", () => {
  const nested = '<table><caption>Outer</caption><tr><td><table><tr><th>inner</th></tr></table></td></tr></table>';
  const f = readTables(nested, "n.html");
  assert.equal(f.length, 2, "both the outer and the inner table are found");
  const inner = f.find((t) => !t.caption);
  assert.ok(inner, "the inner table's caption is not credited from the outer");
});

test("the plugin writes a report only when a table was found, and captures no cell content", async () => {
  assert.equal(plugin.class, "dsp");
  const dir = await mkdtemp(join(tmpdir(), "tables-"));
  try {
    await writeFile(join(dir, "page.html"), NO_CAPTION.replace("1", "SENSITIVE_CELL"));
    await writeFile(join(dir, "plain.html"), "<p>no table here</p>");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "page.html"), rel: "page.html" },
        { path: join(dir, "plain.html"), rel: "plain.html" },
      ] },
      written: {},
      write: async (rel, contents) => { ctx.written[rel] = contents; },
      unverified: (t) => (ctx.note = t),
    };
    await handlers.plan(ctx);
    await handlers.emit(ctx);
    assert.ok(ctx.written["TABLES.md"], "it wrote the report");
    assert.match(ctx.written["TABLES.md"], /no caption/);
    assert.doesNotMatch(ctx.written["TABLES.md"], /SENSITIVE_CELL/, "no cell content is written");
    assert.match(ctx.note, /caption|scope|table|reader/i);

    const clean = { sources: { files: [{ path: join(dir, "plain.html"), rel: "plain.html" }] }, written: {}, write: async (r, c) => (clean.written[r] = c), unverified: () => {} };
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    await handlers.plan(clean);
    await handlers.emit(clean);
    assert.deepEqual(clean.written, {}, "no tables, no report");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/dsp-tables/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:\/\//, "the analyzer does not reach the network");
});
