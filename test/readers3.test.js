import assert from "node:assert/strict";
import test from "node:test";

import { lowerHandlebars } from "../plugins/input-handlebars/lower.js";
import { lowerJinja } from "../plugins/input-jinja/lower.js";
import { readScript } from "../plugins/input-angularjs/index.js";
import { readSpec, readParameters, crossCheck } from "../plugins/input-openapi/index.js";
import { readComponents } from "../plugins/input-knockout/index.js";
import { readItemTemplates } from "../plugins/input-aspnet/index.js";
import { readViews } from "../plugins/input-backbone/index.js";

test("a handlebars #with prefixes bare names with its target and says so", () => {
  const notes = [];
  const out = lowerHandlebars(`{{#with user}}<b>{{name}}</b>, {{this.age}}{{/with}}`, (n) => notes.push(n));
  assert.match(out, /\{\{ user\.name \}\}/);
  assert.match(out, /\{\{ user\.age \}\}/);
  assert.ok(notes.some((n) => n.includes("prefixed with `user.`")));
});

test("@index reshapes the loop it sits in instead of vanishing", () => {
  const out = lowerHandlebars(`{{#each rows}}<li>{{@index}}: {{this.name}}</li>{{/each}}`, () => {});
  assert.match(out, /ng-repeat="item in rows track by \$index"/);
  assert.match(out, /\{\{ \$index \}\}/);
});

test("@key turns the loop into an entries loop, which only objects have", () => {
  const out = lowerHandlebars(`{{#each counts}}<dt>{{@key}}</dt><dd>{{this}}</dd>{{/each}}`, () => {});
  assert.match(out, /ng-repeat="\(itemKey, item\) in counts"/);
  assert.match(out, /\{\{ itemKey \}\}/);
});

test("jinja extends composes the way the server did", () => {
  const files = new Map([
    ["base.html", `<header>site</header>{% block content %}<p>default</p>{% endblock %}<footer>{% block foot %}(c){% endblock %}</footer>`],
  ]);
  const out = lowerJinja(
    `{% extends "base.html" %}{% block content %}<p>{{ x }}</p>{{ super() }}{% endblock %}`,
    () => {},
    (name) => files.get(name) ?? null,
  );
  assert.match(out, /<header>site<\/header>/);
  assert.match(out, /<p>\{\{ x \}\}<\/p>/, "the child's block replaced the parent's");
  assert.match(out, /<p>\{\{ x \}\}<\/p><p>default<\/p>/, "super() spliced the default back in");
  assert.match(out, /<footer>\(c\)<\/footer>/, "an untouched block keeps its default");
});

test("a jinja macro expands at its call site, defaults included", () => {
  const notes = [];
  const out = lowerJinja(
    `{% macro chip(label, tone="quiet") %}<span class="{{ tone }}">{{ label }}</span>{% endmacro %}{{ chip(user.name) }}`,
    (n) => notes.push(n),
  );
  assert.match(out, /\{\{ user\.name \}\}/);
  assert.match(out, /"quiet"/);
  assert.ok(notes.some((n) => n.includes("substituted textually")));
});

test("a pre-1.5 directive with a template is a component in disguise", () => {
  const found = readScript(
    `angular.module("app").directive("orderCard", function () {
      return { restrict: "E", template: "<div>{{card.total}}</div>", scope: { card: "=", onPick: "&" } };
    });`,
    "app.js",
  );
  assert.equal(found.components.length, 1);
  assert.equal(found.components[0].name, "orderCard");
  assert.deepEqual(found.components[0].inputs, ["card"]);
  assert.deepEqual(found.components[0].outputs, ["onPick"]);
});

test("a behavioral directive without a template stays out of the screens", () => {
  const found = readScript(`angular.module("app").directive("autoFocus", function () { return { link: function () {} }; });`, "app.js");
  assert.equal(found.components.length, 0);
});

test("spec parameters are read, and a required one the app never passes is surfaced", () => {
  const document = {
    openapi: "3.0.0",
    paths: {
      "/orders": {
        parameters: [{ name: "region", in: "query", required: true, schema: { type: "string" } }],
        get: { parameters: [{ name: "page", in: "query", schema: { type: "integer" } }] },
      },
    },
  };
  const operations = readSpec(document);
  assert.equal(operations[0].parameters.length, 2);
  assert.deepEqual(operations[0].parameters.map((p) => p.name).sort(), ["page", "region"]);
  const report = crossCheck(operations, [{ method: "GET", path: "/orders?page=2", file: "api.js" }]);
  assert.equal(report.missingParams.length, 1);
  assert.equal(report.missingParams[0].parameter, "region");
  const satisfied = crossCheck(operations, [{ method: "GET", path: "/orders?region=eu", file: "api.js" }]);
  assert.equal(satisfied.missingParams.length, 0);
});

test("readParameters folds the path item's shared list into the operation's", () => {
  const document = {};
  const params = readParameters(document, { parameters: [{ name: "id", in: "path", required: true }] }, { parameters: [{ name: "expand", in: "query" }] });
  assert.deepEqual(params.map((p) => p.name), ["id", "expand"]);
});

test("ko.components.register declares a screen boundary", () => {
  const found = readComponents(
    `ko.components.register("order-line", {
      viewModel: function (params) { this.total = params.total; this.tax = params.tax; },
      template: "<span data-bind='text: total'></span>"
    });`,
    "widgets.js",
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "order-line");
  assert.deepEqual(found[0].inputs.sort(), ["tax", "total"]);
  assert.match(found[0].template, /data-bind/);
});

test("a Repeater's ItemTemplate becomes a screen, empty state included", () => {
  const notes = [];
  const screens = readItemTemplates(
    `<asp:ListView ID="Orders" runat="server"><ItemTemplate><li><%# Eval("Name") %></li></ItemTemplate>` +
    `<EmptyDataTemplate><p>No orders yet.</p></EmptyDataTemplate></asp:ListView>`,
    "orders.aspx",
    (n) => notes.push(n),
  );
  assert.equal(screens.length, 1);
  assert.match(screens[0].template, /ng-repeat="item in orders"/);
  assert.match(screens[0].template, /\{\{ item\.Name \}\}/);
  assert.match(screens[0].template, /ng-if="!orders \|\| !orders\.length"/, "the empty state survives");
  assert.ok(notes.some((n) => n.includes("server side data source")));
});

test("a code behind binding expression is removed and named, never guessed", () => {
  const notes = [];
  const screens = readItemTemplates(
    `<asp:Repeater ID="Rows" runat="server"><ItemTemplate><td><%# FormatPrice(Eval("P")) %></td></ItemTemplate></asp:Repeater>`,
    "x.aspx",
    (n) => notes.push(n),
  );
  assert.doesNotMatch(screens[0].template, /FormatPrice/);
  assert.ok(notes.some((n) => n.includes("code behind logic")));
});

test("a backbone view names the underscore template it renders", () => {
  const views = readViews(
    `var OrderRow = Backbone.View.extend({
      tagName: "li",
      events: { "click .pick": "onPick" },
      template: _.template($("#order-row-template").html()),
    });`,
    "views.js",
  );
  assert.equal(views[0].templateId, "order-row-template");
  assert.equal(views[0].events[0].handler, "onPick");
});
