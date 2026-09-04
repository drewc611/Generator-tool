import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { remixRouteFile } from "../plugins/output-remix/index.js";
import { readStores } from "../plugins/dsp-state/index.js";
import { replaySteps } from "../plugins/output-tests/index.js";
import { diffStructure } from "../plugins/vis-parity/index.js";
import { compareRuns } from "../plugins/vis-ui/lib.js";
import { mergeSpacing } from "../plugins/dsp-tokens/measure.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Round four: the two framework targets on the site model, and the port
 * meeting its witnesses — stores, recordings, structure, the previous run.
 * One pipeline run with both targets on backs the emitter claims.
 */

let run;
test.before(async () => {
  run = await runPipeline({ src: join(ROOT, "example/legacy-site"), site: true, next: true, remix: true });
  assert.equal(run.error, null);
});
test.after(() => run?.cleanup());

const readOut = (rel) => readFile(join(run.out, rel), "utf8");

test("the Next target arranges the site as an app directory without porting twice", async () => {
  const layout = await readOut("next/app/layout.jsx");
  assert.match(layout, /<main id="main">\{children\}<\/main>/);
  assert.match(layout, /<nav\b/, "the lifted chrome wraps every page");
  const page = await readOut("next/app/about/page.jsx");
  assert.match(page, /import About from "\.\.\/\.\.\/\.\.\/src\/features\/About\/About\.jsx"/, "the component is imported, never copied");
  assert.match(page, /export const metadata = \{ title: "About Acme"/);
  const config = await readOut("next/next.config.mjs");
  assert.match(config, /\{ source: "\/old-shop\.html", destination: "\/products", permanent: true \}/, "the redirect chain arrives flattened");
});

test("the Remix target answers retired addresses with loaders that 301", async () => {
  assert.equal(remixRouteFile("/"), "_index");
  assert.equal(remixRouteFile("/products/widget"), "products.widget");
  assert.equal(remixRouteFile("/about.html"), "about[.]html");
  const root = await readOut("remix/app/root.jsx");
  assert.match(root, /<Outlet \/>/);
  assert.match(root, /<nav\b/);
  const stub = await readOut("remix/app/routes/old-shop[.]html.jsx");
  assert.match(stub, /export const loader = \(\) => redirect\("\/products", 301\);/, "the loader speaks the flattened 301");
  const page = await readOut("remix/app/routes/about.jsx");
  assert.match(page, /import About from "\.\.\/\.\.\/\.\.\/src\/features\/About\/About\.jsx"/);
});

test("jQuery behavior lands on the route that owned its selector", async () => {
  const { readPage } = await import("../plugins/input-static/index.js");
  assert.ok(readPage, "the reader is loadable");
  // The join itself, driven through a pipeline over a fixture with a page
  // and a script the pages own; the portal fixture carries both.
  const portal = await runPipeline({ src: join(ROOT, "example/legacy-portal"), site: true });
  try {
    assert.equal(portal.error, null);
    if (portal.ctx.jqueryByRoute?.length) {
      assert.ok(portal.ctx.written.includes("src/app/behavior-manifest.js"), "the manifest is data the shell can hold");
      const manifest = await readFile(join(portal.out, "src/app/behavior-manifest.js"), "utf8");
      assert.match(manifest, /export const BEHAVIOR = \{/);
      assert.match(await readFile(join(portal.out, "BEHAVIOR_BY_ROUTE.md"), "utf8"), /work list for/);
    } else {
      assert.ok(portal.ctx.widgets === undefined || !portal.ctx.site, "no handler joined and nothing pretended to");
    }
  } finally {
    await portal.cleanup();
  }
});

test("declared stores are read as shapes, never executed", () => {
  const vuex = readStores(`const store = new Vuex.Store({ state: { cart: [], user: null }, mutations: { add(state) {}, clear(state) {} } });`, "store.js");
  assert.equal(vuex[0].kind, "vuex");
  assert.deepEqual(vuex[0].stateKeys, ["cart", "user"]);
  assert.deepEqual(vuex[0].actions, ["add", "clear"]);

  const pinia = readStores(`export const useCart = defineStore("cart", { state: () => ({ items: [], open: false }), actions: { add() {}, empty() {} } });`, "cart.js");
  assert.equal(pinia[0].kind, "pinia");
  assert.equal(pinia[0].name, "cart");
  assert.deepEqual(pinia[0].stateKeys, ["items", "open"]);

  const ngrx = readStores(`export const load = createAction("[Orders] Load"); export const loaded = createAction("[Orders] Loaded");`, "orders.actions.ts");
  assert.equal(ngrx[0].name, "Orders");
  assert.deepEqual(ngrx[0].actions, ["Load", "Loaded"]);
  assert.deepEqual(readStores("const x = 1;", "plain.js"), [], "quiet code declares nothing");
});

test("a recording becomes replayable steps, values never reproduced", async () => {
  const exploration = JSON.parse(await readFile(join(ROOT, "test/fixtures/explored/exploration.json"), "utf8"));
  const { steps, skipped } = replaySteps(exploration);
  assert.ok(steps.length > 0, "the fixture recording replays");
  assert.equal(steps.length + skipped, exploration.steps.length, "every step is either replayable or counted");
  for (const step of steps) {
    assert.ok(step.selector, "a replay step names its selector");
    if (step.kind === "fill") assert.equal(step.value, "", "a recorded input value is not reproduced");
  }
});

test("the structure diff names the control the port lost", () => {
  const recorded = [
    { tag: "button", name: "Save draft" },
    { tag: "button", name: "Delete" },
    { tag: "div" }, { tag: "div" },
  ];
  const ir = buildIr(`<div><button>Save draft</button></div>`);
  const diff = diffStructure(recorded, ir);
  assert.deepEqual(diff.missingControls, [{ tag: "button", name: "Delete" }], "the missing button is named, not scored");
  assert.ok(diff.tagDrift.some((d) => d.tag === "div" && d.recorded === 2 && d.ported === 1));
  const clean = diffStructure(recorded.slice(0, 1), buildIr(`<button>Save draft</button>`));
  assert.deepEqual(clean.missingControls, []);
  assert.deepEqual(clean.tagDrift, []);
});

test("two runs compare as movement and closed notes, not a score", () => {
  const previous = { screens: [{}, {}], endpoints: [{}], unverified: ["a", "b", "c"], files: ["x"] };
  const current = { screens: [{}, {}, {}], endpoints: [{}], unverified: ["b", "d"], files: ["x", "y"] };
  const cmp = compareRuns(current, previous);
  assert.deepEqual(cmp.metrics.find((m) => m.name === "unverified"), { name: "unverified", was: 3, is: 2, delta: -1, verdict: "better" });
  assert.deepEqual(cmp.notesClosed, ["a", "c"]);
  assert.deepEqual(cmp.notesOpened, ["d"]);
  assert.equal(compareRuns(current, null), null, "a first run has nothing to compare and says so");
});

test("spacing merges across recordings with the disagreement kept", () => {
  // A session with a vertical rhythm and a horizontal one: a column of rows
  // gapped vertically by `v`, and within each row two boxes gapped by `h`.
  const session = (v, h) => ({
    screens: [{
      elements: Array.from({ length: 5 }, (_, i) => i).flatMap((i) => {
        const y = 10 + i * (30 + v);
        return [
          { box: { x: 10, y, w: 80, h: 30 } },
          { box: { x: 90 + h, y, w: 80, h: 30 } },
        ];
      }),
    }],
  });
  const eight = mergeSpacing([session(8, 16), session(8, 16)], [4, 8, 12, 16, 24, 32, 48]);
  assert.equal(eight.sessions, 2);
  assert.ok(eight.agreed.includes(8) && eight.agreed.includes(16), "rungs both sessions found are agreed");

  const merged = mergeSpacing([session(8, 16), session(8, 16), session(20, 16)], [4, 8, 12, 16, 24, 32, 48]);
  assert.equal(merged.sessions, 3);
  assert.ok(merged.disputed.some((d) => d.agreedBy < d.of), "the odd session's rung is a dispute, not an average");

  const lone = mergeSpacing([session(8, 16)], [4, 8, 12, 16, 24, 32, 48]);
  assert.equal(lone.sessions, 1, "one session measures the way it always did");
  assert.deepEqual(mergeSpacing([], [4, 8]), null, "no recording, no claim");
});
