import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";

import { readEra } from "../plugins/dsp-era/index.js";
import { ROOT, runPipeline } from "./helpers.js";

const exec = promisify(execFile);

/**
 * The thirty seven, held. One run over the fixture with everything on, and
 * every claim below reads what that run actually wrote or serves.
 */

let run;
test.before(async () => {
  run = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true, export: true, pwa: true });
  assert.equal(run.error, null);
});
test.after(() => run?.cleanup());

const readOut = (rel) => readFile(join(run.out, rel), "utf8");

test("search: the port carries its own engine and the engine answers honestly", async () => {
  const { rank, nearestRoutes, stripBase, decideScroll } = await import(pathToFileURL(join(run.out, "src/app/match.js")).href);
  const { INDEX } = await import(pathToFileURL(join(run.out, "src/app/search-index.js")).href);
  assert.ok(rank(INDEX, "widget").includes("/products/widget"), "a word a page says finds that page");
  assert.deepEqual(rank(INDEX, ""), [], "an empty question gets an empty answer");
  assert.ok(rank(INDEX, "shed").length >= 2, "a word two pages say finds both");

  // did you mean, base paths, and scroll decisions are pure and provable
  assert.deepEqual(nearestRoutes(["/products", "/about", "/contact"], "/prodcts"), ["/products"]);
  assert.deepEqual(nearestRoutes(["/products"], "/utterly-unrelated-address"), [], "far means silence, not a guess");
  assert.equal(stripBase("/repo/about", "/repo"), "/about");
  assert.equal(stripBase("/about", "/"), "/about");
  assert.equal(decideScroll("team", "300"), "hash");
  assert.equal(decideScroll("", "300"), "saved");
  assert.equal(decideScroll("", null), "top");
});

test("the router grew manners: transitions, scroll memory, a base, a skip link", async () => {
  const router = await readOut("src/app/router.js");
  assert.match(router, /startViewTransition/);
  assert.match(router, /scrollRestoration/);
  assert.match(router, /sessionStorage/);
  assert.match(router, /stripBase/);
  const layout = await readOut("src/app/Layout.jsx");
  assert.match(layout, /Skip to content/);
  const crumbs = await readOut("src/app/Breadcrumbs.jsx");
  assert.match(crumbs, /aria-label="Breadcrumb"/);
  assert.match(crumbs, /aria-current="page"/);
});

test("not found offers three ways out: the guess, the search, the map", async () => {
  const nf = await readOut("src/app/NotFound.jsx");
  assert.match(nf, /nearestRoutes/);
  assert.match(nf, /Did you mean/);
  assert.match(nf, /role="search"/);
  assert.match(nf, /Nothing on this site mentions that\./, "an empty result says so instead of padding");
});

test("machines get the site in their own tongues", async () => {
  assert.match(await readOut("feed.xml"), /<rss version="2.0">/);
  assert.match(await readOut("feed.xml"), /<link>\/about<\/link>/);
  const llms = await readOut("llms.txt");
  assert.match(llms, /## Pages/);
  assert.match(llms, /### \/about/);
  assert.match(await readOut("humans.txt"), /portamp/);
  const vercel = JSON.parse(await readOut("vercel.json"));
  assert.ok(vercel.redirects.some((r) => r.source === "/moved" && r.destination === "/about" && r.permanent));
  assert.match(await readOut("netlify.toml"), /from = "\/moved"/);
});

test("identity survives: reading time, dark palette, social cards, print synthesis", async () => {
  const head = await readOut("src/app/head.js");
  assert.match(head, /readingMinutes: \d/);
  const dark = await readOut("public/theme-dark.css");
  assert.match(dark, /prefers-color-scheme: dark/);
  assert.match(dark, /--accent:/);
  // a page that declared no og:image gets a card drawn from its own title
  const card = await readOut("public/social/about.svg");
  assert.match(card, /About/);
  assert.match(head, /\/social\/about\.svg/);
  // the fixture brought print.css, so nothing was synthesized for it
  assert.ok(!run.ctx.written.includes("public/print-port.css"), "a site with its own print stylesheet keeps it");
});

test("the security policy allows exactly what the pages reach for", async () => {
  const headers = await readOut("_headers");
  assert.match(headers, /Content-Security-Policy: default-src 'self'/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  const md = await readOut("SECURITY_HEADERS.md");
  assert.match(md, /names the page that reached for it|allows nothing outside it/);
});

test("the site is weighed, drawn, and hashed", async () => {
  const stats = await readOut("SITE_STATS.md");
  assert.match(stats, /\| \/about \|/);
  assert.match(stats, /Heaviest: /);
  const svg = await readOut("SITE_MAP.svg");
  assert.match(svg, /<svg/);
  assert.match(svg, /\/about/);
  const ledger = JSON.parse(await readOut("LEDGER.json"));
  for (const r of ledger.decisions.routes) {
    assert.match(r.sourceSha256 ?? "", /^[0-9a-f]{64}$/, `${r.route} carries its birth certificate`);
  }
});

test("offline is opt in and caches exactly what the run wrote", async () => {
  const manifest = JSON.parse(await readOut("public/manifest.webmanifest"));
  assert.equal(manifest.name, "Acme Widgets — Home");
  const sw = await readOut("public/sw.js");
  assert.match(sw, /"\/about"/);
  assert.match(sw, /caches\.open/);
  assert.match(await readOut("index.html"), /serviceWorker/);
  // and without the flag, none of it exists
  const plain = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true });
  assert.ok(!plain.ctx.written.includes("public/sw.js"));
  await plain.cleanup();
});

test("the locale trees and the era are read as facts with evidence", async () => {
  const era = readEra([
    { rel: "a.html", text: `<frameset></frameset><font color="red">x</font>` },
    { rel: "b.css", text: "display: grid;" },
  ]);
  assert.ok(era.spread, "framesets beside grid is a site built across eras");
  assert.ok(era.signals.some((s) => s.id === "frameset"));
  assert.equal(readEra([]).verdict, null, "no signals, no verdict");
  assert.ok(run.ctx.era.verdict, "the fixture dates");
  assert.ok(run.ctx.written.includes("ERA.md"));
  assert.deepEqual(run.ctx.site.locales, { dirs: [], sharedPaths: 0 }, "no locale trees in this fixture, and it says so");
});

test("the dead links ceiling is a gate that only ever adds", async () => {
  const over = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true, maxDeadLinks: 0 });
  assert.ok(over.error, "one dead link against a ceiling of zero fails");
  assert.match(over.error.message, /ceiling of 0/);
  await over.cleanup();
});

test("audit vouches for a whole port and catches a hole", async () => {
  const cli = join(ROOT, "src/cli.js");
  const ok = await exec(process.execPath, [cli, "audit", "--out", run.out], { cwd: ROOT });
  assert.match(ok.stdout + ok.stderr, /agrees with its ledger/);
  const { rm } = await import("node:fs/promises");
  await rm(join(run.out, "src/features/About/About.jsx"));
  await assert.rejects(
    exec(process.execPath, [cli, "audit", "--out", run.out], { cwd: ROOT }),
    (e) => /names component About/.test(e.stdout + e.stderr)
  );
});

test("the server speaks modern http: gzip, etags, caching, health, the export", async () => {
  const { handler } = await import(pathToFileURL(join(run.out, "serve.js")).href);
  const server = createServer(handler());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.mode, "export", "the export outranks the raw tree");

    const first = await fetch(`${base}/style.css`);
    assert.ok(first.headers.get("etag"));
    assert.match(first.headers.get("cache-control"), /max-age/);
    const again = await fetch(`${base}/style.css`, { headers: { "if-none-match": first.headers.get("etag") } });
    assert.equal(again.status, 304, "an unchanged file costs a 304");

    const gz = await fetch(`${base}/about`, { headers: { "accept-encoding": "gzip" } });
    assert.match(gz.headers.get("cache-control") ?? "", /no-cache/, "markup never rests");
    const raw = Buffer.from(await gz.arrayBuffer());
    const body = gz.headers.get("content-encoding") === "gzip" ? gunzipSync(raw).toString() : raw.toString();
    assert.match(body, /<title>About Acme<\/title>/, "the exported page answers at its route");
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
