import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildModel } from "../plugins/dsp-behavior/model.js";
import { contrastRatio, findIssues, luminance, parseColor } from "../plugins/dsp-improve/findings.js";
import { ROOT } from "./helpers.js";

const exploration = JSON.parse(
  await readFile(join(ROOT, "test/fixtures/explored/exploration.json"), "utf8")
);
const findings = findIssues(exploration, buildModel(exploration));
const of = (kind) => findings.filter((f) => f.kind === kind);

test("contrast is the WCAG ratio, not an impression", () => {
  assert.deepEqual(parseColor("rgb(0, 75, 135)"), { r: 0, g: 75, b: 135, a: 1 });
  assert.equal(parseColor("nonsense"), null);
  assert.equal(Math.round(luminance({ r: 255, g: 255, b: 255 })), 1);
  assert.equal(contrastRatio("rgb(0,0,0)", "rgb(255,255,255)"), 21);
  assert.equal(contrastRatio("rgb(255,255,255)", "rgb(255,255,255)"), 1);
  assert.equal(contrastRatio("bad", "rgb(0,0,0)"), null);
});

test("the muted text the original never checked is caught with its numbers", () => {
  const [hit] = of("contrast");
  assert.ok(hit, "the #bbbbbb muted text should be found");
  assert.match(hit.evidence, /1\.84:1/);
  assert.match(hit.evidence, /under the 4\.5:1/);
  assert.equal(hit.severity, "high");
});

test("a glyph is not an accessible name", () => {
  const named = of("accessible-name");
  assert.equal(named.length, 1);
  assert.match(named[0].evidence, /↻/);
  assert.match(named[0].instead, /aria-label/);
});

test("a placeholder is not a label", () => {
  const [hit] = of("unlabelled-field");
  assert.equal(hit.element, "#q");
  assert.match(hit.evidence, /placeholder "Filter by customer"/);
  assert.match(hit.evidence, /disappears/);
  assert.ok(!of("unlabelled-field").some((f) => f.element === "#customer"), "the labelled field is not flagged");
});

test("targets under the minimum are measured, not guessed", () => {
  const icon = of("tap-target").find((f) => f.element === "#refresh");
  assert.match(icon.evidence, /24x24px/);
  assert.match(icon.evidence, /44px minimum/);
});

test("an empty state is asked of a collection, not of a form", () => {
  const empties = of("missing-state").filter((f) => f.evidence.includes("empty"));
  assert.ok(empties.length >= 1);
  assert.ok(
    empties.every((f) => !/New order/.test(f.element)),
    "a form does not need an apology for having no rows"
  );
});

test("every finding names where it came from and what the port does instead", () => {
  assert.ok(findings.length > 5);
  for (const f of findings) {
    assert.ok(f.screen, `${f.kind} has no screen`);
    assert.ok(f.element, `${f.kind} has no element`);
    assert.ok(f.evidence?.length > 10, `${f.kind} has no evidence`);
    assert.ok(f.instead?.length > 10, `${f.kind} says nothing about the fix`);
    assert.ok(["high", "medium", "low"].includes(f.severity));
  }
});

test("the serious findings come first", () => {
  const order = findings.map((f) => f.severity);
  assert.deepEqual(order, [...order].sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b]));
});

test("nothing observed means nothing claimed", () => {
  assert.deepEqual(findIssues({ screens: [] }, { screens: [], wiring: [] }), []);
});
