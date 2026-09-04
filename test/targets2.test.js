import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { toAngular } from "../plugins/output-angular/print.js";
import { toLit } from "../plugins/output-lit/index.js";
import { runPipeline } from "./helpers.js";

/* --------------------------------------------------------- output-angular */

test("the loop closes: 2013's dialect comes out as this year's", () => {
  const markup = toAngular(`<tr ng-repeat="o in orders track by o.id" ng-click="pick(o)"><td>{{o.id}}</td></tr>`).markup;
  assert.match(markup, /@for \(o of orders; track o\.id\)/);
  assert.match(markup, /\(click\)="pick\(o\)"/);
  assert.doesNotMatch(markup, /ng-repeat/);
});

test("both heirs print identically from either dialect", () => {
  const a = toAngular(`<li *ngFor="let o of xs" [class.hot]="o.hot">{{o.n}}</li>`).markup;
  const b = toAngular(`<li v-for="o in xs" :class="{hot: o.hot}">{{o.n}}</li>`).markup;
  assert.equal(a, b);
});

test("a whole 1.x app emits standalone components with block syntax", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ angular: true, src: join(process.cwd(), "example/legacy-angularjs") });
  t.after(cleanup);
  assert.equal(error, null);
  const source = await readFile(join(out, "src/app/orders/orders.component.ts"), "utf8");
  assert.match(source, /standalone: true/);
  assert.match(source, /@for \(o of orders; track o\.id\)/);
  assert.match(source, /\[\(ngModel\)\]="q"/);
  assert.match(source, /@Output\(\) retry/);
});

/* ------------------------------------------------------------- output-lit */

test("component state gets this., a loop's own row does not", () => {
  const { markup } = toLit(`<li *ngFor="let o of xs" (click)="pick(o)" [class.hot]="o.hot">{{o.n}}</li>`);
  assert.match(markup, /repeat\(this\.xs \?\? \[\]/);
  assert.match(markup, /\(o\) => o\.id \?\? o/, "the key function sees the bare row");
  assert.match(markup, /this\.pick\(o\)/, "the handler is the component's, the row is the loop's");
  assert.doesNotMatch(markup, /this\.o\./);
});

test("a lit element carries the four states and parses", async (t) => {
  const { out, cleanup } = await runPipeline({ lit: true });
  t.after(cleanup);
  const source = await readFile(join(out, "src/elements/AppOrders.lit.js"), "utf8");
  for (const state of ["state--loading", "state--error", "state--empty"]) assert.match(source, new RegExp(state));
  assert.match(source, /import \{ repeat \}/, "the repeat directive is imported only because it is used");
});

/* --------------------------------------------------- stories, every target */

test("a story file follows its component, per target", async (t) => {
  const { ctx, cleanup } = await runPipeline({ storybook: true, vue: true, svelte: true, lit: true });
  t.after(cleanup);
  const written = ctx.written.join("\n");
  assert.match(written, /AppOrders\.stories\.jsx/);
  assert.match(written, /AppOrders\.vue\.stories\.js/);
  assert.match(written, /AppOrders\.svelte\.stories\.js/);
  assert.match(written, /AppOrders\.element\.stories\.js/);
});

test("no stories for targets that did not emit", async (t) => {
  const { ctx, cleanup } = await runPipeline({ storybook: true });
  t.after(cleanup);
  assert.ok(!ctx.written.some((f) => /vue\.stories|svelte\.stories|element\.stories/.test(f)));
});
