import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readPage } from "../plugins/input-static/index.js";
import { freshScope, lowerTwirl, parseParams, scalaToJs } from "../plugins/input-twirl/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Twirl, the Play Framework's template language: Scala reached from markup
 * through one character, lowered onto the dialect with the Scala spelled as
 * JavaScript and everything the server supplied named.
 */

const lower = (src, note = () => {}, resolve = () => null, types = {}) => {
  const scope = freshScope(note);
  for (const [k, v] of Object.entries(types)) scope.types.set(k, v);
  return lowerTwirl(src, scope, resolve, 0);
};

test("the header declares the parameters: groups, implicits, defaults and types with commas inside", () => {
  const { params, rest } = parseParams('@(product: Product, tags: Seq[String] = Nil, m: Map[String, Int])(implicit request: RequestHeader, messages: Messages)\n<h1/>');
  assert.deepEqual(params.map((p) => [p.name, p.type, p.fallback ?? null, p.implicit, p.group]), [
    ["product", "Product", null, false, 0], ["tags", "Seq[String]", "Nil", false, 0], ["m", "Map[String, Int]", null, false, 0],
    ["request", "RequestHeader", null, true, 1], ["messages", "Messages", null, true, 1],
  ]);
  assert.equal(rest, "\n<h1/>");
  assert.deepEqual(parseParams("<p>no header</p>"), { params: [], rest: "<p>no header</p>" });
});

test("Scala is spelled as JavaScript: strings, interpolation, Option, collections, placeholders, symbols, formatters named", () => {
  const notes = []; const s = freshScope((n) => notes.push(n));
  assert.equal(scalaToJs('product.description.getOrElse("none") + " " + s"Hi $name ${x.size}"', s), "(product.description ?? 'none') + ' ' + ('Hi ' + (name) + ' ' + (x.length))");
  assert.equal(scalaToJs("product.tags.isEmpty", s), "!product.tags || !product.tags.length");
  assert.equal(scalaToJs('!product.tags.nonEmpty && items.mkString(", ")', s), "!(product.tags && product.tags.length) && items.join(', ')");
  assert.equal(scalaToJs('xs.filter(_.active).map(_.name).contains("a")', s), "xs.filter((it) => it.active).map((it) => it.name).includes('a')");
  assert.equal(scalaToJs("Some(x)", s), "(x)"); assert.equal(scalaToJs("None", s), "null"); assert.equal(scalaToJs("x.toString.trim", s), "x.trim()");
  assert.equal(scalaToJs('if (a) "x" else b', s), "(a) ? 'x' : b");
  assert.equal(scalaToJs("xs.take(2).size", s), "xs.slice(0, 2).length");
  assert.equal(scalaToJs("d.isDefined && d.get", s), "(d != null) && d");
  assert.deepEqual(notes, []);
  assert.equal(scalaToJs('"%.2f".format(price)', s), "price");
  assert.ok(notes.some((n) => /formatter .*\.format/.test(n)), "a formatter is named and its value interpolated unformatted");
  scalaToJs("routes.Products.show(product.id)", s);
  assert.ok(notes.some((n) => /`routes` is Play's reverse router/.test(n)));
});

test("if chains, for with an index and a guard, match with Some, None, literals and guards, defining, Html, comments and @@ lower onto the dialect", () => {
  const notes = [];
  const out = lower([
    '@if(a) {<p>A</p>} else if (b) {<p>B</p>} else {<p>C</p>}',
    '@for((p, i) <- ps.zipWithIndex; q <- p.qs if q.ok) {<i>@p.a @i @q</i>}',
    '@x match { case Some(v) => {<b>@v</b>} case "a" => {A} case n if n > 2 => {<i>@n</i>} case _ => {D} }',
    '@defining(a.b) { t => <q>@t</q> }@Html(raw)@* gone *@ me@@x.org @{ val z = 1 }@{ a + 1 }',
  ].join(""), (n) => notes.push(n));
  assert.equal(out,
    '<ng-container ng-if="a"><p>A</p></ng-container><ng-container ng-if="!(a) && (b)"><p>B</p></ng-container><ng-container ng-if="!(a) && !(b)"><p>C</p></ng-container>' +
    '<ng-container ng-repeat="p in ps track by $index"><ng-container ng-repeat="q in p.qs"><ng-container ng-if="q.ok"><i>{{ p.a }} {{ $index }} {{ q }}</i></ng-container></ng-container></ng-container>' +
    '<ng-container ng-if="x != null"><b>{{ x }}</b></ng-container><ng-container ng-if="!(x != null) && (x == \'a\')">A</ng-container><ng-container ng-if="!(x != null) && !(x == \'a\') && (x > 2)"><i>{{ x }}</i></ng-container><ng-container ng-if="!(x != null) && !(x == \'a\') && !(x > 2)">D</ng-container>' +
    ' <q>{{ a.b }}</q> <span ng-bind-html="raw"></span> me@x.org {{ a + 1 }}');
  assert.ok(notes.some((n) => /A Scala block declaring `z` ran code/.test(n)), "a code block is named by what it declared, never by its text");
  assert.ok(!notes.some((n) => /could not be read/.test(n)));
});

test("a condition inside an attribute folds to a ternary, .map is a presence test on a declared Option or when .getOrElse follows, a loop on a collection, and named when undeclared", () => {
  const notes = [];
  const out = lower([
    '<a class="@if(on) {on} else {off}" href="@routes.X.y(id)">go</a>',
    '@d.map { v => <p>@v</p> }',
    '@e.map { v => <p>@v</p> }.getOrElse { <p>none</p> }',
    '@xs.map { case (x, i) => <b>@x.n @i</b> }',
    '@ys.map { y => <b>@y</b> }',
  ].join(""), (n) => notes.push(n), () => null, { d: "Option[String]", xs: "Seq[Item]" });
  assert.equal(out,
    '<a class="{{ on ? \'on\' : \'off\' }}" href="{{ routes.X.y(id) }}">go</a>' +
    '<ng-container ng-if="d != null"> <p>{{ d }}</p> </ng-container>' +
    '<ng-container ng-if="e != null"> <p>{{ e }}</p> </ng-container><ng-container ng-if="e == null"> <p>none</p> </ng-container>' +
    '<ng-container ng-repeat="(x, i) in xs"> <b>{{ x.n }} {{ i }}</b> </ng-container>' +
    '<ng-container ng-repeat="y in ys"> <b>{{ y }}</b> </ng-container>');
  assert.ok(notes.some((n) => /`ys.map \{ \}` was read as a loop; the template declares no type/.test(n)), "an undeclared receiver's .map is a loop with the assumption named");
  assert.ok(!notes.some((n) => /`xs.map|`e.map|`d.map/.test(n)), "a declared collection, a declared Option and a proven Option need no note");
  assert.ok(notes.some((n) => /folded into the ternary/.test(n)));
});

test("Play's form helpers become the form and fields they render, messages keeps its key, CSRF is named, a layout is applied as a call and a partial inlined with its arguments bound", () => {
  const notes = [];
  const templates = {
    main: { key: "app/views/main.scala.html", params: parseParams('@(title: String, active: String = "shop")(content: Html)').params, body: '<html><title>@title</title><body>@partials.nav(active)<main>@content</main></body></html>', layout: true },
    "partials/nav": { key: "app/views/partials/nav.scala.html", params: parseParams("@(active: String)").params, body: '<nav class="@active">n</nav>', layout: false },
    "partials/card": { key: "app/views/partials/card.scala.html", params: parseParams("@(product: Product, index: Int)").params, body: '<div class="card @if(index == 0) {first}">@product.name</div>', layout: false },
  };
  const scope = freshScope((n) => notes.push(n));
  scope.types.set("orderForm", "Form[OrderData]");
  const out = lowerTwirl([
    '@main(product.name) {',
    '@helper.form(action = routes.Orders.create(product.id), \'class -> "order") {@CSRF.formField @helper.inputText(orderForm("quantity"), \'_label -> "Quantity", \'min -> "1") @helper.textarea(orderForm("note")) <button>@messages("product.buy")</button>}',
    '@for((p, i) <- related.zipWithIndex) {@partials.card(p, i)}',
    '@unknown.layout("x") {<p>kept</p>}',
    '}',
  ].join(""), scope, (path) => templates[path] ?? null, 0);
  assert.equal(out,
    '<html><title>{{ product.name }}</title><body><nav class="shop">n</nav><main>' +
    '<form action="{{ routes.Orders.create(product.id) }}" class="order"> <label>Quantity</label><input type="text" ng-model="orderForm.quantity" min="1"> <textarea ng-model="orderForm.note"></textarea> <button>product.buy</button></form>' +
    '<ng-container ng-repeat="p in related track by $index"><div class="card {{ $index == 0 ? \'first\' : \'\' }}">{{ p.name }}</div></ng-container>' +
    '<p>kept</p>' +
    '</main></body></html>');
  assert.deepEqual([...scope.composed], ["app/views/main.scala.html", "app/views/partials/nav.scala.html", "app/views/partials/card.scala.html"]);
  assert.equal(scope.twoWay, true);
  assert.ok(notes.some((n) => /`orderForm` is a Play Form/.test(n)));
  assert.ok(notes.some((n) => /CSRF\.formField/.test(n)));
  assert.ok(notes.some((n) => /messages\("key"\)/.test(n)));
  assert.ok(notes.some((n) => /`@unknown\.layout\(\.\.\.\)` calls a template this run does not hold/.test(n)));
});

test("input-static leaves a Twirl file to its reader", () => {
  assert.deepEqual(readPage('@(title: String)\n<html><body><h1>@title</h1></body></html>', "app/views/page.scala.html"), { skip: "another dialect owns it" });
  assert.notDeepEqual(readPage("<html><body><h1>Plain</h1></body></html>", "index.html"), { skip: "another dialect owns it" });
});

test("a run composes the page into its layout through the nav partial, inlines the card, reads the inputs and counts the layout as composed", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/twirl") });
  try {
    assert.equal(run.error, null);
    const show = run.ctx.screens.find((s) => s.selector === "products-show");
    assert.ok(show, "the page is a screen");
    assert.equal(show.readBy, "twirl");
    assert.equal(show.templateOrigin, "a Twirl template, composed into its layout and lowered");
    assert.deepEqual(show.inputs, ["orderForm", "product", "related", "routes"]);
    assert.ok(show.usesNgIf && show.usesNgFor && show.usesTwoWay);
    assert.match(show.template, /<nav>/, "the layout's nav partial is composed in");
    assert.match(show.template, /ng-if="product\.description != null"/, ".map with .getOrElse is a presence test");
    assert.match(show.template, /shop@example\.com/, "@@ is one @");
    assert.ok(!/@(?:if|for|main|import|helper|messages)\b|\.getOrElse \{/.test(show.template), "no Twirl leaks into the template");
    assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["partials-card", "partials-nav", "products-show"], "partials are screens too; the layout is not");
    assert.deepEqual(show.composed, ["app/views/main.scala.html", "app/views/partials/nav.scala.html", "app/views/partials/card.scala.html"]);
    assert.deepEqual(run.ctx.readers.composed, [{ file: "app/views/main.scala.html", reader: "twirl", into: 1 }]);
    assert.deepEqual(run.ctx.readers.unread, []);
    const jsx = await readFile(join(run.out, "src/features/ProductsShow/ProductsShow.jsx"), "utf8");
    assert.match(jsx, /className=\{\["card", \$index == 0 \? 'first' : ''\]\.filter\(Boolean\)\.join\(" "\)\}/, "a class that interpolates is a static class and an expression class");
    assert.match(jsx, /related\.slice\(0, 3\)\.map\(\(p, \$index\)/, "the defining alias and the index reach React");
    const roundtrip = await readFile(join(run.out, "ROUNDTRIP.md"), "utf8");
    assert.ok(!/products-show.*\*\*drifted\*\*/.test(roundtrip), "the page round trips through React with its loops intact");
    for (const re of [/main\.scala\.html takes its body as an Html parameter/, /`routes` is Play's reverse router/, /`orderForm` is a Play Form/, /CSRF\.formField/, /formatter/]) assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `${re} is named`);
  } finally {
    await run.cleanup();
  }
});

test("the twelfth review pass: a comment before the header, aliases in one pass, Map getOrElse and get, an Option of a value, a typed lambda, a declared Option in a for, a literal layout call not held, and notes that carry names only", () => {
  const notes = []; const note = (n) => notes.push(n);
  const { params, rest } = parseParams('@* licence *@\n@(product: Product, f: String => Html, m: Map[String, Int] = Map())(content: Html)\n<h1>@product.name</h1>');
  assert.deepEqual(params.map((p) => [p.name, p.type, p.fallback ?? null]), [["product", "Product", null], ["f", "String => Html", null], ["m", "Map[String, Int]", "Map()"], ["content", "Html", null]]);
  assert.equal(rest, "\n<h1>@product.name</h1>");

  const s = freshScope(note);
  s.aliases.set("product", "related[0]"); s.aliases.set("related", "product.related");
  assert.equal(scalaToJs("product.name + related.size", s), "related[0].name + product.related.length", "an alias whose value names another alias is rewritten once");
  const t = freshScope(note);
  t.types.set("user", "Option[User]"); t.types.set("m", "Map[String, Int]");
  assert.equal(scalaToJs('m.getOrElse(k, "d") + m.get(k) + o.getOrElse("x")', t), "(m[k] ?? 'd') + m[k] + (o ?? 'x')");
  assert.equal(scalaToJs("user.nonEmpty && !user.isEmpty && tags.isEmpty", t), "(user != null) && !(user == null) && (!tags || !tags.length)");
  assert.equal(scalaToJs('xs.mkString("[", ", ", "]") + ys.mkString', t), "('[' + xs.join(', ') + ']') + ys.join('')");

  const u = freshScope(note);
  for (const [k, v] of Object.entries({ desc: "Option[String]", xs: "Seq[Product]", user: "Option[User]", orderForm: "Form[Order]" })) u.types.set(k, v);
  const out = lowerTwirl([
    '@for(d <- desc) {<p>@d</p>}',
    '@xs.map { (p: Product) => <b>@p.name</b> }',
    '@user.get.roles.map { r => <li>@r</li> }',
    '<a title="@(if (a > 1) "x" else "y")" class="@if(on) {on}">go</a>',
    '@main("Title") {<p>@x</p>}',
    '@for(i <- xs) { @helper.inputText(orderForm("qty")) }',
    '@{ val secret = "hunter2" }@messages("cart.count", n)',
  ].join(""), u, () => null, 0);
  assert.equal(out,
    '<ng-container ng-if="desc != null"><p>{{ desc }}</p></ng-container>' +
    '<ng-container ng-repeat="p in xs"> <b>{{ p.name }}</b> </ng-container>' +
    '<ng-container ng-repeat="r in user.roles"> <li>{{ r }}</li> </ng-container>' +
    '<a title="{{ (a > 1) ? \'x\' : \'y\' }}" class="{{ on ? \'on\' : \'\' }}">go</a>' +
    '<p>{{ x }}</p>' +
    '<ng-container ng-repeat="i in xs"> <input type="text" ng-model="orderForm.qty"> </ng-container>' +
    'cart.count');
  assert.equal(u.twoWay, true, "a field inside a loop still makes the screen two way");
  assert.ok(notes.some((n) => /`user\.get\.roles\.map \{ \}` was read as a loop/.test(n)), "the receiver's type is the receiver's own, not its root's");
  assert.ok(notes.some((n) => /`@main\(\.\.\.\)` calls a template this run does not hold/.test(n)), "a layout called with a literal and not held is named");
  assert.ok(notes.some((n) => /`messages\("cart\.count", \.\.\.\)` carried 1 argument/.test(n)));
  assert.ok(notes.some((n) => /declaring `secret`/.test(n)) && !notes.some((n) => /hunter2/.test(n)), "a code block's note names what it declared and never its values");

  // A layout that renders its content inside a defining still composes, a partial's form parameter binds the page's form, and a second argument group is named.
  const templates = {
    main: { key: "main.scala.html", params: parseParams("@(title: String)(content: Html)").params, body: "@defining(title.trim) { t => <h1>@t</h1><main>@content</main> }", layout: true },
    "partials/field": { key: "partials/field.scala.html", params: parseParams("@(form: Form[X])").params, body: '@helper.inputText(form("qty"))', layout: false },
  };
  const v = freshScope(note);
  const composed = lowerTwirl('@main("T")(Html("")) {@partials.field(orderForm)}', v, (path) => templates[path] ?? null, 0);
  assert.equal(composed, ' <h1>{{ \'T\'.trim() }}</h1><main><input type="text" ng-model="orderForm.qty"></main> ');
  assert.ok(notes.some((n) => /`main` was called with 1 more argument group/.test(n)));
  assert.ok(notes.some((n) => /`orderForm` is a Play Form/.test(n)) && !notes.some((n) => /`form` is a Play Form/.test(n)));
  assert.ok(!notes.some((n) => /never renders its/.test(n)));

  assert.notDeepEqual(readPage("<html><body><p>sales@main.com</p></body></html>", "contact.html"), { skip: "another dialect owns it" }, "an e-mail address is not a Twirl call");
});
