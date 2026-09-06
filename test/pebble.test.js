import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { lowerJinja } from "../plugins/input-jinja/lower.js";
import { pebbleToTwig } from "../plugins/input-pebble/index.js";
import { twigToJinja } from "../plugins/input-twig/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Pebble rides Twig's front over the jinja lowering: its own spellings are
 * rewritten onto Twig's and what the client cannot do is named.
 */

const lower = (src, note = () => {}) => lowerJinja(twigToJinja(pebbleToTwig(src, note), note), note);

test("equals, contains, even and odd, ?: and the block wrappers lower onto the dialect; a block filter and an embed are named", () => {
  const notes = []; const note = (n) => notes.push(n);
  const out = lower([
    `{% autoescape %}{% parallel %}{% cache "k" %}`,
    `{% if a equals 1 %}<b>one</b>{% elseif tags contains "sale" %}<i>sale</i>{% endif %}`,
    `{% for t in tags %}<li class="{% if loop.index is even %}e{% endif %}">{{ t }}</li>{% endfor %}`,
    `<p>{{ product.tagline ?: product.name }}</p>{% filter upper %}<p>shout</p>{% endfilter %}`,
    `{% endcache %}{% endparallel %}{% endautoescape %}{% flush %}`,
  ].join(""), note);
  assert.equal(out,
    `<ng-container ng-if="a == 1"><b>one</b></ng-container><ng-container ng-if="!(a == 1) && ((tags).includes('sale'))"><i>sale</i></ng-container>` +
    `<ng-container ng-repeat="t in tags track by $index"><li class="{{ $index % 2 == 0 ? 'e' : '' }}">{{ t }}</li></ng-container>` +
    `<p>{{ product.tagline || product.name }}</p><p>shout</p>`);
  assert.ok(notes.some((n) => /`\{% filter upper %\}` applied a filter to a whole block/.test(n)));
  assert.ok(!notes.some((n) => /could not be carried|server side machinery/.test(n)), "nothing Pebble falls through as unknown");
  lower(`{% embed "card.peb" %}{% block body %}x{% endblock %}{% endembed %}{% if x is iterable %}y{% endif %}`, note);
  assert.ok(notes.some((n) => /`\{% embed "card\.peb" %\}` included a template while overriding its blocks/.test(n)));
  assert.ok(notes.some((n) => /a runtime type the client cannot know/.test(n)));
});

test("a run composes the page into its base through the nav include, ports it and names the base as composed", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/pebble") });
  try {
    assert.equal(run.error, null);
    const product = run.ctx.screens.find((s) => s.selector === "product");
    assert.ok(product, "the page is a screen");
    assert.equal(product.readBy, "pebble");
    assert.equal(product.templateOrigin, "a Pebble template, composed into its layout and lowered through Twig and jinja");
    assert.deepEqual(product.composed, ["templates/base.peb"]);
    assert.match(product.template, /^<nav>/);
    assert.match(product.template, /ng-if="\(product\.tags\)\.includes\('sale'\)"/);
    assert.match(product.template, /\{\{ product\.tagline \|\| product\.name \}\}/);
    assert.ok(!/parallel|autoescape|endfilter|equals|contains|\?:/.test(product.template), "no Pebble leaks into the template");
    assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["partials-nav", "product"]);
    assert.deepEqual(run.ctx.readers.unread, []);
  } finally {
    await run.cleanup();
  }
});

test("the seventeenth review pass: loop.index counts from zero, contains inside a string is prose, .equals( is a method, a set inside an even test stays scoped", () => {
  const notes = []; const note = (n) => notes.push(n);
  assert.equal(lower(`{% for t in tags %}<i>{{ loop.index }}/{{ loop.revindex }}</i>{% endfor %}`, note), `<ng-container ng-repeat="t in tags track by $index"><i>{{ $index }}/{{ loop.revindex0 }}</i></ng-container>`, "Pebble's loop.index is the dialect's own zero based index");
  assert.equal(lower(`<p>{{ "this box contains nuts" }}</p>{% if user.name.equals("x") %}y{% endif %}{% if tags contains "sale" and a contains b %}z{% endif %}`, note), `<p>{{ "this box contains nuts" }}</p><ng-container ng-if="user.name.equals('x')">y</ng-container><ng-container ng-if="(tags).includes('sale') && (a).includes(b)">z</ng-container>`);
  assert.equal(lower(`{% if count is even %}{% set cls = "e" %}{% endif %}<li class="{{ cls }}">x</li>{% for t in tags %}{% set y = t %}{{ y }}{% endfor %}`, note), `<ng-container ng-if="count % 2 == 0"></ng-container><li class="{{ cls }}">x</li><ng-container ng-repeat="t in tags">{{ y }}</ng-container>`, "a % inside a tag no longer breaks the set scope scan");
  assert.ok(notes.some((n) => /`\{% set cls %\}` binds a name inside a block or a loop/.test(n)));
});
