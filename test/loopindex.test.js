import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { toLit } from "../plugins/output-lit/index.js";
import { translate } from "../plugins/output-react/template.js";
import { toSvelte } from "../plugins/output-svelte/print.js";
import { toVue } from "../plugins/output-vue/print.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A nested loop's index is its own name. The dialect spells every loop's
 * index $index and the loop above it $parent.$index; every printer used to
 * name each level $index, so an inner loop shadowed the outer and a body
 * reading the outer index read the inner one. The IR gives each loop a name
 * of its own and resolves $parent.$index to the loop above.
 */

const T = `<table><tr ng-repeat="row in rows track by $index"><td ng-repeat="cell in row.cells track by $index">{{ $parent.$index }}:{{ $index }} {{ cell }}</td></tr></table>`;

test("the IR names each loop's index once and resolves $parent.$index to the loop above", () => {
  const rows = buildIr(T).root.children[0];
  assert.equal(rows.kind, "each"); assert.equal(rows.index, "$index");
  const cells = rows.children[0].children[0];
  assert.equal(cells.kind, "each"); assert.equal(cells.index, "$index2");
  const td = cells.children[0];
  assert.deepEqual(td.children[0].parts.filter((p) => p.expression).map((p) => p.expression), ["$index", "$index2", "cell"]);
});

test("React, Vue and Lit print two names; Svelte spells them without the $ a store would claim", () => {
  const jsx = translate(T).jsx.replace(/\s+/g, " ");
  assert.match(jsx, /rows\.map\(\(row, \$index\) =>/);
  assert.match(jsx, /row\.cells\.map\(\(cell, \$index2\) =>/);
  assert.match(jsx, /\{\$index\}:\{\$index2\} \{cell\}/);
  const vue = toVue(T).markup.replace(/\s+/g, " ");
  assert.match(vue, /v-for="\(row, \$index\) in rows"/); assert.match(vue, /v-for="\(cell, \$index2\) in row\.cells"/); assert.match(vue, /\{\{ \$index \}\}:\{\{ \$index2 \}\}/);
  const svelte = toSvelte(T).markup.replace(/\s+/g, " ");
  assert.match(svelte, /\{#each rows as row, index \(index\)\}/); assert.match(svelte, /\{#each row\.cells as cell, index2 \(index2\)\}/); assert.match(svelte, /\{index\}:\{index2\} \{cell\}/);
  assert.ok(!/\$index/.test(svelte), "no $ prefixed name reaches Svelte");
  const lit = toLit(T).markup.replace(/\s+/g, " ");
  assert.match(lit, /\(cell, \$index2\) => html/);
});

test("a body that reads $index gets its index even when the loop names none, and an authored index name is kept", () => {
  const plain = buildIr(`<li ng-repeat="x in xs">{{ $index }}. {{ x }}</li>`).root;
  assert.equal(plain.index, "$index", "the index is carried because the body read it");
  const silent = buildIr(`<li ng-repeat="x in xs">{{ x }}</li>`).root;
  assert.equal(silent.index, null, "a body that never reads the index gets none");
  const authored = buildIr(`<li ng-repeat="(i, x) in xs"><b ng-repeat="y in x.ys">{{ $parent.$index }}-{{ $index }}</b></li>`).root;
  assert.equal(authored.index, "i");
  assert.deepEqual(authored.children[0].children[0].children[0].children[0].parts.filter((p) => p.expression).map((p) => p.expression), ["i", "$index2"]);
});

test("an EJS grid with two indexed loops reaches React with two names", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/nested-index") });
  try {
    assert.equal(run.error, null);
    const grid = run.ctx.screens.find((s) => s.selector === "grid");
    assert.match(grid.template, /\{\{ \$parent\.\$index \}\}:\{\{ \$index \}\}/);
    const { readFile } = await import("node:fs/promises");
    const jsx = await readFile(join(run.out, "src/features/Grid/Grid.jsx"), "utf8");
    assert.match(jsx, /rows\.map\(\(row, \$index\)/); assert.match(jsx, /row\.cells\.map\(\(cell, \$index2\)/); assert.match(jsx, /\{\$index\}:\{\$index2\}/);
  } finally {
    await run.cleanup();
  }
});
