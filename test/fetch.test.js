import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Policy } from "../src/core/policy.js";
import plugin, { fetchForRun, readAttestation } from "../plugins/input-fetch/index.js";
import { cssLinks, fetchSite, linksIn, localPath, robotsDisallow } from "../plugins/input-fetch/fetch.js";
import { runPipeline } from "./helpers.js";

/**
 * A site you can reach but do not have is the no source path with the
 * network as the source. input-fetch copies one origin, link by link to a
 * depth, honouring robots.txt, saving pages byte for byte with their assets
 * under the paths the site served them at, and writing down every request it
 * skipped and why. It stands behind the recorder's two gates: --allow-live,
 * and an attestation naming who owns the system. The site here is a local
 * server the test starts; nothing leaves the machine.
 */

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

const SITE = {
  "/robots.txt": ["text/plain", "User-agent: *\nDisallow: /private\n"],
  "/": ["text/html", `<!doctype html><html><head><title>Acme &amp; Co</title><link rel="stylesheet" href="/css/site.css"><script src="/js/app.js"></script></head><body><nav><a href="/about">About</a> <a href="/products/">Products</a> <a href="/private/report">Report</a> <a href="https://cdn.example.net/lib.js">cdn</a> <a href="mailto:x@y">mail</a></nav><img src="/img/logo.png" alt="Acme"><form action="/search" method="get"><input name="q"></form></body></html>`],
  "/about": ["text/html", `<html><head><title>About</title></head><body><a href="/">Home</a> <a href="/team?dept=sales">Sales</a> <a href="/deep/one">Deep</a><a href="/old">Old</a></body></html>`],
  "/products/": ["text/html", `<html><head><title>Products</title></head><body><a href="/products/widget.html">Widget</a></body></html>`],
  "/products/widget.html": ["text/html", `<html><head><title>Widget</title></head><body>a widget</body></html>`],
  "/team?dept=sales": ["text/html", `<html><head><title>Sales</title></head><body>team</body></html>`],
  "/deep/one": ["text/html", `<html><head><title>One</title></head><body><a href="/deep/two">Two</a></body></html>`],
  "/deep/two": ["text/html", `<html><head><title>Two</title></head><body>too deep</body></html>`],
  "/css/site.css": ["text/css", `@import url("/css/print.css"); body { background: url(/img/bg.png); font-family: F; } @font-face { src: url("/fonts/f.woff2"); }`],
  "/css/print.css": ["text/css", `@media print { nav { display: none } }`],
  "/js/app.js": ["text/javascript", `console.log("hi")`],
  "/img/logo.png": ["image/png", "PNG-BYTES"],
  "/img/bg.png": ["image/png", "BG"],
  "/fonts/f.woff2": ["font/woff2", "WOFF"],
  "/private/report": ["text/html", `<html><body>secret</body></html>`],
};

async function serveSite(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    if (req.url === "/old") { res.writeHead(301, { Location: "/about" }); return res.end(); }
    if (req.url === "/away") { res.writeHead(302, { Location: "https://elsewhere.example.org/x" }); return res.end(); }
    if (req.url === "/big") { res.writeHead(200, { "Content-Type": "text/html", "Content-Length": String(20 * 1024 * 1024) }); return res.end(); }
    const hit = SITE[req.url];
    if (!hit) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end("<h1>gone</h1>"); }
    res.writeHead(200, { "Content-Type": hit[0] });
    res.end(hit[1]);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise((done) => server.close(done)));
  return { base: `http://127.0.0.1:${server.address().port}`, hits };
}

test("a URL's local path, a page's links, a stylesheet's urls and robots.txt rules are read as the format means them", () => {
  assert.equal(localPath("http://x/"), "index.html");
  assert.equal(localPath("http://x/about"), "about/index.html", "a page with no extension is a folder's index, so relative links still resolve");
  assert.equal(localPath("http://x/products/"), "products/index.html");
  assert.equal(localPath("http://x/a/b.html"), "a/b.html");
  assert.equal(localPath("http://x/css/site.css"), "css/site.css");
  assert.match(localPath("http://x/team?dept=sales&x=1"), /^team\/index~dept_sales_x_1-[0-9a-f]{6}\.html$/, "a query string names another document and stays in the name, with a hash of the exact string");
  assert.notEqual(localPath("http://x/p?q=a%20b"), localPath("http://x/p?q=a_20b"), "two queries that clean to the same letters land in two files");
  assert.equal(localPath("http://x/docs/%zz"), "docs/%zz/index.html", "a literal percent that is not an escape is kept, not thrown on");
  assert.equal(localPath("http://x/../../etc/passwd"), "etc/passwd/index.html", "the URL parser has already collapsed the climb");
  const links = linksIn(`<a href="/a">a</a><a href='b.html'>b</a><a href=#top>t</a><a href="javascript:void(0)">j</a><link rel="stylesheet" href="s.css"><link rel="canonical" href="/canon"><script src="/j.js"></script><img src="i.png" srcset="i2.png 2x, i3.png 3x"><form action="/go"><!-- <a href="/commented">x</a> -->`, "http://x/dir/page.html");
  assert.deepEqual(links, [
    { url: "http://x/a", kind: "page" }, { url: "http://x/dir/b.html", kind: "page" },
    { url: "http://x/dir/s.css", kind: "asset" }, { url: "http://x/j.js", kind: "asset" },
    { url: "http://x/dir/i.png", kind: "asset" }, { url: "http://x/dir/i2.png", kind: "asset" }, { url: "http://x/dir/i3.png", kind: "asset" },
    { url: "http://x/go", kind: "form" },
  ], "anchors, stylesheets, scripts, images and srcsets are links; a fragment, a script scheme, a canonical and a commented out link are not");
  assert.deepEqual(cssLinks(`@import "a.css"; .x{background:url(  "../i.png" )} .y{background:url(data:image/png;base64,AAAA)} @font-face{src:url(f.woff2) format("woff2")}`, "http://x/css/s.css").map((l) => l.url), ["http://x/css/a.css", "http://x/i.png", "http://x/css/f.woff2"]);
  assert.deepEqual(robotsDisallow("User-agent: googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /private # secret\nDisallow: /tmp/\nAllow: /\n"), ["/private", "/tmp/"], "only rules for every agent (or for portamp) apply");
  assert.deepEqual(robotsDisallow("User-agent: portamp\nDisallow: /no\n"), ["/no"]);
});

test("the copy takes one origin to a depth, honours robots.txt, keeps assets a stylesheet names, and writes down every skip", async (t) => {
  const { base, hits } = await serveSite(t);
  const dir = await mkdtemp(join(tmpdir(), "portamp-fetch-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const policy = new Policy({ allowLive: true, allowedDomains: ["acme.example"], log: quiet });
  const m = await fetchSite({ url: `${base}/`, dir, policy, log: quiet, depth: 2, maxPages: 50 });
  assert.deepEqual(m.pages.map((p) => p.file.replace(/-[0-9a-f]{6}\.html$/, ".html")).sort(), ["about/index.html", "deep/one/index.html", "index.html", "products/index.html", "products/widget.html", "team/index~dept_sales.html"]);
  assert.equal(m.pages.find((p) => p.file === "index.html").title, "Acme &amp; Co", "the title is recorded as served, not decoded");
  assert.deepEqual(m.assets.map((a) => a.file).sort(), ["css/print.css", "css/site.css", "fonts/f.woff2", "img/bg.png", "img/logo.png", "js/app.js"], "the stylesheet's own import, background and font are fetched too");
  assert.equal(await readFile(join(dir, "index.html"), "utf8"), SITE["/"][1], "a page is saved byte for byte");
  assert.equal(await readFile(join(dir, "img/logo.png"), "utf8"), "PNG-BYTES");
  const reasons = Object.fromEntries(m.skipped.map((s) => [s.url.replace(base, ""), s.reason]));
  assert.equal(reasons["/private/report"], "disallowed by robots.txt");
  assert.equal(reasons["/deep/two"], "beyond depth 2");
  assert.ok(!hits.includes("/private/report") && !hits.includes("/deep/two"), "what is skipped is never requested");
  assert.deepEqual(m.redirects, [{ from: `${base}/old`, to: `${base}/about` }], "a redirect is followed on the origin and recorded");
  assert.match(reasons["/old"], /^redirected to http:\/\/127\.0\.0\.1:\d+\/about, which is saved under its own address$/, "the page is saved once, under the address it lives at");
  assert.deepEqual(m.external, ["cdn.example.net"], "another host is named, never fetched");
  assert.deepEqual(m.forms, ["/search"], "a form's action is recorded, never submitted");
  assert.deepEqual(m.robots, [{ allow: false, pattern: "/private" }]);
  assert.ok(!hits.some((h) => /cdn|elsewhere/.test(h)));
  const md = await readFile(join(dir, "FETCH.md"), "utf8");
  assert.match(md, /^# The copy\n/); assert.match(md, /\| http:\/\/127\.0\.0\.1:\d+\/about \| about\/index\.html \| 1 \| \d+ \| 4 \| About \|/);
  assert.match(md, /\| http:\/\/127\.0\.0\.1:\d+\/private\/report \| disallowed by robots\.txt \|/);
  assert.match(md, /- cdn\.example\.net/); assert.match(md, /- Disallow: \/private/);
  const manifest = JSON.parse(await readFile(join(dir, "portamp.fetch.json"), "utf8"));
  assert.equal(manifest.pages.length, 6);
});

test("the limits hold and are named: a page limit, a byte limit, a file too big, a 404, a redirect off the origin, no answer", async (t) => {
  const { base } = await serveSite(t);
  const dir = await mkdtemp(join(tmpdir(), "portamp-fetch-limits-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const policy = new Policy({ allowLive: true, log: quiet });
  const few = await fetchSite({ url: `${base}/`, dir: join(dir, "few"), policy, log: quiet, depth: 3, maxPages: 2 });
  assert.equal(few.pages.length, 2);
  assert.ok(few.skipped.some((s) => /over the page limit of 2/.test(s.reason)));
  const small = await fetchSite({ url: `${base}/`, dir: join(dir, "small"), policy, log: quiet, depth: 3, maxBytes: 700 });
  assert.ok(small.skipped.some((s) => /over the byte limit of 700/.test(s.reason)), "the byte limit stops the copy and says so");
  const slow = await fetchSite({ url: `${base}/`, dir: join(dir, "slow"), policy, log: quiet, depth: 1, timeoutMs: 1, fetchImpl: (u, o) => new Promise((_, fail) => o.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; fail(e); })) });
  assert.equal(slow.pages.length, 0);
  assert.ok(slow.skipped.some((s) => /no answer within 1 ms/.test(s.reason)));
  const gone = await fetchSite({ url: `${base}/nope`, dir: join(dir, "gone"), policy, log: quiet });
  assert.deepEqual(gone.skipped.map((s) => s.reason), ["HTTP 404"]);
  const big = await fetchSite({ url: `${base}/big`, dir: join(dir, "big"), policy, log: quiet });
  assert.match(big.skipped[0].reason, /over the file limit/);
  // A redirect off the origin is recorded and never followed: the other host sees no request at all.
  const asked = [];
  const away = await fetchSite({ url: `${base}/away`, dir: join(dir, "away"), policy, log: quiet, fetchImpl: (u, o) => { asked.push(u); return fetch(u, o); } });
  assert.ok(away.skipped.some((s) => /redirected off the origin to elsewhere\.example\.org/.test(s.reason)));
  assert.deepEqual(away.external, ["elsewhere.example.org"]);
  assert.ok(asked.every((u) => u.startsWith(base)), `no request left the origin: ${asked.join(" ")}`);
});

test("the gates hold: no live calls without --allow-live, no domain outside the attestation, offline outranks both, no attestation no copy", async (t) => {
  const { base, hits } = await serveSite(t);
  const dir = await mkdtemp(join(tmpdir(), "portamp-fetch-gates-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(() => fetchSite({ url: `${base}/`, dir, policy: new Policy({ log: quiet }), log: quiet }), /Live calls are off by default/);
  await assert.rejects(() => fetchSite({ url: `${base}/`, dir, policy: new Policy({ allowLive: true, offline: true, log: quiet }), log: quiet }), /This run is offline/);
  await assert.rejects(() => fetchSite({ url: "http://acme.example/", dir, policy: new Policy({ allowLive: true, allowedDomains: ["other.example"], log: quiet }), log: quiet }), /The attestation authorizes other\.example/);
  await assert.rejects(() => fetchSite({ url: "ftp://acme.example/", dir, policy: new Policy({ allowLive: true, log: quiet }), log: quiet }), /only http and https/);
  assert.equal(hits.length, 0, "a refused copy sends no request at all");
  const cwd = await mkdtemp(join(tmpdir(), "portamp-fetch-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  assert.match((await readAttestation(cwd)).error, /no portamp\.authorization\.json/);
  await assert.rejects(() => fetchForRun({ url: `${base}/`, dir, cwd, policy: new Policy({ allowLive: true, log: quiet }), log: quiet }), /needs portamp\.authorization\.json beside the run/);
  assert.equal(hits.length, 0);
  await writeFile(join(cwd, "portamp.authorization.json"), JSON.stringify({ owner: "Acme", authorizedBy: "J. Doe", basis: "engagement" }));
  const m = await fetchForRun({ url: `${base}/`, dir, cwd, policy: new Policy({ allowLive: true, log: quiet }), log: quiet, depth: 0 });
  assert.equal(m.attestedBy, "J. Doe"); assert.equal(m.pages.length, 1);
  assert.equal(typeof plugin.commands.fetch.run, "function"); assert.match(plugin.commands.fetch.describe, /--allow-live and portamp\.authorization\.json/);
});

test("a copied site ports as a site, and the copy's gaps become the run's notes", async (t) => {
  const { base } = await serveSite(t);
  const dir = await mkdtemp(join(tmpdir(), "portamp-fetch-port-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await fetchSite({ url: `${base}/`, dir, policy: new Policy({ allowLive: true, log: quiet }), log: quiet, depth: 2 });
  const run = await runPipeline({ src: dir, site: true, offline: true });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.equal(run.ctx.fetched.start, `${base}/`);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /The source is a copy of http:\/\/127\.0\.0\.1:\d+\/ fetched \d{4}-\d\d-\d\dT[\d:.]+Z, as an anonymous visitor/);
  assert.match(notes, /3 request\(s\) were skipped while copying \(disallowed by robots\.txt; beyond depth 2; redirected to http:\/\/127\.0\.0\.1:\d+\/about, which is saved under its own address\)/);
  assert.match(notes, /leaned on 1 other host\(s\) \(cdn\.example\.net\)/);
  assert.ok(run.ctx.site?.pages?.length >= 3, `the copied pages are the site: ${run.ctx.site?.pages?.length}`);
  assert.ok(run.ctx.written.some((f) => /src\/app\/router|serve\.js/.test(f)), "the site engine built the shell around the copy");
});
