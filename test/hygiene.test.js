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

async function walkAll(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walkAll(p, out);
    else out.push(p);
  }
  return out;
}

test("the README's plugin and test file counts are the truth, counted, everywhere they appear", async () => {
  const readme = await readFile(join(ROOT, "README.md"), "utf8");
  const plugins = (await readdir(join(ROOT, "plugins"), { withFileTypes: true })).filter((e) => e.isDirectory()).length;
  const mentions = [...readme.matchAll(/\b(\d+) plugin(?:s\b|\(s\))/g), ...readme.matchAll(/## The (\d+) it ships with/g)].map((m) => Number(m[1]));
  assert.ok(mentions.length >= 4, "the README states the plugin count in several places");
  for (const n of mentions) assert.equal(n, plugins, `README says ${n} plugins somewhere; ${plugins} ship. Update every mention.`);

  const testFiles = (await readdir(join(ROOT, "test"))).filter((f) => f.endsWith(".test.js")).length;
  for (const m of readme.matchAll(/across (\d+) (?:test )?files/g)) {
    assert.equal(Number(m[1]), testFiles, `README says ${m[1]} test files; there are ${testFiles}.`);
  }
});

// These rows move on every commit, so an exact gate would fail every push
// and the practice is to true them up at the end of a sprint. Three percent
// is the slack that lets a sprint happen and still catches a stale table.
test("the README's size table holds to the counted tool, within three percent", async () => {
  const readme = await readFile(join(ROOT, "README.md"), "utf8");
  const { stat } = await import("node:fs/promises");
  const near = (stated, actual, what) => {
    const drift = Math.abs(stated - actual) / actual;
    assert.ok(drift <= 0.03, `README says ${what} is ${stated}; it is ${actual} (${(drift * 100).toFixed(1)}% off). True up the table.`);
  };
  const num = (s) => Number(String(s).replace(/,/g, ""));

  const jsFiles = [...(await walk(join(ROOT, "src"))), ...(await walk(join(ROOT, "plugins")))];
  let jsLines = 0;
  for (const f of jsFiles) jsLines += (await readFile(f, "utf8")).split("\n").length - 1;
  const lines = /\| Every line of the tool \| ([\d,]+) lines/.exec(readme);
  assert.ok(lines, "the README states the tool's line count");
  near(num(lines[1]), jsLines, "the tool's line count");

  const testFiles = (await readdir(join(ROOT, "test"))).filter((f) => f.endsWith(".test.js"));
  let testLines = 0;
  for (const f of testFiles) testLines += (await readFile(join(ROOT, "test", f), "utf8")).split("\n").length - 1;
  const tests = /\| Tests \| ([\d,]+) lines/.exec(readme);
  assert.ok(tests, "the README states the suite's line count");
  near(num(tests[1]), testLines, "the suite's line count");

  const bytes = async (dir) => { let n = 0; for (const f of await walkAll(join(ROOT, dir))) n += (await stat(f)).size; return n; };
  const size = /\| Source on disk \| src (\d+) KB, plugins ([\d.]+) MB/.exec(readme);
  assert.ok(size, "the README states the source size");
  near(Number(size[1]), (await bytes("src")) / 1024, "src in KB");
  near(Number(size[2]), (await bytes("plugins")) / 1048576, "plugins in MB");
});
