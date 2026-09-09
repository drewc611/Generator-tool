import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Policy } from "../src/core/policy.js";
import plugin, { runInstruction } from "../plugins/general-agent/index.js";
import { agentReport, FIELDS, interpretInstruction } from "../plugins/general-agent/instruction.js";

/**
 * Agent is a shared, honest rule based instruction engine, no free form AI:
 * interpretInstruction compiles a recognised phrasing to a scrape or search
 * recipe and runInstruction carries it out through general-scrape's and
 * general-search's own functions; a phrasing outside the small vocabulary
 * this reader knows, or one asking for a live browser action, is refused by
 * name rather than guessed at. Nothing here calls a real search engine or
 * a real site: local servers stand in for both.
 */

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

const FIXTURE_HTML = `<!doctype html><html><head><title>Widget Shop</title><meta name="description" content="Buy widgets"></head><body>
  <h1>Widgets</h1>
  <p>Contact <a href="mailto:sales@example.com">sales@example.com</a>. Price: $19.99.</p>
  <img src="/img/widget.png" alt="A widget">
  <a href="/about">About</a>
  <table><tr><th>Size</th><th>Price</th></tr><tr><td>Small</td><td>$9.99</td></tr></table>
</body></html>`;

async function serveContent(t, html = FIXTURE_HTML) {
  const server = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  return `http://127.0.0.1:${server.address().port}/`;
}

function resultsPage(results) {
  const body = results
    .map((r) => `<div class="result results_links web-result"><div class="links_main result__body">
      <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}">${r.title}</a></h2>
      <a class="result__snippet">${r.snippet ?? ""}</a>
    </div></div>`)
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

/* --------------------------------------------------------- instruction.js: field extractors */

test("every field reads its own plain structural fact off the page, nothing inferred", () => {
  const base = "https://shop.example.com/";
  assert.equal(FIELDS.title(FIXTURE_HTML), "Widget Shop");
  assert.equal(FIELDS.description(FIXTURE_HTML), "Buy widgets");
  assert.deepEqual(FIELDS.headings(FIXTURE_HTML), [{ level: 1, text: "Widgets" }]);
  assert.deepEqual(FIELDS.links(FIXTURE_HTML, base), [{ text: "About", url: "https://shop.example.com/about" }]);
  assert.deepEqual(FIELDS.images(FIXTURE_HTML, base), [{ src: "https://shop.example.com/img/widget.png", alt: "A widget" }]);
  assert.deepEqual(FIELDS.emails(FIXTURE_HTML), ["sales@example.com"]);
  assert.deepEqual(FIELDS.prices(FIXTURE_HTML), ["$19.99", "$9.99"]);
  assert.deepEqual(FIELDS.tables(FIXTURE_HTML), [[["Size", "Price"], ["Small", "$9.99"]]]);
  assert.match(FIELDS.text(FIXTURE_HTML), /Widgets/);
  assert.match(FIELDS.markdown(FIXTURE_HTML, base), /^# Widgets$/m);
});

/* --------------------------------------------------------- instruction.js: interpretInstruction */

test("fields named before or after the url are both read, and no fields at all defaults to the whole page", () => {
  const before = interpretInstruction("extract the title and description from https://example.com/about");
  assert.deepEqual(before, { ok: true, action: "scrape", url: "https://example.com/about", fields: ["title", "description"] });

  const after = interpretInstruction("scrape https://example.com/product and extract the title, price and links");
  assert.deepEqual(after, { ok: true, action: "scrape", url: "https://example.com/product", fields: ["title", "prices", "links"] });

  const bare = interpretInstruction("get https://example.com");
  assert.deepEqual(bare, { ok: true, action: "scrape", url: "https://example.com", fields: ["markdown"] });
});

test("field aliases resolve to their canonical name, deduplicated", () => {
  const r = interpretInstruction("get the link, links and urls from https://example.com");
  assert.deepEqual(r.fields, ["links"]);
});

test("search defaults to title and url, and a trailing field clause narrows it to what a result actually carries", () => {
  const plain = interpretInstruction("search for budgeting apps");
  assert.deepEqual(plain, { ok: true, action: "search", query: "budgeting apps", fields: ["title", "url"] });

  const narrowed = interpretInstruction("search for budgeting apps and get the titles and links");
  assert.deepEqual(narrowed, { ok: true, action: "search", query: "budgeting apps", fields: ["title", "url"] });
});

test("an instruction needing a live browser action is refused by name, pointing at input-record", () => {
  const r = interpretInstruction("click the button on https://example.com");
  assert.equal(r.ok, false);
  assert.match(r.error, /"click" needs a real browser session/);
  assert.match(r.error, /input-record/);
});

test("a field this reader does not know is refused by name, listing what it does understand", () => {
  const r = interpretInstruction("extract the flavor text from https://example.com");
  assert.equal(r.ok, false);
  assert.match(r.error, /does not recognise "the flavor text"/);
  assert.match(r.error, /understood fields are/);
});

test("a field a search result cannot carry is refused by name, rather than silently scraping every result to get it", () => {
  const r = interpretInstruction("search for cats and extract the flavor text");
  assert.equal(r.ok, false);
  assert.match(r.error, /a search result only carries title, url, snippet/);
});

test("a sentence with neither a url nor a search query is refused, naming the two shapes this reader understands", () => {
  const r = interpretInstruction("just some nonsense with no url");
  assert.equal(r.ok, false);
  assert.match(r.error, /no url and no "search for \.\.\." found/);
});

test("the agent report names the instruction, its recipe and its result", () => {
  const report = agentReport("get the title from https://x/", { action: "scrape", url: "https://x/", fields: ["title"], result: { title: "X" } });
  assert.match(report, /^# The instruction\n/);
  assert.match(report, /> get the title from https:\/\/x\//);
  assert.match(report, /action: scrape/);
  assert.match(report, /url: https:\/\/x\//);
  assert.match(report, /"title": "X"/);
});

/* --------------------------------------------------------- index.js: runInstruction */

test("a scrape instruction is carried out against the real page, and only the fields asked for come back", async (t) => {
  const base = await serveContent(t);
  const policy = new Policy({ allowLive: true, log: quiet });
  const r = await runInstruction({ instruction: `get the title and price from ${base}`, policy });
  assert.equal(r.ok, true);
  assert.equal(r.action, "scrape");
  assert.deepEqual(Object.keys(r.result).sort(), ["prices", "title"]);
  assert.equal(r.result.title, "Widget Shop");
  assert.deepEqual(r.result.prices, ["$19.99", "$9.99"]);
});

test("a search instruction is carried out against the engine's own results page", async (t) => {
  const contentBase = await serveContent(t);
  const fetchImpl = await serveEngine(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(resultsPage([{ url: contentBase, title: "Widget Shop", snippet: "Buy widgets" }]));
  });
  const policy = new Policy({ allowLive: true, log: quiet });
  const r = await runInstruction({ instruction: "search for widgets", policy, fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.action, "search");
  assert.deepEqual(r.result, [{ title: "Widget Shop", url: contentBase }]);
});

test("a refused instruction never reaches the network at all", async () => {
  const policy = new Policy({ allowLive: true, log: quiet });
  const r = await runInstruction({ instruction: "click the button on https://example.com", policy });
  assert.equal(r.ok, false);
  assert.match(r.error, /needs a real browser session/);
});

test("the gates hold: no live calls without --allow-live, offline outranks it", async (t) => {
  const base = await serveContent(t);
  await assert.rejects(
    () => runInstruction({ instruction: `get the title from ${base}`, policy: new Policy({ log: quiet }) }),
    /Live calls are off by default/
  );
  await assert.rejects(
    () => runInstruction({ instruction: `get the title from ${base}`, policy: new Policy({ allowLive: true, offline: true, log: quiet }) }),
    /This run is offline/
  );
});

/* --------------------------------------------------------- index.js: the command */

test("the agent command describes its gates, and refuses an instruction it cannot compile before asking for an attestation", async (t) => {
  assert.match(plugin.commands.agent.describe, /--allow-live and portamp\.authorization\.json/);
  const cwd = await mkdtemp(join(tmpdir(), "portamp-agent-noatt-"));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  t.after(async () => { process.chdir(originalCwd); await rm(cwd, { recursive: true, force: true }); });
  const policy = new Policy({ allowLive: true, log: quiet });
  await assert.rejects(
    () => plugin.commands.agent.run({ log: quiet, policy, args: { _: ["agent", "just", "nonsense"] } }),
    /no url and no "search for \.\.\." found/,
    "no portamp.authorization.json exists here either, but the uncompilable instruction is refused first"
  );
});

test("without an attestation beside the run, a compilable instruction still reads nothing", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "portamp-agent-noatt2-"));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  t.after(async () => { process.chdir(originalCwd); await rm(cwd, { recursive: true, force: true }); });
  const policy = new Policy({ allowLive: true, log: quiet });
  await assert.rejects(
    () => plugin.commands.agent.run({ log: quiet, policy, args: { _: ["agent", "get", "the", "title", "from", "http://127.0.0.1:1/x"] } }),
    /needs portamp\.authorization\.json beside the run/
  );
});

test("a run writes AGENT.md and portamp.agent.json under the output directory", async (t) => {
  const base = await serveContent(t);
  const cwd = await mkdtemp(join(tmpdir(), "portamp-agent-cwd-"));
  await writeFile(join(cwd, "portamp.authorization.json"), JSON.stringify({ owner: "Test", authorizedBy: "J. Doe", basis: "test" }));
  const originalCwd = process.cwd();
  process.chdir(cwd);
  t.after(async () => { process.chdir(originalCwd); await rm(cwd, { recursive: true, force: true }); });

  const policy = new Policy({ allowLive: true, log: quiet });
  const args = { _: ["agent", "get", "the", "title", "and", "price", "from", base], out: "./out" };
  const result = await plugin.commands.agent.run({ log: quiet, policy, args });
  assert.equal(result.result.title, "Widget Shop");

  const md = await readFile(join(cwd, "out", "AGENT.md"), "utf8");
  assert.match(md, /^# The instruction\n/);
  assert.match(md, /action: scrape/);

  const manifest = JSON.parse(await readFile(join(cwd, "out", "portamp.agent.json"), "utf8"));
  assert.equal(manifest.result.title, "Widget Shop");
});
