import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseXbase } from "../plugins/input-xbase/parse.js";
import { lowerXbase } from "../plugins/input-xbase/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * dBase/Clipper/FoxPro (the "xBase" family): `@ row, col SAY ... GET ...`
 * full-screen statements built directly into procedural program source, with
 * no separate declarative designer file at all. A `READ` statement is the
 * real boundary that closes the run of statements since the previous one (or
 * the start of the file) into one screen, so it lowers onto the AngularJS
 * attribute dialect the rest of the tool already reads the same way
 * input-cics turns each `DFHMDI` map into its own screen.
 */

test("a bare SAY with no GET is a caption only, never an input", () => {
  const { screens } = parseXbase('@ 1, 1 SAY "CUSTOMER MAINTENANCE"\nREAD');
  const lowered = lowerXbase(screens[0], 1);
  assert.match(lowered.template, /<p>CUSTOMER MAINTENANCE<\/p>/);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
});

test("a SAY combined with a GET renders a caption and a real input bound to the field", () => {
  const { screens } = parseXbase('@ 3, 1 SAY "Cust No:" GET custno PICTURE "999999"\nREAD');
  const lowered = lowerXbase(screens[0], 1);
  assert.match(lowered.template, /<p>Cust No:<\/p>/);
  assert.match(lowered.template, /<input id="f-custno" type="text" ng-model="custno">/);
  assert.deepEqual(lowered.fields, ["custno"]);
  assert.equal(lowered.usesTwoWay, true);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a GET with no SAY is a bare input with no caption", () => {
  const { screens } = parseXbase("@ 9, 1 GET okButton\nREAD");
  const lowered = lowerXbase(screens[0], 1);
  assert.match(lowered.template, /<input id="f-okButton" type="text" ng-model="okButton">/);
  assert.doesNotMatch(lowered.template, /<p>/);
});

test("PICTURE is never named per occurrence, the restraint stated once in a comment instead", () => {
  const { screens } = parseXbase('@ 3, 1 SAY "Cust No:" GET custno PICTURE "999999"\n@ 5, 1 SAY "Qty:" GET qty PICTURE "9999"\nREAD');
  const lowered = lowerXbase(screens[0], 1);
  assert.equal(lowered.notes.filter((n) => /PICTURE/.test(n)).length, 0, "PICTURE carries no per-field note at all");
});

test("a VALID clause is named present on its field, never evaluated", () => {
  const { screens } = parseXbase('@ 5, 1 SAY "Name:" GET custname VALID !EMPTY(custname)\nREAD');
  const lowered = lowerXbase(screens[0], 1);
  assert.ok(lowered.notes.some((n) => /`custname` carries a VALID clause/.test(n)));
  assert.doesNotMatch(lowered.notes.join(" "), /EMPTY\(custname\)/, "the condition itself is never captured or evaluated");
});

test("a WHEN clause is named present on its field, never evaluated", () => {
  const { screens } = parseXbase('@ 5, 1 SAY "Name:" GET custname WHEN active\nREAD');
  const lowered = lowerXbase(screens[0], 1);
  assert.ok(lowered.notes.some((n) => /`custname` carries a WHEN clause/.test(n)));
  assert.doesNotMatch(lowered.notes.join(" "), /\bactive\b/, "the condition itself is never captured or evaluated");
});

test("a RANGE clause is named present on its field, never evaluated", () => {
  const { screens } = parseXbase('@ 5, 1 SAY "Qty:" GET qty RANGE 1, 999\nREAD');
  const lowered = lowerXbase(screens[0], 1);
  assert.ok(lowered.notes.some((n) => /`qty` carries a RANGE clause/.test(n)));
});

test("a DEFAULT clause is named present on its field, never read", () => {
  const { screens } = parseXbase('@ 5, 1 SAY "Qty:" GET qty DEFAULT 1\nREAD');
  const lowered = lowerXbase(screens[0], 1);
  assert.ok(lowered.notes.some((n) => /`qty` carries a DEFAULT clause/.test(n)));
});

test("a semicolon continued statement is joined before parsing", () => {
  const src = ['@ 7, 1 SAY "Active:" ;', '  GET activeflag PICTURE "Y"', "READ"].join("\n");
  const { screens, problems } = parseXbase(src);
  assert.deepEqual(problems, []);
  const lowered = lowerXbase(screens[0], 1);
  assert.match(lowered.template, /<p>Active:<\/p>/);
  assert.match(lowered.template, /ng-model="activeflag"/);
});

test("SAY, GET and READ are recognised case-insensitively", () => {
  const src = '@ 1, 1 say "Hi" get greeting\nread';
  const { screens } = parseXbase(src);
  assert.equal(screens.length, 1);
  const lowered = lowerXbase(screens[0], 1);
  assert.match(lowered.template, /<p>Hi<\/p>/);
  assert.match(lowered.template, /ng-model="greeting"/);
});

test("multiple READ statements produce multiple screens", () => {
  const src = [
    '@ 1, 1 SAY "First"',
    "READ",
    '@ 1, 1 SAY "Second"',
    "READ",
  ].join("\n");
  const { screens } = parseXbase(src);
  assert.equal(screens.length, 2);
  const first = lowerXbase(screens[0], 1);
  const second = lowerXbase(screens[1], 2);
  assert.match(first.template, /First/);
  assert.match(second.template, /Second/);
  assert.equal(first.title, "Screen1");
  assert.equal(second.title, "Screen2");
});

test("SAY/GET statements with no READ at all still produce one screen", () => {
  const src = '@ 1, 1 SAY "Display only"\n@ 3, 1 SAY "No fields, no READ"';
  const { screens } = parseXbase(src);
  assert.equal(screens.length, 1);
  const lowered = lowerXbase(screens[0], 1);
  assert.match(lowered.template, /Display only/);
  assert.match(lowered.template, /No fields, no READ/);
});

test("an @ statement missing a clean row, col pair is named as a structural problem and skipped", () => {
  const { screens, problems } = parseXbase('@ 5 SAY "no comma at all"\nREAD');
  assert.equal(screens.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no clear row, col pair/);
});

test("statements are ordered by row and column, not by declaration order", () => {
  const src = ['@ 5, 1 GET second', '@ 1, 1 GET first', '@ 5, 20 GET third', "READ"].join("\n");
  const { screens } = parseXbase(src);
  const lowered = lowerXbase(screens[0], 1);
  const order = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["first", "second", "third"]);
});

test("ordinary xBase source around the screen statements is ignored: PRIVATE, IF/ENDIF, assignments", () => {
  const src = [
    "PRIVATE custno",
    'custno := SPACE(8)',
    '@ 1, 1 SAY "Header" GET custno',
    "READ",
    "IF LASTKEY() = 27",
    "   RETURN",
    "ENDIF",
  ].join("\n");
  const { screens, problems } = parseXbase(src);
  assert.equal(screens.length, 1);
  assert.deepEqual(problems, []);
  assert.equal(screens[0].length, 1, "only the one @ statement was read; PRIVATE, IF, ENDIF and the assignment were not");
});

test("a full xBase customer maintenance file ports to React through the unchanged pipeline, with no raw xBase syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/xbase") });
  try {
    assert.equal(run.error, null);
    const xbaseScreens = run.ctx.screens.filter((s) => s.readBy === "xbase");
    assert.equal(xbaseScreens.length, 2, "one screen per READ");
    for (const s of xbaseScreens) assert.deepEqual(s.outputs, [], "xBase states no button, event or navigation, so no output is ever produced");

    const screen1 = xbaseScreens.find((s) => s.className === "Screen1");
    assert.ok(screen1, "the first screen was read and named Screen1");
    const jsx1 = await readFile(join(run.out, `src/features/${screen1.className}/${screen1.className}.jsx`), "utf8");
    assert.match(jsx1, /CUSTOMER MAINTENANCE/);
    assert.match(jsx1, /Cust No:/);
    assert.match(jsx1, /Active:/);
    assert.match(jsx1, /onChange=\{\(event\) => setCustno\(event\.target\.value\)\}/);
    assert.match(jsx1, /onChange=\{\(event\) => setActiveflag\(event\.target\.value\)\}/);
    assert.doesNotMatch(
      jsx1,
      /\bSAY\b|\bPICTURE\b|\bVALID\b|@ \d+, \d+/,
      "no raw xBase statement syntax survived into the port",
    );

    const screen2 = xbaseScreens.find((s) => s.className === "Screen2");
    assert.ok(screen2, "the second READ produced a second, separately named screen");
    const jsx2 = await readFile(join(run.out, `src/features/${screen2.className}/${screen2.className}.jsx`), "utf8");
    assert.match(jsx2, /CONFIRM DELETE\?/);

    const md = await readFile(join(run.out, "XBASE.md"), "utf8");
    assert.match(md, /customer\.prg/);
    assert.match(md, /Screen1/);
    assert.match(md, /Screen2/);
    assert.match(md, /VALID clause/);
    assert.doesNotMatch(
      md,
      /@ \d+, \d+|PICTURE "|!EMPTY\(custname\)/,
      "no raw xBase statement syntax (a position pair, a quoted mask, an unevaluated condition) reaches the report",
    );
  } finally {
    await run.cleanup();
  }
});
