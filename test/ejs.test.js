import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ejsToUnderscore, restoreLiterals } from "../plugins/input-ejs/index.js";
import { lowerUnderscore } from "../plugins/input-underscore/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * EJS rides the underscore lowering: the same delimiters with the escaping the
 * other way round, JavaScript control flow, includes with their locals bound.
 */

const lower = (src, note = () => {}, resolve = () => null, from = "views/page.ejs") => restoreLiterals(lowerUnderscore(ejsToUnderscore(src, note, resolve, from), note));

test("escaped and raw output, comments, whitespace control, a literal <%, if chains and the JavaScript loops lower onto the dialect", () => {
  const notes = []; const note = (n) => notes.push(n);
  const out = lower([
    `<%# c %><%%= literal %%><h1><%= title -%></h1>`,
    `<% if (user) { %><b><%= user.name %></b><% } else if (guest) { %><i>g</i><% } else { %><u>n</u><% } %>`,
    `<% items.forEach((item, i) => { %><li><%= item %> <%= i %></li><% }); %>`,
    `<% for (const t of tags) { %><em><%= t %></em><% } %>`,
    `<% for (const k in specs) { %><dt><%= k %></dt><% } %>`,
    `<%_ for (let j = 0; j < rows.length; j++) { _%><tr><td><%= rows[j].a %></td></tr><% } %>`,
    `<%- html %>`,
  ].join(""), note);
  assert.equal(out,
    `<%= literal %><h1>{{ title }}</h1>` +
    `<ng-container ng-if="user"><b>{{ user.name }}</b></ng-container><ng-container ng-if="!(user) && (guest)"><i>g</i></ng-container><ng-container ng-if="!(user) && !(guest)"><u>n</u></ng-container>` +
    `<ng-container ng-repeat="item in items track by $index"><li>{{ item }} {{ $index }}</li></ng-container>` +
    `<ng-container ng-repeat="t in tags"><em>{{ t }}</em></ng-container>` +
    `<ng-container ng-repeat="k in Object.keys(specs)"><dt>{{ k }}</dt></ng-container>` +
    `<ng-container ng-repeat="rows_item in rows track by $index"><tr><td>{{ rows_item.a }}</td></tr></ng-container>` +
    `<span ng-bind-html="html"></span>`);
  assert.ok(notes.some((n) => /`<%- %>` output raw markup/.test(n)));
  assert.ok(notes.some((n) => /counted over a list; the port repeats over the list itself/.test(n)));
  assert.ok(!notes.some((n) => /interpolated without escaping|could not be carried/.test(n)), "EJS's escaped output is not underscore's raw one, and nothing falls through");
});

test("an include is inlined with its locals bound, relative to the including file, and a missing one is named", () => {
  const notes = []; const note = (n) => notes.push(n);
  const held = { "views/partials/card": { key: "views/partials/card.ejs", text: `<div class="card"><%= item.name %> <%- item.badge %></div>` } };
  const resolve = (name, from) => { const rel = [...from.split("/").slice(0, -1)]; for (const p of name.replace(/\.ejs$/, "").split("/")) { if (p === "..") rel.pop(); else if (p !== ".") rel.push(p); } return held[rel.join("/")] ?? null; };
  const out = lower(`<%- include('../partials/card', { item: related[0] }) %><% include ../partials/missing %>`, note, resolve, "views/products/show.ejs");
  assert.equal(out, `<div class="card">{{ (related[0]).name }} <span ng-bind-html="(related[0]).badge"></span></div>`);
  assert.ok(notes.some((n) => /`include\('\.\.\/partials\/card', \{ \.\.\. \}\)` bound `item` for the include/.test(n)), "the note names the local, never its value");
  assert.ok(notes.some((n) => /`include\('\.\.\/partials\/missing'\)` names a template this run does not hold/.test(n)));
});

test("a run composes every page into layout.ejs through the nav partial, inlines the card per related item, and leaves .ejs to this reader alone", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/ejs") });
  try {
    assert.equal(run.error, null);
    const show = run.ctx.screens.find((s) => s.selector === "products-show");
    assert.ok(show, "the page is a screen");
    assert.equal(show.readBy, "ejs");
    assert.equal(show.templateOrigin, "an EJS template, composed into its layout and lowered through underscore");
    assert.deepEqual(show.composed, ["views/layout.ejs"]);
    assert.match(show.template, /^<nav>/, "the layout's nav include opens the page");
    assert.match(show.template, /class="\{\{ section == 'shop' \? 'current' : '' \}\}"/, "the include's local is the page's section");
    assert.match(show.template, /<span ng-bind-html="product\.descriptionHtml"><\/span>/);
    assert.match(show.template, /ng-repeat="tag in product\.tags track by \$index"/);
    assert.match(show.template, /ng-repeat="key in Object\.keys\(product\.specs\)"/);
    assert.match(show.template, /ng-repeat="related_item in related track by \$index">\s*<div class="card">\s*<a href="\/products\/\{\{ related_item\.id \}\}">/, "the counted loop repeats over the list and the card reads the item");
    assert.match(show.template, /Template tags look like <%= this %> in EJS\./, "a literal <% survives the lowering");
    assert.ok(!/forEach|include\(|<%[-=_#]?\s*(?:if\b|for\b|\}|product|related|section|csrfToken)/.test(show.template), "no EJS leaks into the template beyond the literal the author wrote");
    assert.deepEqual(show.inputs, ["cart", "csrfToken", "product", "related", "section"], "the loop index and Object are not inputs; the head's title is outside the body");
    assert.match(show.template, /<li>\{\{ \$index \+ 1 \}\}\. \{\{ tag \}\}<\/li>/, "the index argument is the dialect's own");
    assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["partials-card", "partials-nav", "products-show"], "partials are screens too, uncomposed; the layout is not");
    assert.ok(run.ctx.screens.every((s) => s.readBy === "ejs"), "input-underscore left the .ejs files alone");
    assert.deepEqual(run.ctx.readers.composed, [{ file: "views/layout.ejs", reader: "ejs", into: 1 }]);
    assert.deepEqual(run.ctx.readers.unread, []);
    const jsx = await readFile(join(run.out, "src/features/ProductsShow/ProductsShow.jsx"), "utf8");
    assert.match(jsx, /dangerouslySetInnerHTML=\{\{ __html: product\.descriptionHtml \}\}/);
    assert.match(jsx, /related\.map\(\(related_item, \$index\)/);
    assert.ok(run.ctx.report.unverified.some((n) => /layout\.ejs is a layout every page renders inside/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("the fifteenth review pass: nested indexes through $parent, computed includes named, whole locals, nested counted loops, an unknown opener owns its closer, a rooted include, a cycle cut, a destructured for...of", () => {
  const notes = []; const note = (n) => notes.push(n);
  const held = { "views/partials/card": { key: "views/partials/card.ejs", text: `<b><%= item.a %> <%= x %></b>` }, "views/self": { key: "views/self.ejs", text: `<p>a</p><%- include('self') %>` } };
  const resolve = (name, from) => { const rooted = name.startsWith("/"); const rel = rooted ? ["views"] : from.split("/").slice(0, -1); for (const p of name.replace(/^\/+/, "").replace(/\.ejs$/, "").split("/")) { if (p === "..") rel.pop(); else if (p !== ".") rel.push(p); } return held[rel.join("/")] ?? null; };
  const L = (src, from = "views/products/show.ejs") => lower(src, note, resolve, from);
  assert.equal(L(`<% rows.forEach(function (row, i) { %><% row.cells.forEach(function (cell, j) { %><td><%= i %>:<%= j %></td><% }); %><i><%= i %></i><% }); %>`),
    `<ng-container ng-repeat="row in rows track by $index"><ng-container ng-repeat="cell in row.cells track by $index"><td>{{ $parent.$index }}:{{ $index }}</td></ng-container><i>{{ $index }}</i></ng-container>`, "an outer index read inside an inner loop reaches it through $parent");
  assert.equal(L(`<%- include('partials/' + name) %><%- include(partial) %>`), "", "a computed include is removed");
  assert.ok(notes.some((n) => /`include\(\.\.\.\)` with a computed path/.test(n)));
  assert.equal(L(`<%- include('../partials/card', { item: { a: b, c: d }, x: fn(p, q) }) %>`), `<b>{{ ({ a: b, c: d }).a }} {{ (fn(p, q)) }}</b>`, "a local with a nested literal or a call with commas is whole");
  assert.ok(notes.some((n) => /bound `item`, `x` for the include/.test(n)) && !notes.some((n) => /`c`/.test(n)));
  assert.equal(L(`<% for (let i = 0; i < a.length; i++) { %><% for (let j = 0; j < b.length; j++) { %><td><%= a[i] %><%= b[j] %></td><% } %><% } %>`),
    `<ng-container ng-repeat="a_item in a track by $index"><ng-container ng-repeat="b_item in b track by $index"><td>{{ a_item }}{{ b_item }}</td></ng-container></ng-container>`, "nested counted loops each find their own closer and leave no marker");
  assert.equal(L(`<% if (a) { %><% while (x) { %>w<% } %><p>after</p><% } %>`), `<ng-container ng-if="a">w<p>after</p></ng-container>`, "a dropped opener owns its closer, so the enclosing condition still holds what follows");
  assert.equal(L(`<%- include('/partials/card', { item, x: 1 }) %>`), `<b>{{ item.a }} {{ 1 }}</b>`, "a rooted include resolves against the views root and shorthand binds the name to itself");
  assert.equal(L(`<%- include('self') %>`, "views/page.ejs"), `<p>a</p>`, "an include cycle is cut at the repeat");
  assert.ok(notes.some((n) => /includes a template already on the include chain; the cycle was cut/.test(n)));
  assert.equal(L(`<% for (const [k, v] of Object.entries(o)) { %><dt><%= k %></dt><dd><%= v %></dd><% } %>`), `<ng-container ng-repeat="(k, v) in o"><dt>{{ k }}</dt><dd>{{ v }}</dd></ng-container>`);
});

test("a layout is the file whose <%- body %> is the page, whatever it is called", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/ejs-layouts") });
  try {
    assert.equal(run.error, null);
    assert.deepEqual(run.ctx.screens.map((s) => s.selector), ["index"], "layouts/main.ejs is chrome, not a screen");
    const index = run.ctx.screens[0];
    assert.match(index.template, /^<header>Main<\/header>/);
    assert.ok(!/\u0000/.test(index.template), "no sentinel reaches the template");
    assert.deepEqual(index.composed, ["views/layouts/main.ejs"]);
  } finally {
    await run.cleanup();
  }
});
