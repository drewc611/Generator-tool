import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readInputs } from "../plugins/dsp-ir/text.js";
import { freshScope, lowerAttrs, lowerTree, parseTag, parseTree, rubyToJs } from "../plugins/input-haml/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Haml read from its indentation and lowered onto the dialect; Ruby spelled
 * as JavaScript; the layout and the partials composed; the helpers named.
 */

const lower = (src, note = () => {}, resolve = () => null) => lowerTree(parseTree(src), freshScope(note), resolve);

test("Ruby is spelled as JavaScript: ivars, symbols, predicates, methods, interpolated strings, helpers rewritten or named", () => {
  const notes = [];
  const sc = freshScope((n) => notes.push(n));
  assert.equal(rubyToJs("@product.tags.empty?"), "!product.tags || !product.tags.length");
  assert.equal(rubyToJs("a && !b || c.present? and d[:key].size > 0"), "a && !b || (!!c && c.length !== 0) && d.key.length > 0");
  assert.equal(rubyToJs('"Hi #{@user.name}!"'), "('Hi ' + (user.name) + '!')");
  assert.equal(rubyToJs("x.nil? ? 'a' : x.upcase"), "x == null ? 'a' : x.toUpperCase()");
  assert.equal(rubyToJs("items.first.name + items.last.to_s"), "items[0].name + items.at(-1).toString()");
  assert.equal(rubyToJs("unless flag"), "! flag");
  assert.equal(rubyToJs("t('.sold_out')", sc), "'sold_out'");
  assert.equal(rubyToJs("truncate(body, length: 20)"), "body | limitTo:20");
  assert.equal(rubyToJs("number_to_currency(price)", sc), "price");
  assert.equal(rubyToJs("cart_add_path(id: @product.id)", sc), "cart_add_path({ id: product.id })");
  assert.equal(rubyToJs("params[:q]", sc), "params.q");
  assert.equal(rubyToJs("'and or nil'"), "'and or nil'", "a string is left alone");
  for (const re of [/Translation keys/, /number_to_currency\(\) formatted/, /cart_add_path\(\) is a route helper/, /params is the request/]) assert.ok(notes.some((n) => re.test(n)), `named: ${re}`);
});

test("a tag line is read with its shorthand, hash and bracket attributes, and its mode", () => {
  assert.deepEqual(parseTag(`%a.btn#go{ href: url, class: "x" }(data-id=id)/ Buy`), { tag: "a", classes: ["btn"], id: "go", hash: ' href: url, class: "x" ', list: "data-id=id", selfClose: true, mode: "text", rest: "Buy" });
  assert.equal(parseTag("%p= name").mode, "code");
  assert.equal(parseTag("%p!= html").mode, "html");
  assert.equal(parseTag(".card").tag, "div");
  const sc = freshScope();
  assert.equal(lowerAttrs(parseTag(`%li{ class: (i == 0 ? "first" : ""), "data-id" => tag.id, :title => "T", disabled: done }`), sc), ` ng-class="(i == 0 ? 'first' : '')" ng-attr-data-id="{{ tag.id }}" title="T" ng-disabled="done"`);
  assert.equal(lowerAttrs(parseTag(`%a.x(href=url title="Hi")`), sc), ` class="x" ng-href="{{ url }}" title="Hi"`);
});

test("if chains, unless, case, each with index, locals, filters and comments lower onto the dialect", () => {
  const notes = [];
  const out = lower([
    "- low = 5",
    "- if a", "  %b 1", "- elsif n < low", "  %b= label", "- else", "  %b 3",
    "- unless c", "  %i 4",
    "%ul", "  - xs.each_with_index do |x, i|", "    %li{ class: (i == 0 ? 'first' : '') }= \"#{i + 1}: #{x.name}\"", "  - if xs.empty?", "    %li.none none",
    "- case t", "- when 'a', 'b'", "  %b AB", "- else", "  %b D",
    "- h.each do |k, v|", "  %dt= k",
    "-# haml comment", "/ html comment", ":javascript", "  track();", "!!!",
    "%p Hi #{name}, \\#{not}",
    ".description!= html",
    "- if b", "  - inner = c", "= inner",
  ].join("\n"), (n) => notes.push(n));
  assert.equal(out,
    `<ng-container ng-if="a"><b>1</b></ng-container><ng-container ng-if="!(a) && (n < 5)"><b>{{ label }}</b></ng-container><ng-container ng-if="!(a) && !(n < 5)"><b>3</b></ng-container>\n` +
    `<ng-container ng-if="!(c)"><i>4</i></ng-container>\n` +
    `<ul><ng-container ng-repeat="x in xs track by $index"><li ng-class="($index == 0 ? 'first' : '')">{{ (($index + 1) + ': ' + (x.name)) }}</li></ng-container><ng-container ng-if="!xs || !xs.length"><li class="none">none</li></ng-container></ul>\n` +
    `<ng-container ng-if="(t) == 'a' || (t) == 'b'"><b>AB</b></ng-container><ng-container ng-if="!((t) == 'a' || (t) == 'b')"><b>D</b></ng-container>\n` +
    `<ng-container ng-repeat="(k, v) in h"><dt>{{ k }}</dt></ng-container>\n` +
    `<p>Hi {{ name }}, #{not}</p>\n` +
    `<div class="description"><span ng-bind-html="html"></span></div>\n` +
    `<ng-container ng-if="b"></ng-container>\n{{ inner }}`);
  assert.ok(notes.some((n) => /filter `:javascript`/.test(n)) && notes.some((n) => /set a local inside a branch or loop/.test(n)));
});

test("a layout's yield is filled by the page, a partial renders where it is asked for, and forms and links lower", () => {
  const files = { "shared/_nav.html.haml": "%nav\n  = link_to 'Home', root_path\n" };
  const resolve = (name) => files[`${name.replace(/(^|\/)(\w+)$/, "$1_$2")}.html.haml`] ?? null;
  const notes = [];
  const out = lower([
    "= render 'shared/nav'",
    "= form_for @review, url: reviews_path do |f|", "  = f.label :rating, 'Rating'", "  = f.number_field :rating", "  = f.text_area :body", "  = f.collection_select :size, sizes, :id, :label", "  = f.submit 'Send'",
    "= link_to 'Buy', cart_add_path(id: @product.id), class: 'buy', disabled: @product.stock == 0",
    "= image_tag 'logo.png'",
    "= render partial: 'shared/missing', locals: { a: 1 }",
    "- content_for :title do", "  = @product.name",
  ].join("\n"), (n) => notes.push(n), resolve);
  assert.equal(out,
    `<nav><a ng-href="{{ root_path }}">Home</a></nav>\n` +
    `<form ng-attr-action="{{ reviews_path }}" method="post"><label for="review_rating">Rating</label><input type="number" name="review[rating]" id="review_rating" ng-model="review.rating"><textarea name="review[body]" id="review_body" ng-model="review.body"></textarea><select name="review[size]" id="review_size" ng-model="review.size"><option ng-repeat="o in sizes" ng-attr-value="{{ o.id }}">{{ o.label }}</option></select><input type="submit" value="Send"></form>\n` +
    `<a ng-href="{{ cart_add_path({ id: product.id }) }}" class="buy" ng-disabled="product.stock == 0">Buy</a>\n` +
    `<img src="logo.png">`);
  for (const re of [/root_path is a route helper/, /render "shared\/missing" passed locals/, /names a partial this run does not hold/, /content_for :title do` handed a block/]) assert.ok(notes.some((n) => re.test(n)), `named: ${re}`);
});

test("readInputs does not read an object key as a name", () => {
  assert.deepEqual(readInputs(`<a ng-href="{{ cart_add_path({ id: product.id }) }}">x</a>`), ["product"]);
});

test("a run composes the page into its layout with its partial, ports it, reads the locals and names the machinery", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/haml") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!run.ctx.screens.some((s) => /layouts/.test(s.selector)), "the layout is chrome, not a screen");
    const show = by("products-show");
    assert.ok(show && show.readBy === "haml");
    assert.match(show.template, /^<nav><a ng-href="\{\{ root_path \}\}">Home<\/a><ng-container ng-if="current_user"><span class="who">\{\{ current_user\.name \}\}<\/span><\/ng-container><\/nav><main><h1>\{\{ product\.name \}\}<\/h1>/);
    assert.match(show.template, /<p class="out">sold_out<\/p>/);
    assert.match(show.template, /ng-if="!\(product\.stock == 0\) && \(product\.stock < 5\)"><p class="low">Only \{\{ product\.stock \}\} left<\/p>/, "the local is substituted");
    assert.match(show.template, /<p class="price">\{\{ \(\(product\.price\) \+ ' ' \+ \(currency\.toUpperCase\(\)\)\) \}\}<\/p>/);
    assert.match(show.template, /<ng-container ng-repeat="tag in product\.tags track by \$index"><li ng-class="\(\$index == 0 \? 'first' : ''\)" ng-attr-data-id="\{\{ tag\.id \}\}">\{\{ \(\(\$index \+ 1\) \+ '\/' \+ \(product\.tags\.length\) \+ ': ' \+ \(tag\.name\)\) \}\}<\/li><\/ng-container>/);
    assert.match(show.template, /<ng-container ng-if="!product\.tags \|\| !product\.tags\.length"><li class="none">No tags<\/li><\/ng-container>/);
    assert.match(show.template, /ng-if="\(product\.type\) == 'shoe' \|\| \(product\.type\) == 'boot'"><span class="badge">Footwear<\/span>/);
    assert.match(show.template, /<div class="description"><span ng-bind-html="product\.description_html"><\/span><\/div>/);
    assert.match(show.template, /<p class="q">Search: \{\{ params\.q \}\}<\/p>/);
    assert.match(show.template, /<a ng-href="\{\{ cart_add_path\(\{ id: product\.id \}\) \}\}" class="buy" ng-disabled="product\.stock == 0">Buy<\/a>/);
    assert.match(show.template, /<form ng-attr-action="\{\{ reviews_path \}\}" method="post"><label for="review_rating">Rating<\/label><input type="number" name="review\[rating\]" id="review_rating" ng-model="review\.rating">/);
    assert.match(show.template, /<p>Free shipping on every order\.<\/p><\/main><footer><small>&copy; \{\{ Time\.now\.year \}\} Shop<\/small><\/footer>$/);
    assert.doesNotMatch(show.template, /track\(|%h1|#\{|content_for|<main>\{\{ product\.name/);
    assert.deepEqual(show.inputs, ["Time", "currency", "current_user", "params", "product", "review", "reviews_path", "root_path", "sizes"]);
    assert.equal(show.usesTwoWay, true);
    assert.ok(by("shared-nav"), "the partial is also a screen of its own");
    const jsx = await readFile(join(run.out, "src/features/ProductsShow/ProductsShow.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|%h1|#\{|track\("view"\)/);
    assert.match(jsx, /<nav>/);
    for (const re of [/is a layout the pages render inside/, /content_for :title do/, /Translation keys/, /number_to_currency\(\) formatted/, /cart_add_path\(\) is a route helper/, /render "shared\/promo" passed locals/, /names a partial this run does not hold/, /filter `:javascript`/, /Time\.now or Date\.today/, /params is the request/]) {
      assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `named: ${re}`);
    }
  } finally {
    await run.cleanup();
  }
});

test("the tenth review pass: prose is text, a comma continues only Ruby, predicates and conversions find their receiver, empty? brackets when part of a test", () => {
  assert.equal(lower("%p\n  Hello world\n  and #{name} more"), "<p>Hello world\nand {{ name }} more</p>".replace("\n", ""));
  assert.equal(lower("%p Thanks for your order,\n%p we ship soon."), "<p>Thanks for your order,</p>\n<p>we ship soon.</p>");
  assert.equal(lower("%li{ class: 'a',\n  title: 'b' } x"), `<li class="a" title="b">x</li>`);
  assert.equal(rubyToJs("!@tags.empty?"), "!(!tags || !tags.length)");
  assert.equal(rubyToJs("a && b.empty?"), "a && (!b || !b.length)");
  assert.equal(rubyToJs("foo(x).present? && items[0].blank?"), "(!!foo(x) && foo(x).length !== 0) && (!items[0] || !items[0].length)");
  assert.equal(rubyToJs("@n.to_i + 1"), "Math.trunc(Number(n)) + 1");
  assert.equal(rubyToJs("name.capitalize"), "(name.charAt(0).toUpperCase() + name.slice(1))");
  assert.equal(rubyToJs("@tags.map(&:name)"), "tags.map((x) => x.name)");
});

test("the tenth review pass: block helpers keep their body, a postfix if wraps the line, a field's call argument is whole, data: is data-*, fields_for nests", () => {
  const notes = [];
  const out = lower([
    "= link_to product_path(@p) do", "  %img{ src: 'x.png' }", "  %span Buy",
    "= content_tag :section do", "  %b in",
    "= cache @p do", "  %i cached",
    "= link_to 'Edit', edit_path if admin?",
    "%p= @x unless hidden",
    "= form_for @review do |f|", "  = f.select :size, options_for_select(sizes)", "  = f.text_field :name, placeholder: t('.name')", "  = f.fields_for :address do |a|", "    = a.text_field :zip",
    "%a{ href: x, data: { id: 1, confirm: 'Sure?' } } Del",
  ].join("\n"), (n) => notes.push(n));
  assert.equal(out,
    `<a ng-href="{{ product_path(p) }}"><img src="x.png"><span>Buy</span></a>\n` +
    `<section><b>in</b></section>\n` +
    `<i>cached</i>\n` +
    `<ng-container ng-if="admin?"><a ng-href="{{ edit_path }}">Edit</a></ng-container>\n` +
    `<p><ng-container ng-if="!(hidden)">{{ x }}</ng-container></p>\n` +
    `<form method="post"><select name="review[size]" id="review_size" ng-model="review.size"><option ng-repeat="o in options_for_select(sizes)" ng-attr-value="{{ o }}">{{ o }}</option></select><input type="text" name="review[name]" id="review_name" ng-model="review.name"><input type="text" name="review.address[zip]" id="review.address_zip" ng-model="review.address.zip"></form>\n` +
    `<a ng-href="{{ x }}" data-id="1" data-confirm="Sure?">Del</a>`);
  assert.ok(notes.some((n) => /cache @p do` wrapped its block in a helper this reader does not know/.test(n)));
});

test("the tenth review pass: a bare partial name resolves beside the view that renders it, and a partial that renders itself is named", async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "portamp-haml-"));
  try {
    await mkdir(join(dir, "app/views/products"), { recursive: true });
    await mkdir(join(dir, "app/views/orders"), { recursive: true });
    await writeFile(join(dir, "app/views/orders/_form.html.haml"), "%form.orders\n");
    await writeFile(join(dir, "app/views/products/_form.html.haml"), "%form.products\n");
    await writeFile(join(dir, "app/views/products/new.html.haml"), "= render 'form'\n");
    await writeFile(join(dir, "app/views/products/_loop.html.haml"), "%b x\n= render 'loop'\n");
    await writeFile(join(dir, "app/views/products/deep.html.haml"), "= render 'loop'\n");
    const run = await runPipeline({ src: dir });
    try {
      assert.equal(run.error, null);
      assert.equal(run.ctx.screens.find((s) => s.selector === "products-new").template, `<form class="products"></form>`);
      assert.ok(run.ctx.report.unverified.some((n) => /renders deeper than this reader follows/.test(n)));
    } finally {
      await run.cleanup();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
