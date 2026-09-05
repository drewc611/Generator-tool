import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { fmToJs, lowerFreemarker, readInputs } from "../plugins/input-freemarker/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * FreeMarker's directives and its expression language lowered onto the
 * dialect; the defaults, existence tests and built ins with a JS spelling
 * rewritten, the rest named.
 */

test("defaults, existence tests, built ins and word operators become the JS they name", () => {
  const notes = [];
  const note = (n) => notes.push(n);
  assert.equal(fmToJs('product.note!"none"', note), '(product.note || "none")');
  assert.equal(fmToJs("user??", note), "(user != null)");
  assert.equal(fmToJs("tags?size gt 2 && name?upper_case == 'X'", note), "tags.length > 2 && name.toUpperCase() == 'X'");
  assert.equal(fmToJs("items?first", note), "items[0]");
  assert.equal(fmToJs("price?string", note), "price");
  assert.deepEqual(notes, []);
  fmToJs("date?string('yyyy') + x?cap_first", note);
  assert.ok(notes.some((n) => /\?cap_first/.test(n)), "a built in with no JS spelling is named");
});

test("if, elseif, list with else, items, switch and a macro lower onto the dialect's blocks", () => {
  const notes = [];
  const out = lowerFreemarker(
    `<#if a>1<#elseif b>2<#else>3</#if><ul><#list xs as x><li>\${x}</li><#else><li>none</li></#list></ul>` +
    `<#list ys><ol><#items as y><li>\${y}</li></#items></ol></#list><#switch t><#case "p">P<#break><#default>D</#switch>` +
    `<#macro tag n><b>\${n}</b></#macro><@tag n=title/>`,
    (n) => notes.push(n)
  );
  assert.equal(out,
    `<ng-container ng-if="a">1</ng-container><ng-container ng-if="!(a) && (b)">2</ng-container><ng-container ng-if="!(a) && !(b)">3</ng-container>` +
    `<ul><ng-container ng-repeat="x in xs"><li>{{ x }}</li></ng-container><ng-container ng-if="!xs || !xs.length"><li>none</li></ng-container></ul>` +
    `<ol><ng-container ng-repeat="y in ys"><li>{{ y }}</li></ng-container></ol><ng-container ng-if="(t) == 'p'">P</ng-container><ng-container ng-if="!((t) == 'p')">D</ng-container>` +
    `<b>{{ title }}</b>`);
  assert.ok(notes.some((n) => /expanded at its call site/.test(n)));
});

test("the data model's names are read from expressions only, loop variables excluded", () => {
  assert.deepEqual(readInputs(`<h1>{{ product.name }}</h1><ng-container ng-repeat="tag in product.tags"><li>{{ tag }}</li></ng-container><input type="search"><ng-container ng-if="user != null">{{ user.name }}</ng-container>`), ["product", "user"]);
});

test("a run inlines the include, expands the macro, names the machinery and ports the template", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/freemarker") });
  try {
    assert.equal(run.error, null);
    const product = run.ctx.screens.find((s) => s.selector === "templates-product");
    assert.ok(product && product.readBy === "freemarker");
    assert.match(product.template, /^<nav>/, "the include is inlined where its tag stood");
    assert.match(product.template, /<ng-container ng-if="\(user != null\)">/);
    assert.match(product.template, /ng-if="!\(product\.stock == 0\) && \(product\.stock < 5\)"/);
    assert.match(product.template, /<ng-container ng-repeat="tag in product\.tags">\s*<li>\{\{ tag\.toUpperCase\(\) \}\}<\/li>/);
    assert.match(product.template, /<li class="none">No tags<\/li>/);
    assert.match(product.template, /\{\{ product\.tags\.length \}\} tags, \{\{ \(product\.note \|\| "no note"\) \}\}/);
    assert.match(product.template, /ng-if="\(product\.type\) == 'shoe'"/);
    assert.match(product.template, /<span class="badge">\{\{ product\.type \}\}<\/span>/, "the macro expanded with its argument");
    assert.match(product.template, /ng-repeat="\(key, value\) in product\.specs"/);
    assert.doesNotMatch(product.template, /<#|<@|discounted|utils\.ftl/);
    assert.deepEqual(product.inputs, ["product", "user"]);
    assert.ok(run.ctx.screens.some((s) => s.selector === "templates-includes-nav"), "the include is also a screen of its own");
    const jsx = await readFile(join(run.out, "src/features/TemplatesProduct/TemplatesProduct.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|<#/);
    assert.ok(run.ctx.report.unverified.some((n) => /<#assign/.test(n)) && run.ctx.report.unverified.some((n) => /<#import/.test(n)));
  } finally {
    await run.cleanup();
  }
});
