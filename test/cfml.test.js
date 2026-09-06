import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseMarkup } from "../plugins/dsp-ir/markup.js";
import { cfToJs, freshScope, lowerTree, prepare } from "../plugins/input-cfml/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * ColdFusion Markup lowered onto the dialect: the tags as the containers they
 * mean, expressions as JavaScript, includes composed, and what the server
 * did or supplied named.
 */

const lower = (src, note = () => {}, resolve = () => null) => { const sc = freshScope(note); return { out: lowerTree(parseMarkup(prepare(src, sc, resolve)), sc, resolve), sc }; };

test("expressions: word operators, concatenation, doubled quotes, functions rewritten or named, one based arrays shifted, scopes named", () => {
  const notes = [];
  const sc = freshScope((n) => notes.push(n));
  assert.equal(cfToJs("a EQ 1 AND NOT b OR c GT Len(d)"), "a == 1 && ! b || c > d.length");
  assert.equal(cfToJs("x IS NOT 2 AND y GREATER THAN OR EQUAL TO 3"), "x != 2 && y >= 3");
  assert.equal(cfToJs('"Hello #name#!" & x'), "('Hello ' + (name) + '!') + x");
  assert.equal(cfToJs("'it''s'"), "'it\\'s'");
  assert.equal(cfToJs("ArrayIsEmpty(tags)"), "!tags || !tags.length", "the whole test needs no brackets");
  assert.equal(cfToJs("ArrayIsEmpty(tags) AND x"), "(!tags || !tags.length) && x");
  assert.equal(cfToJs("UCase(Trim(s)) & Replace(t, 'a', 'b', 'ALL') & Left(u, 3)"), "s.trim().toUpperCase() + t.split('a').join('b') + u.slice(0, 3)");
  assert.equal(cfToJs("IsDefined('session.user') AND StructKeyExists(s, 'k')", sc), "(session.user != null) && (s['k'] != null)");
  assert.equal(cfToJs("tags[1].name & tags[i]", sc), "tags[0].name + tags[i - 1]");
  assert.equal(cfToJs("DateFormat(d, 'yyyy') & MyHelper(x)", sc), "d + MyHelper(x)");
  assert.equal(cfToJs("variables.total & url.page", sc), "total + url.page");
  for (const re of [/one based/, /DateFormat\(\) formatted/, /MyHelper\(\) is a ColdFusion function this reader does not know/, /url\.page is the url scope/]) assert.ok(notes.some((n) => re.test(n)), `named: ${re}`);
});

test("cfif chains, cfloop over arrays, lists, collections and queries, cfswitch, cfoutput, cfset, cfparam and ## lower onto the dialect", () => {
  const notes = [];
  const { out } = lower(
    `<cfset low = 5><cfset label = "Low"><cfparam name="url.q" default="">` +
    `<cfoutput>` +
    `<cfif a EQ 1>A<cfelseif n LT low>#label#<cfelse>C</cfif>` +
    `<ul><cfloop array="#tags#" item="t" index="i"><li class="<cfif i EQ 1>first</cfif>">#i#/#ArrayLen(tags)#: #t.name#</li></cfloop></ul>` +
    `<cfloop list="#colors#" index="c" delimiters=";"><i>#c#</i></cfloop>` +
    `<cfloop collection="#s#" item="k"><b>#k#</b></cfloop>` +
    `<cfswitch expression="#t#"><cfcase value="a,b">AB</cfcase><cfcase value="1">One</cfcase><cfdefaultcase>D</cfdefaultcase></cfswitch>` +
    `<a href="/x?id=#id#" <cfif done>disabled</cfif>>Go</a>` +
    `<p>##literal##</p>` +
    `<cfif b><cfset inner = c></cfif>#inner#` +
    `</cfoutput>` +
    `<p>#outside#</p>` +
    `<cfoutput query="q"><b>#name# #currentRow#/#recordCount#</b></cfoutput><cfif q.recordCount EQ 0>none</cfif>`,
    (n) => notes.push(n),
  );
  assert.equal(out,
    `<ng-container ng-if="a == 1">A</ng-container><ng-container ng-if="!(a == 1) && (n < 5)">{{ 'Low' }}</ng-container><ng-container ng-if="!(a == 1) && !(n < 5)">C</ng-container>` +
    `<ul><ng-container ng-repeat="t in tags track by $index"><li ng-class="(($index + 1) == 1 ? 'first' : '')">{{ ($index + 1) }}/{{ tags.length }}: {{ t.name }}</li></ng-container></ul>` +
    `<ng-container ng-repeat="c in colors.split(';')"><i>{{ c }}</i></ng-container>` +
    `<ng-container ng-repeat="(k, value) in s"><b>{{ k }}</b></ng-container>` +
    `<ng-container ng-if="(t) == 'a' || (t) == 'b'">AB</ng-container><ng-container ng-if="(t) == 1">One</ng-container><ng-container ng-if="!((t) == 'a' || (t) == 'b') && !((t) == 1)">D</ng-container>` +
    `<a ng-href="/x?id={{ id }}" ng-disabled="(done)">Go</a>` +
    `<p>#literal#</p>` +
    `<ng-container ng-if="b"></ng-container>{{ inner }}` +
    `<p>#outside#</p>` +
    `<ng-container ng-repeat="row in q"><b>{{ row.name }} {{ ($index + 1) }}/{{ q.length }}</b></ng-container><ng-container ng-if="q.length == 0">none</ng-container>`);
  for (const re of [/cfparam name="url\.q"/, /cfset inner> inside a branch or loop/, /bare name was read as a column/, /cfoutput writes a value unescaped/]) assert.ok(notes.some((n) => re.test(n)), `named: ${re}`);
});

test("comments, cfscript, cfquery, cfsilent, cfinclude, cfform, cftry, custom tags and a range loop are composed or named", () => {
  const notes = [];
  const files = { "inc/nav.cfm": `<!--- nav ---><nav><cfoutput>#site#</cfoutput></nav>` };
  const { out } = lower(
    `<cfsilent><cfset site = "Shop"></cfsilent><cfscript>x = 1;</cfscript><cfquery name="q" datasource="d">SELECT 1</cfquery>` +
    `<cfinclude template="inc/nav.cfm"><cfinclude template="missing.cfm">` +
    `<cfform action="/go" format="html"><cfinput type="text" name="n" validate="integer" required="yes"><cfselect name="s" query="q"><option>x</option></cfselect></cfform>` +
    `<cftry><p>ok</p><cfcatch type="any"><p>err</p></cfcatch></cftry>` +
    `<cf_footer year="2020">F</cf_footer><cfmodule template="t.cfm">M</cfmodule><cflocation url="/away">` +
    `<cfloop from="1" to="3" index="i"><b>x</b></cfloop><cfabort>`,
    (n) => notes.push(n), (name) => files[name] ?? null,
  );
  assert.equal(out, `<nav>{{ 'Shop' }}</nav><form action="/go"><input type="text" name="n" required="yes"><select name="s"><option>x</option></select></form><p>ok</p>FM<ng-container><b>x</b></ng-container>`);
  for (const re of [/cfscript> block ran code/, /cfquery name="q"> ran SQL/, /missing\.cfm is included by this page and is not in the run/, /cfinput validate> validated/, /cfselect query> validated or bound/, /cf_footer> is a custom tag/, /cfmodule template="t\.cfm"/, /cflocation url="\/away"/, /counts a range/]) assert.ok(notes.some((n) => re.test(n)), `named: ${re}`);
});

test("a run composes the page with its include, ports it, reads the locals and names the machinery", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/cfml") });
  try {
    assert.equal(run.error, null);
    const by = (sel) => run.ctx.screens.find((s) => s.selector === sel);
    const product = by("product");
    assert.ok(product && product.readBy === "cfml");
    assert.match(product.template, /^<nav>\s*<a href="\/">Home<\/a>\s*<ng-container ng-if="session\.user != null"><span class="who">\{\{ session\.user\.name \}\}<\/span><\/ng-container>\s*<\/nav>/);
    assert.match(product.template, /<h1>\{\{ product\.name \}\}<\/h1>/);
    assert.match(product.template, /ng-if="!\(product\.stock == 0\) && \(product\.stock < 5\)">\s*<p class="low">Only \{\{ product\.stock \}\} left<\/p>/, "the cfset value is substituted");
    assert.match(product.template, /<p class="price">\{\{ product\.price \}\} \{\{ currency\.toUpperCase\(\) \}\}<\/p>/);
    assert.match(product.template, /<ng-container ng-repeat="tag in product\.tags track by \$index">\s*<li ng-class="\(\(\$index \+ 1\) == 1 \? 'first' : ''\)">\{\{ \(\$index \+ 1\) \}\}\/\{\{ product\.tags\.length \}\}: \{\{ tag\.name \}\}<\/li>/);
    assert.match(product.template, /<ng-container ng-if="!product\.tags \|\| !product\.tags\.length"><li class="none">No tags<\/li><\/ng-container>/);
    assert.match(product.template, /ng-if="\(product\.type\) == 'shoe' \|\| \(product\.type\) == 'boot'"><span class="badge">Footwear<\/span>/);
    assert.match(product.template, /<ng-container ng-repeat="color in product\.colors\.split\(','\)"><i class="swatch">\{\{ color \}\}<\/i><\/ng-container>/);
    assert.match(product.template, /<p class="first">First tag: \{\{ product\.tags\[0\]\.name \}\}<\/p>/);
    assert.match(product.template, /<p class="q">Search: \{\{ url\.q \}\}<\/p>/);
    assert.match(product.template, /<a class="buy" ng-href="\/cart\/add\?id=\{\{ product\.id \}\}" ng-disabled="\(product\.stock == 0\)">Buy<\/a>/);
    assert.match(product.template, /<ng-container ng-repeat="row in reviews">\s*<blockquote>\{\{ row\.body \}\} - \{\{ row\.author \}\} \(\{\{ \(\$index \+ 1\) \}\} of \{\{ reviews\.length \}\}\)<\/blockquote>/);
    assert.match(product.template, /<ng-container ng-if="reviews\.length == 0"><p>No reviews yet\.<\/p><\/ng-container>/);
    assert.match(product.template, /<form action="\/reviews" method="post">\s*<input type="text" name="body" required="yes">\s*<input type="submit" name="go" value="Send">\s*<\/form>/);
    assert.match(product.template, /Custom footer content\s*<p>Price: ##not an expression##<\/p>\s*<p>Free shipping on every order\.<\/p>/);
    assert.doesNotMatch(product.template, /SELECT|visits|<cf|Shop:|enablecfoutputonly/);
    assert.deepEqual(product.inputs, ["currency", "product", "reviews", "session", "url"]);
    assert.ok(by("includes-nav"), "the included page is also a screen of its own");
    const jsx = await readFile(join(run.out, "src/features/Product/Product.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|<cf|SELECT body/);
    assert.match(jsx, /<nav>/);
    for (const re of [/cfquery name="reviews"> ran SQL/, /cfscript> block ran code/, /DollarFormat\(\) formatted/, /session\.user is the session scope/, /read as a column of the row/, /cf_footer> is a custom tag/, /cfparam name="url\.section"/, /cfinput message> validated/, /writes a value unescaped/]) {
      assert.ok(run.ctx.report.unverified.some((n) => re.test(n)), `named: ${re}`);
    }
  } finally {
    await run.cleanup();
  }
});

test("the ninth review pass: query rows prefix bare names only, aliases read case blind and survive a nested loop, scoped names stay scopes", () => {
  const notes = [];
  const { out } = lower(
    `<cfset total = 9><cfoutput query="a">#variables.total# #session.user.name# #product.name# #name# #currentrow# #RecordCount#` +
    `<cfloop query="b">#b.title# #title#</cfloop> #currentRow#</cfoutput>`,
    (n) => notes.push(n),
  );
  assert.equal(out,
    `<ng-container ng-repeat="row in a">{{ 9 }} {{ session.user.name }} {{ product.name }} {{ row.name }} {{ ($index + 1) }} {{ a.length }}` +
    `<ng-container ng-repeat="row in b">{{ b.title }} {{ row.title }}</ng-container> {{ ($index + 1) }}</ng-container>`);
  assert.ok(notes.some((n) => /bare name was read as a column/.test(n)));
});

test("the ninth review pass: lone tags close themselves, cfsilent restores output, an attribute cfif evaluates outside cfoutput, yes and no keys stay keys", () => {
  const notes = [];
  const { out } = lower(
    `<div><cffile action="read" file="x" variable="v"><p>after file</p></div><div><CFHTTP url="http://x"><p>after http</p></div>` +
    `<cfoutput><cfsilent><cfset a = 1></cfsilent>#x#</cfoutput><p>#outside#</p>` +
    `<a class="<cfif on>on</cfif>" <cfif done>disabled</cfif>>Go</a>` +
    `<cfoutput>#invoice.no# #order.yes# #a#</cfoutput>` +
    `<CFSCRIPT>x = 1 < 2;</CFSCRIPT><cfset label = "Tel(home)"><cfoutput>#label#</cfoutput>`,
    (n) => notes.push(n),
  );
  assert.equal(out,
    `<div><p>after file</p></div><div><p>after http</p></div>` +
    `{{ x }}<p>#outside#</p>` +
    `<a ng-class="(on ? 'on' : '')" ng-disabled="(done)">Go</a>` +
    `{{ invoice.no }} {{ order.yes }} {{ 1 }}` +
    `{{ 'Tel(home)' }}`);
  assert.ok(notes.some((n) => /cfscript> block ran code/.test(n)));
  assert.ok(!notes.some((n) => /Tel\(\)/.test(n)), "a bracket inside a string is not a call");
});

test("the ninth review pass: a cfelse buried in an element the cfif opened is named, and a plain html include is composed", async () => {
  const notes = [];
  const files = { "header.cfm": `<header><h1>Shop</h1></header>` };
  const { out } = lower(`<cfif a><tr class="a"><td>A</td><cfelse><tr class="b"><td>B</td></cfif></tr><cfinclude template="header.cfm">`, (n) => notes.push(n), (name) => files[name] ?? null);
  assert.match(out, /^<ng-container ng-if="a"><tr class="a"><td>A<\/td>/);
  assert.match(out, /<header><h1>Shop<\/h1><\/header>$/);
  assert.ok(notes.some((n) => /could not be read as a branch; both branches stand/.test(n)));
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "portamp-cf-"));
  try {
    await mkdir(join(dir, "includes"), { recursive: true });
    await writeFile(join(dir, "includes/header.cfm"), `<header><h1>Shop</h1></header>`);
    await writeFile(join(dir, "index.cfm"), `<cfinclude template="includes/header.cfm"><cfoutput><p>#t#</p></cfoutput>`);
    const run = await runPipeline({ src: dir });
    try {
      assert.equal(run.error, null);
      assert.equal(run.ctx.screens.find((s) => s.selector === "index").template, `<header><h1>Shop</h1></header><p>{{ t }}</p>`);
      assert.ok(!run.ctx.report.unverified.some((n) => /header\.cfm is included by this page and is not in the run/.test(n)));
      assert.ok(!run.ctx.screens.some((s) => s.selector === "includes-header"), "a plain html include is composed, not a ColdFusion screen of its own");
    } finally {
      await run.cleanup();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
