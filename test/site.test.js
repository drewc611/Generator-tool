import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  stripServerBlocks, resolveSsi, lowerLegacyHtml, readHead, readFrameset, layoutTables,
  localAssets, imagemapLinks,
} from "../plugins/input-static/lower.js";
import { readPage, resolveLink, routeFor, sharedChrome } from "../plugins/input-static/index.js";
import { buildIr, DIALECTS } from "../plugins/dsp-ir/ir.js";
import { translate } from "../plugins/output-react/template.js";
import { ROOT, runPipeline } from "./helpers.js";

/* ------------------------------------------------- lowering the old web */

test("server blocks are removed and counted, never guessed at", () => {
  const notes = [];
  const out = stripServerBlocks(`<p>a</p><?php echo secret(); ?><p>b</p><% Response.Write(x) %>`, (n) => notes.push(n));
  assert.equal(out, "<p>a</p><p>b</p>");
  assert.match(notes[0], /2 server side block/);
});

test("an SSI include resolves from the run's own tree and a missing one is a named gap", () => {
  const notes = [];
  const resolve = (name) => (name === "footer.inc" ? "<footer>f</footer>" : null);
  assert.equal(resolveSsi(`<!--#include virtual="footer.inc" -->`, resolve, (n) => notes.push(n)), "<footer>f</footer>");
  assert.equal(resolveSsi(`<!--#include file="gone.inc" -->`, resolve, (n) => notes.push(n)), "");
  assert.match(notes[0], /gone\.inc/);
});

test("font, center and marquee lower to exact CSS, with the motion dropped and said", () => {
  const notes = [];
  const out = lowerLegacyHtml(
    `<center><font color="red" size="5">Hi</font></center><marquee>go</marquee>`,
    (n) => notes.push(n)
  );
  assert.match(out, /<div style="text-align: center"><span style="color: red; font-size: 24px">Hi<\/span><\/div>/);
  assert.match(out, /<span>go<\/span>/);
  assert.match(notes[0], /motion is dropped on purpose/);
});

test("the head is read for what the port must carry", () => {
  const head = readHead(`<head><title>t</title>
    <meta name="description" content="d">
    <meta http-equiv="refresh" content="0; url=new.html">
    <meta charset="ISO-8859-1">
    <base href="/deep/">
    <meta property="og:title" content="T">
    <link rel="stylesheet" href="style.css?v=3&cache=bust"></head>`);
  assert.equal(head.description, "d");
  assert.equal(head.refresh, "new.html");
  assert.equal(head.charset, "iso-8859-1");
  assert.equal(head.base, "/deep/");
  assert.deepEqual(head.og, { "og:title": "T" });
  assert.deepEqual(head.cssLinks, ["style.css"], "the cache busting query never reaches the disk lookup");
});

test("framesets, layout tables, local assets and imagemaps are all seen for what they are", () => {
  const fs = readFrameset(`<frameset><frame src="menu.html" name="menu"><frame src="main.html" name="main"></frameset>`);
  assert.equal(fs.main, "main.html");
  assert.equal(layoutTables(`<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>`), 1);
  assert.equal(layoutTables(`<table><tr><th>h</th></tr><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr></table>`), 0);
  assert.deepEqual(localAssets(`<img src="a.png"><img src="https://cdn.example/b.png">`), ["a.png"]);
  assert.deepEqual(imagemapLinks(`<map><area href="zone.html" alt="The zone"></map>`), [{ href: "zone.html", label: "The zone" }]);
});

/* ------------------------------------------------------ reading a page */

test("a php page is the HTML the server sent, its blocks stripped and named", () => {
  const notes = [];
  const page = readPage(`<html><head><title>Old</title></head><body><?php echo x(); ?><h1>Hi</h1></body></html>`, "index.php", { note: (n) => notes.push(n) });
  assert.ok(page.screen);
  assert.match(page.screen.template, /<h1>Hi<\/h1>/);
  assert.ok(!/php/.test(page.screen.template));
  assert.match(page.screen.templateOrigin, /server page/);
});

test("a plain html page with erb or underscore markers still belongs to its own reader", () => {
  assert.ok(readPage(`<body><% print(x) %></body>`, "a.html").skip);
});

test("links resolve the way a browser resolves them", () => {
  assert.equal(resolveLink("sub/page.html", "../about.html"), "about.html");
  assert.equal(resolveLink("a.html", "b.html"), "b.html");
  assert.equal(resolveLink("deep/a.html", "b.html"), "deep/b.html");
  // A base href pointing off the tree cannot be checked, so the page's own
  // directory stays the base and dead link detection judges the outcome.
  assert.equal(resolveLink("a.html", "b.html", "https://cdn.example/x/"), "b.html");
  assert.equal(routeFor("products/widget.html"), "/products/widget");
});

test("chrome shared verbatim across pages is found with the pages it sat on", () => {
  const pages = ["a.html", "b.html"].map((rel) => ({
    rel,
    screen: { template: `<nav id="n"><a href="a.html">A</a></nav><p>${rel}</p>` },
  }));
  const chrome = sharedChrome(pages);
  assert.equal(chrome.length, 1);
  assert.equal(chrome[0].tag, "nav");
  assert.deepEqual(chrome[0].on, ["a.html", "b.html"]);
});

/* ------------------------------------------- the old web in the IR */

test("inline events are events, with return spellings stripped and once left alone", () => {
  const ir = buildIr(`<button onclick="return save(); " once>Go</button>`, { dialect: DIALECTS.angularjs });
  assert.deepEqual(ir.root.events, [{ name: "click", handler: "save()", modifiers: [] }]);
});

test("a javascript: href was never a location, so it becomes the click it was", () => {
  const ir = buildIr(`<a href="javascript:openHelp();">?</a>`, { dialect: DIALECTS.angularjs });
  assert.deepEqual(ir.root.events, [{ name: "click", handler: "openHelp()", modifiers: [] }]);
  assert.ok(!ir.root.attrs.some((a) => a.name === "href"));
});

test("presentational attributes carry their exact CSS meaning", () => {
  const ir = buildIr(`<td bgcolor="#fff" align="CENTER" valign="top">x</td>`, { dialect: DIALECTS.angularjs });
  assert.deepEqual(ir.root.styles.map((s) => `${s.property}: ${s.literal}`), [
    "background-color: #fff", "text-align: center", "vertical-align: top",
  ]);
});

test("a multi statement inline handler reaches react as a block, not a syntax error", () => {
  const { jsx } = translate(`<button onclick="a(); b();">x</button>`, { dialect: DIALECTS.angularjs });
  assert.match(jsx, /onClick=\{\(\) => \{ a\(\); b\(\); \}\}/);
});

/* --------------------------------------------------- the site, end to end */

test("a folder of old pages becomes a React application architecture", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true });
  t.after(cleanup);
  assert.equal(error, null);

  // The shell: one route per page, each importing the component the run wrote.
  const app = await readFile(join(out, "src/app/App.jsx"), "utf8");
  for (const route of ["/", "/about", "/products", "/products/widget", "/contact", "/old", "/news-1", "/news-2"]) {
    assert.ok(app.includes(`path: "${route}"`), `App.jsx routes ${route}`);
  }
  assert.match(app, /import Home from "\.\.\/features\/Home\/Home\.jsx"/);

  // The chrome left the pages and landed in the layout, once.
  const layout = await readFile(join(out, "src/app/Layout.jsx"), "utf8");
  assert.match(layout, /<nav className="menu">/);
  assert.match(layout, /<footer className="fine-print">/);
  assert.match(layout, /<main>\{children\}<\/main>/);
  const home = await readFile(join(out, "src/features/Home/Home.jsx"), "utf8");
  assert.ok(!home.includes("<nav"), "the page lost its nav to the layout");
  assert.ok(!home.includes("<footer"), "the page lost its footer to the layout");
  assert.match(home, /href="\/news-1"/, "internal links became routes");
  assert.match(home, /src="\/logo\.svg"/, "a relative asset became the root path the copy answers at");

  // Old addresses keep working in every spelling.
  const redirects = JSON.parse(await readFile(join(out, "redirects.json"), "utf8"));
  assert.ok(redirects.some((r) => r.from === "/moved" && r.to === "/about" && r.kind === "meta refresh"));
  assert.ok(redirects.some((r) => r.from === "/about.html" && r.to === "/about" && r.kind === "extension dropped"));
  assert.match(await readFile(join(out, "_redirects"), "utf8"), /\/moved \/about 301/);

  // Assets travel as bytes; the form's action moved to the API map.
  const svg = await readFile(join(out, "public/logo.svg"));
  assert.deepEqual(svg, await readFile(join(ROOT, "example/legacy-site/logo.svg")));
  const contact = await readFile(join(out, "src/features/Contact/Contact.jsx"), "utf8");
  assert.ok(!contact.includes("/cgi-bin/subscribe"), "no endpoint literal in the component");
  assert.ok(ctx.api.calls.some((c) => c.path === "/cgi-bin/subscribe" && c.method === "POST"));

  // The maps: graph with the orphan and the dead link named, frames read,
  // pagination proposed rather than performed.
  const siteMd = await readFile(join(out, "SITE.md"), "utf8");
  assert.match(siteMd, /Orphan route\(s\).*\/old/);
  assert.match(siteMd, /contact\.html → archive\.html/);
  assert.match(siteMd, /frames\.html framed/);
  assert.match(siteMd, /\/news\/:page/);
  assert.match(await readFile(join(out, "SITE_MAP.mmd"), "utf8"), /r_news_1 --> r_news_2/);

  // The emitted app is loadable: the matcher runs here, outside any browser.
  // Full stack: the port carries its own server, its scripts, and the tests
  // that hold both; the port's CI runs them where they land.
  assert.ok(ctx.written.includes("serve.js"));
  assert.ok(ctx.written.includes("tests/server.test.js"));
  const pkg = JSON.parse(await readFile(join(out, "package.json"), "utf8"));
  assert.equal(pkg.scripts.serve, "node serve.js");
  assert.match(await readFile(join(out, "serve.js"), "utf8"), /501/, "the API surface refuses honestly instead of inventing");

  // A file URL, because a bare Windows path reads as a protocol named c:.
  const { matchPath, resolveRedirect } = await import(pathToFileURL(join(out, "src/app/match.js")).href);
  assert.ok(matchPath("/products/widget", "/products/widget?from=old#top"));
  assert.deepEqual(matchPath("/news/:page", "/news/2").params, { page: "2" });
  const map = Object.fromEntries(redirects.filter((r) => r.to.startsWith("/")).map((r) => [r.from, r.to]));
  assert.equal(resolveRedirect(map, "/moved"), "/about");
  assert.equal(JSON.parse(await readFile(join(out, "package.json"), "utf8")).type, "module");
});

test("without --site the chrome stays a proposal and no shell is written", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ src: join(ROOT, "example/legacy-site") });
  t.after(cleanup);
  assert.equal(error, null);
  assert.ok(!ctx.written.includes("src/app/App.jsx"));
  assert.ok(ctx.plan.notes.some((n) => /--site true makes it/.test(n)));
  const home = await readFile(join(out, "src/features/Home/Home.jsx"), "utf8");
  assert.ok(home.includes("<nav"), "the page keeps its chrome until a person or --site makes the cut");
});
