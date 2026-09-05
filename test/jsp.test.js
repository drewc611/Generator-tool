import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseMarkup } from "../plugins/dsp-ir/markup.js";
import { readInputs } from "../plugins/dsp-ir/text.js";
import { elToJs, freshScope, lowerTree, prepare } from "../plugins/input-jsp/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * JSP with JSTL lowered onto the dialect: the core tags as the containers
 * they mean, EL as JavaScript, includes composed, Spring form tags as models,
 * and what ran on the server named.
 */

const lower = (src, note = () => {}, resolve = () => null) => { const sc = freshScope(note); return { out: lowerTree(parseMarkup(prepare(src, sc, resolve)), sc, resolve), sc }; };

test("EL is spelled as JavaScript: word operators, not, empty in its two senses, fn: functions, implicit objects named", () => {
  const notes = [];
  const sc = freshScope((n) => notes.push(n));
  assert.equal(elToJs("a and not b or c eq 1 and fn:length(x) gt 0"), "a && !b || c == 1 && x.length > 0");
  assert.equal(elToJs("empty user"), "user == null || user.length === 0", "an object with no length is not empty");
  sc.lists.add("product.tags");
  assert.equal(elToJs("empty product.tags", sc), "!product.tags || !product.tags.length", "a collection the page iterates reads as the dialect's empty state");
  assert.equal(elToJs("not empty product.tags and y", sc), "!(!product.tags || !product.tags.length) && y");
  assert.equal(elToJs("fn:contains(fn:toLowerCase(a), 'b') and fn:replace(s, 'x', 'y')"), "a.toLowerCase().includes('b') && s.split('x').join('y')");
  assert.equal(elToJs("param.q", sc), "param.q");
  assert.equal(elToJs("a ? b:c(x) : d", sc), "a ? b:c(x) : d", "a spaceless ternary is not a tag library call");
  sc.prefixes.add("my");
  assert.equal(elToJs("my:helper(a)", sc), "my_helper(a)");
  assert.equal(elToJs("'and eq empty'"), "'and eq empty'", "a string is left alone");
  assert.ok(notes.some((n) => /param is an implicit object/.test(n)) && notes.some((n) => /my:helper\(\) is a tag library function/.test(n)));
});

test("c:if, c:choose, c:forEach with its status, c:out, c:set, c:url and text EL lower onto the dialect", () => {
  const notes = [];
  const { out } = lower(
    `<c:set var="low" value="5" /><c:set var="label" value="Low" />` +
    `<c:if test="\${a}"><b>\${x}</b></c:if>` +
    `<c:choose><c:when test="\${n eq 0}">Z</c:when><c:when test="\${n lt low}">\${label}</c:when><c:otherwise>M</c:otherwise></c:choose>` +
    `<ul><c:forEach var="t" items="\${tags}" varStatus="s"><li class="\${s.first ? 'first' : ''}">\${s.count}/\${fn:length(tags)}: \${t.name}</li></c:forEach></ul>` +
    `<c:if test="\${empty tags}">none</c:if>` +
    `<c:out value="\${html}" escapeXml="false" /><c:out value="\${q}" default="nothing" /><c:out value="plain" />` +
    `<c:url var="u" value="/cart/add"><c:param name="id" value="\${p.id}" /></c:url><a href="\${u}">Buy</a><c:url value="/x" />` +
    `<c:if test="\${b}"><c:set var="inner" value="\${c}" /></c:if>\${inner}`,
    (n) => notes.push(n),
  );
  assert.equal(out,
    `<ng-container ng-if="a"><b>{{ x }}</b></ng-container>` +
    `<ng-container ng-if="n == 0">Z</ng-container><ng-container ng-if="!(n == 0) && (n < 5)">{{ 'Low' }}</ng-container><ng-container ng-if="!(n == 0) && !(n < 5)">M</ng-container>` +
    `<ul><ng-container ng-repeat="t in tags track by $index"><li ng-class="($index == 0) ? 'first' : ''">{{ ($index + 1) }}/{{ tags.length }}: {{ t.name }}</li></ng-container></ul>` +
    `<ng-container ng-if="!tags || !tags.length">none</ng-container>` +
    `<span ng-bind-html="html"></span>{{ (q || 'nothing') }}plain` +
    `<a ng-href="/cart/add?id={{ p.id }}">Buy</a>/x` +
    `<ng-container ng-if="b"></ng-container>{{ inner }}`);
  assert.ok(notes.some((n) => /c:set var="inner"> inside a branch or loop/.test(n)));
});

test("directives, comments, scriptlets, static and dynamic includes, form tags, formats and messages are composed or named", () => {
  const notes = [];
  const files = { "header.jspf": `<%@ taglib prefix="c" uri="x" %><c:set var="site" value="Shop" />`, "nav.jsp": `<nav>\${site}</nav>` };
  const { out, sc } = lower(
    `<%@ page contentType="text/html" %><%@ include file="header.jspf" %><%-- gone --%><!-- gone -->` +
    `<jsp:include page="nav.jsp"><jsp:param name="a" value="1" /></jsp:include>` +
    `<% int v = 1; %><p><%= v %></p><%! int f() { return 1; } %>` +
    `<fmt:message key="k" /><fmt:formatNumber value="\${price}" type="currency" />` +
    `<form:form modelAttribute="r" action="/go"><form:input path="name" /><form:select path="size" items="\${sizes}" itemValue="id" itemLabel="label" /><form:errors path="name" /></form:form>` +
    `<a href="/a" \${on ? 'disabled' : ''}>x</a><my:tag>kept</my:tag>`,
    (n) => notes.push(n), (name) => files[name] ?? null,
  );
  assert.equal(out,
    `<nav>{{ 'Shop' }}</nav><p>{{ v }}</p>k{{ price }}` +
    `<form action="/go" method="post"><input type="text" name="name" id="name" ng-model="r.name"><select name="size" id="size" ng-model="r.size"><option ng-repeat="o in sizes" ng-attr-value="{{ o.id }}">{{ o.label }}</option></select></form>` +
    `<a href="/a">x</a>kept`);
  assert.equal(sc.twoWay, true);
  for (const re of [/scriptlet/, /Java expression/, /declaration/, /passed a into the included page/, /Message keys/, /fmt:formatnumber> formatted/, /form:errors/, /stood where an attribute would/, /`my:` tag library/]) assert.ok(notes.some((n) => re.test(n)), `named: ${re}`);
});

test("readInputs joins expressions as statements, so a name before an expression that opens with ( is not a call", () => {
  assert.deepEqual(readInputs(`<p>{{ currency }}</p><li ng-class="($index == 0)">x</li>`), ["currency"]);
});

test("a run composes the page with its includes, ports it, reads the locals and names the machinery", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/jsp") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    assert.ok(!run.ctx.screens.some((s) => /header/.test(s.selector)), "a .jspf fragment is composed, not a screen");
    const product = by("product");
    assert.ok(product && product.readBy === "jsp");
    assert.match(product.template, /^<nav>\s*<a ng-href="\{\{ pageContext\.request\.contextPath \}\}\/">Home<\/a>\s*<ng-container ng-if="!\(user == null \|\| user\.length === 0\)"><span class="who">\{\{ user\.name \}\}<\/span><\/ng-container>\s*<\/nav>/);
    assert.match(product.template, /<h1>\{\{ product\.name \}\}<\/h1>/);
    assert.match(product.template, /ng-if="!\(product\.stock == 0\) && \(product\.stock < 5\)"><p class="low">Only \{\{ product\.stock \}\} left<\/p>/, "c:set of a number is a number");
    assert.match(product.template, /<p class="out">product\.soldout<\/p>/);
    assert.match(product.template, /<p class="price">\{\{ product\.price \}\} \{\{ currency \}\}<\/p>/);
    assert.match(product.template, /<ng-container ng-repeat="tag in product\.tags track by \$index">\s*<li ng-class="\(\$index == 0\) \? 'first' : ''">\{\{ \(\$index \+ 1\) \}\}\/\{\{ product\.tags\.length \}\}: \{\{ tag\.name\.toUpperCase\(\) \}\}<\/li>/);
    assert.match(product.template, /<ng-container ng-if="!product\.tags \|\| !product\.tags\.length"><li class="none">No tags<\/li><\/ng-container>/);
    assert.match(product.template, /<a class="buy" ng-href="\/cart\/add\?id=\{\{ product\.id \}\}">Buy<\/a>/);
    assert.match(product.template, /<div class="description"><span ng-bind-html="product\.descriptionHtml"><\/span><\/div>/);
    assert.match(product.template, /<p class="q">Search: \{\{ \(param\.q \|\| 'nothing'\) \}\}<\/p>/);
    assert.match(product.template, /<form action="\/reviews" method="post">\s*<label for="rating">Rating<\/label>\s*<input type="number" name="rating" id="rating" ng-model="review\.rating">\s*<textarea name="body" id="body" ng-model="review\.body" class="wide"><\/textarea>/);
    assert.match(product.template, /<p>Visits: \{\{ visits \}\}<\/p>\s*Custom tag content\s*<p>Free shipping on every order\.<\/p>/);
    assert.doesNotMatch(product.template, /visits = 1|<c:|<fmt:|<%|\$\{|product\.title/);
    assert.deepEqual(product.inputs, ["currency", "pageContext", "param", "product", "review", "sizes", "user", "visits", "year"]);
    assert.equal(product.usesTwoWay, true);
    assert.ok(by("includes-nav"), "the included page is also a screen of its own");
    const jsx = await readFile(join(run.out, "src/features/Product/Product.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|<c:|<fmt:|<%|visits = 1/);
    assert.match(jsx, /<nav>/, "the include is composed in and nav stays an element");
    for (const re of [/is a fragment other pages include/, /scriptlet/, /Java expression/, /Message keys/, /passed active into the included page/, /fmt:formatnumber> formatted/, /form:errors/, /`my:` tag library/, /pageContext is an implicit object/, /stood where an attribute would/]) {
      assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `named: ${re}`);
    }
  } finally {
    await run.cleanup();
  }
});

test("the eighth review pass: literals quoted through one helper, text around expressions in expression position, includes stripped, form attributes lowered, nested status restored", () => {
  const notes = [];
  const files = { "footer.jsp": `<script>var a = 1 < 2;</script><style>a{}</style><footer>F</footer>` };
  const { out } = lower(
    `<c:out value="\${q}" default="Don't know" /><c:out value="Hello \${name}" /><fmt:formatNumber value="it's" />` +
    `<c:if test="\${a} ">x</c:if><c:if test="\${a}\${b}">y</c:if>` +
    `<jsp:include page="footer.jsp" />` +
    `<form:form modelAttribute="r"><form:input path="n" id="own" cssClass="\${err ? 'bad' : ''}" /><form:checkboxes path="c" items="\${opts}" itemValue="id" itemLabel="label" /></form:form>` +
    `<c:forEach var="row" items="\${rows}" varStatus="s"><c:forEach var="cell" items="\${row}" varStatus="s">\${s.index}</c:forEach>|\${s.index}</c:forEach>`,
    (n) => notes.push(n), (name) => files[name] ?? null,
  );
  assert.equal(out,
    `{{ (q || 'Don\\'t know') }}Hello {{ name }}{{ 'it\\'s' }}` +
    `<ng-container ng-if="a">x</ng-container><ng-container ng-if="(a) + (b)">y</ng-container>` +
    `<footer>F</footer>` +
    `<form method="post"><input type="text" name="n" ng-model="r.n" id="own" class="{{ err ? 'bad' : '' }}"><label ng-repeat="o in opts"><input type="checkbox" name="c" ng-attr-value="{{ o.id }}" ng-model="r.c">{{ o.label }}</label></form>` +
    `<ng-container ng-repeat="row in rows track by $index"><ng-container ng-repeat="cell in row track by $index">{{ $index }}</ng-container>|{{ $index }}</ng-container>`);
  assert.ok(notes.some((n) => /mixes text and expressions/.test(n)));
});

test("the eighth review pass: a folder name is stripped only before a slash, and two pages that bare to one name keep their paths apart", async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "portamp-jsp-"));
  try {
    await mkdir(join(dir, "WEB-INF/jsp"), { recursive: true });
    await writeFile(join(dir, "index.jsp"), `<p>\${a}</p>`);
    await writeFile(join(dir, "WEB-INF/jsp/index.jsp"), `<p>\${b}</p>`);
    await writeFile(join(dir, "viewstate.jsp"), `<p>\${c}</p>`);
    const run = await runPipeline({ src: dir });
    try {
      assert.equal(run.error, null);
      const sels = run.ctx.screens.filter((s) => s.readBy === "jsp").map((s) => s.selector).sort();
      assert.deepEqual(sels.filter((x) => x !== "viewstate").length, 2);
      assert.ok(sels.includes("viewstate") && sels.includes("index") && (sels.includes("web-inf-jsp-index") || sels.includes("index-2")), JSON.stringify(sels));
      assert.ok(run.ctx.report.unverified.some((n) => /share the name index/.test(n)));
    } finally {
      await run.cleanup();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
