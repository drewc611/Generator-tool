import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { LIMITS, measure, over } from "../plugins/dsp-dom/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";
import { collect } from "../plugins/vis-perf/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The size of the tree each screen renders, measured from its structure and
 * held against thresholds somebody else published. A floor, never a guess.
 */

test("elements, depth, the widest parent and nested loops are measured from the IR", () => {
  const ir = buildIr(`<div><ul>${"<li>x</li>".repeat(4)}</ul><section><div><div><p>deep</p></div></div></section><table><tr ng-repeat="r in rows"><td ng-repeat="c in r.cells">{{ c }}</td></tr></table></div>`);
  const m = measure(ir.root);
  assert.equal(m.elements, 13, "elements rendered once; the loop bodies count once each");
  assert.equal(m.depth, 5, "div > section > div > div > p");
  assert.equal(m.widest, 4); assert.equal(m.widestTag, "ul");
  assert.equal(m.loops, 2); assert.equal(m.loopDepth, 2, "a loop inside a loop");
  assert.deepEqual(over(m), [], "a small tree is within every threshold");
});

test("the thresholds are Lighthouse's, and each names what it measured", () => {
  assert.deepEqual(LIMITS, { nodes: 1500, depth: 32, children: 60 });
  const wide = over({ elements: 10, depth: 3, widest: 61, widestTag: "ul", loops: 0, loopDepth: 0 });
  assert.deepEqual(wide, ["<ul> has 61 children, over 60"]);
  const deep = over({ elements: 1501, depth: 33, widest: 2, widestTag: "div", loops: 0, loopDepth: 0 });
  assert.equal(deep.length, 2);
  assert.match(deep[0], /1501 elements rendered once, over 1500/);
  assert.match(deep[1], /nested 33 deep, over 32/);
});

test("the performance scorecard gains a DOM axis that is not measured until the plugin ran", () => {
  const rows = collect({});
  const dom = rows.find((r) => r.concern === "DOM size");
  assert.equal(dom.present, false);
  const measured = collect({ dom: { screens: [{}, {}, {}], flagged: [{}], nested: [] } }).find((r) => r.concern === "DOM size");
  assert.equal(measured.count, 1); assert.equal(measured.of, 3);
});

test("a run flags the wide and the deep page, leaves the small one within, and writes DOM.md", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/dom-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("DOM.md"));
    const index = run.ctx.dom.screens.find((s) => s.file === "index.html");
    const small = run.ctx.dom.screens.find((s) => s.file === "small.html");
    assert.ok(index && small);
    assert.ok(index.widest >= 70 && index.widestTag === "ul", "the wide list is the widest parent");
    assert.ok(index.depth > 32, "the deep nest is over the depth threshold");
    assert.ok(index.over.some((o) => /over 60/.test(o)) && index.over.some((o) => /over 32/.test(o)));
    assert.deepEqual(small.over, []);
    assert.deepEqual(run.ctx.dom.flagged.map((s) => s.selector), [index.selector]);
    const md = await readFile(join(run.out, "DOM.md"), "utf8");
    assert.match(md, /\(<ul>\) \| 0 \| /, "the widest tag is in the row");
    assert.match(md, /No loop nests inside another/);
    const perf = await readFile(join(run.out, "PERFORMANCE.md"), "utf8");
    assert.match(perf, /DOM size \| 1 \/ 2/);
  } finally {
    await run.cleanup();
  }
});
