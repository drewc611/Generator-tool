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
  // Each helper has one home: the emit helpers in dsp-ir/emit.js, the string
  // helpers every reader shares in dsp-ir/text.js.
  const HOME = { "const pascal =": "dsp-ir/emit.js", "const unique = (list) =>": "dsp-ir/emit.js", "const lineAt =": "dsp-ir/emit.js", "function matchBracket(": "dsp-ir/text.js", "function splitCommas(": "dsp-ir/text.js", "function splitWords(": "dsp-ir/text.js", "const attrSafe =": "dsp-ir/text.js", "function readInputs(": "dsp-ir/text.js" };
  const defs = Object.fromEntries(Object.keys(HOME).map((k) => [k, []]));
  for (const f of files) {
    const text = await readFile(f, "utf8");
    for (const needle of Object.keys(defs)) {
      // A definition inside an emitted-code template string is that port's
      // own copy and does not count against the tool.
      if (text.split("\n").some((l) => l.startsWith(needle) || l.startsWith("export " + needle))) defs[needle].push(f);
    }
  }
  for (const [needle, where] of Object.entries(defs)) {
    assert.deepEqual(where.map((f) => f.split(/[\\/]/).slice(-2).join("/")), [HOME[needle]], `${needle} is defined in ${where.length} place(s); the one spelling lives in ${HOME[needle]}`);
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

  // A Windows checkout turns every LF into CRLF, one byte a line, which put
  // src 3.8% over this gate on the first run. Counting bytes as if every line
  // ended in LF makes the measure the same on every platform and the same as
  // the number the README states.
  const bytes = async (dir) => {
    let n = 0;
    for (const f of await walkAll(join(ROOT, dir))) {
      const buf = await readFile(f);
      let crlf = 0;
      for (let i = 1; i < buf.length; i += 1) if (buf[i] === 10 && buf[i - 1] === 13) crlf += 1;
      n += buf.length - crlf;
    }
    return n;
  };
  const size = /\| Source on disk \| src (\d+) KB, plugins ([\d.]+) MB/.exec(readme);
  assert.ok(size, "the README states the source size");
  near(Number(size[1]), (await bytes("src")) / 1024, "src in KB");
  near(Number(size[2]), (await bytes("plugins")) / 1048576, "plugins in MB");
});

test("the port README can describe every report a plugin writes", async () => {
  const { describe } = await import("../plugins/output-readme/index.js");
  const files = await walk(join(ROOT, "plugins"));
  const missing = new Set();
  for (const f of files) {
    const text = await readFile(f, "utf8");
    for (const m of text.matchAll(/ctx\.write\("([A-Z_]+\.md)"/g)) if (!describe(m[1]) && m[1] !== "PORT_NOTES.md" && m[1] !== "PORT_README.md") missing.add(m[1]);
  }
  assert.deepEqual([...missing].sort(), [], "every report the run can write has a line in output-readme saying what it is");
});

// English numerals as the prose writes them, "five hundred and eighty three",
// so a sentence that spells a count is held the way a digit already is.
const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function wordsToNumber(words) {
  let total = 0; let current = 0;
  for (const w of words.toLowerCase().replace(/-/g, " ").split(/\s+/).filter((x) => x && x !== "and")) {
    if (w === "hundred") current *= 100;
    else if (w === "thousand") { total += current * 1000; current = 0; }
    else if (w in SMALL) current += SMALL[w];
    else throw new Error(`not a numeral: ${w}`);
  }
  return total + current;
}
const NUM = "((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and)\\s+)*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand))";

test("the prose counts spelled in words agree with the roadmap, everywhere they appear", async () => {
  const roadmap = await readFile(join(ROOT, "ROADMAP.md"), "utf8");
  const entries = roadmap.match(/^\*\*\d+\..*(✅|🔨|▢)\s*$/gm) ?? [];
  const features = entries.length;
  const phases = (roadmap.match(/^## Phase /gm) ?? []).length;
  const status = (mark) => entries.filter((e) => e.trim().endsWith(mark)).length;
  const num = (text, re, what) => {
    const m = new RegExp(re, "i").exec(text.replace(/\s+/g, " "));
    assert.ok(m, `${what} is stated`);
    return m.slice(1).map(wordsToNumber);
  };

  const [rf, rp] = num(roadmap, `${NUM} features across ${NUM} phases`, "the roadmap header");
  assert.equal(rf, features, "the roadmap header's feature count is the count of its entries");
  assert.equal(rp, phases, "the roadmap header's phase count is the count of its phase headings");

  const readme = await readFile(join(ROOT, "README.md"), "utf8");
  const [grew] = num(readme, `across ${NUM} features, and every`, "the README's growth sentence");
  assert.equal(grew, features);
  const [f, p, shipped, fresh, planned] = num(readme, `${NUM} features in ${NUM} phases, ${NUM} shipped, ${NUM} new in the current branch, ${NUM} planned`, "the README's still open paragraph");
  assert.equal(f, features); assert.equal(p, phases);
  assert.equal(shipped, status("✅")); assert.equal(fresh, status("🔨")); assert.equal(planned, status("▢"));

  const claude = await readFile(join(ROOT, "CLAUDE.md"), "utf8");
  const [cf, cp] = num(claude, `ROADMAP.md: ${NUM} features in ${NUM} phases`, "CLAUDE.md's pointer to the roadmap");
  assert.equal(cf, features); assert.equal(cp, phases);

  assert.equal(wordsToNumber("five hundred and eighty three"), 583);
  assert.equal(wordsToNumber("ninety nine"), 99);
  assert.equal(wordsToNumber("forty four"), 44);
  assert.equal(wordsToNumber("three"), 3);
});
