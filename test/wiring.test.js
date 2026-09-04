import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readImports, buildGraph } from "../plugins/dsp-imports/index.js";
import { readAsync } from "../plugins/dsp-async/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port's connections: what each module depends on, the import cycles a
 * port should break, and the callback pyramids and long promise chains it
 * could straighten into async/await. All are read and named; none is rewired,
 * because how an app is wired and how it sequences its work are the port
 * owner's decisions.
 */

test("imports are read; a mutual import is a cycle; a leaf is not", () => {
  assert.deepEqual(
    readImports(`import x from "react";\nconst y = require("./a.js");`, "f.js"),
    ["react", "./a.js"]
  );

  const graph = buildGraph([
    { rel: "orders.js", specifiers: ["./billing.js", "./util.js"] },
    { rel: "billing.js", specifiers: ["./orders.js", "./util.js"] },
    { rel: "util.js", specifiers: [] },
  ]);
  assert.ok(graph.edges.length >= 3, "the internal edges are resolved");
  assert.ok(
    graph.cycles.some((c) => c.includes("orders.js") && c.includes("billing.js")),
    "the mutual import is named a cycle"
  );
  assert.ok(
    !graph.cycles.some((c) => c.includes("util.js")),
    "the leaf module is in no cycle"
  );
});

test("a callback pyramid and a long promise chain are found; a lone callback is not", () => {
  const pyramid = readAsync(
    `a(function (e1) {
       b(function (e2) {
         c(function (e3) {
           d(function (e4) { done(e4); });
         });
       });
     });`,
    "p.js"
  );
  assert.ok(pyramid.some((f) => f.kind === "callback-pyramid"));

  const chain = readAsync(
    `fetch("/x").then((r) => r.json()).then((j) => use(j)).then((v) => save(v)).catch((e) => fail(e));`,
    "c.js"
  );
  assert.ok(chain.some((f) => f.kind === "promise-chain"));

  const clean = readAsync(`arr.forEach(function (x) { return x; });`, "f.js");
  assert.ok(!clean.some((f) => f.kind === "callback-pyramid"), "one callback is not a pyramid");
});

test("a run writes IMPORTS.md with the cycle and ASYNC.md, rewiring nothing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/wiring-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("IMPORTS.md"));
    assert.ok(run.ctx.written.includes("ASYNC.md"));

    const imports = await readFile(join(run.out, "IMPORTS.md"), "utf8");
    assert.match(imports, /cycle/i, "the cycle section is present");
    assert.match(imports, /billing\.js/);

    const asyncReport = await readFile(join(run.out, "ASYNC.md"), "utf8");
    assert.match(asyncReport, /callback|promise|await/i);
    assert.match(asyncReport, /approximat/i, "the depths say they are an approximation");
  } finally {
    await run.cleanup();
  }
});
