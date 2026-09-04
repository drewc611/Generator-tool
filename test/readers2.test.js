import assert from "node:assert/strict";
import test from "node:test";

import { readRoutes, flatten } from "../plugins/dsp-routes/parse.js";
import { readPage, routeFor } from "../plugins/input-static/index.js";
import { lowerUnderscore } from "../plugins/input-underscore/lower.js";
import { readTemplates } from "../plugins/input-underscore/index.js";
import { lowerHandlebars } from "../plugins/input-handlebars/lower.js";
import { lowerJinja, pythonToJs } from "../plugins/input-jinja/lower.js";
import { translate } from "../plugins/output-react/template.js";

/* ------------------------------------------------------- $routeProvider */

test("a $routeProvider chain is a route table", () => {
  const routes = readRoutes(`
    angular.module("app").config(function ($routeProvider) {
      $routeProvider
        .when("/orders", { templateUrl: "orders.html", controller: "OrdersCtrl" })
        .when("/orders/:id", { templateUrl: "detail.html", controller: "DetailCtrl" })
        .otherwise({ redirectTo: "/orders" });
    });`, "app.js");
  const flat = flatten(routes);
  assert.deepEqual(flat.map((r) => r.fullPath), ["/orders", "/orders/:id", "/**"]);
  assert.equal(flat[0].component, "OrdersCtrl");
  assert.equal(flat[2].redirectTo, "/orders");
});

test("otherwise with a bare string still names the fallback", () => {
  const routes = readRoutes(`$routeProvider.when("/a", { controller: "A" }).otherwise("/a");`, "app.js");
  assert.equal(routes.find((r) => r.path === "**").redirectTo, "/a");
});

/* ---------------------------------------------------------- input-static */

test("a plain page is a screen and its links imply routes", () => {
  const page = readPage(`<html><head><title>About</title><style>p{}</style></head>
    <body><h1>About us</h1><a href="team.html">Team</a><a href="https://x.example/">out</a></body></html>`, "about.html");
  assert.equal(page.screen.selector, "about");
  assert.match(page.screen.template, /<h1>About us<\/h1>/);
  assert.doesNotMatch(page.screen.template, /<style>/);
  assert.deepEqual(page.links, ["team.html"]);
  assert.equal(routeFor("about.html"), "/about");
  assert.equal(routeFor("index.html"), "/");
});

test("a page another dialect owns is refused", () => {
  assert.ok(readPage(`<body><p ng-if="x">hi</p></body>`, "a.html").skip);
  assert.ok(readPage(`<body><ul data-bind="foreach: rows"></ul></body>`, "b.html").skip);
  assert.ok(readPage(`<body>{{ name }}</body>`, "c.html").skip);
  assert.ok(readPage(`<body><app-root></app-root></body>`, "shell.html").skip, "a mount point is not a page");
});

/* ------------------------------------------------------ underscore/ERB */

test("underscore templates lower to the dialect and translate", () => {
  const notes = [];
  const lowered = lowerUnderscore(
    `<ul><% _.each(orders, function(o){ %><li><%= o.id %></li><% }); %></ul>` +
    `<% if (empty) { %><p>None</p><% } else { %><p>Some</p><% } %>`,
    (n) => notes.push(n)
  );
  const { jsx } = translate(lowered, { indent: 0 });
  assert.match(jsx, /orders\.map\(\(o\) =>/);
  assert.match(jsx, /\{empty && \(/);
  assert.match(jsx, /\{!\(empty\) && \(/, "the else carries the negation");
  assert.ok(notes.some((n) => n.includes("without escaping")), "the escaping change is named");
});

test("an unknown construct is removed and named, never half kept", () => {
  const notes = [];
  const lowered = lowerUnderscore(`<% var total = 0; %><p>ok</p>`, (n) => notes.push(n));
  assert.equal(lowered, "<p>ok</p>");
  assert.ok(notes.some((n) => n.includes("var total = 0;")));
});

test("template blocks are found by their script type", () => {
  const found = readTemplates(
    `<script type="text/template" id="row-tpl"><li><%= id %></li></script><script>var x = 1;</script>`,
    "index.html"
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "row-tpl");
});

/* ----------------------------------------------------------- handlebars */

test("handlebars each folds its else into the empty state", () => {
  const lowered = lowerHandlebars(`{{#each orders}}<li>{{this.id}}</li>{{else}}<p>None</p>{{/each}}`, () => {});
  const { jsx } = translate(lowered, { indent: 0 });
  assert.match(jsx, /orders\.map\(\(item\) =>/);
  assert.match(jsx, /\{item\.id\}/, "this becomes the row");
  assert.match(jsx, /\(!orders \|\| !orders\.length\) && \(/, "the else is the empty state");
});

test("a helper becomes a call and a partial becomes a note", () => {
  const notes = [];
  const lowered = lowerHandlebars(`{{fmt total "usd"}}{{> header}}`, (n) => notes.push(n));
  assert.match(lowered, /\{\{ fmt\(total, "usd"\) \}\}/);
  assert.doesNotMatch(lowered, /header/);
  assert.ok(notes.some((n) => n.includes("Confirm a function")));
  assert.ok(notes.some((n) => n.includes("partial")));
});

test("triple stache stays the same trust decision", () => {
  const { jsx } = translate(lowerHandlebars(`<div>{{{legal}}}</div>`, () => {}), { indent: 0 });
  assert.match(jsx, /dangerouslySetInnerHTML/);
});

/* ---------------------------------------------------------------- jinja */

test("python logic is respelled as JS outside of strings", () => {
  assert.equal(pythonToJs("a and not b or c"), "a && ! b || c");
  assert.equal(pythonToJs("x == None"), "x == null");
  assert.equal(pythonToJs("'a and b'"), "'a and b'", "an operator inside a string is text");
});

test("if/elif/else and for/else lower with honest negations", () => {
  const lowered = lowerJinja(
    `{% if user %}<p>U</p>{% elif guest %}<p>G</p>{% else %}<p>N</p>{% endif %}` +
    `<ul>{% for o in orders %}<li>{{ o.id }}</li>{% else %}<li>none</li>{% endfor %}</ul>`,
    () => {}
  );
  const { jsx } = translate(lowered, { indent: 0 });
  assert.match(jsx, /\{user && \(/);
  assert.match(jsx, /\{!\(user\) && \(guest\) && \(/);
  assert.match(jsx, /\{!\(user\) && !\(guest\) && \(/);
  assert.match(jsx, /\(!orders \|\| !orders\.length\) && \(/, "for/else is the empty state");
});

test("server machinery is removed and named", () => {
  const notes = [];
  const lowered = lowerJinja(`{% csrf_token %}{% include "nav.html" %}<p>ok</p>`, (n) => notes.push(n));
  assert.equal(lowered, "<p>ok</p>");
  assert.ok(notes.some((n) => n.includes("server side machinery")));
  assert.ok(notes.some((n) => n.includes("composes with a template this run does not hold")));
});

test("jinja filters with a JS spelling are rewritten", () => {
  const { jsx } = translate(`<p>{{ name|upper }}</p><p>{{ items|length }}</p>`, { indent: 0 });
  assert.match(jsx, /String\(name\)\.toUpperCase\(\)/);
  assert.match(jsx, /\(items\)\.length/);
});
