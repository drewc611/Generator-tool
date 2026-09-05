import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { lowerBody } from "../plugins/input-react/index.js";
import { lowerSvelte } from "../plugins/input-svelte/index.js";
import { toAlpine } from "../plugins/output-alpine/index.js";
import { toAngular } from "../plugins/output-angular/print.js";
import { toLit } from "../plugins/output-lit/index.js";
import { translate } from "../plugins/output-react/template.js";
import { toSolid } from "../plugins/output-solid/index.js";
import { toSvelte } from "../plugins/output-svelte/print.js";
import { toVue } from "../plugins/output-vue/print.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Bound html keeps its element. `<p class="note" ng-bind-html="x">` used to
 * become a bare html node, so every target printed a div the author never
 * wrote and lost the tag and its class; the round trip counted the extra
 * element and drifted on eight fixtures. The element is the author's and
 * every target keeps it, each carrying the html its own way.
 */

const T = `<p class="note" ng-bind-html="product.descriptionHtml"></p>`;

test("the IR keeps the element that binds html and makes the html its only child", () => {
  const p = buildIr(T).root;
  assert.equal(p.kind, "element"); assert.equal(p.tag, "p");
  assert.deepEqual(p.classes, [{ kind: "literal", value: "note" }]);
  assert.deepEqual(p.children, [{ kind: "html", expression: "product.descriptionHtml" }]);
});

test("every target carries bound html on the element the author wrote", () => {
  assert.match(translate(T).jsx, /<p className="note" dangerouslySetInnerHTML=\{\{ __html: product\.descriptionHtml \}\} \/>/);
  assert.match(toVue(T).markup ?? JSON.stringify(toVue(T)), /<p class="note" v-html="product\.descriptionHtml"><\/p>/);
  assert.match(toSvelte(T).markup ?? JSON.stringify(toSvelte(T)), /<p class="note">\s*\{@html product\.descriptionHtml\}\s*<\/p>/);
  assert.match(toAngular(T).markup, /<p class="note" \[innerHTML\]="product\.descriptionHtml"><\/p>/);
  assert.match(toAlpine(T).markup, /<p class="note" x-html="product\.descriptionHtml"><\/p>/);
  assert.match(toSolid(T).body, /<p class="note" innerHTML=\{props\.product\.descriptionHtml\} \/>/);
  assert.match(toLit(T).markup ?? JSON.stringify(toLit(T)), /<p class="note">\s*\$\{unsafeHTML\(this\.product\.descriptionHtml\)\}\s*<\/p>/);
  for (const out of [translate(T).jsx, toVue(T).markup ?? "", toAngular(T).markup, toAlpine(T).markup, toSolid(T).body]) assert.ok(!/<div/.test(out), "no div the author never wrote");
});

test("the React reader reads bound html, textarea, select and checkbox models, and an entries loop back into the dialect", () => {
  const back = lowerBody(
    `<><p className="note" dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />` +
    `<textarea value={review.body} onChange={(e) => setBody(e.target.value)} />` +
    `<select value={review.size} onChange={(e) => setSize(e.target.value)}></select>` +
    `<input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />` +
    `{Object.entries(product.specs).map(([key, value]) => (<dt key={key}>{key}: {value}</dt>))}</>`
  );
  assert.match(back, /<p class="note" ng-bind-html="product\.descriptionHtml" \/>/);
  assert.match(back, /<textarea ng-model="review\.body" \/>/);
  assert.match(back, /<select ng-model="review\.size"><\/select>/);
  assert.match(back, /<input ng-model="ok" type="checkbox" \/>/);
  assert.match(back, /<dt ng-repeat="\(key, value\) in product\.specs">\{\{ key \}\}: \{\{ value \}\}<\/dt>/);
});

test("the Svelte reader reads an entries loop as the (key, value) form", () => {
  const notes = [];
  assert.equal(lowerSvelte(`{#each Object.entries(product.specs) as [key, value] (key)}<dt>{key}</dt>{/each}`, (n) => notes.push(n)), `<ng-container ng-repeat="(key, value) in product.specs"><dt>{{ key }}</dt></ng-container>`);
  assert.equal(lowerSvelte(`{#each items as item, i (item.id)}<li>{item}</li>{/each}`, (n) => notes.push(n)), `<ng-container ng-repeat="item in items"><li>{{ item }}</li></ng-container>`);
  assert.ok(!notes.some((n) => /could not be read/.test(n)));
});

test("the fixtures that drifted through the round trip hold: pug and haml through React, freemarker through React and Svelte", async () => {
  for (const fixture of ["pug", "haml", "freemarker"]) {
    const run = await runPipeline({ src: join(ROOT, "test/fixtures", fixture) });
    try {
      assert.equal(run.error, null, `${fixture} runs`);
      const md = await readFile(join(run.out, "ROUNDTRIP.md"), "utf8");
      assert.ok(!/\*\*drifted\*\*/.test(md), `${fixture} round trips with no drift:\n${md.split("## Where it drifted")[1] ?? ""}`);
    } finally {
      await run.cleanup();
    }
  }
});
