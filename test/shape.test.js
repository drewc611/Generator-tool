import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readComplexity } from "../plugins/dsp-complexity/index.js";
import { readMagic } from "../plugins/dsp-magic/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port's shape: the functions grown too tangled to carry across cleanly,
 * and the numbers and status strings buried in the logic with no name. Both
 * are measured and named; neither is rewritten, because straightening a
 * function and lifting a value into a constant are decisions the port owner
 * makes on the evidence.
 */

test("a tangled function is flagged; a tiny clean one is not", () => {
  const tangled = readComplexity(
    `function process(order) {
       if (order.total > 4999) {
         if (order.region === "EU") {
           if (order.items.length > 12) {
             for (var i = 0; i < order.items.length; i++) {
               if (order.items[i].weight > 25) {
                 if (order.items[i].fragile) { order.items[i].s = 1; }
               }
             }
           }
         }
       }
       return order;
     }`,
    "p.js"
  );
  assert.equal(tangled.length, 1);
  assert.equal(tangled[0].name, "process");
  assert.ok(tangled[0].maxDepth >= 4, "the nesting depth is measured");

  assert.deepEqual(readComplexity("function f(a){ return a+1; }", "x.js"), []);
});

test("a magic number and a status string are named; a named const is not", () => {
  const found = readMagic(
    `if (order.total > 4999) { order.rate = 0.075; }\nif (s === "PENDING_REVIEW") { go(); }`,
    "p.js"
  );
  const values = found.map((f) => f.value);
  assert.ok(values.includes("4999"));
  assert.ok(values.includes("0.075"));
  assert.ok(values.includes("PENDING_REVIEW"));

  const named = readMagic("const RATE = 0.21;\nx = i + 1;", "x.js");
  assert.deepEqual(named, [], "an already named const and a trivial 1 are not magic");
});

test("a run writes COMPLEXITY.md and MAGIC.md, straightening and lifting nothing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/shape-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("COMPLEXITY.md"));
    assert.ok(run.ctx.written.includes("MAGIC.md"));

    const complexity = await readFile(join(run.out, "COMPLEXITY.md"), "utf8");
    assert.match(complexity, /process/);
    assert.match(complexity, /approximation/i, "the numbers say they are an approximation");

    const magic = await readFile(join(run.out, "MAGIC.md"), "utf8");
    assert.match(magic, /4999/);
    assert.match(magic, /PENDING_REVIEW/);
    assert.match(magic, /constant|enum|config/i, "the report names where a value should live");
  } finally {
    await run.cleanup();
  }
});
