import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readPdf, linesOf, decodeTextString } from "../plugins/input-pdf/parse.js";
import { headingSizes, documentHtml } from "../plugins/input-pdf/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A technical document into a React page, with nothing invented on the way.
 * The fixture PDFs are committed and were written by hand: two pages, one of
 * them Flate compressed, a link annotation, an outline, and a sealed sibling
 * the reader must refuse.
 */

const FIXTURE = join(ROOT, "test/fixtures/docs/widget-3000.pdf");

test("the reader takes a PDF apart without a dependency", async () => {
  const doc = readPdf(await readFile(FIXTURE));
  assert.equal(doc.info.title, "Widget 3000 Data Sheet");
  assert.equal(doc.pages.length, 2, "both pages read");
  assert.equal(doc.pages[0].lines[0].text, "Widget 3000 Data Sheet");
  assert.equal(doc.pages[0].lines[0].size, 24, "the size travels with the text");
  assert.equal(doc.pages[1].lines[0].text, "Mechanical", "the Flate page inflates through node:zlib");
  assert.deepEqual(doc.pages[0].links, [{ uri: "https://example.com/widget-3000" }]);
  assert.deepEqual(doc.outline.map((o) => o.title), ["Electrical characteristics", "Mechanical"]);
  assert.deepEqual(doc.problems, []);
  assert.equal(doc.unmapped, 0);
});

test("what is not a PDF, or is sealed, is said and never guessed at", async () => {
  assert.equal(readPdf(Buffer.from("hello, not a pdf")), null);
  const sealed = readPdf(await readFile(join(ROOT, "test/fixtures/docs/sealed.pdf")));
  assert.deepEqual(sealed, { encrypted: true }, "an encrypted document yields nothing but the fact");
});

test("reading order and headings come from measured positions, not hope", () => {
  const lines = linesOf([
    { str: "world", x: 120, y: 700, size: 10 },
    { str: "hello", x: 72, y: 700.5, size: 10 },
    { str: "Title", x: 72, y: 720, size: 20 },
  ]);
  assert.deepEqual(lines.map((l) => l.text), ["Title", "hello world"], "top first, then left to right on one line");
  const { body, levels } = headingSizes([
    { text: "Big", size: 20 }, { text: "a paragraph of body text", size: 10 },
    { text: "more body text than anything", size: 10 }, { text: "Mid", size: 14 },
  ]);
  assert.equal(body, 10);
  assert.equal(levels.get(20), 1);
  assert.equal(levels.get(14), 2);
  assert.equal(decodeTextString("\xfe\xff\0W\0i"), "Wi", "UTF-16BE metadata decodes");
});

test("the document becomes markup that says where everything came from", async () => {
  const html = documentHtml(readPdf(await readFile(FIXTURE)), "widget-3000.pdf");
  assert.match(html, /<h1 id="widget-3000-data-sheet">Widget 3000 Data Sheet<\/h1>/);
  assert.match(html, /<h2 id="electrical-characteristics">/);
  assert.match(html, /<nav aria-label="In this document">/, "a table of contents when there is one");
  assert.match(html, /Supply voltage 5 V nominal, 4.5 V minimum. Operating current 20 mA at idle./, "lines gather into paragraphs");
  assert.match(html, /<h2 id="referenced-addresses">/, "the annotations' addresses are listed, not scattered");
  assert.match(html, /<a href="\/widget-3000\.pdf">The original document \(PDF\)<\/a>/, "the PDF stays the document of record");
});

test("with --site the data sheet is a routed React page and the original is kept", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/doc-site"), site: true });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.site.pages.some((p) => p.route === "/widget-3000"), "the document has a route beside the pages");
    assert.ok(run.ctx.site.redirects.some((r) => r.from === "/widget-3000.pdf" && r.to === "/widget-3000"), "the old address answers");
    const original = await readFile(join(run.out, "public/widget-3000.pdf"));
    assert.deepEqual(original, await readFile(join(ROOT, "test/fixtures/doc-site/widget-3000.pdf")), "the original travels byte for byte");
    const component = await readFile(join(run.out, "src/features/Widget3000/Widget3000.jsx"), "utf8");
    assert.match(component, /Widget 3000 Data Sheet/);
    assert.match(component, /aria-label="In this document"/);
    assert.match(component, /read from its own text operators/);
    assert.match(await readFile(join(run.out, "DOCS.md"), "utf8"), /2 page\(s\), read as \*\*Widget 3000 Data Sheet\*\*/);
    // The port's own search engine finds the document by its words.
    const { INDEX } = await import(`file://${join(run.out, "src/app/search-index.js")}`);
    const { rank } = await import(`file://${join(run.out, "src/app/match.js")}`);
    assert.ok(rank(INDEX, "voltage").includes("/widget-3000"), "a word the data sheet says finds the data sheet");
  } finally {
    await run.cleanup();
  }
});

test("a sealed document and a route collision are notes, not surprises", async () => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-docs-"));
  try {
    await writeFile(join(dir, "spec.html"), "<html><head><title>Spec</title></head><body><h1>Spec page</h1><p>the page that owns the route</p></body></html>");
    await writeFile(join(dir, "spec.pdf"), await readFile(FIXTURE));
    await writeFile(join(dir, "sealed.pdf"), await readFile(join(ROOT, "test/fixtures/docs/sealed.pdf")));
    const run = await runPipeline({ src: dir, site: true });
    try {
      assert.equal(run.error, null);
      assert.ok(run.ctx.report.unverified.some((n) => /sealed\.pdf is encrypted/.test(n)), "the refusal is on the record");
      assert.ok(run.ctx.site.pages.some((p) => p.route === "/spec-pdf"), "the colliding document steps aside, named");
      assert.ok(run.ctx.report.unverified.some((n) => /already belongs to a page/.test(n)));
      assert.ok(!run.ctx.screens.some((s) => s.file === "sealed.pdf"), "nothing was read out of the sealed file");
    } finally {
      await run.cleanup();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
