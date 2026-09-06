import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { freshScope, lowerTree } from "../plugins/input-haml/index.js";
import { SLIM, parseTag } from "../plugins/input-slim/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Slim is Haml's grammar with terser lines; the reader is a line grammar over
 * the Haml lowering, so the two Rails dialects cannot drift apart.
 */

const lower = (src, note = () => {}, resolve = () => null) => lowerTree(SLIM.parseTree(src), freshScope(note), resolve, 0, SLIM);

test("a Slim tag line is read: the tag's own name, shorthand, bare and wrapped attributes, output, inline child and self close", () => {
  assert.deepEqual(parseTag(`a.btn#go href=url class="x" data-id=(tag.id) Buy`), { tag: "a", classes: ["btn"], id: "go", hash: null, list: null, entries: [["href", "url"], ["class", '"x"'], ["data-id", "(tag.id)"]], notes: [], selfClose: false, mode: "text", rest: "Buy" });
  assert.deepEqual(parseTag(`li: a href="/" Home`).mode, "inline");
  assert.equal(parseTag(`li: a href="/" Home`).rest, `a href="/" Home`);
  assert.deepEqual(parseTag(`img src="logo.png"/`).selfClose, true);
  assert.equal(parseTag(`p.price = "x"`).mode, "code");
  assert.equal(parseTag(`.description == html`).mode, "html");
  assert.deepEqual(parseTag(`input(type="text" disabled=done)`).entries, [["type", '"text"'], ["disabled", "done"]]);
  assert.equal(parseTag(`svg:path d="M0"`).tag, "svg:path");
  assert.equal(parseTag(`| text`), null);
});

test("the grammar's lines: comments, embedded engines, | and ' text, == raw output, a bracket or comma running on", () => {
  const notes = [];
  const out = lower([
    "/ a comment", "/! an html comment", "doctype html",
    "javascript:", "  track();",
    "p", "  | Search:", "  ' #{q}",
    "p == html",
    "li class=(i == 0 ? 'first' : '') data-id=tag.id", "  = tag.name",
    "a(href=url", "  title='t') Go",
    "ul", "  li: a href='/' Home",
    "= link_to 'Buy', path,", "  class: 'buy'",
  ].join("\n"), (n) => notes.push(n));
  assert.equal(out,
    `<p>Search:{{ q }} </p>\n` +
    `<p><span ng-bind-html="html"></span></p>\n` +
    `<li ng-class="(i == 0 ? 'first' : '')" ng-attr-data-id="{{ tag.id }}">{{ tag.name }}</li>\n` +
    `<a ng-href="{{ url }}" title="t">Go</a>\n` +
    `<ul><li><a href="/">Home</a></li></ul>\n` +
    `<a ng-href="{{ path }}" class="buy">Buy</a>`);
  assert.ok(notes.some((n) => /filter `javascript`/.test(n)));
});

test("a run composes the page into its layout with its partial through the Haml lowering, ports it, and names the machinery", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/slim") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!run.ctx.screens.some((s) => /layouts/.test(s.selector)));
    const show = by("products-show");
    assert.ok(show && show.readBy === "slim");
    assert.match(show.template, /^<nav><a ng-href="\{\{ root_path \}\}">Home<\/a><ng-container ng-if="current_user"><span class="who">\{\{ current_user\.name \}\}<\/span><\/ng-container><\/nav><main><h1>\{\{ product\.name \}\}<\/h1>/);
    assert.match(show.template, /ng-if="!\(product\.stock == 0\) && \(product\.stock < 5\)"><p class="low">Only \{\{ product\.stock \}\} left<\/p>/);
    assert.match(show.template, /<li ng-class="\(\$index == 0 \? 'first' : ''\)" ng-attr-data-id="\{\{ tag\.id \}\}">\{\{ \(\(\$index \+ 1\) \+ '\/' \+ \(product\.tags\.length\) \+ ': ' \+ \(tag\.name\)\) \}\}<\/li>/);
    assert.match(show.template, /<div class="description"><span ng-bind-html="product\.description_html"><\/span><\/div>/);
    assert.match(show.template, /<p class="q">Search:\{\{ params\.q \}\} <\/p>/);
    assert.match(show.template, /<a ng-href="\{\{ cart_add_path\(\{ id: product\.id \}\) \}\}" class="buy" ng-disabled="product\.stock == 0">Buy<\/a>/);
    assert.match(show.template, /<img src="logo\.png" alt="Shop">/);
    assert.match(show.template, /<form ng-attr-action="\{\{ reviews_path \}\}" method="post"><label for="review_rating">Rating<\/label><input type="number" name="review\[rating\]" id="review_rating" ng-model="review\.rating">/);
    assert.match(show.template, /<ul class="crumbs"><li><a href="\/">Home<\/a><\/li><li><a href="\/products">Products<\/a><\/li><\/ul>/);
    assert.match(show.template, /<p>Free shipping on every order\.<\/p><\/main><footer><small>&copy; \{\{ Time\.now\.year \}\} Shop<\/small><\/footer>$/);
    assert.doesNotMatch(show.template, /track\(|an html comment|doctype/);
    assert.deepEqual(show.inputs, ["Time", "currency", "current_user", "params", "product", "review", "reviews_path", "root_path"]);
    assert.equal(show.usesTwoWay, true);
    assert.ok(by("shared-nav"));
    const jsx = await readFile(join(run.out, "src/features/ProductsShow/ProductsShow.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|#\{|track\("view"\)/);
    assert.match(jsx, /<nav>/);
    for (const re of [/is a layout the pages render inside/, /Translation keys/, /number_to_currency\(\) formatted/, /cart_add_path\(\) is a route helper/, /filter `javascript`/]) {
      assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `named: ${re}`);
    }
  } finally {
    await run.cleanup();
  }
});

test("the eleventh review pass: a lone * is text, whitespace markers stand after the tag, a backslash continues Ruby, wrapped booleans and splats, deep text blocks, an inline child on the next line", () => {
  const notes = [];
  const out = lower([
    "p * required field",
    "a> href='url1' Link1",
    "= link_to 'a', \\", "  path",
    "input(type=\"text\" disabled)",
    "a(*link_attrs href=\"/x\") Go",
    "div *attrs Hello",
    "|", "  one", "    two", "      three",
    "li:", "  a href='/' Home",
  ].join("\n"), (n) => notes.push(n));
  assert.equal(out,
    `<p>* required field</p>\n` +
    `<a href="url1">Link1</a>\n` +
    `<a ng-href="{{ path }}">a</a>\n` +
    `<input type="text" disabled="">\n` +
    `<a href="/x">Go</a>\n` +
    `<div>Hello</div>\n` +
    ` one two three\n` +
    `<li><a href="/">Home</a></li>`);
  assert.ok(notes.filter((n) => /spread a hash of attributes/.test(n)).length >= 1);
  assert.ok(!notes.some((n) => /could not be read as a tag/.test(n)));
});
