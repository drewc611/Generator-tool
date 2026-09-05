import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { lowerXslt, parseXml, xpathToJs } from "../plugins/input-xslt/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * XSLT read as the template it is: loops, conditionals, interpolations and
 * attributes onto the dialect, XPath onto the JS path it names, and any XPath
 * the table does not know kept as written and named.
 */

test("a well formed stylesheet parses into a tree with attributes, text and self closing tags", () => {
  const doc = parseXml(`<?xml version="1.0"?><a x="1"><!-- c --><b y='2'/>text &amp; more<![CDATA[<raw>]]></a>`);
  const a = doc.children[0];
  assert.equal(a.tag, "a"); assert.equal(a.attrs.x, "1");
  assert.deepEqual(a.children.map((c) => c.tag ?? c.text), ["b", "text & more", "<raw>"]);
  assert.equal(a.children[0].attrs.y, "2");
});

test("XPath lowers to the JS path it names, relative to the context node", () => {
  const notes = [];
  const note = (n) => notes.push(n);
  assert.equal(xpathToJs("name", "item", note), "item.name");
  assert.equal(xpathToJs("@kind", "item", note), "item.kind");
  assert.equal(xpathToJs("/catalog/item", "data", note), "data.catalog.item");
  assert.equal(xpathToJs("count(/catalog/item) = 0", "data", note), "data.catalog.item.length == 0");
  assert.equal(xpathToJs("price > 100 and not(sold)", "item", note), "item.price > 100 && !(item.sold)");
  assert.equal(xpathToJs(".", "note", note), "note");
  assert.equal(xpathToJs("position()", "item", note), "($index + 1)");
  assert.equal(xpathToJs("item[1]/name", "data", note), "data.item[0].name");
  assert.equal(xpathToJs("'a literal'", "x", note), "'a literal'");
  assert.deepEqual(notes, []);
  xpathToJs("item[@kind='book']/name", "data", note);
  assert.ok(notes.some((n) => /predicate, axis or function/.test(n)), "a predicate filter is named, not guessed");
});

test("for-each, if, choose, value-of, attribute, call-template and apply-templates lower onto the dialect", async () => {
  const notes = [];
  const text = await readFile(join(ROOT, "test/fixtures/xslt/catalog.xsl"), "utf8");
  const { template } = lowerXslt(text, (n) => notes.push(n));
  assert.match(template, /^<h1>\{\{ data\.catalog\.name \}\}<\/h1>/, "the body is the screen and the root variable is substituted");
  assert.match(template, /<ng-container ng-if="data\.catalog\.item\.length == 0"><p class="empty">/);
  assert.match(template, /<ng-container ng-repeat="item in data\.catalog\.item">/);
  assert.match(template, /<li class="\{\{ item\.kind \}\}"><a href="\{\{ item\.url \}\}">\{\{ item\.name \}\}<\/a>/, "xsl:attribute and an attribute value template both bind");
  assert.match(template, /<ng-container ng-if="item\.price > 100">dear<\/ng-container><ng-container ng-if="!\(item\.price > 100\) && \(item\.price > 10\)">fair<\/ng-container><ng-container ng-if="!\(item\.price > 100\) && !\(item\.price > 10\)">cheap<\/ng-container>/);
  assert.match(template, /<span class="badge">\{\{ \(\$index \+ 1\) \}\}<\/span>/, "the named template is inlined where it is called");
  assert.match(template, /<ng-container ng-repeat="note in data\.catalog\.note"><p class="note">\{\{ note \}\}<\/p><\/ng-container>/, "apply-templates over a select with a matching template repeats its body");
  assert.doesNotMatch(template, /xsl:|<html|<head|\$shop/);
  assert.ok(notes.some((n) => /xsl:sort/.test(n)), "the sort is named");
});

test("a run reads the stylesheet as a screen with the document as its one input and ports it", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/xslt") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.selector === "catalog");
    assert.ok(screen && screen.readBy === "xslt");
    assert.deepEqual(screen.inputs, ["data"]);
    assert.ok(screen.usesNgIf && screen.usesNgFor);
    const jsx = await readFile(join(run.out, "src/features/Catalog/Catalog.jsx"), "utf8");
    assert.doesNotMatch(jsx, /ng-|xsl:/);
    assert.match(jsx, /data\.catalog\.item\.map\(/);
  } finally {
    await run.cleanup();
  }
});
