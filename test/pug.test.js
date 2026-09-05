import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { compose, lowerAttrs, lowerText, lowerTree, parseTag, parseTree, readInputs } from "../plugins/input-pug/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Pug read from its indentation and lowered onto the dialect; the layout
 * composed the way the compiler composes it, the machinery named.
 */

const lower = (src, note = () => {}) => lowerTree(parseTree(src), note);

test("a tag head is read with its shorthand, attributes, self close and text mode", () => {
  assert.deepEqual(parseTag(`a.btn.primary#go(href=url, class="x") Buy`), { tag: "a", classes: ["btn", "primary"], id: "go", attrs: `href=url, class="x"`, selfClose: false, mode: "text", rest: "Buy", andAttrs: null });
  assert.equal(parseTag(`p= name`).mode, "code");
  assert.equal(parseTag(`p!= html`).mode, "html");
  assert.equal(parseTag(`p.`).mode, "blockText");
  assert.equal(parseTag(`li: a(href="/") Home`).mode, "inline");
  assert.equal(parseTag(`.card`).tag, "div");
});

test("attributes lower by name and kind; interpolations and unescaped output lower onto the dialect", () => {
  assert.equal(lowerAttrs(`href=url class="a b" class=cls disabled=!ok data-id=row.id title="Hi #{name}" hidden`, ["c"], null, () => {}), ` class="c a b" ng-href="{{ url }}" ng-class="cls" ng-disabled="!ok" ng-attr-data-id="{{ row.id }}" title="Hi {{ name }}" hidden`);
  assert.equal(lowerText("Hi #{user.name}, !{html} \\#{not}"), `Hi {{ user.name }}, <span ng-bind-html="html"></span> #{not}`);
});

test("if with its chain, unless, each with index and else, case, a mixin and block text lower onto the dialect", () => {
  const notes = [];
  const out = lower([
    "if a", "  b 1", "else if b", "  b 2", "else", "  b 3",
    "unless c", "  i 4",
    "ul", "  each x, i in xs", "    li #{i}: #{x}", "  else", "    li none",
    "case t", "  when 'p'", "    b P", "  default", "    b D",
    "mixin tag(n)", "  b= n", "+tag(title)",
    "p.", "  two", "  lines",
  ].join("\n"), (n) => notes.push(n));
  assert.equal(out,
    `<ng-container ng-if="a"><b>1</b></ng-container><ng-container ng-if="!(a) && (b)"><b>2</b></ng-container><ng-container ng-if="!(a) && !(b)"><b>3</b></ng-container>` +
    `<ng-container ng-if="!(c)"><i>4</i></ng-container>` +
    `<ul><ng-container ng-repeat="x in xs track by $index"><li>{{ $index }}: {{ x }}</li></ng-container><ng-container ng-if="!xs || !xs.length"><li>none</li></ng-container></ul>` +
    `<ng-container ng-if="(t) == 'p'"><b>P</b></ng-container><ng-container ng-if="!((t) == 'p')"><b>D</b></ng-container>` +
    `<b>{{ title }}</b><p>two lines</p>`);
  assert.ok(notes.some((n) => /expanded at its call site/.test(n)));
});

test("a template is composed into the layout it extends, blocks replace, append and prepend, and a held include is inlined", () => {
  const notes = [];
  const files = new Map([
    ["layout.pug", "html\n  body\n    include nav.pug\n    block content\n      p default\n    block foot\n      p F"],
    ["nav.pug", "nav N"],
  ]);
  const resolve = (name) => files.get(name.replace(/^\.\//, "")) ?? files.get(`${name}.pug`) ?? null;
  const tree = compose(parseTree("extends layout\nblock content\n  h1 C\nblock append foot\n  p G"), resolve, (n) => notes.push(n));
  assert.equal(lowerTree(tree), `<html><body><nav>N</nav><h1>C</h1><p>F</p><p>G</p></body></html>`);
  assert.deepEqual(notes, []);
});

test("a run composes the view, skips the layout, reads the locals as inputs, names the code and ports it", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/pug") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!by("layout"), "the layout is chrome, not a screen");
    const product = by("product");
    assert.ok(product && product.readBy === "pug");
    assert.match(product.template, /^<nav><a href="\/">Home<\/a><ng-container ng-if="user"><span class="who">\{\{ user\.name \}\}<\/span><\/ng-container><\/nav>/);
    assert.match(product.template, /<h1>\{\{ product\.name \}\}<\/h1>/);
    assert.match(product.template, /ng-if="!\(product\.stock === 0\) && \(product\.stock < 5\)"><p class="low">Only \{\{ product\.stock \}\} left<\/p>/);
    assert.match(product.template, /<ng-container ng-repeat="tag in product\.tags track by \$index"><li ng-class="tag\.hot \? 'hot' : ''">\{\{ \$index \}\}: \{\{ tag\.name \}\}<\/li><\/ng-container>/);
    assert.match(product.template, /<li class="none">No tags<\/li>/);
    assert.match(product.template, /ng-if="\(product\.type\) == 'shoe'"/);
    assert.match(product.template, /<span class="badge">\{\{ product\.type \}\}<\/span>/, "the mixin expanded with its argument");
    assert.match(product.template, /<a class="buy" ng-href="\{\{ product\.url \}\}" ng-disabled="!product\.available">Buy<\/a>/);
    assert.match(product.template, /<p class="note"><span ng-bind-html="product\.descriptionHtml"><\/span><\/p>/);
    assert.match(product.template, /<p>Free shipping on every order\.<\/p>/);
    assert.doesNotMatch(product.template, /discounted|extends|block content|doctype/);
    assert.deepEqual(product.inputs, ["product", "user"]);
    assert.ok(by("includes-nav"), "the include is also a screen of its own");
    const jsx = await readFile(join(run.out, "src/features/Product/Product.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|#\{/);
    assert.ok(run.ctx.report.unverified.some((n) => /Unbuffered code/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("the fifth review pass: attribute lists over several lines, a bare boolean between valued attributes, a tag inside text", () => {
  assert.equal(lower('input(\n  type="text"\n  name="q"\n)\np after'), `<input type="text" name="q"><p>after</p>`);
  assert.equal(lowerAttrs(`type="checkbox" checked name="x"`, [], null, () => {}), ` type="checkbox" checked name="x"`);
  assert.equal(lowerAttrs(`title='say "hi"' data-x='a'`, [], null, () => {}), ` title="say &quot;hi&quot;" data-x="a"`);
  assert.equal(lower("p Hello #[strong world] there"), `<p>Hello <strong>world</strong> there</p>`);
});

test("the fifth review pass: a mixin's block is the caller's children, a hyphenated name, and a parameter before == is substituted", () => {
  const notes = [];
  assert.equal(lower("mixin card(t)\n  .card\n    h2= t\n    block\n+card(title)\n  p body", (n) => notes.push(n)), `<div class="card"><h2>{{ title }}</h2><p>body</p></div>`);
  assert.ok(!notes.some((n) => /called with a block/.test(n)), "the block is filled, not named");
  assert.equal(lower("mixin my-tag(n)\n  b= n\n+my-tag(t)"), `<b>{{ t }}</b>`);
  assert.equal(lower("mixin m(p)\n  if p == 1\n    b one\n  a(p=p) x\n+m(kind)"), `<ng-container ng-if="kind == 1"><b>one</b></ng-container><a ng-attr-p="{{ kind }}">x</a>`);
});

test("the fifth review pass: an outer index inside a nested loop is the parent's, named; an empty when falls through", () => {
  const notes = [];
  assert.equal(lower("each row, i in rows\n  each cell, j in row\n    td #{i}-#{j}: #{cell}\n  li #{i}", (n) => notes.push(n)),
    `<ng-container ng-repeat="row in rows track by $index"><ng-container ng-repeat="cell in row track by $index"><td>{{ $parent.$index }}-{{ $index }}: {{ cell }}</td></ng-container><li>{{ $index }}</li></ng-container>`);
  assert.ok(notes.some((n) => /\$parent\.\$index/.test(n)));
  assert.equal(lower("case t\n  when 'a'\n  when 'b'\n    b AB\n  default\n    b D"),
    `<ng-container ng-if="(t) == 'a' || (t) == 'b'"><b>AB</b></ng-container><ng-container ng-if="!((t) == 'a') && !((t) == 'b')"><b>D</b></ng-container>`);
  assert.deepEqual(readInputs(`{{ $parent.$index }}`), []);
});

test("the fifth review pass: an include at the top of an extending template carries its mixins in, and a layout named relatively is a layout", () => {
  const files = new Map([["layout.pug", "html\n  body\n    block content"], ["mixins.pug", "mixin badge(t)\n  span.badge= t"]]);
  const resolve = (n) => files.get(n.replace(/^\.\//, "")) ?? files.get(`${n}.pug`) ?? null;
  const notes = [];
  const tree = compose(parseTree("extends layout\ninclude mixins\nblock content\n  +badge(kind)"), resolve, (n) => notes.push(n));
  assert.equal(lowerTree(tree, (n) => notes.push(n)), `<html><body><span class="badge">{{ kind }}</span></body></html>`);
  assert.ok(!notes.some((n) => /does not hold/.test(n)));
});

test("a run treats extends ../layout as the layout it names, in .jade too", async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "portamp-pug-"));
  try {
    await mkdir(join(dir, "views/pages"), { recursive: true });
    await writeFile(join(dir, "views/layout.jade"), "html\n  body\n    block content\n");
    await writeFile(join(dir, "views/pages/home.jade"), "extends ../layout\nblock content\n  h1= title\n");
    const run = await runPipeline({ src: dir });
    try {
      assert.equal(run.error, null);
      const sels = run.ctx.screens.filter((s) => s.readBy === "pug").map((s) => s.selector);
      assert.deepEqual(sels, ["pages-home"]);
      assert.equal(run.ctx.screens.find((s) => s.selector === "pages-home").template, `<h1>{{ title }}</h1>`);
      assert.ok(run.ctx.report.unverified.some((n) => /layout other templates extend/.test(n)));
    } finally {
      await run.cleanup();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
