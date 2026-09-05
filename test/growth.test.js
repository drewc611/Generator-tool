import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { auditCss } from "../plugins/dsp-css/index.js";
import { readEra } from "../plugins/dsp-era/index.js";
import { performTables, readFrameset } from "../plugins/input-static/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The site engine grows into its planned entries: hashing, performed
 * tables, locale routes, prefetch, feeds as evidence, code splitting, the
 * 404 report, floats named, frames proposed, the era corpus, and the a11y
 * ceiling. Everything here reads what a run actually wrote.
 */

test("float scaffolding is named; an image that merely floats is not", () => {
  const audit = auditCss(".col { float: left; width: 33%; }\n.pic { float: left; }", "old.css");
  assert.deepEqual(audit.floats, [".col"], "floating and sizing at once is layout; floating alone is text wrap");
});

test("performed tables become the grid they meant, originals kept, data tables untouched", () => {
  const layout = `<table border="0"><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>`;
  const { html, originals } = performTables(layout);
  assert.match(html, /class="port-grid" style="--port-grid-cols: 2"/);
  assert.match(html, /class="port-grid-cell">a</);
  assert.deepEqual(originals, [layout], "the original is kept for the diff");

  const data = `<table><tr><th>name</th></tr><tr><td>x</td></tr><tr><td>y</td></tr><tr><td>z</td></tr></table>`;
  assert.deepEqual(performTables(data), { html: data, originals: [] }, "a header cell means data, never touched");
  const nested = `<table><tr><td><table><tr><td>i</td><td>j</td></tr><tr><td>k</td><td>l</td></tr></table></td><td>o</td></tr></table>`;
  assert.equal(performTables(nested).originals.length, 0, "a nested table is left alone rather than half converted");
});

test("the era corpus holds the readers to their labels", async () => {
  const dir = join(ROOT, "test/fixtures/era-corpus");
  const entries = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  assert.ok(entries.length >= 5, "miniatures for the font era, frames, ssi, php and the modern web");
  for (const file of entries) {
    const entry = JSON.parse(await readFile(join(dir, file), "utf8"));
    const era = readEra(entry.files);
    assert.ok(era.verdict, `${file}: the miniature dates`);
    assert.ok(
      era.verdict.from <= entry.label.to && era.verdict.to >= entry.label.from,
      `${file}: labelled ${entry.label.from}–${entry.label.to}, read as ${era.verdict.from}–${era.verdict.to}`
    );
    assert.ok(era.signals.length >= 1, `${file}: the verdict carries its evidence`);
  }
});

test("a feed in the tree is the site's own word about its families", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/feed-site"), site: true });
  try {
    assert.equal(run.error, null);
    assert.equal(run.ctx.site.feedEntries.length, 1);
    assert.equal(run.ctx.site.feedEntries[0].source, "feed.xml");
    assert.deepEqual(run.ctx.site.feedEntries[0].routes.sort(), ["/story-1", "/story-2"], "relative and absolute entry links both land");
    assert.ok(run.ctx.report.unverified.some((n) => /feed\.xml declares 2 page\(s\) as entries/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("a side by side frameset is proposed as a split view with its geometry", async () => {
  const fs = readFrameset(`<frameset cols="200,*"><frame src="nav.html" name="nav"><frame src="main.html" name="main"></frameset>`);
  assert.equal(fs.cols, "200,*");
  assert.equal(fs.rows, null);
  const run = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true });
  try {
    assert.equal(run.error, null);
    const framed = run.ctx.site.frames.find((f) => f.cols);
    assert.ok(framed?.proposal.includes("split layout"), "the proposal carries the author's own geometry");
    assert.ok(run.ctx.report.unverified.some((n) => /laid its frames side by side/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("twin locale trees parameterize the route table and every page knows its siblings", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/locale-site"), site: true });
  try {
    assert.equal(run.error, null);
    const { locales } = run.ctx.site;
    assert.deepEqual(locales.dirs, ["de", "en"]);
    assert.ok(locales.routes.some((r) => r.pattern === "/:locale/about"));
    assert.ok(locales.routes.some((r) => r.pattern === "/:locale"), "the twin index pages are one pattern too");
    assert.deepEqual(locales.alternates["/en/about"], { de: "/de/about" });
    const emitted = await readFile(join(run.out, "src/app/locales.js"), "utf8");
    assert.match(emitted, /LOCALE_ROUTES/);
    const head = await readFile(join(run.out, "src/app/head.js"), "utf8");
    assert.match(head, /"\/en\/about": \{[^\n]*alternates: \{"de":"\/de\/about"\}/);
    assert.match(head, /hreflang/, "the shell applies the siblings per navigation");
  } finally {
    await run.cleanup();
  }
});

test("hashed assets rename by their bytes and every written reference follows", async () => {
  const plain = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true });
  const hashed = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true, hashAssets: true });
  try {
    assert.equal(hashed.error, null);
    assert.deepEqual(plain.ctx.site.assetNames, {}, "without the flag nothing is renamed");
    const names = hashed.ctx.site.assetNames;
    assert.match(names["style.css"], /^style\.[0-9a-f]{8}\.css$/);
    assert.ok(hashed.ctx.written.includes(`public/${names["style.css"]}`), "the file lands under its content name");
    assert.ok(!hashed.ctx.written.includes("public/style.css"), "and not under the old one");
    const index = await readFile(join(hashed.out, "index.html"), "utf8");
    assert.ok(index.includes(names["style.css"]), "the entry links the renamed sheet");
    assert.ok(hashed.ctx.report.unverified.some((n) => /contract this flag knowingly changes/.test(n)));
  } finally {
    await plain.cleanup();
    await hashed.cleanup();
  }
});

test("--split loads one module per route and a hover warms it", async () => {
  const run = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true, split: true });
  try {
    assert.equal(run.error, null);
    const app = await readFile(join(run.out, "src/app/App.jsx"), "utf8");
    assert.match(app, /export const LOADERS = \{/);
    assert.match(app, /"\/about": \(\) => import\("\.\.\/features\/About\/About\.jsx"\)/);
    assert.match(app, /lazy\(load\)/);
    assert.match(app, /<Suspense fallback=\{<p role="status">Loading…<\/p>\}>/, "the split still shows its loading state");
    assert.match(app, /pointerover/, "intent warms the module");
    assert.match(app, /raw\.replace\(\/\\\/\$\/, ""\)/, "the emitted regex survived the template");
  } finally {
    await run.cleanup();
  }
});

test("the 404 report matches the old server's refusals against the port", async () => {
  const run = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true, logs: join(ROOT, "test/fixtures/access-log.txt") });
  try {
    assert.equal(run.error, null);
    const report = await readFile(join(run.out, "LOGS_404.md"), "utf8");
    assert.match(report, /\| `\/moved` \| 1 \| redirected \|/);
    assert.match(report, /\| `\/gone-forever` \| 2 \| uncovered \|/, "demand is counted, heaviest first");
    assert.match(report, /\| `\/about` \| 1 \| a live route \|/);
    assert.match(report, /\| `\/style.css` \| 1 \| a served asset \|/);
    assert.match(report, /\| `\/search` \| 1 \| uncovered \|/, "the query string is not part of the path");
    assert.ok(run.ctx.report.unverified.some((n) => /answered by nothing in this port/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("performed tables ship their grid and the originals sit beside the components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-tables-"));
  try {
    await writeFile(join(dir, "index.html"), `<html><head><title>Tables</title></head><body><h1>Home</h1><table border="0"><tr><td>left</td><td>right</td></tr><tr><td>a</td><td>b</td></tr></table></body></html>`);
    await writeFile(join(dir, "other.html"), `<html><head><title>Other</title></head><body><h1>Other</h1><p>no table here</p></body></html>`);
    const run = await runPipeline({ src: dir, site: true, performTables: true });
    try {
      assert.equal(run.error, null);
      const component = await readFile(join(run.out, "src/features/Home/Home.jsx"), "utf8");
      assert.match(component, /port-grid/);
      assert.doesNotMatch(component, /<table/);
      assert.match(await readFile(join(run.out, "src/features/Home/Home.original-table.html"), "utf8"), /<table border="0">/);
      assert.match(await readFile(join(run.out, "public/port-grid.css"), "utf8"), /display: grid/);
      const index = await readFile(join(run.out, "index.html"), "utf8");
      assert.match(index, /port-grid\.css/, "the grid stylesheet is linked");
    } finally {
      await run.cleanup();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the a11y ceiling is a gate that only ever adds", async () => {
  const over = await runPipeline({ src: join(ROOT, "example/legacy"), maxA11y: 0 });
  assert.ok(over.error, "the demo's measured findings exceed a ceiling of zero");
  assert.match(over.error.message, /accessibility finding\(s\) against a ceiling of 0/);
  await over.cleanup();
  const under = await runPipeline({ src: join(ROOT, "example/legacy"), maxA11y: 99 });
  assert.equal(under.error, null);
  await under.cleanup();
});
