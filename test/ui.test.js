import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { buildRun, serve, previewPage, reportPage } from "../plugins/vis-ui/index.js";
import { ROOT, runPipeline } from "./helpers.js";

const ctxFor = async () => {
  const result = await runPipeline({ shots: join(ROOT, "example/screenshots") });
  return result;
};

test("the plugin is a vis plugin that registers the ui command", () => {
  assert.equal(plugin.class, "vis");
  assert.equal(typeof plugin.commands.ui.run, "function");
  assert.ok(plugin.commands.ui.describe);
});

test("no dependency was added", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies, {});
  const source = await readFile(join(ROOT, "plugins/vis-ui/index.js"), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:|from "\./, `${line.trim()} is not a node builtin or a local file`);
  }
});

test("the whole ui is under the budget the spec set", async () => {
  const js = (await readFile(join(ROOT, "plugins/vis-ui/index.js"), "utf8")).split("\n").length;
  const html = (await readFile(join(ROOT, "plugins/vis-ui/app.html"), "utf8")).split("\n").length;
  const lib = (await readFile(join(ROOT, "plugins/vis-ui/lib.js"), "utf8")).split("\n").length;
  // The original budget was 800; the preview, keyboard navigation, the
  // filter and the quiet refresh bought 1000. The tabbed notes deck, the
  // rendered reports, the day chassis, the filters on every list, the
  // keymap, the sparkline and the offline line bought the raise to 1550,
  // with the pure logic split into lib.js where the suite reads it. Anchoring
  // the run comparison as a tooltip below the head, so its list stops
  // overrunning the header bar, bought the last ten. The intake, a drop zone
  // that hands what a person drops to the run with the flags they pressed,
  // bought the raise to 1750; the site copy, a URL handed through the fetch
  // command's gates, bought 1800; an archive unpacked on the intake, 1850. The
  // budget still exists so growth stays a decision, not a drift.
  assert.ok(js + html + lib < 1850, `${js + html + lib} lines, the spec allows under 1850`);
});

// The run comparison lives inside the 70px trend gauge in the head. It once
// rendered in normal flow and its list overran the header bar. It must now be
// an off-flow tooltip: hidden until the gauge is hovered or focused, and never
// forced visible from script, so it can never push text over the head again.
test("the run comparison is an off-flow tooltip, not header flow", async () => {
  const html = await readFile(join(ROOT, "plugins/vis-ui/app.html"), "utf8");
  assert.match(html, /#compare\s*\{[^}]*position:\s*absolute/, "the comparison is positioned out of flow");
  assert.match(html, /#compare\s*\{[^}]*display:\s*none/, "it is hidden until asked for");
  assert.match(
    html,
    /\.spark-box:hover #compare\[data-ready\][^{]*,\s*\.spark-box:focus-within #compare\[data-ready\]\s*\{\s*display:\s*block/,
    "it is revealed only on hover or focus of the trend gauge"
  );
  assert.doesNotMatch(html, /\bbox\.hidden\s*=\s*false/, "nothing forces the comparison visible in flow");
});

test("the run records every plugin with its class and what it said", async (t) => {
  const { ctx, cleanup } = await ctxFor();
  t.after(cleanup);
  const run = buildRun(ctx);

  assert.equal(run.plugins.length, ctx.timings.map((x) => x.name).filter((v, i, a) => a.indexOf(v) === i).length);
  const angular = run.plugins.find((p) => p.name === "input-angular");
  assert.equal(angular.class, "input");
  assert.ok(angular.ms >= 0);
  assert.match(angular.contributed, /component\(s\)/);
  for (const p of run.plugins) assert.ok(["input", "dsp", "output", "vis", "general"].includes(p.class));
});

// The number in the bottom bar is the number in the notes, or the bar is a lie.
test("the unverified count matches what the run reported", async (t) => {
  const { ctx, out, cleanup } = await ctxFor();
  t.after(cleanup);
  const run = buildRun(ctx);

  assert.deepEqual(run.unverified, ctx.report.unverified);
  const notes = await readFile(join(out, "PORT_NOTES.md"), "utf8");
  for (const item of run.unverified) {
    assert.ok(notes.includes(item.slice(0, 40)), `the notes omit: ${item.slice(0, 50)}`);
  }
});

test("a screen carries its component, its screenshot and whether they matched", async (t) => {
  const { ctx, cleanup } = await ctxFor();
  t.after(cleanup);
  const [screen] = buildRun(ctx).screens;

  assert.equal(screen.name, "orders");
  assert.match(screen.component, /AppOrders\.jsx$/);
  assert.equal(screen.screenshot, "orders-default.png");
  assert.equal(screen.matched, true);
});

test("a screen with no screenshot says so rather than guessing one", async (t) => {
  const { ctx, cleanup } = await runPipeline({ shots: join(ROOT, "example/nosource") });
  t.after(cleanup);
  const [screen] = buildRun(ctx).screens;
  assert.equal(screen.matched, false);
  assert.equal(screen.screenshot, null);
});

test("endpoints carry where they came from", async (t) => {
  const { ctx, cleanup } = await ctxFor();
  t.after(cleanup);
  const run = buildRun(ctx);
  assert.ok(run.endpoints.length >= 3);
  for (const e of run.endpoints) assert.ok(["source", "observed"].includes(e.origin));
});

test("the server binds loopback, serves the run, and refuses to leave the directory", async (t) => {
  const { ctx, out, cleanup } = await ctxFor();
  t.after(cleanup);
  const { server } = await serve({ outDir: out, shotsDir: join(ROOT, "example/screenshots"), port: 0, log: {} });
  t.after(() => new Promise((done) => server.close(done)));

  assert.equal(server.address().address, "127.0.0.1", "never 0.0.0.0: it serves a customer system");
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/run.json`)).status, 200);
  assert.equal((await fetch(`${base}/nope`)).status, 404);

  const escaped = await fetch(`${base}/source?path=${encodeURIComponent("../../../etc/passwd")}`);
  assert.equal(escaped.status, 403, "a path outside the output directory is refused");
  const escapedShot = await fetch(`${base}/shots/${encodeURIComponent("../../../etc/passwd")}`);
  assert.equal(escapedShot.status, 403);

  const run = await (await fetch(`${base}/run.json`)).json();
  assert.equal(run.unverified.length, ctx.report.unverified.length);

  const source = await fetch(`${base}/source?path=${encodeURIComponent(run.screens[0].component)}`);
  assert.equal(source.status, 200);
  assert.match(await source.text(), /export default function/);
});

test("the ui never writes into the port", async () => {
  const source = await readFile(join(ROOT, "plugins/vis-ui/index.js"), "utf8");
  const server = source.slice(source.indexOf("export async function serve"), source.indexOf("export function openBrowser"));
  assert.ok(!/writeFile|mkdir|rm\(|unlink/.test(server), "the server is read only");
});

/* -------------------------- the console's twenty two, phase twenty two -------------------------- */

import {
  encodeHash, decodeHash, filterByQuery, filterEndpoints, sortPlugins,
  sparklinePoints, keyAction, STAGE_KEYS, offlineNotice, isTextFile, reportsIn,
  intakePath, rerunOptions, rerunPatch, RERUN_FLAGS,
} from "../plugins/vis-ui/lib.js";
import { createIntake } from "../plugins/vis-ui/index.js";

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

/* ------------------------------------------------------ the pure half */

test("the selection travels in the hash and comes back whole", () => {
  const hash = encodeHash({ screen: "app-orders", stage: "emit" });
  assert.equal(hash, "#screen=app-orders&stage=emit");
  assert.deepEqual(decodeHash(hash), { screen: "app-orders", stage: "emit" });
  assert.equal(encodeHash({}), "", "no selection writes no hash");
  assert.deepEqual(decodeHash(""), { screen: null, stage: null });
});

test("one filter serves every list panel, case blind, empty keeps all", () => {
  const items = [{ name: "dsp-tokens", class: "dsp" }, { name: "output-react", class: "output" }];
  assert.equal(filterByQuery(items, "TOKEN", ["name"]).length, 1);
  assert.equal(filterByQuery(items, "", ["name"]).length, 2);
  assert.equal(filterByQuery(items, "output", ["name", "class"]).length, 1);
});

test("endpoints filter by text and by verb facet together", () => {
  const endpoints = [
    { method: "GET", path: "/api/orders" },
    { method: "POST", path: "/api/orders" },
    { method: "GET", path: "/api/customers" },
  ];
  assert.equal(filterEndpoints(endpoints, "orders", null).length, 2);
  assert.equal(filterEndpoints(endpoints, "orders", "POST").length, 1);
  assert.equal(filterEndpoints(endpoints, "", "GET").length, 2);
});

test("the rack's cost order puts the expensive plugin first and copies", () => {
  const plugins = [{ name: "a", ms: 2 }, { name: "b", ms: 9 }, { name: "c", ms: 4 }];
  const byCost = sortPlugins(plugins, "cost");
  assert.deepEqual(byCost.map((p) => p.name), ["b", "c", "a"]);
  assert.equal(plugins[0].name, "a", "the run's own order is nobody's to reorder");
  assert.equal(sortPlugins(plugins, "class"), plugins);
});

test("the sparkline scales its values into the box, oldest first", () => {
  const points = sparklinePoints([0, 10, 5], 54, 16);
  const pairs = points.split(" ").map((p) => p.split(",").map(Number));
  assert.equal(pairs.length, 3);
  assert.equal(pairs[0][0], 0);
  assert.equal(pairs[2][0], 54);
  assert.ok(pairs[1][1] < pairs[0][1], "a higher count draws higher");
  assert.equal(sparklinePoints([], 54, 16), "");
  assert.ok(sparklinePoints([3], 54, 16).length, "a trend of one still deserves a mark");
});

test("the keymap is one decision: screens, stages, wipe, help, rerun, theme", () => {
  assert.equal(keyAction("j", {}).kind, "next-screen");
  assert.equal(keyAction("ArrowUp", {}).kind, "prev-screen");
  assert.equal(keyAction("/", {}).kind, "focus-filter");
  assert.equal(keyAction("?", {}).kind, "toggle-help");
  assert.equal(keyAction("r", {}).kind, "rerun");
  assert.equal(keyAction("t", {}).kind, "toggle-theme");
  assert.deepEqual(keyAction("[", {}), { kind: "wipe", by: -5 });
  assert.deepEqual(keyAction("]", {}), { kind: "wipe", by: 5 });
  assert.deepEqual(keyAction("4", {}), { kind: "stage", stage: "emit" });
  assert.deepEqual(keyAction("0", {}), { kind: "stage", stage: null });
  assert.equal(Object.keys(STAGE_KEYS).length, 5);
  assert.equal(keyAction("j", { inInput: true }), null, "keys inside an input belong to the input");
  assert.equal(keyAction("x", {}), null);
});

test("the offline line says what the cached run is and is not", () => {
  assert.equal(offlineNotice(true), "");
  assert.match(offlineNotice(false), /offline/);
  assert.match(offlineNotice(false), /last run/);
});

test("the files pane knows which files it can show as text", () => {
  for (const yes of ["a.jsx", "PORT_NOTES.md", "x.svelte", "t.yml", "m.mmd"]) assert.ok(isTextFile(yes), yes);
  for (const no of ["shot.png", "icon.ico", "font.woff2"]) assert.ok(!isTextFile(no), no);
});

test("reports are the run's own root level markdown, nothing deeper", () => {
  assert.deepEqual(
    reportsIn(["PORT_NOTES.md", "src/i18n/README.md", "A11Y.md", "src/tokens.js"]),
    ["PORT_NOTES.md", "A11Y.md"],
  );
});

/* ------------------------------------------------------ the server half */

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "portamp-ui-"));
  const out = join(dir, "out");
  await mkdir(join(out, ".portamp"), { recursive: true });
  await mkdir(join(out, "src", "elements"), { recursive: true });
  await writeFile(join(out, "PORT_NOTES.md"), "# Notes\n\n| a | b |\n| --- | --- |\n| 1 | `two` |\n\n- an <item> & more\n");
  await writeFile(join(out, "secret-not-written.md"), "# not in the run\n");
  await writeFile(join(out, "src", "elements", "AppOrders.js"), 'customElements.define("app-orders", class extends HTMLElement {});\n');
  await writeFile(join(out, ".portamp", "run.json"), JSON.stringify({
    ranAt: "2026-09-03T20:00:00.000Z",
    plugins: [], screens: [{ name: "app-orders" }], endpoints: [], unverified: [],
    files: ["PORT_NOTES.md", "src/elements/AppOrders.js", "src/tokens.js"],
    provenance: {}, tokens: null, notes: [], improvements: [],
  }));
  const { server, address } = await serve({ outDir: out, shotsDir: join(dir, "shots"), port: 0, log: quiet });
  return { dir, out, server, address };
}

test("the ui server answers for the console's new panels", async (t) => {
  const { dir, server, address } = await fixture();
  t.after(() => new Promise((done) => server.close(done)) .then(() => rm(dir, { recursive: true, force: true })));

  const lib = await fetch(`${address}/lib.js`);
  assert.equal(lib.status, 200);
  assert.match(lib.headers.get("content-type"), /text\/javascript/);
  assert.match(await lib.text(), /export function keyAction/);

  const health = await fetch(`${address}/healthz`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.ranAt, "2026-09-03T20:00:00.000Z");
  assert.equal(health.screens, 1);

  const first = await fetch(`${address}/run.json`);
  const tag = first.headers.get("etag");
  assert.ok(tag, "run.json carries a version");
  const again = await fetch(`${address}/run.json`, { headers: { "If-None-Match": tag } });
  assert.equal(again.status, 304, "an unchanged run costs a 304, not the document");

  const reports = await fetch(`${address}/reports.json`).then((r) => r.json());
  assert.deepEqual(reports, ["PORT_NOTES.md"]);

  const report = await fetch(`${address}/report?name=PORT_NOTES.md`);
  assert.equal(report.status, 200);
  const html = await report.text();
  assert.match(html, /<h1>Notes<\/h1>/);
  assert.match(html, /<td>1<\/td>/, "the table renders as a table");
  assert.match(html, /&lt;item&gt; &amp; more/, "content is escaped before anything renders");

  assert.equal((await fetch(`${address}/report?name=secret-not-written.md`)).status, 403, "the written list is the whitelist");
  assert.equal((await fetch(`${address}/report?name=..%2Fescape.md`)).status, 403);
  assert.equal((await fetch(`${address}/report?name=src/tokens.js`)).status, 403, "only markdown");

  const favicon = await fetch(`${address}/favicon.ico`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get("content-type"), /svg/);

  const preview = await fetch(`${address}/preview?path=src/elements/AppOrders.js&state=rows`).then((r) => r.text());
  assert.match(preview, /invented rows/, "the rows state names its data as invented");
  assert.match(preview, /Example row one/);
});

test("previewPage whitelists its states and reportPage never trusts input", () => {
  assert.match(previewPage("x-y", "src/elements/X.js", "rows"), /invented rows/);
  assert.doesNotMatch(previewPage("x-y", "src/elements/X.js", "weird"), /weird/, "an unknown state falls back instead of echoing");
  const page = reportPage("R.md", '# Hi\n```\n<code stays literal>\n```\n**bold** and `tick`\n<script>alert(1)</script>\n');
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /<strong>bold<\/strong>/);
  assert.match(page, /<code>tick<\/code>/);
  assert.match(page, /&lt;code stays literal&gt;/);
});

/* ------------------------------------------------------ the console page */

test("the console page carries every affordance this phase claims", async () => {
  const page = await readFile(join(ROOT, "plugins", "vis-ui", "app.html"), "utf8");

  assert.match(page, /class="skip" href="#screens"/, "a skip link for the keyboard");
  assert.match(page, /<noscript>/, "no script gets an explanation, not a blank deck");
  assert.match(page, /id="now" role="status" aria-live="polite"/, "the readout announces itself");
  assert.match(page, /<dialog id="help"/, "the shortcuts card");
  assert.match(page, /\[data-theme="day"\]/, "the day chassis exists in CSS");
  assert.match(page, /id="theme"/, "and has its key");
  assert.match(page, /@media print/, "printed, the console flattens into a report");
  assert.match(page, /role="tablist"/, "the notes deck is tabbed");
  assert.match(page, /id="tab-reports"/, "with a reports face");
  assert.match(page, /id="pane-files"/, "and a files face");
  for (const id of ["sc-q", "rk-q", "ep-q", "fi-q", "un-q"]) {
    assert.match(page, new RegExp(`id="${id}"`), `${id} filter input`);
  }
  assert.match(page, /id="ep-verbs"/, "the verb facet chips");
  assert.match(page, /id="rk-sort"/, "the rack's by-cost key");
  assert.match(page, /id="spark"/, "the trend sparkline");
  assert.match(page, /id="offline"/, "the offline line");
  assert.match(page, /id="copy-src"/, "source views can be copied");
  assert.match(page, /from "\/lib\.js"/, "the page runs the same logic the suite tests");
  assert.match(page, /If-None-Match/, "the poll sends the version it holds");
  assert.match(page, /hashchange/, "the hash is live, not only read at load");
});

test("the service worker shell carries the lib and moved its version", async () => {
  const sw = await readFile(join(ROOT, "plugins", "vis-ui", "sw.js"), "utf8");
  assert.match(sw, /"\/lib\.js"/);
  assert.doesNotMatch(sw, /portamp-shell-v1/, "a changed shell is a new cache");
});

/* ------------------------------------------------- integrated, not beside */

test("coverage and the equivalence verdicts ride the run into the console", async (t) => {
  const { ctx, cleanup } = await ctxFor();
  t.after(cleanup);
  const run = buildRun(ctx);
  assert.equal(typeof run.coverage.ported, "number", "vis-coverage's number, not a re-derivation");
  assert.equal(typeof run.coverage.routed, "number");
  assert.ok(Array.isArray(run.parity), "the equivalence verdicts have a seat even when empty");
});

test("the emitted index points back at the console that renders it", async (t) => {
  const { out, cleanup } = await ctxFor();
  t.after(cleanup);
  const index = await readFile(join(out, "PORT_README.md"), "utf8");
  assert.match(index, /portamp ui/, "the run's own docs name the workbench");
});

test("the console shows the coverage gauge and the ui command watches", async () => {
  const page = await readFile(join(ROOT, "plugins", "vis-ui", "app.html"), "utf8");
  assert.match(page, /id="g-cover"/, "the ported gauge");
  assert.match(page, /run\.coverage/, "fed from the run, not re-derived");
  assert.match(page, /diverged/, "the equivalence verdicts reach the readout");
  const cli = await readFile(join(ROOT, "src", "cli.js"), "utf8");
  assert.match(cli, /--watch/, "the flag is a first class boolean");
  assert.equal(plugin.commands.ui.describe.includes("--watch"), true, "the command says so");
  const source = await readFile(join(ROOT, "plugins", "vis-ui", "index.js"), "utf8");
  assert.match(source, /args\.watch/, "and the command honors it");
});

/* ------------------------------------------------------------ the intake */

test("an intake path is a relative file path and nothing else", () => {
  assert.equal(intakePath("ledger.exe"), "ledger.exe");
  assert.equal(intakePath("site/pages/index.html"), "site/pages/index.html");
  assert.equal(intakePath("\\win\\style\\a.png"), "win/style/a.png", "a Windows separator is a separator");
  assert.equal(intakePath("/rooted/a.png"), "rooted/a.png", "a leading slash is dropped, never honoured");
  assert.equal(intakePath("a//b.png"), "a/b.png", "a doubled slash is one");
  for (const bad of ["", "../escape", "a/../b", "./a", "a\u0000b", "x".repeat(600)]) assert.equal(intakePath(bad), null, JSON.stringify(bad));
});

test("a rerun request carries only the flags the console offers, as booleans, and the source", () => {
  assert.deepEqual(rerunOptions(undefined), { source: "src", flags: {} });
  assert.deepEqual(rerunOptions({ source: "intake", flags: { transformer: 1, vue: false, allowLive: true, "max-kb": 0 } }), { source: "intake", flags: { transformer: true, vue: false } }, "a policy switch or a ceiling is never a flag a page can set");
  assert.deepEqual(rerunOptions({ source: "/etc" }), { source: "src", flags: {} });
  assert.ok(!RERUN_FLAGS.some((f) => /allow|offline|max|only|skip/.test(f)), "nothing that weakens a gate is offered");
});

test("the intake writes what it is handed under the run's sidecar, lists it, refuses an escape, and empties", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-intake-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const intake = createIntake(join(dir, "out", ".portamp", "intake"));
  assert.deepEqual(await intake.list(), [], "an intake that does not exist yet is empty, not an error");
  const { files, refused } = await intake.put("pages/index.html", Buffer.from("<h1>hi</h1>"));
  assert.deepEqual(files, [{ path: "pages/index.html", bytes: 11 }]); assert.deepEqual(refused, []);
  await intake.put("ledger.exe", Buffer.from("MZ"));
  assert.deepEqual((await intake.list()).map((f) => f.path), ["ledger.exe", "pages/index.html"]);
  await assert.rejects(() => intake.put("../outside.txt", Buffer.from("x")), /only land inside the intake/);
  await assert.rejects(() => intake.put("", Buffer.from("x")));
  assert.equal(await readFile(join(dir, "out", ".portamp", "intake", "pages", "index.html"), "utf8"), "<h1>hi</h1>");
  await intake.clear();
  assert.deepEqual(await intake.list(), []);
});

test("the server hands uploads to the intake and reruns pointed at it; without one it says so", async (t) => {
  const { dir, out, server: plain, address: plainAddress } = await fixture();
  t.after(() => new Promise((done) => plain.close(done)).then(() => rm(dir, { recursive: true, force: true })));
  assert.equal((await fetch(`${plainAddress}/intake?path=a.png`, { method: "POST", body: "x" })).status, 501, "a server started without an intake refuses, it does not invent one");
  assert.deepEqual(await fetch(`${plainAddress}/intake.json`).then((r) => r.json()), { dir: null, files: [] });

  const puts = [];
  const reruns = [];
  const intake = { dir: join(out, ".portamp", "intake"), files: [], async put(rel, bytes) { puts.push([rel, bytes.length]); this.files.push(rel); return { files: this.files.map((p) => ({ path: p, bytes: 1 })), refused: [] }; }, async clear() { this.files = []; }, async list() { return this.files.map((p) => ({ path: p, bytes: 1 })); } };
  const { server, address } = await serve({ outDir: out, shotsDir: join(dir, "shots"), port: 0, log: quiet, intake, rerun: async (o) => { reruns.push(o); } });
  t.after(() => new Promise((done) => server.close(done)));
  const put = await fetch(`${address}/intake?path=${encodeURIComponent("site/index.html")}`, { method: "POST", body: "<p>old</p>" }).then((r) => r.json());
  assert.deepEqual(put, { ok: true, path: "site/index.html", files: 1, refused: [] });
  assert.deepEqual(puts, [["site/index.html", 10]]);
  assert.equal((await fetch(`${address}/intake?path=${encodeURIComponent("../escape.html")}`, { method: "POST", body: "x" })).status, 400);
  assert.equal((await fetch(`${address}/intake`, { method: "POST", body: "x" })).status, 400, "no path, no file");
  assert.deepEqual(await fetch(`${address}/intake.json`).then((r) => r.json()), { dir: intake.dir, files: [{ path: "site/index.html", bytes: 1 }] });
  const ran = await fetch(`${address}/rerun`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "intake", flags: { transformer: true, allowLive: true } }) }).then((r) => r.json());
  assert.equal(ran.ok, true);
  assert.deepEqual(reruns, [{ source: "intake", flags: { transformer: true } }], "the rerun gets the source and the offered flags, nothing else");
  await fetch(`${address}/rerun`, { method: "POST" });
  assert.deepEqual(reruns[1], { source: "src", flags: {} }, "an empty request is the plain rerun it always was");
  assert.deepEqual(await fetch(`${address}/intake`, { method: "DELETE" }).then((r) => r.json()), { ok: true });
  assert.deepEqual(intake.files, []);
});

test("the console page carries the intake: a drop zone, a folder picker, the offered flags and the buttons", async () => {
  const html = await readFile(join(ROOT, "plugins/vis-ui/app.html"), "utf8");
  for (const needle of ['id="intake"', 'id="drop"', "webkitdirectory", 'data-flag="transformer"', 'data-flag="train-reverse"', 'id="port-intake"', 'id="clear-intake"', '"/intake?path="', 'source: "intake"', "webkitGetAsEntry"]) {
    assert.ok(html.includes(needle), `app.html carries ${needle}`);
  }
  const flags = [...html.matchAll(/data-flag="([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(flags.every((f) => RERUN_FLAGS.includes(f)), "every flag the page offers is one the server accepts");
  const source = await readFile(join(ROOT, "plugins/vis-ui/index.js"), "utf8");
  assert.match(source, /Object\.assign\(config, rerunPatch\(original, intake\.dir, rerunOptions\(options\)\)\)/, "a rerun over the intake reads the intake, and the next plain rerun reads the tree again");
});

test("the nineteenth review pass: a rerun's flags ride on the command line's and come back, and the shots directory follows the run", async (t) => {
  const original = { src: "/tree", shots: "/tree/shots", flags: { vue: true } };
  const intake = "/out/.portamp/intake";
  const plain = rerunPatch(original, intake, rerunOptions({}));
  assert.equal(plain.src, "/tree"); assert.equal(plain.shots, "/tree/shots"); assert.equal(plain.vue, true, "a flag from the command line stays on when the console presses nothing");
  assert.equal(plain.transformer, undefined, "a flag the command line never gave stays ungiven");
  const pressed = rerunPatch(original, intake, rerunOptions({ source: "intake", flags: { transformer: true } }));
  assert.equal(pressed.src, intake); assert.equal(pressed.shots, intake); assert.equal(pressed.transformer, true); assert.equal(pressed.vue, true, "a pressed key adds to the command line's flags");
  const off = rerunPatch(original, intake, rerunOptions({ flags: { vue: false } }));
  assert.equal(off.vue, false, "an explicit false in a request still turns a flag off for that run");
  assert.equal(rerunPatch(original, intake, rerunOptions({})).vue, true, "and the next plain rerun has it back");

  const html = await readFile(join(ROOT, "plugins/vis-ui/app.html"), "utf8");
  assert.match(html, /filter\(\(k\) => k\.getAttribute\("aria-pressed"\) === "true"\)\.map\(\(k\) => \[k\.dataset\.flag, true\]\)/, "the page sends only pressed keys");
  const source = await readFile(join(ROOT, "plugins/vis-ui/index.js"), "utf8");
  assert.match(source, /shotsDir: \(\) => config\.shots/, "the server asks where the screenshots are each time");
  assert.match(source, /const ctx = await rerun\(\);/, "the watch reruns through the same door, so it reads the tree and flags the command was given");

  const dir = await mkdtemp(join(tmpdir(), "portamp-shots-move-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = join(dir, "out"); const a = join(dir, "a"); const b = join(dir, "b");
  await mkdir(join(out, ".portamp"), { recursive: true }); await mkdir(a); await mkdir(b);
  await writeFile(join(out, ".portamp", "run.json"), JSON.stringify({ ranAt: "2026-09-06T00:00:00.000Z", plugins: [], screens: [], endpoints: [], unverified: [], files: [], provenance: {}, tokens: null, notes: [], improvements: [] }));
  await writeFile(join(a, "home.png"), "A"); await writeFile(join(b, "home.png"), "B");
  let where = a;
  const { server, address } = await serve({ outDir: out, shotsDir: () => where, port: 0, log: quiet });
  t.after(() => new Promise((done) => server.close(done)));
  assert.equal(await fetch(`${address}/shots/home.png`).then((r) => r.text()), "A");
  where = b;
  assert.equal(await fetch(`${address}/shots/home.png`).then((r) => r.text()), "B", "after an intake rerun the console serves the intake's screenshots");
});
