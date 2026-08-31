import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readSfc } from "../plugins/input-vue/index.js";
import { inspect } from "../plugins/general-license/index.js";
import { checkDensity, checkTokens, ratio } from "../plugins/dsp-a11y/index.js";
import { translate } from "../plugins/output-react/template.js";
import { ROOT, runPipeline } from "./helpers.js";

const jsx = (html) => translate(html, { indent: 0 }).jsx.replace(/\s+/g, " ").trim();

/* ------------------------------------------------------------- input-vue */

test("a single file component becomes the same shape an Angular one does", async () => {
  const sfc = await readFile(join(ROOT, "example/legacy-vue/src/OrdersPanel.vue"), "utf8");
  const { screen, calls } = readSfc(sfc, "src/OrdersPanel.vue");

  assert.equal(screen.selector, "orders-panel");
  assert.deepEqual(screen.inputs, ["region", "pageSize"]);
  assert.deepEqual(screen.outputs, ["selected"]);
  assert.equal(screen.usesTwoWay, true);
  assert.equal(screen.usesNgFor, true);
  assert.match(screen.template, /v-for/);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/v2/orders", "POST /api/v2/orders"]);
});

test("props declared either way are found", () => {
  const options = readSfc(`<template><p/></template><script>export default { name: 'Thing', props: { a: String, b: Number } }</script>`, "a.vue");
  assert.deepEqual(options.screen.inputs, ["a", "b"]);
  const array = readSfc(`<template><p/></template><script>export default { props: ['x', 'y'] }</script>`, "b.vue");
  assert.deepEqual(array.screen.inputs, ["x", "y"]);
});

test("a component with no template is reported, not invented", () => {
  const { screen } = readSfc(`<script>export default { name: 'Headless' }</script>`, "c.vue");
  assert.equal(screen.template, null);
});

/* ----------------------------------------------- the translator, in Vue */

test("Vue directives translate through the pass written for Angular", () => {
  assert.match(jsx(`<p v-if="loading">L</p>`), /\{loading && \( <p> L <\/p> \)\}/);
  assert.match(jsx(`<li v-for="o in xs">{{o.n}}</li>`), /xs\.map\(\(o\) =>/);
  assert.match(jsx(`<li v-for="(o, i) in xs">x</li>`), /xs\.map\(\(o, i\) =>/);
  assert.match(jsx(`<img :src="u">`), /src=\{u\}/);
  assert.match(jsx(`<button @click="go()">x</button>`), /onClick=\{\(\) => go\(\)\}/);
  assert.match(jsx(`<slot></slot>`), /\{children\}/);
  assert.match(jsx(`<span v-show="open">x</span>`), /display: open \? undefined : "none"/);
});

// The bug this guards: key={i} key={o.id} on one element, where React keeps the
// last and the author's intent is the one that gets dropped.
test("an author's key wins over a derived one, and there is only ever one", () => {
  const withKey = jsx(`<li v-for="(o, i) in xs" :key="o.id">x</li>`);
  assert.equal((withKey.match(/key=/g) || []).length, 1);
  assert.match(withKey, /key=\{o\.id\}/);
  assert.match(jsx(`<li v-for="o in xs">x</li>`), /key=\{o\.id \?\? o\}/);
});

// The bug this guards: `'Filter ' + region` declaring a prop called Filter.
test("a word inside a string is text, not a name", () => {
  const r = translate(`<input :placeholder="'Filter ' + region" />`, { indent: 0 });
  assert.deepEqual(r.reads, ["region"]);
});

test("v-html is translated and named for what it is", () => {
  const r = translate(`<div v-html="body"></div>`, { indent: 0 });
  assert.match(r.jsx, /dangerouslySetInnerHTML=\{\{ __html: body \}\}/);
  assert.ok(r.notes.some((n) => /trust decision/.test(n)));
});

/* -------------------------------------------------------- general-license */

test("a commercial typeface is flagged and an open one is not", () => {
  const commercial = inspect(`.a { font-family: 'Proxima Nova', Arial, sans-serif; }`, "a.css");
  assert.equal(commercial.length, 1);
  assert.equal(commercial[0].subject, "Proxima Nova");
  assert.match(commercial[0].note, /commercial typeface/);

  assert.deepEqual(inspect(`.a { font-family: Inter, system-ui, sans-serif; }`, "b.css"), []);
  assert.deepEqual(inspect(`.a { font-family: Arial, Helvetica Neue; }`, "c.css").map((f) => f.subject), ["Helvetica Neue"]);
});

test("an icon set is flagged with what makes its licence awkward", () => {
  const [icons] = inspect(`<i class="fa fa-user"></i>`, "a.html");
  assert.equal(icons.subject, "Font Awesome");
  assert.match(icons.note, /per seat|Pro/);
});

test("a self hosted font file is a licence term of its own", () => {
  const found = inspect(`@font-face { font-family: Whatever; src: url("/f/x.woff2"); }`, "a.css");
  assert.ok(found.some((f) => f.kind === "font-file"));
});

test("an unrecognised family is reported as unknown rather than as safe", () => {
  const [found] = inspect(`.a { font-family: "Acme Sans"; }`, "a.css");
  assert.match(found.note, /Find out what it is licensed under/);
});

/* -------------------------------------------------------------- dsp-a11y */

test("contrast is the real ratio", () => {
  assert.equal(ratio("#000000", "#ffffff"), 21);
  assert.equal(ratio("#ffffff", "#ffffff"), 1);
  assert.equal(ratio("rgb(0,75,135)", "#ffffff"), ratio("#004B87", "#ffffff"));
  assert.equal(ratio("nonsense", "#fff"), null);
});

test("a pair that cannot be read on screen is reported with what it needs", () => {
  const findings = checkTokens({ color: { ink: "#bbbbbb", bg: "#ffffff", surface: "#ffffff" } });
  assert.ok(findings.length >= 1);
  assert.equal(findings[0].severity, "high");
  assert.match(findings[0].evidence, /under the 4\.5:1/);
});

test("a palette that clears AA reports nothing", () => {
  assert.deepEqual(checkTokens({ color: { ink: "#111111", bg: "#ffffff", surface: "#ffffff" } }), []);
  assert.deepEqual(checkTokens({}), []);
});

test("a row under the tap target minimum is a decision, and is named as one", () => {
  assert.equal(checkDensity({ density: { rowHeight: "41px" } }).required, 44);
  assert.equal(checkDensity({ density: { rowHeight: "48px" } }), null);
});

/* ------------------------------------------------------- end to end, Vue */

test("a Vue app ports through the pipeline written for Angular", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ src: join(ROOT, "example/legacy-vue") });
  t.after(cleanup);
  assert.equal(error, null);

  assert.equal(ctx.screens.length, 1);
  assert.equal(ctx.screens[0].readBy, "vue");
  assert.deepEqual(ctx.api.calls.map((c) => c.path).sort(), ["/api/v2/orders", "/api/v2/orders"]);

  const jsxFile = ctx.written.find((f) => f.endsWith(".jsx"));
  const source = await readFile(join(out, jsxFile), "utf8");
  assert.match(source, /orders\.map\(/, "the v-for was translated");
  assert.match(source, /setQuery\(event\.target\.value\)/, "v-model became controlled");
  assert.match(source, /if \(loading\)/);
  assert.match(source, /length === 0\)/);
  assert.doesNotMatch(source, /v-if|v-for|v-model/, "no Vue syntax survived");
  assert.doesNotMatch(source, /\{Filter\}|, Filter/, "a word from a string is not a prop");
});

test("the licence of the font that Vue app uses is raised", async (t) => {
  const { ctx, cleanup } = await runPipeline({ src: join(ROOT, "example/legacy-vue") });
  t.after(cleanup);
  assert.ok(ctx.licensing.some((f) => f.subject === "Proxima Nova"));
  assert.ok(ctx.report.unverified.some((u) => /Proxima Nova/.test(u)));
});

/* ---------------------------------------------------------- storybook */

test("a story is emitted per component, one per state", async (t) => {
  const { ctx, out, cleanup } = await runPipeline({ storybook: true });
  t.after(cleanup);

  const story = ctx.written.find((f) => f.endsWith(".stories.jsx"));
  assert.ok(story, "a story file was emitted");
  const source = await readFile(join(out, story), "utf8");
  for (const state of ["Body", "Loading", "Failed", "Empty"]) {
    assert.match(source, new RegExp(`export const ${state}`), `${state} has no story`);
  }
  assert.match(source, /title: "Ported\//);
});

test("stories are off unless asked for", async (t) => {
  const { ctx, cleanup } = await runPipeline();
  t.after(cleanup);
  assert.ok(!ctx.written.some((f) => f.endsWith(".stories.jsx")));
});
