import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { liquidToJs, lowerLiquid, lowerOutput, splitSchema } from "../plugins/input-liquid/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Liquid is the jinja shape with its own words, and a theme is a layout that
 * wraps every template. Each construct with an exact spelling is lowered; the
 * server side machinery is named.
 */

test("liquid operators and shorthands become JS outside of strings", () => {
  assert.equal(liquidToJs("a and b or c contains d"), "a && b || c.includes(d)");
  assert.equal(liquidToJs("x == blank and y != empty"), "!(x) && !!(y && y.length)");
  assert.equal(liquidToJs("items.size > 1 and items.first == nil"), "items.length > 1 && items[0] == null");
  assert.equal(liquidToJs("'a and b'"), "'a and b'", "a string is left alone");
});

test("filters with an exact spelling are rewritten and the rest are kept for the translator", () => {
  assert.equal(lowerOutput("name | upcase"), "{{ name | uppercase }}");
  assert.equal(lowerOutput("title | default: 'Untitled' | append: '!'"), `{{ ((title || 'Untitled') + '!') }}`);
  assert.equal(lowerOutput("items | size"), "{{ items.length }}");
  assert.equal(lowerOutput("body | truncate: 20"), "{{ body | limitTo:20 }}");
  assert.equal(lowerOutput("price | money"), "{{ price | money }}", "a platform filter stays as written so the translator names it");
  assert.equal(lowerOutput("tags | join: ', '"), "{{ tags.join(', ') }}");
});

test("if, elsif, unless, case, for and its else lower onto the dialect's blocks", () => {
  const notes = [];
  const out = lowerLiquid(
    `{% if a %}1{% elsif b %}2{% else %}3{% endif %}{% unless c %}4{% endunless %}` +
    `{% case t %}{% when 'x', 'y' %}X{% when 'z' %}Z{% else %}O{% endcase %}` +
    `<ul>{% for i in items %}<li>{{ i.name }}</li>{% else %}<li>none</li>{% endfor %}</ul>`,
    (n) => notes.push(n)
  );
  assert.equal(out,
    `<ng-container ng-if="a">1</ng-container><ng-container ng-if="!(a) && (b)">2</ng-container><ng-container ng-if="!(a) && !(b)">3</ng-container>` +
    `<ng-container ng-if="!(c)">4</ng-container>` +
    `<ng-container ng-if="(t) == 'x' || (t) == 'y'">X</ng-container><ng-container ng-if="(t) == 'z'">Z</ng-container><ng-container ng-if="!((t) == 'x' || (t) == 'y') && !((t) == 'z')">O</ng-container>` +
    `<ul><ng-container ng-repeat="i in items"><li>{{ i.name }}</li></ng-container><ng-container ng-if="!items || !items.length"><li>none</li></ng-container></ul>`);
  assert.deepEqual(notes, []);
});

test("machinery is named, a held snippet is inlined, a missing one is named, and raw stays literal", () => {
  const notes = [];
  const resolve = (kind, name) => (kind === "snippets" && name === "price" ? `<b>{{ price }}</b>` : null);
  const out = lowerLiquid(
    `{% assign x = 1 %}{% render 'price' %}{% render 'gone' %}{% for p in ps limit: 2 %}{{ p }}{% endfor %}{% raw %}{{ kept }}{% endraw %}{% capture c %}q{% endcapture %}`,
    (n) => notes.push(n), resolve
  );
  assert.match(out, /^<b>\{\{ price \}\}<\/b>/);
  assert.match(out, /&#123;&#123; kept &#125;&#125;/, "raw output is literal text, not an interpolation");
  assert.ok(notes.some((n) => /assign x = 1/.test(n)) && notes.some((n) => /gone/.test(n)) && notes.some((n) => /limit/.test(n)));
  assert.doesNotMatch(out, /\{%/);
});

test("a section's schema names its settings, and the schema is not markup", () => {
  const { source, settings } = splitSchema(`<h1>x</h1>{% schema %}{ "settings": [{"id":"title"},{"id":"show"}] }{% endschema %}`);
  assert.deepEqual(settings, ["title", "show"]);
  assert.equal(source, "<h1>x</h1>");
});

test("a run wraps each template in the layout, inlines its sections and snippets, and reads settings and platform objects as inputs", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/liquid") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!by("layout-theme"), "the layout is chrome, not a screen");
    const product = by("templates-product");
    assert.ok(product && product.readBy === "liquid");
    assert.match(product.template, /^<header>/, "the layout wraps the template and the header section is inlined");
    assert.match(product.template, /<span class="price">\{\{ product\.price \| money \}\}<\/span>/, "the snippet is inlined");
    assert.match(product.template, /<ng-container ng-if="!\(product\.available\)">/);
    assert.match(product.template, /ng-if="\(product\.type\) == 'Shoe' \|\| \(product\.type\) == 'Boot'"/);
    assert.match(product.template, /ng-repeat="v in product\.variants"/);
    assert.match(product.template, /<form data-liquid-form="product">/);
    assert.doesNotMatch(product.template, /\{%|content_for|has_variants/);
    assert.deepEqual(product.inputs, ["product", "routes", "show_search", "title"]);
    assert.ok(product.usesNgIf && product.usesNgFor);
    const header = by("sections-header");
    assert.deepEqual(header.inputs, ["routes", "show_search", "title"], "schema settings and the platform object it reads");
    assert.match(header.template, /\{\{ title \| uppercase \}\}/, "a setting read is the input itself");
    assert.deepEqual(by("snippets-price").inputs, ["product"]);
    const jsx = await readFile(join(run.out, "src/features/TemplatesProduct/TemplatesProduct.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|\{%/);
    assert.ok(run.ctx.report.unverified.some((n) => /limit/.test(n)) && run.ctx.report.unverified.some((n) => /money/.test(n)), "the limit and the platform filter are both named");
  } finally {
    await run.cleanup();
  }
});
