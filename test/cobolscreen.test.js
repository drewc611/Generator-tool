import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseCobolScreen } from "../plugins/input-cobolscreen/parse.js";
import { lowerCobolScreen } from "../plugins/input-cobolscreen/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A standard ANSI/ISO COBOL program's `SCREEN SECTION`, the DATA DIVISION
 * section that has declared a character-cell terminal screen directly in
 * COBOL source since COBOL-85. An `01` level entry is one physical screen,
 * the same "one structural unit, one screen" shape input-cics already gives
 * a `DFHMDI` map.
 */

test("a VALUE literal becomes a caption, never bound to anything", () => {
  const src = `
       SCREEN SECTION.
       01 GREET-SCREEN.
           02 LINE 1 COLUMN 1 VALUE "Hello there".`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.match(lowered.template, /<p>Hello there<\/p>/);
  assert.deepEqual(lowered.fields, []);
});

test("PIC together with USING becomes a real enterable input bound by camelCased name", () => {
  const src = `
       SCREEN SECTION.
       01 CUST-SCREEN.
           02 LINE 3 COLUMN 15 PIC 9(8) USING WS-CUST-NO.`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.match(lowered.template, /<input id="f-wsCustNo" type="text" ng-model="wsCustNo">/);
  assert.deepEqual(lowered.fields, ["wsCustNo"]);
  assert.equal(lowered.usesTwoWay, true);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("PIC together with TO also becomes a real enterable input", () => {
  const src = `
       SCREEN SECTION.
       01 ORDER-SCREEN.
           02 LINE 1 COLUMN 1 PIC 9(4) TO WS-ORDER-QTY.`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.match(lowered.template, /ng-model="wsOrderQty"/);
  assert.deepEqual(lowered.fields, ["wsOrderQty"]);
});

test("PIC together with FROM is display only: a read only interpolation, not a two way field", () => {
  const src = `
       SCREEN SECTION.
       01 STATUS-SCREEN.
           02 LINE 9 COLUMN 10 PIC X(20) FROM WS-STATUS-MSG.`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.match(lowered.template, /<span>\{\{ wsStatusMsg \}\}<\/span>/);
  assert.deepEqual(lowered.fields, [], "a FROM field is not the screen's own editable state");
});

test("REQUIRED is named through a note, never invented as an HTML required attribute", () => {
  const src = `
       SCREEN SECTION.
       01 CUST-SCREEN.
           02 LINE 7 COLUMN 10 PIC X USING WS-ACTIVE-FLAG REQUIRED.`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.doesNotMatch(lowered.template, /\brequired\b/i);
  assert.ok(lowered.notes.some((n) => /`wsActiveFlag` is marked REQUIRED/.test(n)));
});

test("BLANK SCREEN is skipped silently, no note", () => {
  const src = `
       SCREEN SECTION.
       01 CUST-SCREEN.
           02 BLANK SCREEN.
           02 LINE 1 COLUMN 1 VALUE "Hi".`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.equal(lowered.notes.length, 0);
  assert.match(lowered.template, /<p>Hi<\/p>/);
});

test("a formatting clause like HIGHLIGHT is never named per occurrence", () => {
  const src = `
       SCREEN SECTION.
       01 CUST-SCREEN.
           02 LINE 1 COLUMN 1 VALUE "Loud" HIGHLIGHT REVERSE-VIDEO BLINK.`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.equal(lowered.notes.length, 0);
  assert.doesNotMatch(lowered.notes.join(" "), /HIGHLIGHT|REVERSE-VIDEO|BLINK/);
});

test("AUTO is ignored silently, carrying no rendering meaning", () => {
  const src = `
       SCREEN SECTION.
       01 CUST-SCREEN.
           02 LINE 1 COLUMN 1 PIC 9(2) USING WS-CODE AUTO.`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.equal(lowered.notes.length, 0);
});

test("a PIC clause with none of USING/FROM/TO is named through a note rather than guessed", () => {
  const src = `
       SCREEN SECTION.
       01 CUST-SCREEN.
           02 LINE 1 COLUMN 1 PIC X(10).`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.doesNotMatch(lowered.template, /<input|<span/);
  assert.ok(lowered.notes.some((n) => /declares a PIC\/PICTURE clause with none of USING, FROM or TO/.test(n)));
});

test("a relative LINE PLUS/COLUMN PLUS entry is renderable in declaration order, its exact position named as not computed", () => {
  const src = `
       SCREEN SECTION.
       01 CUST-SCREEN.
           02 LINE 1 COLUMN 1 VALUE "Top".
           02 LINE PLUS 2 COLUMN PLUS 1 VALUE "Below".`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  const order = [...lowered.template.matchAll(/<p>([^<]*)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(order, ["Top", "Below"], "still rendered, in declaration order");
  assert.ok(lowered.notes.some((n) => /"Below" uses a relative LINE PLUS\/COLUMN PLUS position/.test(n)));
});

test("a hyphenated COBOL data-name is camelCased for the emitted binding", () => {
  const src = `
       SCREEN SECTION.
       01 CUST-SCREEN.
           02 LINE 1 COLUMN 1 PIC X(30) USING WS-CUST-FULL-NAME.`;
  const { screens } = parseCobolScreen(src);
  const lowered = lowerCobolScreen(screens[0]);
  assert.match(lowered.template, /ng-model="wsCustFullName"/);
});

test("multiple 01 level entries in one SCREEN SECTION become multiple screens", () => {
  const src = `
       SCREEN SECTION.
       01 FIRST-SCREEN.
           02 LINE 1 COLUMN 1 PIC 9(4) USING WS-FIRST.
       01 SECOND-SCREEN.
           02 LINE 1 COLUMN 1 PIC 9(4) USING WS-SECOND.`;
  const { screens } = parseCobolScreen(src);
  assert.equal(screens.length, 2);
  const lowered = screens.map((s) => lowerCobolScreen(s));
  assert.deepEqual(lowered.map((l) => l.title), ["FIRST-SCREEN", "SECOND-SCREEN"]);
  assert.deepEqual(lowered[0].fields, ["wsFirst"]);
  assert.deepEqual(lowered[1].fields, ["wsSecond"]);
});

test("SCREEN SECTION is recognised case-insensitively", () => {
  for (const header of ["SCREEN SECTION.", "screen section.", "Screen Section."]) {
    const src = `\n       ${header}\n       01 X-SCREEN.\n           02 LINE 1 COLUMN 1 VALUE "Hi".`;
    const { found, screens } = parseCobolScreen(src);
    assert.equal(found, true, `"${header}" should be recognised`);
    assert.equal(screens.length, 1);
  }
});

test("a file with no SCREEN SECTION at all produces no screens, not a gap", () => {
  const src = `
       IDENTIFICATION DIVISION.
       PROGRAM-ID. NOSCREEN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-X PIC X.`;
  const { found, screens, problems } = parseCobolScreen(src);
  assert.equal(found, false);
  assert.deepEqual(screens, []);
  assert.deepEqual(problems, []);
});

test("content outside the SCREEN SECTION never leaks in", () => {
  const src = `
       WORKING-STORAGE SECTION.
       01 WS-NEVER-SCREENED PIC X(5).

       SCREEN SECTION.
       01 CUST-SCREEN.
           02 LINE 1 COLUMN 1 PIC 9(8) USING WS-CUST-NO.

       PROCEDURE DIVISION.
       DISPLAY "not part of any screen".`;
  const { screens } = parseCobolScreen(src);
  assert.equal(screens.length, 1);
  assert.equal(screens[0].entries.length, 2, "the 01 header entry plus the one field entry, nothing from outside the section");
  const lowered = lowerCobolScreen(screens[0]);
  assert.doesNotMatch(lowered.template, /WS-NEVER-SCREENED|wsNeverScreened|not part of any screen/);
});

test("a COBOL SCREEN SECTION ports to React through the unchanged pipeline, with no raw COBOL syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/cobolscreen") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "cobolscreen");
    assert.ok(screen, "the COBOL SCREEN SECTION was read");
    assert.deepEqual(screen.outputs, [], "a SCREEN SECTION states no button, event or navigation, so no output is ever produced");
    assert.equal(screen.className, "CustScreen");

    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");
    assert.match(jsx, /CUSTOMER MAINTENANCE/);
    assert.match(jsx, /Cust No:/);
    assert.match(jsx, /Name:/);
    assert.match(jsx, /value=\{wsCustNo\}/);
    assert.match(jsx, /onChange=\{\(event\) => setWsCustNo\(event\.target\.value\)\}/);
    assert.match(jsx, /onChange=\{\(event\) => setWsCustName\(event\.target\.value\)\}/);
    assert.doesNotMatch(
      jsx,
      /\bPIC\b|\bUSING\b|SCREEN SECTION|\bVALUE\b|WS-CUST-NO|WS-CUST-NAME|WORKING-STORAGE|PROCEDURE DIVISION/,
      "no raw COBOL syntax or hyphenated data-name survived into the port",
    );

    const md = await readFile(join(run.out, "COBOLSCREEN.md"), "utf8");
    assert.match(md, /CUSTMAINT\.cbl/);
    assert.match(md, /CUST-SCREEN/);
    assert.match(md, /is marked REQUIRED/);
    assert.doesNotMatch(
      md,
      /\bPIC\b|\bUSING\b|SCREEN SECTION|WORKING-STORAGE|PROCEDURE DIVISION/,
      "no raw COBOL syntax reaches the report",
    );
  } finally {
    await run.cleanup();
  }
});
