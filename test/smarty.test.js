import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { lowerJinja } from "../plugins/input-jinja/lower.js";
import { exprToJs, freshScope, smartyToJinja } from "../plugins/input-smarty/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Smarty is jinja's shape under different braces; the reader rewrites its tags
 * onto jinja's and its expressions onto JavaScript, and one lowering serves
 * jinja, Twig and Smarty alike.
 */

test("expressions: variables lose their sigil, word operators become signs, a modifier binds to the operand before it", () => {
  const notes = [];
  const sc = freshScope((n) => notes.push(n));
  assert.equal(exprToJs("$a.b->c[$d] gt 1 and $e|@count ne 0"), "a.b.c[d] > 1 and e.length != 0");
  assert.equal(exprToJs("$name|upper|default:'anon'"), "(name.toUpperCase() || 'anon')");
  assert.equal(exprToJs("$items.$k.name"), "items[k].name");
  assert.equal(exprToJs('"Hi $user.name!"'), '"Hi " + user.name + "!"');
  assert.equal(exprToJs("$x|date_format:'%Y'|escape", sc), "x", "a formatter is dropped and named; escape is the target's job");
  assert.equal(exprToJs("$i is even and $j is not odd"), "i % 2 == 0 and j % 2 != 1");
  assert.equal(exprToJs("$t|truncate:20|cat:'...'"), "(t | limitTo:20 + '...')");
  assert.ok(notes.some((n) => /\|date_format formatted its value on the server/.test(n)));
  assert.equal(exprToJs("'and or'"), "'and or'", "a string is left alone");
});

test("tags rewrite onto jinja's: if chains, foreach with its properties and else, section, include, extends, block append and prepend, assign, literal", () => {
  const notes = [];
  const out = smartyToJinja(
    `{if $a eq 1}A{elseif $b}B{else}C{/if}` +
    `{foreach $rows as $row}{$row@iteration}/{$row@total}{if $row@last}L{/if}{foreachelse}none{/foreach}` +
    `{foreach from=$items item=it key=k name=outer}{$smarty.foreach.outer.index}:{$k}{/foreach}` +
    `{section name=i loop=$reviews}{$reviews[i].body}{/section}` +
    `{assign var='low' value=5}{$x = $y}{if $n lt $low}low{/if}{$x.name}` +
    `{literal}{a}{/literal}{ .css }{ldelim}x{rdelim}{* gone *}{strip}s{/strip}` +
    `{include file='nav.tpl' active='x'}{extends file='layout.tpl'}` +
    `{block name=content append}B{/block}{block name=foot prepend}P{/block}{block name=title}{$smarty.block.parent}!{/block}` +
    `{html_options options=$o}{$smarty.get.q}{$total = $total + 1}`,
    (n) => notes.push(n),
  );
  assert.equal(out,
    `{% if a == 1 %}A{% elif b %}B{% else %}C{% endif %}` +
    `{% for row in rows %}{{ ($index + 1) }}/{{ rows.length }}{% if ($index == rows.length - 1) %}L{% endif %}{% else %}none{% endfor %}` +
    `{% for it in items %}{{ $index }}:{{ $index }}{% endfor %}` +
    `{% for i in reviews %}{{ i.body }}{% endfor %}` +
    `{% if n < 5 %}low{% endif %}{{ (y).name }}` +
    `&#123;a&#125;{ .css }&#123;x&#125;s` +
    `{% include 'nav.tpl' %}{% extends 'layout.tpl' %}` +
    `{% block content %}{{ super() }}B{% endblock %}{% block foot %}P{{ super() }}{% endblock %}{% block title %}{{ super() }}!{% endblock %}` +
    `{{ smarty.get.q }}{% set total = total + 1 %}`);
  for (const re of [/named its key/, /iterates by index/, /passed active/, /function plugin/, /\$smarty\.get is context/, /reads its own previous value/]) assert.ok(notes.some((n) => re.test(n)), `named: ${re}`);
});

test("the rewritten template lowers through the jinja lowering, and a condition inside an attribute is the ternary it means", () => {
  const notes = [];
  const lowered = lowerJinja(smartyToJinja(`<li class="{if $t@first}first{/if}{if $t@last} last{else} mid{/if}">{$t}</li>`), (n) => notes.push(n));
  assert.equal(lowered, `<li class="{{ ($index == 0) ? 'first' : '' }}{{ ($index == undefined) ? ' last' : ' mid' }}">{{ t }}</li>`.replace("($index == undefined)", "false"));
  assert.ok(notes.some((n) => /folded into the ternary/.test(n)));
  assert.equal(lowerJinja(`<a class="{% if a %}on {{ x }}{% elif b %}b'{% else %}off{% endif %}">t</a>`), `<a class="{{ a ? 'on ' + (x) : b ? 'b\\'' : 'off' }}">t</a>`);
  assert.equal(lowerJinja(`<i class="{% if a %}{% if b %}x{% endif %}{% endif %}">t</i>`), `<i class="<ng-container ng-if="a">{{ b ? 'x' : '' }}</ng-container>">t</i>`, "a nested chain: the outer falls through as before, the flat inner folds");
});

test("a run composes the template into the layout it extends, ports it, reads the locals, and names the machinery", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/smarty") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!by("layout"), "the layout is chrome, not a screen");
    const product = by("product");
    assert.ok(product && product.readBy === "smarty");
    assert.match(product.template, /^<nav>\s*<a href="\/">Home<\/a>\s*<ng-container ng-if="user"><span class="who">\{\{ user\.name \}\}<\/span><\/ng-container>\s*<\/nav>/);
    assert.match(product.template, /<h1>\{\{ product\.name \}\}<\/h1>/);
    assert.match(product.template, /ng-if="!\(product\.stock == 0\) && \(product\.stock < 5\)">\s*<p class="low">Only \{\{ product\.stock \}\} left<\/p>/, "the assigned value is substituted where it is read");
    assert.match(product.template, /<p class="price">\{\{ product\.price \}\} \{\{ \(currency \|\| 'EUR'\) \}\}<\/p>/);
    assert.match(product.template, /<ng-container ng-repeat="tag in product\.tags">\s*<li class="\{\{ \(\$index == 0\) \? 'first' : '' \}\}\{\{ \(\$index == product\.tags\.length - 1\) \? ' last' : '' \}\}">\{\{ \(\$index \+ 1\) \}\}\/\{\{ product\.tags\.length \}\}: \{\{ tag\.name\.toUpperCase\(\) \}\}<\/li>/);
    assert.match(product.template, /<li class="none">No tags<\/li>/);
    assert.match(product.template, /<ng-container ng-repeat="i in reviews">\s*<blockquote>\{\{ i\.body \| limitTo:80 \}\} - \{\{ i\.author \}\}<\/blockquote>/);
    assert.match(product.template, /<ng-container ng-repeat="spec in specs">\s*<dl><dt>\{\{ \$index \}\}<\/dt><dd>\{\{ spec \}\} \(\{\{ \(\$index \+ 1\) \}\}\)<\/dd><\/dl>/);
    assert.match(product.template, /<p class="q">Search: \{\{ smarty\.get\.q \}\}<\/p>/);
    assert.match(product.template, /<p class="brace">Use \{ braces \} freely; &#123;literal&#125;<\/p>/);
    assert.match(product.template, /<ng-container ng-if="product\.tags\.length > 0 && user"><a class="buy" href="\/cart\/add\/\{\{ product\.id \}\}">Buy<\/a><\/ng-container>/);
    assert.match(product.template, /<footer><span class="tel">Call us<\/span><small>All rights reserved\.<\/small><\/footer>/, "prepend composed");
    assert.doesNotMatch(product.template, /Layout default|html_options|\{\$|\{if|number_format|<style|<script/);
    assert.deepEqual(product.inputs, ["currency", "product", "reviews", "smarty", "specs", "user"]);
    assert.ok(by("nav"), "the include is also a screen of its own");
    const jsx = await readFile(join(run.out, "src/features/Product/Product.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|\{if |\{foreach |\{\/|\{\$[a-z]+\./);
    for (const re of [/layout other templates extend/, /\|number_format formatted/, /iterates by index/, /named its key/, /\$smarty\.get is context/, /html_options.*function plugin/, /passed active/, /folded into the ternary/]) {
      assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `named: ${re}`);
    }
  } finally {
    await run.cleanup();
  }
});
