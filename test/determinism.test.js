import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * Two runs over the same tree write the same bytes. The excepted files are
 * the ones whose business is time itself, listed here so an addition to the
 * list is a reviewed decision and not a drift.
 */
const VOLATILE = new Set([
  ".portamp/run.json",       // carries per-plugin timings
  ".portamp/history.jsonl",  // appends a timestamped record per run
  "HISTORY.md",              // renders that record
]);

test("the same tree ports to the same bytes, twice", async (t) => {
  const first = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true, export: true });
  t.after(first.cleanup);
  assert.equal(first.error, null);
  const second = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true, export: true });
  t.after(second.cleanup);
  assert.equal(second.error, null);

  assert.deepEqual(
    first.ctx.written.filter((f) => !VOLATILE.has(f)).sort(),
    second.ctx.written.filter((f) => !VOLATILE.has(f)).sort(),
    "both runs wrote the same file list"
  );
  for (const rel of first.ctx.written) {
    if (VOLATILE.has(rel)) continue;
    const a = await readFile(join(first.out, rel));
    const b = await readFile(join(second.out, rel));
    assert.ok(a.equals(b), `${rel} differs between two runs of the same tree`);
  }
});
