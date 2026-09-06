import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { DIALECTS, buildIr, mapExpressions } from "../plugins/dsp-ir/ir.js";
import { lowerBody } from "../plugins/input-react/index.js";
import { toAngular } from "../plugins/output-angular/print.js";
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

/**
 * The eighteenth review pass. The frame a loop opens used to close before the
 * row's own key, its html binding and the condition AngularJS evaluates per row
 * were read, so those resolved $index to the loop above or to nothing; every
 * expression a row owns is now read inside its loop and the list alone outside
 * it. Angular declares $index in every @for, so the port aliases each index
 * through let and never shadows an outer one; Lit's key function receives the
 * index; Svelte picks a name the screen does not already read; knockout's
 * $index() and $parentContext.$index() are the same two things; a read no open
 * loop answers is kept as written and said; and a React map's index is spelled
 * by depth in one pass over the finished markup, copy untouched.
 */

const exprs = (node) => node.parts.filter((p) => p.expression !== undefined).map((p) => p.expression);

test("every expression a row owns is read inside its loop, the list outside it", () => {
  const moved = buildIr(`<li ng-repeat="x in xs" ng-if="$index > 0">{{ x }}</li>`).root;
  assert.equal(moved.kind, "each"); assert.equal(moved.index, "$index");
  assert.equal(moved.children[0].kind, "when"); assert.equal(moved.children[0].test, "$index > 0", "the condition moved inside the loop reads that loop's index");
  const keyed = buildIr(`<ul><li ng-repeat="a in as"><b ng-repeat="c in a.cs track by c.id + '-' + $index">{{ c }}</b></li></ul>`).root.children[0];
  const inner = keyed.children[0].children[0];
  assert.equal(inner.kind, "each"); assert.equal(inner.key, "c.id + '-' + $index2"); assert.equal(inner.index, "$index2", "a key that reads the index gives the loop its name");
  const html = buildIr(`<ul><li ng-repeat="a in as"><b ng-repeat="c in a.cs" ng-bind-html="c.body + $index"></b></li></ul>`).root.children[0].children[0].children[0];
  assert.equal(html.children[0].children[0].expression, "c.body + $index2");
  const ko = buildIr(`<ul ko-foreach="row in rows" ko-attr-title="$index()"><li>{{ $index() }}<b ko-foreach="c in row.cs"><i>{{ $parentContext.$index() }}</i></b></li></ul>`, { dialect: DIALECTS.knockout });
  assert.equal(ko.root.attrs[0].expression, "$index()", "where the loop repeats the children, the element's own attributes are outside it");
  assert.match(ko.notes.join("\n"), /`\$index\(\)` names a loop index no loop open at that point provides; it was kept as written/);
  const rows = ko.root.children[0];
  assert.equal(rows.kind, "each"); assert.equal(rows.index, "$index");
  const li = rows.children[0];
  assert.deepEqual(exprs(li.children[0]), ["$index"], "knockout's $index() is the row's index");
  assert.deepEqual(exprs(li.children[1].children[0].children[0].children[0]), ["$index"], "$parentContext.$index() is the loop above");
  const beyond = buildIr(`<li ng-repeat="x in xs">{{ $parent.$parent.$index }}</li>`);
  assert.match(beyond.notes.join("\n"), /`\$parent\.\$parent\.\$index` names a loop index no loop open/);
  assert.deepEqual(exprs(beyond.root.children[0].children[0]), ["$parent.$parent.$index"], "kept as written, never resolved to a loop it is not in");
});

test("Angular aliases every index through let, Lit's key function takes it, Svelte avoids a name the screen reads", () => {
  const angular = toAngular(T).markup.replace(/\s+/g, " ");
  assert.match(angular, /@for \(row of rows; track \$index; let index = \$index\)/);
  assert.match(angular, /@for \(cell of row\.cells; track \$index; let index2 = \$index\)/, "an inner @for declares $index of its own, so the outer's name is an alias it cannot shadow");
  assert.match(angular, /\{\{ index \}\}:\{\{ index2 \}\}/);
  const once = toAngular(T).markup;
  assert.equal(toAngular(once).markup, once, "the let aliases read back into the same bytes");
  assert.match(toAngular(`<li v-for="(x, i) in xs" :key="x.id">{{ i }}</li>`).markup, /track x\.id; let i = \$index/);
  const lit = toLit(T).markup.replace(/\s+/g, " ");
  assert.match(lit, /repeat\(this\.rows \?\? \[\], \(row, \$index\) => \$index, \(row, \$index\) => html/, "the key function receives the index it reads");
  const svelte = toSvelte(`<li ng-repeat="x in xs"><input ng-model="vals[$index]">{{ index }} {{ $index }}</li>`).markup.replace(/\s+/g, " ");
  assert.match(svelte, /\{#each xs as x, idx \(idx\)\}/, "index is a name the screen reads, so the loop's is idx");
  assert.match(svelte, /bind:value=\{vals\[idx\]\}/, "a model indexed into a collection binds the element it named");
  assert.match(svelte, /\{index\} \{idx\}/);
  const mapped = mapExpressions({ kind: "element", tag: "component", tagExpression: "w", model: "m", attrs: [], classes: [], styles: [], events: [], children: [] }, (s) => `${s}!`);
  assert.equal(mapped.tagExpression, "w!"); assert.equal(mapped.model, "m!");
});

test("a React map index is spelled $index in its own rows and $parent.$index in the rows below, copy untouched", () => {
  const notes = [];
  const t = lowerBody(`<tbody>{rows.map((row, i) => (<tr key={i} className={i % 2 ? "odd" : "even"} title="i">{row.cells.map((cell, j) => (<td onClick={() => pick(i, j)} data-n={\`c\${j}\`}>{i}:{j} i {cell}</td>))}</tr>))}</tbody>`, (n) => notes.push(n));
  assert.match(t, /<tr ng-repeat="row in rows" class=\{\{ \$index % 2 \? "odd" : "even" \}\} title="i">/, "a static attribute value is copy");
  assert.match(t, /ng-click="pick\(\$parent\.\$index, \$index\)"/);
  assert.match(t, /\{\{ \$parent\.\$index \}\}:\{\{ \$index \}\} i \{\{ cell \}\}/, "the word in copy is not a name");
  assert.ok(!/portamp-index/.test(t), "the carried name leaves no trace");
  assert.ok(notes.some((n) => /`j` is read inside a template string/.test(n)));
  assert.equal(lowerBody(`<ul>{rows.map((row, $index) => (<li key={$index}>{row.cells.map((cell, $index2) => (<b>{$index}:{$index2}</b>))}</li>))}</ul>`),
    `<ul><li ng-repeat="row in rows"><b ng-repeat="cell in row.cells">{{ $parent.$index }}:{{ $index }}</b></li></ul>`, "what output-react wrote reads back by depth");
});
