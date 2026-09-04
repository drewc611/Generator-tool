import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildIr, detectDialect, DIALECTS } from "../plugins/dsp-ir/ir.js";
import { toSvelte } from "../plugins/output-svelte/print.js";
import { translate } from "../plugins/output-react/template.js";
import { buildSpec, renderSpec } from "../plugins/output-tests/spec.js";
import { buildModel } from "../plugins/dsp-behavior/model.js";
import { ROOT, runPipeline } from "./helpers.js";

const kinds = (node) => (node.children ?? []).map((c) => c.kind);

/* ------------------------------------------------------------------ the IR */

test("the dialect is judged by what is in the markup", () => {
  assert.equal(detectDialect(`<p *ngIf="a">x</p>`).name, "angular");
  assert.equal(detectDialect(`<p v-if="a">x</p>`).name, "vue");
  assert.equal(detectDialect(`<p :class="a">x</p>`).name, "vue");
  assert.equal(detectDialect(`<div v-html="a"></div>`).name, "vue");
  assert.equal(detectDialect(`<p>plain</p>`).name, "angular", "the default is stated, not accidental");
});

// This is the whole argument for having an IR at all.
test("the same screen written two ways becomes the same tree", () => {
  const ng = buildIr(`<div *ngIf="loading">L</div><li *ngFor="let o of orders" [class.hot]="o.hot" (click)="pick(o)">{{o.n}}</li><input [(ngModel)]="q">`);
  const vue = buildIr(`<div v-if="loading">L</div><li v-for="o in orders" :class="{hot: o.hot}" @click="pick(o)">{{o.n}}</li><input v-model="q">`);

  assert.deepEqual(kinds(ng.root), kinds(vue.root));
  assert.deepEqual(kinds(ng.root), ["when", "each", "element"]);
  assert.deepEqual(ng.models, vue.models);
  assert.deepEqual(ng.reads, vue.reads);
  assert.deepEqual(ng.collections, vue.collections);
});

test("both targets accept both dialects, and produce the same output for each", () => {
  const angular = `<div *ngIf="a">x</div><li *ngFor="let o of xs" (click)="p(o)">{{o.n}}</li>`;
  const vue = `<div v-if="a">x</div><li v-for="o in xs" @click="p(o)">{{o.n}}</li>`;

  assert.equal(translate(angular, { indent: 0 }).jsx, translate(vue, { indent: 0 }).jsx);
  assert.equal(toSvelte(angular).markup, toSvelte(vue).markup);
});

test("a loop carries what it needs to be rebuilt anywhere", () => {
  const { root } = buildIr(`<li *ngFor="let o of orders; index as i; trackBy: byId">x</li>`);
  assert.equal(root.kind, "each");
  assert.equal(root.item, "o");
  assert.equal(root.index, "i");
  assert.equal(root.list, "orders");
  assert.match(root.key, /byId\(i, o\)/);
});

test("a class arrives as roles, not as a string somebody already joined", () => {
  const { root } = buildIr(`<div class="card" [class.busy]="loading" [ngClass]="{ late: o.late }"></div>`);
  assert.deepEqual(root.classes.map((c) => c.kind), ["literal", "conditional", "conditional"]);
  assert.equal(root.classes[0].value, "card");
  assert.equal(root.classes[1].name, "busy");
});

test("hiding is not the same as not rendering", () => {
  const { root } = buildIr(`<span v-show="open">x</span>`);
  assert.equal(root.kind, "element");
  assert.match(root.styles[0].expression, /open \? undefined : "none"/);
  assert.match(toSvelte(`<span v-show="open">x</span>`).markup, /display/);
});

test("slot and ng-content mean the same thing without being told the dialect", () => {
  assert.equal(buildIr(`<slot></slot>`).root.kind, "slot");
  assert.equal(buildIr(`<ng-content></ng-content>`).root.kind, "slot");
  assert.match(translate(`<slot></slot>`, { indent: 0 }).jsx, /\{children\}/);
  assert.match(toSvelte(`<ng-content></ng-content>`).markup, /<slot \/>/);
});

/* -------------------------------------------------------------- the svelte */

test("svelte gets the directive it has rather than a joined string", () => {
  const out = toSvelte(`<li *ngFor="let o of xs" [class.hot]="o.hot" (click)="p(o)">{{o.n}}</li>`).markup;
  assert.match(out, /\{#each xs as o \(/);
  assert.match(out, /class:hot=\{o\.hot\}/);
  assert.match(out, /on:click=\{\(\) => p\(o\)\}/);
  assert.match(out, /\{\/each\}/);
});

test("svelte binds a model and blocks are balanced", () => {
  const out = toSvelte(`<div *ngIf="a"><input [(ngModel)]="q"></div>`).markup;
  assert.match(out, /bind:value=\{q\}/);
  assert.equal((out.match(/\{#if/g) || []).length, (out.match(/\{\/if\}/g) || []).length);
});

test("a svelte component is emitted only when asked, with every state", async (t) => {
  const { ctx, out, cleanup } = await runPipeline({ svelte: true });
  t.after(cleanup);
  const file = ctx.written.find((f) => f.endsWith(".svelte"));
  assert.ok(file, "a svelte component was emitted");
  const source = await readFile(join(out, file), "utf8");
  for (const state of ["{#if loading}", ":else if error}", ":else if", "{:else}"]) {
    assert.ok(source.includes(state), `${state} is missing`);
  }
  assert.match(source, /export let/);
});

test("svelte is off unless asked for", async (t) => {
  const { ctx, cleanup } = await runPipeline();
  t.after(cleanup);
  assert.ok(!ctx.written.some((f) => f.endsWith(".svelte")));
});

/* -------------------------------------------------- the conformance suite */

const exploration = JSON.parse(await readFile(join(ROOT, "test/fixtures/explored/exploration.json"), "utf8"));
const model = buildModel(exploration);
const spec = buildSpec(model, exploration, { portUrl: "http://127.0.0.1:3000" });

test("a suite is written from what the original did", () => {
  assert.ok(spec.cases.length >= 5, `${spec.cases.length} cases`);
  const source = renderSpec(spec);
  assert.match(source, /@playwright\/test/);
  assert.match(source, /PORTAMP_PORT_URL/);
  assert.ok(source.split("\n").every((l) => l.length < 400));
});

// The rule the app stated is the assertion. A port that accepts the input the
// original refused has lost something nobody wrote down anywhere else.
test("a validation rule the app demonstrated becomes an assertion", () => {
  const source = renderSpec(spec);
  assert.match(source, /Customer is required/);
  assert.ok(!/Orders Portal New order Customer Customer is required/.test(source), "the sentence, not the whole page");
});

test("a request the original fired is awaited before the action, not after", () => {
  const source = renderSpec(spec);
  const withRequest = spec.cases.find((c) => c.body.includes("waitForRequest"));
  assert.ok(withRequest, "at least one case asserts a request");
  // Armed after the click, the request has already gone and the wait times out.
  assert.ok(
    withRequest.body.indexOf("waitForRequest") < withRequest.body.indexOf(".click()"),
    "the wait must be armed before the action"
  );
});

test("a step three screens in replays the way it was reached", () => {
  const cancel = spec.cases.find((c) => /Cancel/.test(c.title));
  assert.ok(cancel, "the Cancel step produced a case");
  assert.match(cancel.body, /New order[\s\S]*Cancel/, "it opens the screen before clicking the control on it");
});

test("a control with no accessible name falls back to its selector, and says why", () => {
  const glyph = spec.cases.find((c) => /↻/.test(c.title));
  assert.ok(glyph);
  assert.match(glyph.how, /no accessible name/);
});

test("the header says how much of the app was never reached", () => {
  assert.match(spec.header, /of \d+ steps the explorer was allowed/);
  assert.match(spec.header, /not covered here/);
});

test("nothing explored means nothing asserted, rather than an empty pass", () => {
  const empty = buildSpec({ screens: [], endpoints: [] }, { screens: [], steps: [], requests: [] });
  assert.equal(empty.cases.length, 0);
  assert.match(renderSpec(empty), /test\.skip/);
});
