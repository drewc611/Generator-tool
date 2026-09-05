import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { twigToJinja } from "../plugins/input-twig/index.js";
import { lowerJinja } from "../plugins/input-jinja/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Twig is jinja's grammar with its own spellings; the reader rewrites those
 * onto jinja's and one lowering serves both, as with Liquid and its own.
 */

test("Twig's spellings are rewritten onto jinja's, outside of strings", () => {
  const notes = [];
  const out = twigToJinja(
    `{% if a is defined and b is empty %}x{% elseif c is not null %}y{% endif %}{{ name ~ '!' }}{{ body|e }}{{ 'a ~ b is defined' }}{{ path('home') }}`,
    (n) => notes.push(n)
  );
  assert.match(out, /\{% if a != null and b == null %\}/, "the tests are rewritten; and stays for the jinja lowering to translate");
  assert.match(out, /\{% elif c != null %\}/);
  assert.match(out, /\{\{ name \+ '!' \}\}/);
  assert.match(out, /\{\{ body \}\}/, "the escape filter is dropped; the target escapes");
  assert.match(out, /'a ~ b is defined'/, "a string is left alone");
  assert.ok(notes.some((n) => /path\('home'\)/.test(n)), "a server route call is named");
});

test("the rewritten template lowers through the jinja lowering, with the else of a for as the empty state", () => {
  const lowered = lowerJinja(twigToJinja(`{% for t in tags %}<li>{{ t|upper }}</li>{% else %}<li>none</li>{% endfor %}{% if n is defined %}<b>{{ n }}</b>{% endif %}`));
  assert.equal(lowered, `<ng-container ng-repeat="t in tags"><li>{{ t | upper }}</li></ng-container><ng-container ng-if="!tags || !tags.length"><li>none</li></ng-container><ng-container ng-if="n != null"><b>{{ n }}</b></ng-container>`);
});

test("a run composes the page into its layout, inlines the include, skips the layout as a screen, and ports it", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/twig") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!by("templates-base"), "the layout is chrome, not a screen");
    const product = by("templates-product");
    assert.ok(product && product.readBy === "twig");
    assert.match(product.template, /^<nav>/, "the layout's nav include is composed in and the body is the screen");
    assert.match(product.template, /<ng-container ng-if="user != null">/);
    assert.match(product.template, /<ng-container ng-if="product\.stock == null">/);
    assert.match(product.template, /ng-if="!\(product\.stock == null\) && \(product\.stock < 5\)"/);
    assert.match(product.template, /ng-repeat="tag in product\.tags"/);
    assert.match(product.template, /<li class="none">No tags<\/li>/);
    assert.doesNotMatch(product.template, /\{%|discounted|parent\(\)/);
    assert.ok(product.usesNgIf && product.usesNgFor);
    assert.ok(by("templates-partials-nav"), "the partial is also a screen of its own, as with jinja");
    const jsx = await readFile(join(run.out, "src/features/TemplatesProduct/TemplatesProduct.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|\{%/);
    assert.ok(run.ctx.report.unverified.some((n) => /path\('home'\)|asset\(/.test(n)), "the server route and asset calls are named");
  } finally {
    await run.cleanup();
  }
});
