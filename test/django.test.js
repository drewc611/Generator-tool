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
    assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["includes-nav", "shop-detail", "shop-plain"], "the include is a screen too; the base is not; a child spelled only in jinja's shared tags is Django's by its base");
    const plain = run.ctx.screens.find((s) => s.selector === "shop-plain");
    assert.equal(plain.readBy, "django"); assert.deepEqual(plain.composed, ["shop/templates/base.html"]); assert.match(plain.template, /<nav>/);
    assert.ok(run.ctx.screens.every((s) => s.readBy === "django"), "input-jinja left the Django files to input-django");
    assert.deepEqual(run.ctx.readers.composed, [{ file: "shop/templates/base.html", reader: "django", into: 2 }]);
    assert.deepEqual(run.ctx.readers.unread, []);
    const jsx = await readFile(join(run.out, "src/features/ShopDetail/ShopDetail.jsx"), "utf8");
    assert.match(jsx, /\{product\.tags\.map\(\(tag, \$index\)/, "the loop and its counter reach React");
    for (const re of [/`\{% csrf_token %\}`/, /`\{% url %\}` reversed a route/, /`\{% cycle %\}` alternated/, /base\.html is a layout other templates extend/]) assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `${re} is named`);
  } finally {
    await run.cleanup();
  }
});

test("the fourteenth review pass: stripped filters named, url keyword arguments kept, quoted blocktrans values, asvar bound, colon filters in every tag, include notes name names, defined names are not inputs, prose keeps loop.index, a with name a loop rebinds", () => {
  const notes = []; const note = (n) => notes.push(n);
  const out = lower([
    `<a href="/s?q={{ q|urlencode }}">{{ body|safe }}</a>{{ text|linebreaks }}`,
    `{% url 'shop:detail' slug=product.slug year=2020 %}{% url 'shop:list' page %}`,
    `{% blocktrans with name="Hello World" %}Hi {{ name }}{% endblocktrans %}`,
    `{% blocktrans asvar title %}Hello{% endblocktrans %}<h1>{{ title }}</h1>`,
    `{% for x in xs|dictsort:"name" %}<li>{{ x }}</li>{% endfor %}`,
    `{% trans "Buy" as buy %}{% if buy %}<b>{{ buy }}</b>{% endif %}`,
    `{% with item=product %}{% for item in product.related %}<i>{{ item.name }}</i>{% endfor %}{% endwith %}`,
    `<p>Read about loop.index here</p>`,
  ].join(""), note);
  assert.match(out, /<a href="\/s\?q=\{\{ q \}\}">\{\{ body \}\}<\/a>\{\{ text \}\}/);
  assert.ok(notes.some((n) => /`\|urlencode` encoded the value for a URL; the port must encode it itself/.test(n)) && notes.some((n) => /`\|safe` marked the value as html/.test(n)) && notes.some((n) => /`\|linebreaks` turned line breaks/.test(n)), "a dropped filter is named by what it meant");
  assert.match(out, /\{\{ url\('shop:detail', \{ slug: product\.slug, year: 2020 \}\) \}\}\{\{ url\('shop:list', page\) \}\}/, "keyword arguments keep their names");
  assert.match(out, /Hi \{\{ "Hello World" \}\}/, "a quoted value with a space is whole");
  assert.match(out, /<h1>\{\{ "Hello" \}\}<\/h1>/, "asvar binds the text and prints nothing where the block stood");
  assert.ok(!/Hello<h1>/.test(out));
  assert.match(out, /ng-repeat="x in xs\|dictsort\('name'\)"/, "a colon filter in a for's list is jinja's call");
  assert.match(out, /<ng-container ng-if="'Buy'"><b>\{\{ "Buy" \}\}<\/b><\/ng-container>/, "a name bound by trans ... as is read inside a tag too");
  assert.match(out, /ng-repeat="item in product\.related"><i>\{\{ item\.name \}\}<\/i>/, "a with name the loop rebinds keeps the loop's own");
  assert.ok(notes.some((n) => /which a loop inside the block binds again/.test(n)));
  assert.match(out, /<p>Read about loop\.index here<\/p>/, "prose is not a loop variable");

  const n2 = []; const rewritten = djangoToJinja(`{% include "row.html" with total=product.price|floatformat:2 only %}{% include "x.html" only %}{% regroup people by city as grouped %}{% cycle 'a' 'b' as row silent %}{% for g in grouped %}<li class="{{ row }}">{{ g.grouper }}</li>{% endfor %}`, (n) => n2.push(n));
  assert.ok(n2.some((n) => n === '`{% include "row.html" with %}` passed `total` into the include; the include is inlined and reads those names from the page\'s own.'), "an include note names the names, never the values");
  assert.ok(n2.some((n) => /`\{% include "x\.html" only %\}` restricted the include/.test(n)));
  assert.ok(!n2.some((n) => /floatformat|product\.price/.test(n)));
  assert.deepEqual([...djangoToJinja.defined].sort(), ["grouped", "row"], "names a removed tag defined are known so they are not read as inputs");
  assert.match(rewritten, /\{% include "row\.html" %\}\{% include "x\.html" %\}/);

  assert.equal(isDjango(`{% trans %}Hello{% endtrans %}<p>{{ x }}</p>`), false, "jinja's i18n block is not Django's trans");
  assert.equal(isDjango(`{% autoescape false %}{{ html }}{% endautoescape %}`), false);
  assert.equal(isDjango(`{% for post in site.posts %}{{ post.date | date: "%Y" }}{% endfor %}{% assign x = 1 %}`), false, "a Liquid page in .html is not Django's");
  assert.equal(isDjango(`{% trans "Buy" %}`), true); assert.equal(isDjango(`{% autoescape off %}{{ x }}{% endautoescape %}`), true);
});

test("two apps' templates of one name stay two screens, and each child extends the base of its own app", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/django-apps") });
  try {
    assert.equal(run.error, null);
    const selectors = run.ctx.screens.map((s) => s.selector).sort();
    assert.deepEqual(selectors, ["blog-index", "catalog-index"], "the app qualifies a colliding name");
    const blog = run.ctx.screens.find((s) => s.selector === "blog-index");
    assert.match(blog.template, /<header>Blog<\/header>/, "the blog page extends the blog base, not the first base by path");
    assert.deepEqual(blog.composed, ["blog/templates/base.html"]);
    assert.match(run.ctx.screens.find((s) => s.selector === "catalog-index").template, /<header>Catalog<\/header>/);
    assert.deepEqual(run.ctx.readers.unread, []);
    assert.ok(!run.ctx.report.unverified.some((n) => /answered by 2 templates/.test(n)), "a same app parent is no tie");
  } finally {
    await run.cleanup();
  }
});
