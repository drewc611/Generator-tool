import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Policy } from "../src/core/policy.js";
import plugin, { batchScrape, parseFormats, renderFormats, scrapeUrl } from "../plugins/general-scrape/index.js";
import { decodeEntities, htmlToMarkdown, htmlToText, pageMeta } from "../plugins/general-scrape/markdown.js";

/**
 * Scrape and Batch Scrape read a URL, or many, as Markdown, HTML or JSON.
 * Unlike fetch and map, neither is confined to one origin: a redirect is
 * followed wherever it leads, each hop still asking the policy first, and a
 * domain the attestation does not cover fails that one URL rather than the
 * whole batch. The sites here are a local server the test starts; nothing
 * leaves the machine.
 */

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

/* --------------------------------------------------------- markdown.js */

test("entities decode, named and numeric, and anything unrecognised is left exactly as written", () => {
  assert.equal(decodeEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(decodeEntities("&#39;quoted&#39;"), "'quoted'");
  assert.equal(decodeEntities("&#x27;hex&#x27;"), "'hex'");
  assert.equal(decodeEntities("&nosuchentity;"), "&nosuchentity;");
});

test("a whole document becomes Markdown: headings, emphasis, links resolved against the page, lists, quotes, code and tables", () => {
  const html = `<!doctype html><html><head><title>T</title></head><body>
    <h1>Title</h1>
    <p>Hello <strong>bold</strong> and <em>italic</em> and <code>x = 1</code>, visit <a href="/about">about</a>.</p>
    <ul><li>One</li><li>Two<ul><li>Nested</li></ul></li></ul>
    <ol><li>First</li><li>Second</li></ol>
    <blockquote><p>Quoted</p></blockquote>
    <pre>  code   block  </pre>
    <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2 | 3</td></tr></table>
    <img src="pic.png" alt="a pic">
    <!-- <a href="/hidden">never</a> -->
    <script>if (1 < 2) { document.write("<a href=nope>x</a>") }</script>
    <style>.x { color: red }</style>
  </body></html>`;
  const md = htmlToMarkdown(html, { baseUrl: "https://example.com/dir/page" });
  assert.doesNotMatch(md, /doctype/i, "the doctype is not markup and never leaks into the output");
  assert.doesNotMatch(md, /never|nope|color: red/, "a comment, and a script's or style's own content, are never read as the page");
  assert.match(md, /^# Title$/m);
  assert.match(md, /Hello \*\*bold\*\* and \*italic\* and `x = 1`, visit \[about\]\(https:\/\/example\.com\/about\)\./);
  assert.match(md, /^- One\n- Two\n {2}- Nested$/m, "list items stay on adjacent lines, one list, not several");
  assert.match(md, /^1\. First\n2\. Second$/m);
  assert.match(md, /^> Quoted$/m);
  assert.ok(md.includes("```\n  code   block  \n```"), "pre keeps its own internal spacing exactly, only its own leading/trailing blank lines trimmed");
  assert.match(md, /^\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \\\| 3 \|$/m, "a table's rows stay adjacent, and a literal pipe in a cell is escaped");
  assert.match(md, /!\[a pic\]\(https:\/\/example\.com\/dir\/pic\.png\)/, "a relative image src resolves against the page, not the site root");
});

test("Markdown's own marks strip cleanly for a plain text read, with block boundaries intact", () => {
  const html = "<h1>Title</h1><p>One</p><ul><li>A</li><li>B</li></ul><p>Two</p>";
  const text = htmlToText(html);
  assert.doesNotMatch(text, /[#>`*[\]|-]/, "no Markdown mark survives");
  assert.equal(text, "Title\n\nOne\n\nA\nB\n\nTwo");
});

test("the head's own title, description, canonical and lang are read by name, decoded, never guessed when absent", () => {
  const full = pageMeta(`<html lang="fr"><head><title>Café &amp; Bar</title><meta name="description" content="A place"><link rel="canonical" href="https://x.example/c"></head></html>`);
  assert.deepEqual(full, { title: "Café & Bar", description: "A place", canonical: "https://x.example/c", lang: "fr" });
  const bare = pageMeta("<html><body>nothing in the head</body></html>");
  assert.deepEqual(bare, { title: null, description: null, canonical: null, lang: null });
});

test("renderFormats renders only the formats asked for", () => {
  const html = "<html><head><title>T</title></head><body><h1>Hi</h1></body></html>";
  const only = renderFormats(html, "https://x/", ["markdown"]);
  assert.match(only.markdown, /^# Hi/);
  assert.equal(only.html, undefined);
  assert.equal(only.json, undefined);
  const all = renderFormats(html, "https://x/", ["markdown", "html", "json"]);
  assert.equal(all.html, html);
  const parsed = JSON.parse(all.json);
  assert.equal(parsed.title, "T");
  assert.match(parsed.markdown, /^# Hi/);
  assert.match(parsed.text, /^Hi$/m);
});

/* --------------------------------------------------------------- scrape */

async function serveSite(t) {
  const server = createServer((req, res) => {
    if (req.url === "/redirected") { res.writeHead(302, { Location: "/final" }); return res.end(); }
    if (req.url === "/final") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html><head><title>Final</title></head><body><h1>Landed</h1></body></html>"); }
    if (req.url === "/a") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html><head><title>A</title></head><body><h1>A</h1></body></html>"); }
    if (req.url === "/loop") { res.writeHead(302, { Location: "/loop" }); return res.end(); }
    if (req.url === "/slow") { return; } // never responds
    res.writeHead(404); res.end("gone");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("a redirect is followed wherever it leads, off the origin included, unlike fetch and map", async (t) => {
  const base = await serveSite(t);
  const other = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html><head><title>Elsewhere</title></head><body>ok</body></html>"); });
  await new Promise((done) => other.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => other.close(done)));
  const otherBase = `http://127.0.0.1:${other.address().port}`;

  const server3 = createServer((req, res) => { res.writeHead(302, { Location: `${otherBase}/` }); res.end(); });
  await new Promise((done) => server3.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server3.close(done)));
  const crossOriginRedirector = `http://127.0.0.1:${server3.address().port}`;

  const policy = new Policy({ allowLive: true, log: quiet });
  const r = await scrapeUrl({ url: crossOriginRedirector, policy, formats: ["markdown", "json"] });
  assert.equal(r.ok, true);
  assert.equal(r.url, `${otherBase}/`, "the scrape landed on the other origin, not refused for leaving the first");
  assert.match(r.markdown, /^ok$/m, "the other origin's own body was actually read");
  assert.equal(JSON.parse(r.json).title, "Elsewhere", "and its head was read too");
});

test("a redirect loop and a url that answers with nothing are each named, not hung on forever", async (t) => {
  const base = await serveSite(t);
  const policy = new Policy({ allowLive: true, log: quiet });
  const loop = await scrapeUrl({ url: `${base}/loop`, policy, formats: ["markdown"] });
  assert.equal(loop.ok, false);
  assert.match(loop.error, /more than five redirects/);
  const slow = await scrapeUrl({ url: `${base}/slow`, policy, formats: ["markdown"], timeoutMs: 50 });
  assert.equal(slow.ok, false);
  assert.match(slow.error, /no answer within 50 ms/);
});

test("only http and https are scraped; anything else is refused by name, not attempted", async () => {
  const policy = new Policy({ allowLive: true, log: quiet });
  const r = await scrapeUrl({ url: "ftp://example.com/", policy, formats: ["markdown"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /http or https/);
});

test("the gates hold: no live calls without --allow-live, offline outranks it", async (t) => {
  const base = await serveSite(t);
  await assert.rejects(() => scrapeUrl({ url: `${base}/a`, policy: new Policy({ log: quiet }), formats: ["markdown"] }), /Live calls are off by default/);
  await assert.rejects(() => scrapeUrl({ url: `${base}/a`, policy: new Policy({ allowLive: true, offline: true, log: quiet }), formats: ["markdown"] }), /This run is offline/);
});

test("a batch keeps going past a domain the attestation does not cover, failing only that url", async (t) => {
  const base = await serveSite(t);
  const policy = new Policy({ allowLive: true, allowedDomains: ["127.0.0.1"], log: quiet });
  const results = await batchScrape({ urls: [`${base}/a`, "http://elsewhere.example/x"], policy, formats: ["markdown"] });
  const byUrl = Object.fromEntries(results.map((r) => [r.url, r]));
  assert.equal(byUrl[`${base}/a`].ok, true);
  assert.equal(byUrl["http://elsewhere.example/x"].ok, false);
  assert.match(byUrl["http://elsewhere.example/x"].error, /The attestation authorizes/);
});

test("a batch stops outright when live calls are off entirely, since every url would fail the identical way", async (t) => {
  const base = await serveSite(t);
  await assert.rejects(() => batchScrape({ urls: [`${base}/a`], policy: new Policy({ log: quiet }), formats: ["markdown"] }), /Live calls are off by default/);
});

test("formats parse to their canonical names, and screenshot is refused by name; this plugin renders no page as pixels", () => {
  assert.deepEqual(parseFormats("md"), ["markdown"]);
  assert.deepEqual(parseFormats("markdown, JSON"), ["markdown", "json"]);
  assert.deepEqual(parseFormats(undefined), ["markdown"]);
  assert.throws(() => parseFormats("screenshot"), /needs a real browser/, "a real browser, not this zero dependency tool, renders pixels");
  assert.throws(() => parseFormats("pdf"), /--format must be markdown, html or json/);
  assert.ok(plugin.commands.scrape);
  assert.match(plugin.commands.scrape.describe, /--allow-live and portamp\.authorization\.json/);
  assert.match(plugin.commands["batch-scrape"].describe, /--allow-live and portamp\.authorization\.json/);
});

test("a batch writes one file per url per format under the output directory, and BATCH.md names every refusal", async (t) => {
  const base = await serveSite(t);
  const policy = new Policy({ allowLive: true, log: quiet });
  const cwd = await mkdtemp(join(tmpdir(), "portamp-scrape-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "portamp.authorization.json"), JSON.stringify({ owner: "Test", authorizedBy: "J. Doe", basis: "test" }));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  t.after(() => process.chdir(originalCwd));

  const args = { _: ["batch-scrape", `${base}/a`, `${base}/nope`], format: "markdown,json", out: "./out", concurrency: 2 };
  const result = await plugin.commands["batch-scrape"].run({ log: quiet, policy, args });
  assert.equal(result.length, 2);
  const md = await readFile(join(cwd, "out", "BATCH.md"), "utf8");
  assert.match(md, /^# The batch\n/);
  assert.match(md, /1 scraped, 1 refused/);
  // /a has no extension of its own, so it lands as a folder's index, the same rule fetch and map's localPath already uses.
  const written = await readFile(join(cwd, "out", "a", "index.md"), "utf8");
  assert.match(written, /^# A$/m);
  const asJson = JSON.parse(await readFile(join(cwd, "out", "a", "index.json"), "utf8"));
  assert.equal(asJson.title, "A");
  const manifest = JSON.parse(await readFile(join(cwd, "out", "portamp.batch.json"), "utf8"));
  assert.equal(manifest.filter((r) => r.ok).length, 1);
});

test("without an attestation beside the run, neither command scrapes anything", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "portamp-scrape-noatt-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  t.after(() => process.chdir(originalCwd));
  const policy = new Policy({ allowLive: true, log: quiet });
  await assert.rejects(
    () => plugin.commands.scrape.run({ log: quiet, policy, args: { _: ["scrape", "http://127.0.0.1:1/x"] } }),
    /needs portamp\.authorization\.json beside the run/
  );
  await assert.rejects(
    () => plugin.commands["batch-scrape"].run({ log: quiet, policy, args: { _: ["batch-scrape", "http://127.0.0.1:1/x"] } }),
    /needs portamp\.authorization\.json beside the run/
  );
});
