import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { isDjango, lowerJinja } from "../plugins/input-jinja/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Nunjucks is jinja's JavaScript port: the same lowering reads its .njk files,
 * with its asynchronous loops as the loops they are, a raw block's braces
 * spelled as the strings they are, a set bound where it is read, and an
 * import or a call named.
 */

test("raw braces are printed not read, asyncEach is a for, set binds a name, import and call are named", () => {
  const notes = []; const note = (n) => notes.push(n);
  const out = lowerJinja([
    `{% import "macros.njk" as ui %}{% set price = product.price | round(2) %}{% set label = "Price" %}`,
    `<p class="price">{{ label }}: {{ price }}</p>`,
    `{% asyncEach tag in product.tags %}<span>{{ tag }}</span>{% else %}<i>none</i>{% endeach %}`,
    `{% call ui.card(product) %}<p>{{ product.summary }}</p>{% endcall %}`,
    `<pre>{% raw %}Use {{ name }} and {% if x %} here{% endraw %}</pre>`,
  ].join(""), note);
  assert.equal(out,
    `<p class="price">{{ "Price" }}: {{ (product.price | round(2)) }}</p>` +
    `<ng-container ng-repeat="tag in product.tags"><span>{{ tag }}</span></ng-container><ng-container ng-if="!product.tags || !product.tags.length"><i>none</i></ng-container>` +
    `<p>{{ product.summary }}</p>` +
    `<pre>Use {{ '{' + '{' }} name {{ '}' + '}' }} and {{ '{' + '%' }} if x {{ '%' + '}' }} here</pre>`);
  assert.ok(notes.some((n) => /`\{% set price %\}` bound a name/.test(n)) && !notes.some((n) => /round\(2\)/.test(n)), "the set note names the name, never the value");
  assert.ok(notes.some((n) => /imports macros from another template/.test(n)));
  assert.ok(notes.some((n) => /called a macro with a body; the body is kept once/.test(n)));
  assert.ok(!notes.some((n) => /could not be carried|server side machinery/.test(n)), "nothing Nunjucks falls through as unknown");
});

test("a run reads .njk files, composes the page into its layout through the nav include, and credits Nunjucks by name", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/nunjucks") });
  try {
    assert.equal(run.error, null);
    const product = run.ctx.screens.find((s) => s.selector === "views-product");
    assert.ok(product, "the page is a screen");
    assert.equal(product.readBy, "nunjucks");
    assert.equal(product.templateOrigin, "a Nunjucks template, composed into its layout and lowered through jinja");
    assert.deepEqual(product.composed, ["views/layout.njk"]);
    assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["views-partials-nav", "views-product"], "the layout is chrome, the include a screen too");
    assert.ok(!/<html|<head|DOCTYPE/.test(product.template), "the document around the page never reaches the port");
    assert.match(product.template, /^<nav>/, "the layout's nav include is composed in");
    assert.match(product.template, /<p class="price">\{\{ \(product\.price \| round\(2\)\) \}\}<\/p>/, "the set is read where it was bound");
    assert.match(product.template, /ng-repeat="tag in product\.tags"/);
    assert.match(product.template, /<pre>Use \{\{ '\{' \+ '\{' \}\} name \{\{ '\}' \+ '\}' \}\} in your template<\/pre>/);
    assert.ok(!/asyncEach|endeach|{% |import|endcall/.test(product.template), "no Nunjucks leaks into the template");
    assert.ok(run.ctx.readers.byReader.some(([r]) => r === "nunjucks"));
    assert.deepEqual(run.ctx.readers.unread, []);
  } finally {
    await run.cleanup();
  }
});

test("the sixteenth review pass: a set is substituted only when it is one top level binding no construct rebinds, reaches the parent, never a binding head; elseif, raw in attributes and comments, verbatim in .njk, layout scripts", async () => {
  const notes = []; const note = (n) => notes.push(n);
  const branchy = lowerJinja(`{% if a %}{% set cls = "on" %}{% else %}{% set cls = "off" %}{% endif %}<div class="{{ cls }}"></div>{% set total = 0 %}{% for p in ps %}{% set total = total + p.price %}{% endfor %}{{ total }}`, note);
  assert.equal(branchy, `<ng-container ng-if="a"></ng-container><ng-container ng-if="!(a)"></ng-container><div class="{{ cls }}"></div><ng-container ng-repeat="p in ps"></ng-container>{{ total }}`, "a set inside a branch or set twice is not substituted");
  assert.ok(notes.some((n) => /`\{% set cls %\}` binds a name inside a block or a loop/.test(n) || /`\{% set cls %\}` is set more than once/.test(n)));
  assert.ok(notes.some((n) => /`\{% set total %\}` is set more than once/.test(n)));
  const shadow = lowerJinja(`{% set item = "x" %}{% for item in items %}<li>{{ item }}</li>{% endfor %}{% set name = "y" %}{% macro card(name) %}<b>{{ name }}</b>{% endmacro %}{{ card(user.name) }}`, note);
  assert.equal(shadow, `<ng-container ng-repeat="item in items"><li>{{ item }}</li></ng-container><b>{{ user.name }}</b>`, "a name a loop or a macro rebinds is left to them");
  assert.ok(notes.some((n) => /`\{% set item %\}` names what a loop, a macro or a block binds again/.test(n)));
  const scoped = lowerJinja(`{% block a %}{% set x = user.first %}{{ x }}{% endblock %}{% block b %}{{ x }}{% endblock %}`, note);
  assert.equal(scoped, `{{ x }}{{ x }}`, "a set inside a block does not reach a sibling block");
  const chained = lowerJinja(`{% set a = user.name %}{% set b = a | upper %}{{ b }}{% for t in tags | sort %}{{ t }}{% endfor %}`, note);
  assert.equal(chained, `{{ (user.name | upper) }}<ng-container ng-repeat="t in tags | sort">{{ t }}</ng-container>`, "one set may read another, and a for's list is substituted while its head is not");
  const parent = `<a class="{% if active_page == 'index' %}on{% endif %}">x</a>{% block body %}{% endblock %}`;
  const child = lowerJinja(`{% extends "l" %}{% set active_page = "index" %}{% block body %}<p>hi</p>{% endblock %}`, note, () => parent);
  assert.equal(child, `<a class="{{ 'index' == 'index' ? 'on' : '' }}">x</a><p>hi</p>`, "a child's top level set reaches the parent it extends");
  assert.equal(lowerJinja(`{% if a %}<p>A</p>{% elseif b %}<p>B</p>{% else %}<p>C</p>{% endif %}`, note), `<ng-container ng-if="a"><p>A</p></ng-container><ng-container ng-if="!(a) && (b)"><p>B</p></ng-container><ng-container ng-if="!(a) && !(b)"><p>C</p></ng-container>`, "Nunjucks's elseif is elif");
  assert.equal(lowerJinja(`<div title="{% raw %}{{ x }}{% endraw %}"><pre>{% verbatim %}Use {# not a comment #} here{% endverbatim %}</pre></div>`, note), `<div title="{{ '{' + '{' }} x {{ '}' + '}' }}"><pre>Use {{ '{' + '#' }} not a comment {{ '#' + '}' }} here</pre></div>`, "raw braces stay whole inside an attribute and a raw comment is text");
  assert.equal(isDjango(`{% verbatim %}{{ x }}{% endverbatim %}`), false, "verbatim is Nunjucks's alias for raw, not Django's mark");
  assert.ok(!notes.some((n) => /could not be carried/.test(n)));

  const run = await runPipeline({ src: join(ROOT, "test/fixtures/nunjucks") });
  try {
    const product = run.ctx.screens.find((s) => s.selector === "views-product");
    assert.ok(!/<script|<style/.test(product.template), "the layout's scripts and styles never reach the port");
  } finally {
    await run.cleanup();
  }
});
