import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { djangoToJinja } from "../plugins/input-django/index.js";
import { isDjango, lowerJinja } from "../plugins/input-jinja/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Django's template language rides the jinja lowering: its own spellings are
 * rewritten onto jinja's and what the server resolved is named.
 */

const lower = (src, note = () => {}) => lowerJinja(djangoToJinja(src, note), note);

test("a template is Django's by its own spellings, and jinja's otherwise", () => {
  assert.equal(isDjango(`{% load static %}<p>x</p>`), true);
  assert.equal(isDjango(`{% for t in ts %}{{ t }}{% empty %}none{% endfor %}`), true);
  assert.equal(isDjango(`{{ x|date:"Y" }}`), true);
  assert.equal(isDjango(`{{ forloop.counter }}`), true);
  assert.equal(isDjango(`{% if a %}{{ x|upper }}{% endif %}{% for x in xs %}{% else %}{% endfor %}`), false);
});

test("empty, ifequal, comment, trans, static, url, with, firstof, forloop, colon filters and an entries loop lower onto the dialect", () => {
  const notes = []; const note = (n) => notes.push(n);
  const out = lower([
    `{% load static i18n %}{% comment %}old{% endcomment %}`,
    `<a href="{% url 'shop:detail' product.id %}" class="{% if a %}on{% endif %}">{% trans "Buy" %}</a><img src="{% static 'img/logo.png' %}">`,
    `{% for tag in product.tags %}<li>{{ forloop.counter }}: {{ tag }}</li>{% empty %}<li>none</li>{% endfor %}`,
    `{% with total=product.price|floatformat:2 name=product.name %}<p>{{ name }} {{ total }}</p>{% endwith %}`,
    `{% ifequal product.type "shoe" %}<b>shoe</b>{% endifequal %}{% firstof a b "c" %}{{ product.date|date:"Y-m-d" }}`,
    `{% blocktrans with n=product.name %}Hello {{ n }}{% plural %}Hello all{% endblocktrans %}{% url 'home' as home %}<a href="{{ home }}">Home</a>`,
    `{% for k, v in specs.items %}<dt>{{ k }}</dt><dd>{{ v }}</dd>{% endfor %}{% now "Y" %}`,
  ].join(""), note);
  assert.equal(out,
    `<a href="{{ url('shop:detail', product.id) }}" class="{{ a ? 'on' : '' }}">Buy</a><img src="img/logo.png">` +
    `<ng-container ng-repeat="tag in product.tags track by $index"><li>{{ ($index + 1) }}: {{ tag }}</li></ng-container><ng-container ng-if="!product.tags || !product.tags.length"><li>none</li></ng-container>` +
    `<p>{{ product.name }} {{ product.price|floatformat(2) }}</p>` +
    `<ng-container ng-if="product.type == 'shoe'"><b>shoe</b></ng-container>{{ a || b || "c" }}{{ product.date|date("Y-m-d") }}` +
    `Hello {{ product.name }}<a href="{{ url('home') }}">Home</a>` +
    `<ng-container ng-repeat="(k, v) in specs"><dt>{{ k }}</dt><dd>{{ v }}</dd></ng-container>`);
  for (const re of [/`\{% url %\}` reversed a route/, /`\{% trans %\}` looked a translation up/, /`\{% static %\}` prefixed a path/, /`\{% with %\}` bound `total`, `name`/, /`\{% blocktrans %\}`/, /`\{% plural %\}` chose a form/, /`\{% now %\}` printed the server's clock/]) assert.ok(notes.some((n) => re.test(n)), `${re} is named`);
  assert.ok(!notes.some((n) => /floatformat:2|product\.price/.test(n)), "a with note names the bound names, never what they were bound to");
  assert.ok(!notes.some((n) => /could not be carried/.test(n)), "no Django tag falls through as unknown");
});

test("the jinja lowering itself now reads for k, v in map.items() as the entries loop and spells loop.index, loop.index0 and loop.first", () => {
  const notes = [];
  const out = lowerJinja(`{% for k, v in d.items() %}<dt>{{ k }}</dt>{% endfor %}{% for x in xs %}<i class="{% if loop.first %}f{% endif %}">{{ loop.index0 }}/{{ loop.index }} {{ loop.last }}</i>{% endfor %}`, (n) => notes.push(n));
  assert.equal(out, `<ng-container ng-repeat="(k, v) in d"><dt>{{ k }}</dt></ng-container><ng-container ng-repeat="x in xs track by $index"><i class="{{ ($index == 0) ? 'f' : '' }}">{{ $index }}/{{ ($index + 1) }} {{ loop.last }}</i></ng-container>`);
  assert.ok(!notes.some((n) => /unpacked a tuple/.test(n)), "the items() pair is not a tuple the lowering drops");
  assert.ok(notes.some((n) => /beyond index and first/.test(n)), "loop.last is named");
});

test("a run composes the page into its base through the nav include, leaves the layout to the page, reads inputs and names what the server did", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/django") });
  try {
    assert.equal(run.error, null);
    const detail = run.ctx.screens.find((s) => s.selector === "shop-detail");
    assert.ok(detail, "the page is a screen");
    assert.equal(detail.readBy, "django");
    assert.equal(detail.templateOrigin, "a Django template, composed into its layout and lowered through jinja");
    assert.deepEqual(detail.composed, ["shop/templates/base.html"]);
    assert.deepEqual(detail.inputs, ["product", "section"]);
    assert.match(detail.template, /<nav>/, "the base's nav include is composed in");
    assert.match(detail.template, /ng-if="!product\.tags \|\| !product\.tags\.length"/, "{% empty %} is the empty state");
    assert.match(detail.template, /ng-repeat="\(key, value\) in product\.specs"/);
    assert.match(detail.template, /\{\{ url\('shop:order', product\.id\) \}\}/);
    assert.ok(!/\{%|forloop|old sidebar|csrf/.test(detail.template), "no Django leaks into the template and a comment's body is gone");
    assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["includes-nav", "shop-detail"], "the include is a screen too; the base is not");
    assert.ok(run.ctx.screens.every((s) => s.readBy === "django"), "input-jinja left the Django files to input-django");
    assert.deepEqual(run.ctx.readers.composed, [{ file: "shop/templates/base.html", reader: "django", into: 1 }]);
    assert.deepEqual(run.ctx.readers.unread, []);
    const jsx = await readFile(join(run.out, "src/features/ShopDetail/ShopDetail.jsx"), "utf8");
    assert.match(jsx, /\{product\.tags\.map\(\(tag, \$index\)/, "the loop and its counter reach React");
    for (const re of [/`\{% csrf_token %\}`/, /`\{% url %\}` reversed a route/, /`\{% cycle %\}` alternated/, /base\.html is a layout other templates extend/]) assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `${re} is named`);
  } finally {
    await run.cleanup();
  }
});
