import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import plugin, { buildRun, serve } from "../plugins/vis-ui/index.js";
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
    assert.match(line, /from "node:|from "\.\//, `${line.trim()} is not a node builtin or a local file`);
  }
});

test("the whole ui is under the budget the spec set", async () => {
  const js = (await readFile(join(ROOT, "plugins/vis-ui/index.js"), "utf8")).split("\n").length;
  const html = (await readFile(join(ROOT, "plugins/vis-ui/app.html"), "utf8")).split("\n").length;
  assert.ok(js + html < 800, `${js + html} lines, the spec allows under 800`);
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
