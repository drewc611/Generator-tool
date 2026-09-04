import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * The portal fixture is the shape of a government service front end from the
 * mid 2000s: a masthead, a dense nav, forms that are the whole point, tables
 * that are data and tables that are not, copy written by a legal department.
 * If the site engine and the language audit hold up here, they hold up.
 */

test("a service portal becomes a full stack React app", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ src: join(ROOT, "example/legacy-portal"), site: true });
  t.after(cleanup);
  assert.equal(error, null);

  // The shell: every page routed, the nested service pages as children in
  // the navigation model, the shared masthead and nav lifted once.
  const app = await readFile(join(out, "src/app/App.jsx"), "utf8");
  for (const route of ["/", "/track", "/services", "/services/pickup", "/services/forwarding", "/zip", "/help"]) {
    assert.ok(app.includes(`path: "${route}"`), `App.jsx routes ${route}`);
  }
  const nav = JSON.parse(/export const NAV = (\[[\s\S]*\]);/.exec(await readFile(join(out, "src/app/nav.js"), "utf8"))[1]);
  const services = nav.find((item) => item.route === "/services");
  assert.ok(services.children.some((c) => c.route === "/services/pickup"), "nested pages hang under their section");
  const layout = await readFile(join(out, "src/app/Layout.jsx"), "utf8");
  assert.match(layout, /portal-nav/);
  assert.match(layout, /masthead/);

  // The forms are the portal's API surface: read into the map, lifted out
  // of the markup, and the GET query contract kept in the notes.
  const paths = ctx.api.calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(paths.includes("GET /track"));
  assert.ok(paths.includes("GET /routes"));
  assert.ok(paths.includes("POST /cgi-bin/schedule"));
  const home = await readFile(join(out, "src/features/Home/Home.jsx"), "utf8");
  assert.ok(!home.includes("/track"), "the tracking action left the markup for the API map");
  assert.ok(ctx.report.unverified.some((n) => /barcode.*query string|query string.*barcode/s.test(n)), "the GET contract is named");

  // A data table is data: the tracking history keeps its header cells and
  // no layout table note fires for it.
  const track = await readFile(join(out, "src/features/Track/Track.jsx"), "utf8");
  assert.match(track, /<th>/);

  // The language audit reads the portal the way a tired person does.
  const kinds = new Set((ctx.cognitive ?? []).map((f) => f.kind));
  assert.ok(kinds.has("vague-link"), "click here / read more / here are named");
  assert.ok(kinds.has("unexplained-abbreviation"), "RTAO three times, never expanded");
  assert.ok(kinds.has("wall-of-text"), "the route code paragraph is a wall");
  assert.ok(kinds.has("long-list"), "twenty districts in one select");
  assert.ok(kinds.has("hard-copy"), "the legalese front page reads at a measured grade");
  const cognitive = await readFile(join(out, "COGNITIVE.md"), "utf8");
  assert.match(cognitive, /RTAO appears \d+ time/);
  assert.match(cognitive, /median reading grade/);

  // Full stack: the port's server and its own suites landed beside the app.
  assert.ok(ctx.written.includes("serve.js"));
  assert.ok(ctx.written.includes("tests/server.test.js"));
  const seal = await readFile(join(out, "public/seal.svg"));
  assert.deepEqual(seal, await readFile(join(ROOT, "example/legacy-portal/seal.svg")));
});
