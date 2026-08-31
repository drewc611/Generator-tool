import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  flattenSamples, measureColors, measureDensity, measureRadius, measureTypeScale,
  readStyleVariables, rolesFromVariables, toHex,
} from "../plugins/dsp-tokens/measure.js";
import { ROOT } from "./helpers.js";

const recorded = async () =>
  JSON.parse(await readFile(join(ROOT, "test/fixtures/recorded/observed.json"), "utf8"));

test("colors normalise to hex, and transparent is not a color", () => {
  assert.equal(toHex("rgb(0, 75, 135)"), "#004B87");
  assert.equal(toHex("#abc"), "#AABBCC");
  assert.equal(toHex("#004b87"), "#004B87");
  assert.equal(toHex("rgba(0, 0, 0, 0)"), null, "fully transparent is the absence of a color");
  assert.equal(toHex("rgba(0, 75, 135, 0.5)"), "#004B87");
  assert.equal(toHex("inherit"), null);
  assert.equal(toHex(null), null);
});

test("the base size is the size that appears most, not the middle of the range", () => {
  const samples = [
    ...Array(20).fill({ tag: "p", fontSize: 15 }),
    ...Array(3).fill({ tag: "h2", fontSize: 20 }),
    ...Array(2).fill({ tag: "h1", fontSize: 30 }),
    ...Array(4).fill({ tag: "th", fontSize: 13 }),
  ];
  const { scale } = measureTypeScale(samples);
  assert.equal(scale.md, 15);
  assert.equal(scale.sm, 13);
  assert.equal(scale.lg, 20);
  assert.equal(scale.xl, 30);
});

test("sizes seen once are a tail of accidents, not steps in the scale", () => {
  const samples = [
    ...Array(20).fill({ tag: "p", fontSize: 15 }),
    ...Array(4).fill({ tag: "h1", fontSize: 30 }),
    { tag: "sup", fontSize: 9 },
    { tag: "small", fontSize: 11 },
  ];
  const { scale } = measureTypeScale(samples);
  assert.equal(scale.md, 15);
  assert.ok(!Object.values(scale).includes(9), "a size seen once is not a step");
});

test("nothing to measure returns nothing rather than a guess", () => {
  assert.equal(measureTypeScale([]), null);
  assert.equal(measureTypeScale([{ fontSize: 15 }]), null);
  assert.equal(measureDensity([]), null);
  assert.equal(measureRadius([{ radius: 0 }]), null);
  assert.equal(measureColors([], null), null);
});

test("density comes from the median row height", () => {
  assert.equal(measureDensity([30, 31, 32]).density, "compact");
  assert.equal(measureDensity([40, 41, 42]).density, "comfortable");
  assert.equal(measureDensity([60, 61, 62]).density, "roomy");
  assert.equal(measureDensity([41, 41, 41]).rowHeight, 41);
});

// The bug this guards: a button's blue background winning the surface role and
// painting every panel in the port brand blue.
test("a control does not get a vote on ink or surface", () => {
  const samples = [
    ...Array(10).fill({ tag: "p", color: "rgb(28, 27, 25)", background: "rgba(0,0,0,0)" }),
    ...Array(9).fill({ tag: "button", color: "rgb(255,255,255)", background: "rgb(0, 75, 135)" }),
  ];
  const { color } = measureColors(samples, "rgb(251, 250, 248)");
  assert.equal(color.ink, "#1C1B19");
  assert.equal(color.bg, "#FBFAF8");
  assert.ok(!("surface" in color), "no non control background was painted, so none is claimed");
  assert.notEqual(color.ink, "#FFFFFF");
});

test("a real panel background does become the surface", () => {
  const samples = [
    ...Array(6).fill({ tag: "td", color: "rgb(28,27,25)", background: "rgb(255,255,255)" }),
    ...Array(3).fill({ tag: "button", color: "rgb(255,255,255)", background: "rgb(0,75,135)" }),
  ];
  assert.equal(measureColors(samples, "rgb(251,250,248)").color.surface, "#FFFFFF");
});

test("declared variables are read from css and scss alike", () => {
  const vars = readStyleVariables(":root { --brand: #004B87; --text-muted: #6B675F; }\n$radius-base: 6px;");
  assert.equal(vars.brand, "#004B87");
  assert.equal(vars["text-muted"], "#6B675F");
  assert.equal(vars["radius-base"], "6px");
});

test("a variable name states intent, so it maps to a role", () => {
  const { color } = rolesFromVariables({ brand: "#004B87", "error-red": "#A3231F", spacing: "8px" });
  assert.equal(color.accent, "#004B87");
  assert.equal(color.danger, "#A3231F");
  assert.ok(!("spacing" in color), "a length is not a color");
});

test("the recorded fixture measures the way a recording should", async () => {
  const { samples, rowHeights, font, pageBackground } = flattenSamples(await recorded());
  assert.ok(samples.length > 40);

  const { scale } = measureTypeScale(samples);
  assert.equal(scale.md, 15, "body copy");
  assert.equal(scale.xl, 30);

  const density = measureDensity(rowHeights);
  assert.equal(density.density, "comfortable");
  assert.equal(density.rowHeight, 41);

  const { color } = measureColors(samples, pageBackground);
  assert.equal(color.bg, "#FBFAF8");
  assert.equal(color.ink, "#1C1B19");
  assert.equal(color.inkMuted, "#6B675F");

  assert.equal(measureRadius(samples).control, 6);
  assert.match(font, /Inter/);
});

test("flattening tolerates a recording with nothing in it", () => {
  const empty = flattenSamples([]);
  assert.deepEqual(empty.samples, []);
  assert.equal(empty.font, null);
  assert.deepEqual(flattenSamples([{ route: "x" }]).rowHeights, []);
});
