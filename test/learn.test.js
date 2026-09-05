import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import plugin, { renderLearned } from "../plugins/dsp-learn/index.js";
import { FEATURES, vectorFromEntry } from "../plugins/dsp-learn/features.js";
import { train, standardizer, standardize, classifyVector, robustness, crossValidate } from "../plugins/dsp-learn/model.js";
import { CORPUS } from "../plugins/dsp-learn/corpus.js";
import { ROOT } from "./helpers.js";

/**
 * dsp-learn is a real, small model: it learns a standardization from the
 * labelled corpus and classifies a screen by the nearest exemplar. These hold
 * its honest edges. The feature vector is deterministic and the right length,
 * the standardization is what it claims, every exemplar is its own nearest
 * neighbour, the robustness figure is reproducible and decays with noise, the
 * report states the one exemplar per class limitation, and the embedded corpus
 * never drifts from the fixtures it mirrors.
 */

test("the feature vector is fixed length and deterministic", () => {
  const a = vectorFromEntry(CORPUS[0]);
  const b = vectorFromEntry(CORPUS[0]);
  assert.equal(a.length, FEATURES.length);
  assert.deepEqual(a, b, "the same entry always makes the same vector");
  assert.ok(a.every((x) => Number.isFinite(x)), "every feature is a finite number");
});

test("the standardizer centres and scales each feature, and never divides by zero", () => {
  const matrix = [
    [0, 5, 2],
    [2, 5, 4],
    [4, 5, 6],
  ];
  const norm = standardizer(matrix);
  assert.deepEqual(norm.mean, [2, 5, 4]);
  // Column 1 never varies: its spread is forced to one so it neutralises rather than explodes.
  assert.equal(norm.std[1], 1);
  const z = standardize([2, 5, 4], norm);
  assert.equal(z[0], 0, "the mean maps to zero");
  assert.equal(z[1], 0, "a constant feature contributes nothing");
});

test("every corpus exemplar is its own nearest prototype", () => {
  const model = train(CORPUS);
  assert.equal(model.prototypes.length, CORPUS.length);
  const misses = [];
  for (const entry of CORPUS) {
    const reading = classifyVector(model, vectorFromEntry(entry));
    if (reading.label !== entry.label) misses.push(`${entry.label} read as ${reading.label}`);
  }
  assert.deepEqual(misses, [], `the standardized space disagrees with the labels it was built from:\n${misses.join("\n")}`);
});

test("a screen unlike anything the model saw classifies, with a real confidence", () => {
  const model = train(CORPUS);
  // A plain crud table it was not trained on: different words, same shape.
  const vector = vectorFromEntry({
    html: '<table><tr *ngFor="let x of rows"><td>{{x.id}}</td><td><button (click)="del(x)">Remove</button></td></tr></table>',
    calls: [{ method: "GET", path: "/api/things" }, { method: "DELETE", path: "/api/things/${id}" }],
  });
  const reading = classifyVector(model, vector);
  assert.equal(reading.label, "crud-table");
  assert.ok(reading.confidence > 0 && reading.confidence <= 1, "confidence is a probability");
  assert.equal(reading.ranked.length, CORPUS.length, "every archetype is ranked");
});

test("robustness is reproducible and decays as the noise grows", () => {
  const model = train(CORPUS);
  const a = robustness(model, { seed: 7, trials: 50, sigma: 1.0 });
  const b = robustness(model, { seed: 7, trials: 50, sigma: 1.0 });
  assert.equal(a, b, "the same seed gives the same figure");
  assert.ok(a > 0 && a <= 1, "it is a fraction");
  const low = robustness(model, { seed: 7, trials: 60, sigma: 0.5 });
  const high = robustness(model, { seed: 7, trials: 60, sigma: 2.5 });
  assert.ok(low >= high, "more noise recognises fewer, never more");
  assert.ok(low > 0.9, "at low noise the well separated exemplars are almost always recognised");
});

test("leave one out cross validation is a real, deterministic held out accuracy", () => {
  const a = crossValidate(CORPUS);
  const b = crossValidate(CORPUS);
  assert.equal(a.accuracy, b.accuracy, "the same corpus gives the same number");
  assert.equal(a.n, CORPUS.length);
  assert.ok(a.accuracy > 0.7, `held out accuracy should clear chance by a lot, got ${a.accuracy}`);
  assert.ok(a.accuracy <= 1);
  // Every miss names a real substitution, never a phantom class.
  const labels = new Set(CORPUS.map((c) => c.label));
  for (const m of a.misses) assert.ok(labels.has(m.label) && labels.has(m.predicted));
});

test("the report names the reading and its held out accuracy", () => {
  const model = train(CORPUS);
  const reading = classifyVector(model, vectorFromEntry(CORPUS[2]));
  const md = renderLearned({
    reading,
    robustnessCurve: [0.5, 1.0, 1.5, 2.0].map((sigma) => ({ sigma, accuracy: robustness(model, { seed: 1, trials: 20, sigma }) })),
    cv: crossValidate(CORPUS),
    top: [{ name: "loops", value: 1 }],
  });
  assert.match(md, /learned/i);
  assert.match(md, new RegExp(reading.label));
  assert.match(md, /leave one out|held out/i, "it reports a real held out accuracy");
  assert.match(md, /two labelled exemplars per archetype/i, "it states the corpus size honestly");
  assert.match(md, /ARCHITECTURE\.md/, "it points at the rule based reading to compare");
  assert.match(md, /proposal|unverified|can be confidently wrong/i);
});

test("each screen is classified on its own shape, and the report tables it", async () => {
  const handlers = {};
  plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
  const ctx = {
    screens: [
      { selector: "orders", template: '<table><tr *ngFor="let o of orders"><td>{{o.id}}</td></tr></table>' },
      { selector: "signup", template: '<form (submit)="go()"><input [(ngModel)]="a"><input [(ngModel)]="b"><button type="submit">Join</button></form>' },
    ],
    api: { calls: [] },
    written: {},
    write: async (rel, c) => (ctx.written[rel] = c),
    unverified: () => {},
  };
  await handlers.plan(ctx);
  assert.equal(ctx.learned.perScreen.length, 2, "both screens were placed on their own");
  const byScreen = Object.fromEntries(ctx.learned.perScreen.map((s) => [s.selector, s.label]));
  assert.ok(byScreen.orders && byScreen.signup, "each screen got a label");
  await handlers.emit(ctx);
  assert.match(ctx.written["LEARNED.md"], /Each screen on its own/);
  assert.match(ctx.written["LEARNED.md"], /`orders`/);
  assert.match(ctx.written["LEARNED.md"], /`signup`/);
});

test("the plugin is a dsp plugin that reads the run and writes a learned report", async () => {
  assert.equal(plugin.class, "dsp");
  const handlers = {};
  plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });

  const ctx = {
    screens: [
      { template: '<table><tr *ngFor="let o of orders"><td><button (click)="remove(o)">Delete</button></td></tr></table>' },
    ],
    api: { calls: [{ method: "GET", path: "/api/orders" }, { method: "DELETE", path: "/api/orders/${id}" }] },
    written: {},
    write: async (rel, contents) => { ctx.written[rel] = contents; },
    unverified: (t) => (ctx.note = t),
  };
  await handlers.plan(ctx);
  assert.ok(ctx.learned, "it classified the run");
  await handlers.emit(ctx);
  assert.ok(ctx.written["LEARNED.md"], "it wrote the learned report");
  assert.match(ctx.note, /learned|proposal|unverified/i, "the reading is flagged unverified");
});

test("with nothing to read the plugin writes nothing", async () => {
  const handlers = {};
  plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
  const ctx = { screens: [], api: { calls: [] }, written: {}, write: async (r, c) => (ctx.written[r] = c), unverified: () => {} };
  await handlers.plan(ctx);
  await handlers.emit(ctx);
  assert.equal(ctx.learned, undefined);
  assert.deepEqual(ctx.written, {}, "no run, no report");
});

test("no dependency was added and no network is reached", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies, {});
  for (const file of ["index.js", "features.js", "model.js", "corpus.js"]) {
    const source = await readFile(join(ROOT, "plugins/dsp-learn", file), "utf8");
    for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
      assert.match(line, /from "node:|from "\.\.?\//, `${line.trim()} is not a builtin or a local import`);
    }
    assert.doesNotMatch(source, /fetch\(|http:|https:/, `${file} reaches the network`);
  }
});

// The model trains on its own embedded copy so it needs no test tree at run
// time. This holds that copy byte equal to the fixtures, so the two never drift.
test("the embedded corpus matches the calibration fixtures", async () => {
  const dir = join(ROOT, "test", "fixtures", "corpus");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const fixtures = [];
  for (const file of files) fixtures.push(JSON.parse(await readFile(join(dir, file), "utf8")));

  // Two exemplars share a label now, so a fixture is matched to its embedded twin
  // by label and markup together, and the two sets must be the same size.
  const key = (e) => `${e.label} ${e.html}`;
  const byKey = (list) => new Map(list.map((e) => [key(e), e]));
  const embedded = byKey(CORPUS);
  const onDisk = byKey(fixtures);

  assert.equal(embedded.size, CORPUS.length, "no two embedded exemplars are identical");
  assert.equal(onDisk.size, fixtures.length, "no two fixtures are identical");
  assert.deepEqual([...embedded.keys()].sort(), [...onDisk.keys()].sort(), "the same exemplars, embedded and on disk");
  for (const [k, fixture] of onDisk) {
    assert.deepEqual(embedded.get(k).calls ?? [], fixture.calls ?? [], `${fixture.label}: calls drifted from the fixture`);
  }
});
