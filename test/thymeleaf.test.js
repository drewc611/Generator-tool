import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readInputs } from "../plugins/dsp-ir/text.js";
import { decorate, exprToJs, freshScope, lowerLink, lowerTree, lowerValue, parseHtml, withElse } from "../plugins/input-thymeleaf/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Thymeleaf's th: attributes lowered onto the dialect beside the prototype
 * they replace; fragments and the Layout Dialect composed the way the engine
 * composes them; what has no equivalent named.
 */

const lower = (html, note = () => {}, library) => lowerTree(parseHtml(html), freshScope(note), library);

test("the expression language is spelled as JavaScript outside strings, utilities rewritten or named", () => {
  const notes = [];
  const sc = freshScope((n) => notes.push(n));
  assert.equal(exprToJs("a and b or not c"), "a && b || !c");
  assert.equal(exprToJs("x eq 1 and y ne 'and or'"), "x == 1 && y != 'and or'");
  assert.equal(exprToJs("name ?: 'anon'"), "name || 'anon'");
  assert.equal(exprToJs("#lists.isEmpty(a)"), "!a || !a.length", "the whole expression needs no brackets");
  assert.equal(exprToJs("#lists.isEmpty(a) and b"), "(!a || !a.length) && b", "a part of one does");
  assert.equal(exprToJs("#strings.toUpperCase(n) + #strings.listJoin(xs, ', ')"), "n.toUpperCase() + xs.join(', ')");
  assert.equal(exprToJs("#dates.format(d, 'dd MMM')", sc), "d", "a formatter keeps its value unformatted");
  assert.equal(exprToJs("#fields.hasErrors('body')", sc), "fields.hasErrors('body')", "an unknown utility stays the call it was");
  assert.equal(exprToJs("#authentication.name", sc), "authentication.name");
  assert.ok(notes.some((n) => /formatted its value on the server/.test(n)) && notes.some((n) => /must supply `fields`/.test(n)) && notes.some((n) => /context object/.test(n)));
  assert.equal(withElse("ok ? 'hot'"), "ok ? 'hot' : ''");
  assert.equal(withElse("ok ? 'a' : 'b'"), "ok ? 'a' : 'b'");
  assert.equal(withElse("x?.y ?: 'z'"), "x?.y ?: 'z'");
});

test("link expressions become the address they build, and each standard expression kind reads as itself", () => {
  assert.deepEqual(lowerLink("/products/{id}(id=${p.id},q=${q})"), { kind: "interp", text: "/products/{{ p.id }}?q={{ q }}" });
  assert.deepEqual(lowerLink("/a/b"), { kind: "literal", text: "/a/b" });
  assert.deepEqual(lowerLink("'/x/' + ${id}"), { kind: "interp", text: "/x/{{ id }}" });
  assert.deepEqual(lowerLink("~/home(page=2)"), { kind: "literal", text: "/home?page=2" });
  assert.deepEqual(lowerValue("|Hi ${name}, welcome|"), { kind: "interp", text: "Hi {{ name }}, welcome" });
  assert.deepEqual(lowerValue("'Total: ' + ${t}"), { kind: "expr", text: "'Total: ' + t" });
  assert.deepEqual(lowerValue("#{home.title}"), { kind: "literal", text: "home.title" });
  assert.deepEqual(lowerValue("'plain'"), { kind: "literal", text: "plain" });
  const sc = freshScope(); sc.object = "form";
  assert.deepEqual(lowerValue("*{name}", sc), { kind: "expr", text: "form.name" });
  assert.deepEqual(lowerValue("*{stock > 0 and stock < 5}", sc), { kind: "expr", text: "form.stock > 0 && form.stock < 5" }, "every path root inside a selection is a field");
});

test("th:if, th:unless, th:each with its status, th:text, th:utext, th:switch, th:field and th:remove lower onto the dialect", () => {
  const notes = [];
  const out = lower(
    `<p th:if="\${a}" th:text="\${msg}">proto</p><p th:unless="\${b}">B</p>` +
    `<ul><li th:each="x, st : \${xs}" th:class="\${st.odd} ? 'odd' : 'even'" th:classappend="\${x.hot} ? 'hot'"><b th:text="\${st.count}">1</b>[[\${x.name}]]</li></ul>` +
    `<div th:utext="\${html}"><i>proto</i></div>` +
    `<th:block th:switch="\${t}"><span th:case="'a'">A</span><span th:case="*">Z</span></th:block>` +
    `<form th:object="\${review}"><input type="text" th:field="*{rating}"></form>` +
    `<p th:remove="all">gone</p><div th:remove="tag"><p>kept</p></div><p th:remove="body">empty</p>` +
    `<img th:src="@{/i/{id}.png(id=\${p.id})}" src="proto.png" th:alt-title="\${p.name}" alt="proto">` +
    `<!--/* parser comment */--><!--/*/ <p class="proto">shown</p> /*/-->` +
    `<a th:href="@{/go}" href="#" th:onclick="'track(' + \${id} + ')'">Go</a>`,
    (n) => notes.push(n),
  );
  assert.equal(out,
    `<p ng-if="a">{{ msg }}</p><p ng-if="!(b)">B</p>` +
    `<ul><li ng-class="(($index % 2 == 1) ? 'odd' : 'even') + ' ' + (x.hot ? 'hot' : '')" ng-repeat="x in xs track by $index"><b>{{ ($index + 1) }}</b>{{ x.name }}</li></ul>` +
    `<div ng-bind-html="html"></div>` +
    `<ng-container><span ng-if="(t) == 'a'">A</span><span ng-if="!((t) == 'a')">Z</span></ng-container>` +
    `<form><input type="text" name="rating" id="rating" ng-model="review.rating"></form>` +
    `<p>kept</p><p></p>` +
    `<img ng-src="/i/{{ p.id }}.png" ng-attr-alt="{{ p.name }}" ng-attr-title="{{ p.name }}">` +
    ` <p class="proto">shown</p> ` +
    `<a href="/go">Go</a>`);
  assert.ok(notes.some((n) => /th:onclick built inline script/.test(n)));
  assert.doesNotMatch(out, /track\(/, "the handler's script is not in the port");
});

test("a repeated element with a condition repeats first and tests per item; an unknown th:each shape is named", () => {
  const notes = [];
  assert.equal(lower(`<li th:each="x : \${xs}" th:if="\${x.on}" th:text="\${x}">p</li>`), `<ng-container ng-repeat="x in xs"><li ng-if="x.on">{{ x }}</li></ng-container>`);
  assert.equal(lower(`<li th:each="\${xs}">p</li>`, (n) => notes.push(n)), `<li>p</li>`);
  assert.ok(notes.some((n) => /iterates in a shape this reader does not know/.test(n)));
});

test("fragments compose with their parameters, insert keeps the host, replace does not, and a missing one is named", () => {
  const lib = parseHtml(`<div th:fragment="card(title, body)"><h2 th:text="\${title}">T</h2><p th:text="\${body}">B</p></div><small th:fragment="legal">(c)</small>`);
  const library = { resolve: (name) => (name === "frags" ? { root: lib, fragments: collect(lib), name } : null) };
  const notes = [];
  const out = lower(
    `<section th:insert="~{frags :: card(\${p.name}, 'Static')}">host</section>` +
    `<footer th:replace="~{frags :: legal}">host</footer>` +
    `<div th:replace="~{missing :: x}">host</div>`,
    (n) => notes.push(n), library,
  );
  assert.equal(out, `<section><div><h2>{{ p.name }}</h2><p>Static</p></div></section><small>(c)</small>`);
  assert.ok(notes.some((n) => /names a template this run does not hold/.test(n)));
});
async function collectFrom() { return (await import("../plugins/input-thymeleaf/index.js")).collectFragments; }
let collect;
test.before(async () => { collect = await collectFrom(); });

test("the Layout Dialect composes a page into its layout: the fragment fills, default content goes, markup outside is named", () => {
  const notes = [];
  const layout = parseHtml(`<html><body><header>H</header><main layout:fragment="content"><p>default</p></main><footer>F</footer></body></html>`);
  const page = parseHtml(`<html layout:decorate="~{layout}"><body><main layout:fragment="content"><h1 th:text="\${t}">T</h1></main><aside>outside</aside></body></html>`);
  const out = lowerTree(decorate(page, layout, (n) => notes.push(n)), freshScope());
  assert.equal(out, `<html><body><header>H</header><main><h1>{{ t }}</h1></main><footer>F</footer></body></html>`);
  assert.ok(notes.some((n) => /outside any layout:fragment/.test(n)));
});

test("the shared readInputs reads an address around an expression as the expression alone", () => {
  assert.deepEqual(readInputs(`<a ng-href="/cart/add?id={{ p.id }}&qty={{ qty }}">x</a><li ng-repeat="t in p.tags track by $index">{{ ($index + 1) }} {{ t }}</li>`), ["p", "qty"]);
  assert.deepEqual(readInputs(`{{ a }} {{ b.c }}`, { skip: ["a"] }), ["b"]);
});

test("a run composes the page into its layout and fragments, ports it, reads the locals, and names the machinery", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/thymeleaf") });
  try {
    assert.equal(run.error, null);
    const screens = run.ctx.screens.filter((s) => s.readBy === "thymeleaf");
    assert.deepEqual(screens.map((s) => s.selector), ["product"], "the layout and the fragment file are chrome, not screens");
    const product = screens[0];
    assert.match(product.template, /^<nav>\s*<a href="\/">nav\.home<\/a>\s*<span class="who" ng-if="user != null">\{\{ user\.name \}\}<\/span>\s*<\/nav>/, "the layout's th:replace fragment with its argument");
    assert.match(product.template, /<h1>\{\{ product\.name \}\}<\/h1>/);
    assert.match(product.template, /<img ng-src="\/images\/\{\{ product\.id \}\}\.png" ng-attr-alt="\{\{ product\.name \}\}" ng-attr-title="\{\{ product\.name \}\}">/);
    assert.match(product.template, /<p class="price">Price: \{\{ product\.price \}\} \{\{ currency \}\}<\/p>/);
    assert.match(product.template, /<span class="badge" ng-if="!\(\(product\.type\) == 'shoe'\) && !\(\(product\.type\) == 'hat'\)">\{\{ product\.type \}\}<\/span>/);
    assert.match(product.template, /<p class="low" ng-if="product\.stock > 0 && product\.stock < 5">Only \{\{ product\.stock \}\} left<\/p>/);
    assert.match(product.template, /<p class="out" ng-if="!\(product\.stock > 0\)">product\.soldout<\/p>/);
    assert.match(product.template, /<li ng-class="\(\(\$index % 2 == 1\) \? 'odd' : 'even'\) \+ ' ' \+ \(tag\.hot \? 'hot' : ''\)" ng-repeat="tag in product\.tags track by \$index">/);
    assert.match(product.template, /<p>\{\{ 'Total: ' \+ \(product\.price \* quantity\) \}\}<\/p>/, "th:with substituted");
    assert.match(product.template, /<div class="description" ng-bind-html="product\.descriptionHtml"><\/div>/);
    assert.match(product.template, /<a class="buy" ng-href="\/cart\/add\?id=\{\{ product\.id \}\}&qty=\{\{ quantity \}\}" ng-disabled="product\.stock == 0">Buy<\/a>/);
    assert.match(product.template, /<form method="post" action="\/reviews">/);
    assert.match(product.template, /<input type="number" value="5" name="rating" id="rating" ng-model="review\.rating">/);
    assert.match(product.template, /<p class="error" ng-if="fields\.hasErrors\('body'\)">Body error<\/p>/);
    assert.match(product.template, /<p>Free shipping on every order\.<\/p>/);
    assert.match(product.template, /<p class="proto-only">Prototype only comment content<\/p>/);
    assert.match(product.template, /<footer><small>All rights reserved\.<\/small><\/footer>/, "the layout's th:insert fragment");
    assert.doesNotMatch(product.template, /Delete me|Layout default content|Outside the fragment|Prototype navigation|th:|\[\[|track\(/);
    assert.deepEqual(product.inputs, ["authentication", "currency", "fields", "product", "quantity", "review", "user"]);
    assert.equal(product.usesTwoWay, true);
    const jsx = await readFile(join(run.out, "src/features/Product/Product.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|th:|\[\[/);
    assert.match(jsx, /useState/, "th:field became controlled inputs");
    for (const re of [/defines only fragments/, /layout other templates decorate/, /Message keys/, /th:onclick built inline script/, /th:errors rendered Spring validation/, /#authentication is a context object/, /outside any layout:fragment/]) {
      assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `named: ${re}`);
    }
  } finally {
    await run.cleanup();
  }
});

test("the sixth review pass: the older fragment spelling, a void element repeated with a condition, a selection with a utility", () => {
  const lib = parseHtml(`<small th:fragment="legal">(c)</small><nav th:fragment="nav"><span th:replace="~{:: legal}">x</span></nav>`);
  const library = { resolve: (name) => (name === "frags" ? { root: lib, fragments: collect(lib), name } : null) };
  assert.equal(lower(`<footer th:replace="frags :: legal">host</footer>`, () => {}, library), `<small>(c)</small>`);
  assert.equal(lower(`<div th:insert="~{frags :: nav}">h</div>`, () => {}, library), `<div><nav><small>(c)</small></nav></div>`, ":: inside a fragment means the file it came from");
  assert.equal(lower(`<img th:each="i : \${imgs}" th:if="\${i.show}" th:src="@{\${i.url}}">`), `<ng-container ng-repeat="i in imgs"><img ng-src="{{ i.url }}" ng-if="i.show"></ng-container>`);
  const sc = freshScope(); sc.object = "f";
  assert.deepEqual(lowerValue("*{#maps.isEmpty(attrs)}", sc), { kind: "expr", text: "!f.attrs || !Object.keys(f.attrs).length" });
  assert.deepEqual(lowerValue("*{#fields.hasErrors('body')}", sc), { kind: "expr", text: "fields.hasErrors('body')" });
  assert.deepEqual(lowerValue("*{not active and name != null}", sc), { kind: "expr", text: "!f.active && f.name != null" });
});

test("the sixth review pass: appends apply after what they append to, th:field names its whole path, a whole template inserted is its body", () => {
  assert.equal(lower(`<li th:classappend="\${x.hot} ? 'hot'" th:class="\${odd} ? 'odd' : 'even'">x</li>`), `<li ng-class="(odd ? 'odd' : 'even') + ' ' + (x.hot ? 'hot' : '')">x</li>`);
  assert.equal(lower(`<form th:object="\${o}"><input th:field="*{billing.zip}"><input th:field="*{shipping.zip}"></form>`), `<form><input name="billing.zip" id="billing.zip" ng-model="o.billing.zip"><input name="shipping.zip" id="shipping.zip" ng-model="o.shipping.zip"></form>`);
  const footer = parseHtml(`<html><head><title>F</title></head><body><footer>F</footer></body></html>`);
  const library = { resolve: (name) => (name === "footer" ? { root: footer, fragments: collect(footer), name } : null) };
  assert.equal(lower(`<div th:insert="~{footer}"></div><p>after</p>`, () => {}, library), `<div><footer>F</footer></div><p>after</p>`);
  assert.equal(lowerTree(parseHtml(`<div th:replace="~{:: x}">h</div>`), freshScope()), "", "a direct caller with no fragments of its own does not crash");
});

test("the sixth review pass: a template is found by its path or a suffix of it, never by its basename alone", async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "portamp-th-"));
  try {
    await mkdir(join(dir, "templates/public"), { recursive: true });
    await writeFile(join(dir, "templates/public/nav.html"), `<nav th:fragment="menu">public</nav>`);
    await writeFile(join(dir, "templates/page.html"), `<html xmlns:th="http://www.thymeleaf.org"><body><div th:replace="~{admin/nav :: menu}">x</div><p th:text="\${t}">t</p></body></html>`);
    const run = await runPipeline({ src: dir });
    try {
      assert.equal(run.error, null);
      const page = run.ctx.screens.find((s) => s.selector === "page");
      assert.equal(page.template, `<p>{{ t }}</p>`, "the wrong nav is not composed in");
      assert.ok(run.ctx.report.unverified.some((n) => /admin\/nav.*does not hold/.test(n)));
    } finally {
      await run.cleanup();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
