import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT } from "./helpers.js";

/**
 * Sanitation, enforced. Every claim in here rotted once before this file
 * existed: the README swore the core was 527 lines while it stood at 718,
 * and four emitters each carried their own copy of the same helper. A claim
 * a test holds cannot quietly rot again, and a sprint that changes the
 * numbers ends by updating the words, which is the whole practice.
 */

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("the README's size table is the truth, counted", async () => {
  const core = ["src/core/kernel.js", "src/core/policy.js", "src/core/context.js", "src/cli.js"];
  let lines = 0;
  for (const f of core) lines += (await readFile(join(ROOT, f), "utf8")).split("\n").length - 1;

  const readme = await readFile(join(ROOT, "README.md"), "utf8");
  const table = /\| Core \| \*\*(\d+) lines\*\*/.exec(readme);
  assert.ok(table, "the README states the core's size");
  assert.equal(Number(table[1]), lines, `README says the core is ${table[1]} lines; it is ${lines}. Update the table.`);
  const panel = /(\d+)\r?\nlines of core/.exec(readme);
  assert.ok(panel && Number(panel[1]) === lines, "the console caption states the same number");

  const claude = await readFile(join(ROOT, "CLAUDE.md"), "utf8");
  const contract = /core is (\d+) lines across\s*\nfour files/.exec(claude);
  assert.ok(contract && Number(contract[1]) === lines, `CLAUDE.md says ${contract?.[1]}; the core is ${lines}. Update the contract.`);
});

test("nothing in the tool is deferred with a marker comment", async () => {
  const files = [...(await walk(join(ROOT, "src"))), ...(await walk(join(ROOT, "plugins")))];
  for (const f of files) {
    const text = await readFile(f, "utf8");
    assert.ok(!/\b(TODO|FIXME|XXX|HACK)\b/.test(text), `${f} carries a deferral marker; do the work or file it on the roadmap`);
  }
});

test("the shared helpers exist exactly once", async () => {
  const files = [...(await walk(join(ROOT, "src"))), ...(await walk(join(ROOT, "plugins")))];
  const defs = { "const pascal =": [], "const unique = (list) =>": [] };
  for (const f of files) {
    const text = await readFile(f, "utf8");
    for (const needle of Object.keys(defs)) {
      // A definition inside an emitted-code template string is that port's
      // own copy and does not count against the tool.
      if (text.split("\n").some((l) => l.startsWith(needle) || l.startsWith("export " + needle))) defs[needle].push(f);
    }
  }
  for (const [needle, where] of Object.entries(defs)) {
    assert.deepEqual(where.map((f) => f.split(/[\\/]/).slice(-2).join("/")), ["dsp-ir/emit.js"], `${needle} is defined in ${where.length} place(s); the one spelling lives in dsp-ir/emit.js`);
  }
});
