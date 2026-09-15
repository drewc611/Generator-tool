import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Policy } from "../src/core/policy.js";
import plugin, { searchWeb } from "../plugins/general-search/index.js";
import { buildSearchUrl, parseDuckDuckGoHtml, searchReport, SUPPORTED_ENGINES } from "../plugins/general-search/search.js";

/**
 * Search reads a query from a search engine's own results page, the same
 * dependency free, no browser restraint as scrape and batch-scrape, standing
 * behind the identical --allow-live and portamp.authorization.json gates.
 * One engine is read, DuckDuckGo's no-JS HTML endpoint; the fixtures below
 * mirror its real result__body / result__a / result__snippet vocabulary so
 * the parser is proven against genuine structure, not a strawman. Nothing
 * here calls the real duckduckgo.com: a fetchImpl stands in for it.
 */

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

function resultsPage(results) {
  const body = results
    .map(
      (r) => `<div class="result results_links web-result"><div class="links_main result__body">
        <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}">${r.title}</a></h2>
        <a class="result__snippet">${r.snippet ?? ""}</a>
      </div></div>`
    )
    .join("\n");
  return `<!doctype html><html><body><div class="results">${body}</div></body></html>`;
}

/** A local server standing in for html.duckduckgo.com, and the fetchImpl that redirects any request to that host onto it. */
async function serveEngine(t, handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  return (url, opts) => {
    const u = new URL(url);
    if (u.hostname === "html.duckduckgo.com") return realFetch(base + u.pathname + u.search, opts);
    return realFetch(url, opts);
  };
}

async function serveContent(t) {
  const server = createServer((req, res) => {
    if (req.url === "/page1") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html><head><title>Page One</title></head><body><p>First body.</p></body></html>"); }
    if (req.url === "/page2") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html><head><title>Page Two</title></head><body><p>Second body.</p></body></html>"); }
    res.writeHead(404); res.end("gone");
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  return `http://127.0.0.1:${server.address().port}`;
}

/* --------------------------------------------------------- search.js */

test("a well formed DuckDuckGo results page yields title, decoded url and snippet in rank order", () => {
  const html = resultsPage([
    { url: "https://example.com/a", title: "First &amp; Result", snippet: "A snippet." },
    { url: "https://example.org/b", title: "Second Result", snippet: "Another <b>snippet</b>." },
  ]);
  const { results, unrecognized } = parseDuckDuckGoHtml(html);
  assert.equal(unrecognized, false);
  assert.deepEqual(results, [
    { title: "First & Result", url: "https://example.com/a", snippet: "A snippet." },
    { title: "Second Result", url: "https://example.org/b", snippet: "Another snippet." },
  ]);
});

test("a results page carrying none of the vocabulary this reader recognises is named unrecognised, not read as zero results", () => {
  const { results, unrecognized } = parseDuckDuckGoHtml("<html><body><p>a wholly different page shape</p></body></html>");
  assert.deepEqual(results, []);
  assert.equal(unrecognized, true);
});

test("buildSearchUrl encodes the query and refuses an engine this reader does not know", () => {
  assert.equal(buildSearchUrl("duckduckgo", "a b"), "https://html.duckduckgo.com/html/?q=a%20b");
  assert.deepEqual(SUPPORTED_ENGINES, ["duckduckgo"]);
  assert.throws(() => buildSearchUrl("bing", "x"), /--engine must be one of duckduckgo, not bing/);
});

test("the search report lists every result by rank with its url and snippet, pipes and backslashes escaped", () => {
  const report = searchReport("q", "duckduckgo", [{ title: "A | B", url: "https://x/", snippet: "s\\t" }]);
  assert.match(report, /^# The search\n/);
  assert.match(report, /"q" on duckduckgo, 1 result\(s\)\./);
  assert.match(report, /\| 1 \| A \\\| B \| https:\/\/x\/ \| s\\\\t \|/);
});

/* --------------------------------------------------------- index.js: searchWeb */

test("a query is answered from the engine's own results page, ranked and limited", async (t) => {
  const fetchImpl = await serveEngine(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(resultsPage([
      { url: "https://one.example/", title: "One" },
      { url: "https://two.example/", title: "Two" },
      { url: "https://three.example/", title: "Three" },
    ]));
  });
  const policy = new Policy({ allowLive: true, log: quiet });
  const result = await searchWeb({ query: "test", policy, fetchImpl, limit: 2 });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results.map((r) => r.title), ["One", "Two"]);
});

test("with --scrape true, each result is read the way scrape reads any url, index for index", async (t) => {
  const contentBase = await serveContent(t);
  const fetchImpl = await serveEngine(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(resultsPage([
      { url: `${contentBase}/page1`, title: "One" },
      { url: `${contentBase}/page2`, title: "Two" },
    ]));
  });
  const policy = new Policy({ allowLive: true, log: quiet });
  const result = await searchWeb({ query: "test", policy, fetchImpl, scrape: true, formats: ["markdown"] });
  assert.equal(result.ok, true);
  assert.equal(result.results[0].scraped.ok, true);
  assert.match(result.results[0].scraped.markdown, /First body\./);
  assert.equal(result.results[1].scraped.ok, true);
  assert.match(result.results[1].scraped.markdown, /Second body\./);
});

test("a results page that does not match the expected shape is named, not silently returned as zero results", async (t) => {
  const fetchImpl = await serveEngine(t, (req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<html><body>nothing recognisable</body></html>"); });
  const policy = new Policy({ allowLive: true, log: quiet });
  const result = await searchWeb({ query: "test", policy, fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /did not match the structure this reader expects/);
});

test("the gates hold: no live calls without --allow-live, offline outranks it", async (t) => {
  const fetchImpl = await serveEngine(t, (req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(resultsPage([])); });
  await assert.rejects(() => searchWeb({ query: "x", policy: new Policy({ log: quiet }), fetchImpl }), /Live calls are off by default/);
  await assert.rejects(() => searchWeb({ query: "x", policy: new Policy({ allowLive: true, offline: true, log: quiet }), fetchImpl }), /This run is offline/);
});

/* --------------------------------------------------------- index.js: the command */

test("the search command describes its gates, and refuses an unknown engine before asking for an attestation", async (t) => {
  assert.match(plugin.commands.search.describe, /--allow-live and portamp\.authorization\.json/);
  const cwd = await mkdtemp(join(tmpdir(), "portamp-search-noatt-"));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  t.after(async () => { process.chdir(originalCwd); await rm(cwd, { recursive: true, force: true }); });
  const policy = new Policy({ allowLive: true, log: quiet });
  await assert.rejects(
    () => plugin.commands.search.run({ log: quiet, policy, args: { _: ["search", "x"], engine: "bing" } }),
    /--engine must be one of duckduckgo, not bing/,
    "no portamp.authorization.json exists here either, but the bad engine name is the caller's own mistake and is refused first"
  );
});

test("without an attestation beside the run, search reads nothing", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "portamp-search-noatt2-"));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  t.after(async () => { process.chdir(originalCwd); await rm(cwd, { recursive: true, force: true }); });
  const policy = new Policy({ allowLive: true, log: quiet });
  await assert.rejects(
    () => plugin.commands.search.run({ log: quiet, policy, args: { _: ["search", "hello", "world"] } }),
    /needs portamp\.authorization\.json beside the run/
  );
});

test("a run writes SEARCH.md and portamp.search.json, and the scraped/ folder when --scrape true", async (t) => {
  const contentBase = await serveContent(t);
  const fetchImpl = await serveEngine(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(resultsPage([{ url: `${contentBase}/page1`, title: "One", snippet: "s" }]));
  });
  const cwd = await mkdtemp(join(tmpdir(), "portamp-search-cwd-"));
  await writeFile(join(cwd, "portamp.authorization.json"), JSON.stringify({ owner: "Test", authorizedBy: "J. Doe", basis: "test" }));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  t.after(async () => { process.chdir(originalCwd); await rm(cwd, { recursive: true, force: true }); });

  const policy = new Policy({ allowLive: true, log: quiet });
  const args = { _: ["search", "hello", "world"], out: "./out", scrape: "true", format: "markdown" };
  const result = await plugin.commands.search.run({ log: quiet, policy, args, fetchImpl });
  assert.equal(result.results.length, 1);

  const md = await readFile(join(cwd, "out", "SEARCH.md"), "utf8");
  assert.match(md, /^# The search\n/);
  assert.match(md, /"hello world" on duckduckgo, 1 result\(s\)\./);
  assert.match(md, /\| 1 \| One \| .*\/page1 \| s \|/);

  const manifest = JSON.parse(await readFile(join(cwd, "out", "portamp.search.json"), "utf8"));
  assert.equal(manifest.query, "hello world");
  assert.equal(manifest.results[0].scraped.ok, true);

  const scrapedMd = await readFile(join(cwd, "out", "scraped", "page1", "index.md"), "utf8");
  assert.match(scrapedMd, /First body\./);
});
