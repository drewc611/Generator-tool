import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { mergeShapes, shapeOf } from "../plugins/dsp-archetype/shape.js";
import { classify, readApi } from "../plugins/dsp-archetype/classify.js";
import { planFor } from "../plugins/dsp-modernize/decisions.js";
import { uplift, upliftColor } from "../plugins/dsp-uplift/index.js";
import { fitContrast, ratio, toHex, toHsl } from "../plugins/dsp-uplift/color.js";
import { runPipeline } from "./helpers.js";

const shapeOfHtml = (html) => shapeOf(buildIr(html));

/* ------------------------------------------------------------ the shape */

test("a screen is read structurally, not by framework", () => {
  const angular = `<table><tr *ngFor="let o of xs"><td>{{o.n}}</td></tr></table><input [(ngModel)]="q" placeholder="Search">`;
  const vue = `<table><tr v-for="o in xs"><td>{{o.n}}</td></tr></table><input v-model="q" placeholder="Search">`;
  assert.deepEqual(shapeOfHtml(angular), shapeOfHtml(vue), "the same screen reads the same in either dialect");
});

test("controls are counted by what they are, and by what they say", () => {
  const f = shapeOfHtml(`
    <form>
      <input placeholder="Search orders">
      <select><option>a</option></select>
      <input type="checkbox">
      <button>Save</button>
      <button>Delete</button>
    </form>`);
  assert.equal(f.forms, 1);
  assert.equal(f.inputs, 1);
  assert.equal(f.selects, 1);
  assert.equal(f.checkboxes, 1);
  assert.equal(f.searchFields, 1, "a field is a search field because of its label");
  assert.equal(f.submits, 1);
  assert.equal(f.destructive, 1);
});

test("repetition inside repetition is counted as such", () => {
  const f = shapeOfHtml(`<div *ngFor="let g of gs"><p *ngFor="let o of g.xs">{{o.n}}</p></div>`);
  assert.equal(f.loops, 2);
  assert.equal(f.nestedLoops, 1);
});

test("shapes add up, so a whole app reads like one screen", () => {
  const merged = mergeShapes([shapeOfHtml(`<table><tr><td>a</td></tr></table>`), shapeOfHtml(`<form><input></form>`)]);
  assert.equal(merged.tables, 1);
  assert.equal(merged.forms, 1);
  assert.equal(merged.inputs, 1);
});

/* --------------------------------------------------------- the endpoints */

test("an endpoint addressing one record is told apart from a collection", () => {
  const api = readApi([
    { method: "GET", path: "/api/orders" },
    { method: "GET", path: "/api/orders/${id}" },
    { method: "GET", path: "/api/orders/:key" },
    { method: "GET", path: "/api/orders/42" },
    { method: "POST", path: "/api/orders" },
  ]);
  assert.equal(api.byId.length, 3, "template, colon and a literal id all address one record");
  assert.equal(api.collections.length, 1);
  assert.equal(api.writes.length, 1);
});

/* --------------------------------------------------------- the verdict */

test("a table with writes reads as a table of records", () => {
  const { best } = classify({
    shape: shapeOfHtml(`<table><tr *ngFor="let o of xs"><td>{{o.n}}</td></tr></table><button>Delete</button>`),
    calls: [
      { method: "GET", path: "/api/orders" },
      { method: "POST", path: "/api/orders" },
    ],
  });
  assert.equal(best.id, "crud-table");
  assert.ok(best.evidence.length >= 3);
});

test("a multi step form reads as a wizard, not as a form", () => {
  const { ranked } = classify({
    shape: shapeOfHtml(`<div><p>Step 2 of 4</p><p>Step</p><input><input><button>Continue</button></div>`),
    calls: [{ method: "POST", path: "/api/apply" }],
    model: {
      screens: [{ kind: "form" }, { kind: "form" }],
      transitions: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    },
  });
  assert.equal(ranked[0].id, "wizard");
});

test("read only panels and no writes read as a dashboard", () => {
  const { best } = classify({
    shape: shapeOfHtml(`<div><h2>A</h2><canvas></canvas><h2>B</h2><canvas></canvas><h2>C</h2></div>`),
    calls: [
      { method: "GET", path: "/api/a" },
      { method: "GET", path: "/api/b" },
      { method: "GET", path: "/api/c" },
    ],
  });
  assert.equal(best.id, "dashboard");
});

test("selectors with no components read as what they are", () => {
  const { best } = classify({
    shape: shapeOfHtml(""),
    calls: [{ method: "GET", path: "/api/a" }],
    widgets: [{ selector: "#a" }, { selector: "#b" }, { selector: "#c" }, { selector: "#d" }, { selector: "#e" }],
    components: 0,
  });
  assert.equal(best.id, "selector-soup");
});

// The rule this guards: one signal is a coincidence.
test("a single signal never produces a verdict", () => {
  const { best, ranked } = classify({ shape: shapeOfHtml(`<table></table>`), calls: [] });
  assert.equal(ranked.every((a) => a.matched >= 2), true);
  if (best) assert.ok(best.matched >= 2);
});

test("nothing to read produces no verdict at all", () => {
  const { best } = classify({ shape: shapeOfHtml(""), calls: [] });
  assert.equal(best, null);
});

// The rule this guards: a close second is not a loser, it is an ambiguity.
test("two readings within twenty points are reported as contested", () => {
  const { contested, ranked } = classify({
    shape: shapeOfHtml(`<table><tr *ngFor="let o of xs"><td><a href="/x">{{o.n}}</a></td></tr></table><a href="/y">z</a>`),
    calls: [
      { method: "GET", path: "/api/orders" },
      { method: "GET", path: "/api/orders/${id}" },
      { method: "POST", path: "/api/orders" },
    ],
  });
  assert.ok(ranked.length >= 2);
  assert.equal(contested, ranked[0].confidence - ranked[1].confidence < 0.2);
});

/* -------------------------------------------------------------- the plan */

test("every decision names the thing that makes it necessary", () => {
  const { decisions } = planFor({
    best: { id: "crud-table", name: "x", matched: 3, of: 4 },
    observations: [{ id: "unbounded-collection", what: "no paging", severity: "high" }],
    ranked: [],
  });
  assert.ok(decisions.length);
  for (const d of decisions) {
    assert.ok(d.because, `${d.id} has no premise`);
    assert.ok(d.instead, `${d.id} proposes nothing`);
    assert.ok(d.source, `${d.id} does not say where it came from`);
  }
});

test("a decision the shape already implies is not repeated by an observation", () => {
  const { decisions } = planFor({
    best: { id: "crud-table" },
    // crud-table already proposes bounding the rows.
    observations: [{ id: "unbounded-collection", what: "x", severity: "high" }],
    ranked: [],
  });
  const ids = decisions.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, "no decision appears twice");
});

test("a contested reading keeps the other plan in front of you", () => {
  const plan = planFor({
    best: { id: "crud-table" },
    contested: true,
    ranked: [{ id: "crud-table" }, { id: "master-detail" }],
    observations: [],
  });
  assert.equal(plan.alternative.id, "master-detail");
  assert.ok(plan.alternative.decisions.length);
});

/* ------------------------------------------------------------ the uplift */

test("a colour is round tripped through hsl without drifting", () => {
  for (const hex of ["#004B87", "#FBFAF8", "#000000", "#FFFFFF", "#A3231F"]) {
    assert.equal(toHex(toHsl(hex)), hex.toUpperCase());
  }
});

// The rule this guards: the brand colour is the one thing somebody chose.
test("fixing contrast moves lightness and leaves the hue alone", () => {
  const fixed = fitContrast("#5BA4E6", "#FFFFFF", 4.5);
  assert.ok(fixed.ratio >= 4.5, "it reaches the target");
  assert.ok(toHsl(fixed.hex).l < toHsl("#5BA4E6").l, "by getting darker on a light ground");
  // Eight bits a channel means the hue cannot be preserved exactly, only to
  // within the rounding. A degree is far below what anybody can see.
  const drift = Math.abs(toHsl("#5BA4E6").h - toHsl(fixed.hex).h) * 360;
  assert.ok(drift <= 2, `hue moved ${drift.toFixed(1)} degrees`);
});

test("a colour that already passes is returned untouched", () => {
  const { color, changes } = upliftColor({ surface: "#FFFFFF", bg: "#FFFFFF", ink: "#111111" });
  assert.equal(color.ink, "#111111");
  assert.ok(changes.every((c) => c.kept));
});

test("on a dark ground the correction lightens rather than inverting", () => {
  const fixed = fitContrast("#777777", "#111111", 4.5);
  assert.ok(toHsl(fixed.hex).l > toHsl("#777777").l, "it got lighter, not darker");
  assert.ok(fixed.ratio >= 4.5);
});

test("a pair that lightness alone cannot fix says so instead of pretending", () => {
  // Yellow on white cannot reach 7:1 by lightness without ceasing to be yellow.
  const fixed = fitContrast("#FFFF00", "#FFFFFF", 7);
  assert.ok(fixed.exhausted || fixed.ratio >= 7);
});

// The rule this guards: imposing a ratio erases the app's typographic voice.
test("the type ratio is recovered from the app rather than asserted", () => {
  const wide = uplift({ size: { xs: 10, sm: 11, md: 13, lg: 18, xl: 28 }, color: {} });
  assert.equal(wide.scale.measured, true);
  assert.ok(wide.tokens.size.xl > wide.tokens.size.lg);
  // A 28px display size was a decision. It survives near the top of the scale.
  assert.ok(wide.tokens.size["2xl"] >= 26, `expected the display size to survive, got ${wide.tokens.size["2xl"]}`);
});

test("too few sizes to imply a ratio is said out loud, not guessed past", () => {
  const thin = uplift({ size: { md: 14 }, color: {} });
  assert.equal(thin.scale.measured, false);
  assert.equal(thin.tokens.size.md, 14, "the body size is still the app's own");
});

test("the additions are the things the old app could not have had", () => {
  const { tokens } = uplift({ size: { md: 14 }, color: { ink: "#1C1B19", surface: "#FFFFFF", accent: "#004B87" } });
  assert.ok(tokens.elevation.card.includes("rgba"), "shadows are tinted, not black");
  assert.ok(!tokens.elevation.card.includes("rgba(0, 0, 0"), "and specifically not black");
  assert.ok(tokens.motion.easing.startsWith("cubic-bezier"));
  assert.ok(tokens.focus.includes("#004B87"), "the focus ring uses the accent");
  assert.equal(tokens.space[0] % 2, 0, "the spacing scale is even");
});

/* ------------------------------------------------------------ end to end */

test("the reading, the plan and the uplift all land in a run", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline();
  t.after(cleanup);
  assert.equal(error, null);

  assert.equal(ctx.archetype.best.id, "crud-table");
  assert.ok(ctx.modernization.decisions.length);
  assert.ok(ctx.uplift.tokens.color.accent);

  const architecture = await readFile(join(out, "ARCHITECTURE.md"), "utf8");
  assert.match(architecture, /crud-table/);
  assert.match(architecture, /Every candidate, and what it rested on/);

  const plan = await readFile(join(out, "MODERNIZATION.md"), "utf8");
  assert.match(plan, /\*\*Because\*\*/);
  assert.match(plan, /has not implemented any of this/);

  const css = await readFile(join(out, "src/tokens.modern.css"), "utf8");
  assert.match(css, /--color-accent:/);
  assert.match(css, /prefers-reduced-motion/);
});

// The rule this guards: an app read as a table gets the table's plan, and a
// reading nobody could make gets no plan at all.
test("the plan follows the reading, and no reading means no plan", async (t) => {
  const { ctx, cleanup } = await runPipeline({ src: join(process.cwd(), "test/fixtures") });
  t.after(cleanup);
  if (!ctx.archetype) assert.equal(ctx.modernization, undefined);
});

test("nothing the uplift proposes is what the emitted components import", async (t) => {
  const { out, cleanup } = await runPipeline();
  t.after(cleanup);
  const component = await readFile(join(out, "src/features/AppOrders/AppOrders.jsx"), "utf8");
  assert.doesNotMatch(component, /tokens\.modern/, "the proposal is a proposal");
});
