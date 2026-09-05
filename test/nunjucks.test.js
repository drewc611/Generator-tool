import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { lowerJinja } from "../plugins/input-jinja/lower.js";
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
    `<pre>Use {{ "{" + "{" }} name {{ "}" + "}" }} and {{ "{" + "%" }} if x {{ "%" + "}" }} here</pre>`);
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
    assert.match(product.template, /<pre>Use \{\{ "\{" \+ "\{" \}\} name \{\{ "\}" \+ "\}" \}\} in your template<\/pre>/);
    assert.ok(!/asyncEach|endeach|{% |import|endcall/.test(product.template), "no Nunjucks leaks into the template");
    assert.ok(run.ctx.readers.byReader.some(([r]) => r === "nunjucks"));
    assert.deepEqual(run.ctx.readers.unread, []);
  } finally {
    await run.cleanup();
  }
});
