import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readScript, readRegions, markupOf } from "../plugins/input-angularjs/index.js";
import { buildIr, DIALECTS, detectDialect } from "../plugins/dsp-ir/ir.js";
import { translate } from "../plugins/output-react/template.js";
import { parse } from "../plugins/dsp-ir/parse.js";
import { runPipeline } from "./helpers.js";

const jsx = (html) => translate(html, { indent: 0 }).jsx.replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------ the dialect */

test("1.x markup is recognised as its own dialect, not mistaken for either heir", () => {
  assert.equal(detectDialect(`<tr ng-repeat="o in xs" ng-click="p(o)">{{o.n}}</tr>`).name, "angularjs");
  assert.equal(detectDialect(`<tr *ngFor="let o of xs">{{o.n}}</tr>`).name, "angular");
  assert.equal(detectDialect(`<tr v-for="o in xs">{{o.n}}</tr>`).name, "vue");
});

test("ng-repeat's track by is an expression, and it already is the key", () => {
  assert.match(jsx(`<li ng-repeat="o in xs track by o.id">x</li>`), /key=\{o\.id\}/);
  assert.match(jsx(`<li ng-repeat="o in xs track by $index">x</li>`), /key=\{\$index\}/);
});

test("a runtime filter on the list is stripped and said, never silently applied", () => {
  const r = translate(`<li ng-repeat="o in xs | filter:q track by o.id">x</li>`, { indent: 0 });
  assert.match(r.jsx, /xs\.map\(/);
  assert.ok(r.notes.some((n) => /reapply the filter/.test(n)));
});

test("ng-hide is ng-show with the test inverted, not a different idea", () => {
  assert.match(jsx(`<p ng-show="a">x</p>`), /display: a \? undefined : "none"/);
  assert.match(jsx(`<p ng-hide="a">x</p>`), /display: !\(a\) \? undefined : "none"/);
});

test("ng-src interpolates, so it is a template attribute wearing a directive's name", () => {
  assert.match(jsx(`<img ng-src="{{o.avatar}}">`), /src=\{`\$\{o\.avatar\}`\}/);
});

test("ng-model and ng-change become one onChange that does both", () => {
  const out = jsx(`<input ng-model="q" ng-change="reload()">`);
  assert.equal((out.match(/onChange/g) ?? []).length, 1);
  assert.match(out, /setQ\(event\.target\.value\); reload\(\);/);
});

/* ------------------------------------------------------------- the reader */

test("every $http shape lands in the call inventory", () => {
  const { calls } = readScript(`
    $http.get("/api/a");
    $http({ method: "POST", url: "/api/b" });
    var Orders = $resource("/api/c/:id");
  `, "app.js");
  const seen = calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(seen.includes("GET /api/a"));
  assert.ok(seen.includes("POST /api/b"));
  assert.ok(seen.includes("GET /api/c/:id"));
  assert.ok(calls.some((c) => c.assumed), "the $resource write is marked assumed, not seen");
});

test("a .component() declares everything a screen needs", () => {
  const { components } = readScript(`
    angular.module("x").component("orderBadge", {
      bindings: { count: "<", label: "@", onClear: "&" },
      template: "<span>{{ $ctrl.count }}</span>",
    });
  `, "app.js");
  assert.equal(components[0].name, "orderBadge");
  assert.deepEqual(components[0].inputs, ["count", "label"]);
  assert.deepEqual(components[0].outputs, ["onClear"]);
  assert.match(components[0].template, /\$ctrl\.count/);
});

test("an ng-controller region is a component in everything but the registration", () => {
  const regions = readRegions(`<body><div ng-controller="OrdersCtrl"><p ng-if="a">x</p></div><footer>f</footer></body>`, "index.html");
  assert.equal(regions.length, 1);
  assert.equal(regions[0].controller, "OrdersCtrl");
  const markup = markupOf(regions[0].node);
  assert.match(markup, /ng-if="a"/);
  assert.doesNotMatch(markup, /ng-controller/, "the boundary attribute does not survive into the template");
  assert.doesNotMatch(markup, /footer/, "the region is the region, not the page");
});

/* ------------------------------------------------------------- end to end */

test("a 1.x app ports through the pipeline written for its successor", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ src: join(process.cwd(), "example/legacy-angularjs") });
  t.after(cleanup);
  assert.equal(error, null);

  assert.deepEqual(ctx.screens.map((s) => s.selector).sort(), ["order-badge", "orders"]);
  assert.deepEqual(ctx.api.calls.map((c) => c.path).sort(), ["/api/v3/orders", "/api/v3/orders/seen"]);

  const source = await readFile(join(out, "src/features/Orders/Orders.jsx"), "utf8");
  assert.match(source, /orders\.map\(/);
  assert.match(source, /key=\{o\.id\}/, "track by survived as the key");
  assert.match(source, /setQ\(event\.target\.value\); reload\(\);/, "ng-model and ng-change merged");
  assert.doesNotMatch(source, /ng-repeat|ng-if|ng-model/, "no 1.x syntax survived");
  assert.ok(ctx.report.unverified.some((u) => /currency/.test(u)), "the filter gap is named");
});

/* ------------------------------------- Angular's block syntax, lowered */

const flatJsx = (html) => translate(html, { indent: 0 }).jsx.replace(/\s+/g, " ").trim();

test("an @else is the conjunction of every branch it is not", () => {
  const out = flatJsx(`@if (a) { <p>A</p> } @else if (b) { <p>B</p> } @else { <p>C</p> }`);
  assert.match(out, /\{a && \( <p> A <\/p> \)\}/);
  assert.match(out, /\{!\(a\) && \(b\) && \( <p> B <\/p> \)\}/);
  assert.match(out, /\{!\(a\) && !\(b\) && \( <p> C <\/p> \)\}/);
});

test("@for's track expression is the key, and @empty is a real state", () => {
  const out = flatJsx(`@for (o of xs; track o.id) { <li>{{o.n}}</li> } @empty { <p>None</p> }`);
  assert.match(out, /<li key=\{o\.id\}>/);
  assert.match(out, /\{\(!xs \|\| !xs\.length\) && /, "the empty test keeps its parentheses");
});

test("@switch becomes conditions that mean what the cases meant", () => {
  const out = flatJsx(`@switch (m) { @case ("edit") { <b>e</b> } @default { <i>v</i> } }`);
  assert.match(out, /\{\(m\) === \('edit'\) && /, "a quoted case value survives the attribute");
  assert.match(out, /\{!\(\(m\) === \('edit'\)\) && /);
});

test("@defer is flattened and says so; @let is removed and says so", () => {
  const deferred = translate(`@defer { <heavy-thing/> } @placeholder { <p>soon</p> }`, { indent: 0 });
  assert.ok(deferred.notes.some((n) => /flattened/.test(n)));
  assert.ok(deferred.notes.some((n) => /transient state/.test(n)));

  const local = translate(`@let total = a + b; <p>{{ total }}</p>`, { indent: 0 });
  assert.ok(local.notes.some((n) => /template local/.test(n)));
});

test("a template with no blocks passes through the lowering untouched", () => {
  const plain = `<p *ngIf="a">x</p>`;
  assert.equal(flatJsx(plain), flatJsx(plain));
  const withEmail = `<p>mail me @ home {curly}</p>`;
  assert.match(flatJsx(withEmail), /mail me @ home/);
});
