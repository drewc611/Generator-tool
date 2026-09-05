import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { lowerVelocity, readInputs, vtlToJs } from "../plugins/input-velocity/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Velocity's directives and references lowered onto the dialect, the Java
 * methods with a JS spelling rewritten, the word operators as symbols, and
 * the server's machinery named.
 */

test("references, Java methods and word operators become the JS they name, outside of strings", () => {
  const notes = [];
  const note = (n) => notes.push(n);
  assert.equal(vtlToJs("$product.tags.size() gt 2 and not $product.sold", note), "product.tags.length > 2 && ! product.sold");
  assert.equal(vtlToJs("$!{user.name}.equals($other) or $list.isEmpty()", note), "user.name == other || list.length == 0");
  assert.equal(vtlToJs("$foreach.count", note), "($index + 1)");
  assert.equal(vtlToJs("$items.get(0)", note), "items[0]");
  assert.equal(vtlToJs(`'$x and $y'`, note), `'$x and $y'`, "a single quoted string is literal, as Velocity keeps it");
  assert.equal(vtlToJs(`"Hi $name"`, note), "`Hi ${name}`", "a double quoted string interpolates");
  assert.deepEqual(notes, []);
});

test("if, elseif, foreach with else, references, quiet references, a macro and an escaped dollar lower onto the dialect", () => {
  const notes = [];
  const out = lowerVelocity(
    `#if($a)1#elseif($b)2#else 3#end<ul>#foreach($x in $xs)<li>$x</li>#else<li>none</li>#end</ul>` +
    `#macro(tag $n)<b>$n</b>#end#tag($title)$!missing cost \\$5 #1 hit`,
    (n) => notes.push(n)
  );
  assert.equal(out,
    `<ng-container ng-if="a">1</ng-container><ng-container ng-if="!(a) && (b)">2</ng-container><ng-container ng-if="!(a) && !(b)"> 3</ng-container>` +
    `<ul><ng-container ng-repeat="x in xs"><li>{{ x }}</li></ng-container><ng-container ng-if="!xs || !xs.length"><li>none</li></ng-container></ul>` +
    `<b>{{ title }}</b>{{ missing }} cost $5 #1 hit`);
  assert.ok(notes.some((n) => /expanded at its call site/.test(n)));
});

test("the context's names are read from expressions only", () => {
  assert.deepEqual(readInputs(`<h1>{{ product.name }}</h1><ng-container ng-repeat="tag in product.tags"><li>{{ tag }}</li></ng-container><input type="search">`), ["product"]);
});

test("a run composes each page into the layout that reads $screen_content, inlines the parse, and ports it", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/velocity") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!by("templates-layout"), "the layout is chrome, not a screen");
    const product = by("templates-product");
    assert.ok(product && product.readBy === "velocity");
    assert.match(product.template, /^<nav>/, "the layout's nav parse is composed in and the body is the screen");
    assert.match(product.template, /<ng-container ng-if="user"><span class="who">\{\{ user\.name \}\}<\/span><\/ng-container>/);
    assert.match(product.template, /ng-if="!\(product\.stock == 0\) && \(product\.stock < 5\)"/);
    assert.match(product.template, /<ng-container ng-repeat="tag in product\.tags">\s*<li>\{\{ \(\$index \+ 1\) \}\}\. \{\{ tag\.toUpperCase\(\) \}\}<\/li>/);
    assert.match(product.template, /<li class="none">No tags<\/li>/);
    assert.match(product.template, /\{\{ product\.tags\.length \}\} tags, \{\{ product\.note \}\}/);
    assert.match(product.template, /<span class="badge">\{\{ product\.type \}\}<\/span>/, "the macro expanded with its argument");
    assert.match(product.template, /Price #1 in town, email us at info\$shop\.example/, "a hash in prose and an escaped dollar are text");
    assert.doesNotMatch(product.template, /#set|#if|discounted|screen_content/);
    assert.deepEqual(product.inputs, ["product", "user"], "the head is not the screen, so its $page read is not an input");
    assert.ok(by("templates-includes-nav"), "the parsed piece is also a screen of its own");
    const jsx = await readFile(join(run.out, "src/features/TemplatesProduct/TemplatesProduct.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|#end/);
    assert.ok(run.ctx.report.unverified.some((n) => /#set/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("a macro calling a macro, a string literal argument, an unclosed #define and $foreach.last are read as Velocity reads them", () => {
  const notes = [];
  const note = (n) => notes.push(n);
  assert.equal(lowerVelocity(`#macro(a $t)<i>$t</i>#end#macro(b $t)<p>#a($t)</p>#end#b($x)`, note), `<p><i>{{ x }}</i></p>`);
  assert.equal(lowerVelocity(`#macro(h $t)<h1>$t</h1>#if($t)!#end#end#h("Hello")`, note), `<h1>Hello</h1><ng-container ng-if="'Hello'">!</ng-container>`);
  const cut = lowerVelocity(`<p>before</p>#define($x)<b>x</b>\n<p>AFTER</p>`, note);
  assert.match(cut, /AFTER/, "an unclosed #define keeps the rest of the file");
  assert.ok(notes.some((n) => /never reaches its #end/.test(n)));
  assert.equal(vtlToJs("$foreach.last", note), "$last");
});
