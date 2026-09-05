import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { lowerJinja } from "../plugins/input-jinja/lower.js";
import { voltToJinja } from "../plugins/input-volt/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Volt rides the jinja lowering through Twig's tests: its framework helpers
 * are the elements they render or the calls the port must supply, and its
 * server side tags are named.
 */

const lower = (src, note = () => {}, resolve = () => null) => lowerJinja(voltToJinja(src, note, resolve), note);

test("partials inline, link_to and url are the reverse router, tag helpers are fields, do, break and cache are named or transparent", () => {
  const notes = []; const note = (n) => notes.push(n);
  const out = lower([
    `{% cache "k" %}{{ partial('partials/nav') }}{{ link_to('products', 'Shop') }}<a href="{{ url('cart') }}">Cart</a><img src="{{ static_url('img/logo.png') }}">`,
    `{% for t in tags %}{% if t is empty %}{% continue %}{% endif %}<li>{{ t }}</li>{% endfor %}{% do product.touch() %}`,
    `{{ tag.textField(['quantity', 'class': 'qty']) }}{{ tag.select('size') }}{{ tag.textArea('note') }}{{ tag.submitButton('Buy') }}{{ flash.output() }}{% endcache %}`,
    `{% if a %}1{% elseif b %}2{% endif %}{{ partial('missing') }}`,
  ].join(""), note, (name) => (name === "partials/nav" ? `<nav>{{ section }}</nav>` : null));
  assert.equal(out,
    `<nav>{{ section }}</nav><a href="{{ url('products') }}">{{ 'Shop' }}</a><a href="{{ url('cart') }}">Cart</a><img src="{{ url('img/logo.png') }}">` +
    `<ng-container ng-repeat="t in tags"><ng-container ng-if="t == null"></ng-container><li>{{ t }}</li></ng-container>` +
    `<input type="text" ng-model="quantity"><select ng-model="size"></select><textarea ng-model="note"></textarea>{{ tag.submitButton('Buy') }}` +
    `<ng-container ng-if="a">1</ng-container><ng-container ng-if="!(a) && (b)">2</ng-container>`);
  for (const re of [/`link_to\(\)` built an anchor/, /`url\(\)` and `static_url\(\)` resolved a route/, /`\{% continue %\}` left a loop/, /`\{% do product\.touch %\}` ran an expression/, /`tag\.\*` form helpers render fields/, /`tag\.select` took its options/, /`flash\.output\(\)` printed/, /`partial\('missing'\)` names a template this run does not hold/]) assert.ok(notes.some((n) => re.test(n)), `${re} is named`);
  assert.ok(!notes.some((n) => /could not be carried/.test(n)));
});

test("a run composes every view into the layout that renders content(), inlines the nav partial, and names what the server did", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/volt") });
  try {
    assert.equal(run.error, null);
    const show = run.ctx.screens.find((s) => s.selector === "products-show");
    assert.ok(show, "the view is a screen");
    assert.equal(show.readBy, "volt");
    assert.equal(show.templateOrigin, "a Volt template, composed into its layout and lowered through jinja");
    assert.deepEqual(show.composed, ["app/views/layouts/main.volt"]);
    assert.match(show.template, /^<nav><a href="\{\{ url\('products'\) \}\}">/);
    assert.match(show.template, /<input type="text" ng-model="quantity">\s*<select ng-model="size"><\/select>/);
    assert.ok(show.usesTwoWay);
    assert.deepEqual(show.inputs, ["product", "quantity", "size"], "url is the router the port supplies, not an input; the field models are the state the port holds");
    assert.ok(!/content\(\)|partial\(|static_url|\{% cache|\{% do/.test(show.template), "no Volt leaks into the template");
    assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["partials-nav", "products-show"], "the layout is chrome; the partial is a screen too");
    assert.deepEqual(run.ctx.readers.unread, []);
  } finally {
    await run.cleanup();
  }
});
