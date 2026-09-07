import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseCics } from "../plugins/input-cics/parse.js";
import { lowerCics } from "../plugins/input-cics/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * IBM CICS BMS (Basic Mapping Support) `.bms` map definitions, the assembler
 * macro source that has laid out mainframe 3270 "green screen" terminal
 * screens since the 1970s. A `DFHMDI` map is one physical screen, so each
 * lowers onto the AngularJS attribute dialect the rest of the tool already
 * reads, one screen per map, the same "one structural unit, one screen"
 * shape input-storyboard already gives a multi scene storyboard.
 */

test("a protected field with an INITIAL value becomes a caption, never an input", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
CUSTNOL  DFHMDF POS=(03,01),LENGTH=9,ATTRB=(PROT),INITIAL='Cust No:'
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  assert.match(lowered.template, /<p>Cust No:<\/p>/);
  assert.doesNotMatch(lowered.template, /ng-model="CUSTNOL"|<input/);
  assert.deepEqual(lowered.fields, []);
});

test("an unprotected labeled field becomes a real input bound to its own name", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
CUSTNO   DFHMDF POS=(03,15),LENGTH=8,ATTRB=(UNPROT)
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  assert.match(lowered.template, /<input id="f-CUSTNO" type="text" ng-model="CUSTNO">/);
  assert.deepEqual(lowered.fields, ["CUSTNO"]);
  assert.equal(lowered.usesTwoWay, true);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("an unlabeled protected field with an INITIAL value renders as a positional literal, a caption only", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
         DFHMDF POS=(01,01),LENGTH=20,ATTRB=(PROT,BRT),INITIAL='CUSTOMER MAINTENANCE'
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  assert.match(lowered.template, /<p>CUSTOMER MAINTENANCE<\/p>/);
  assert.equal(lowered.notes.length, 0, "a captioned literal with no label is not a gap");
});

test("a protected field with neither INITIAL nor a label is empty screen furniture, skipped silently", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
         DFHMDF POS=(10,01),LENGTH=5,ATTRB=(PROT)
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  assert.equal(lowered.template, "<div>\n</div>");
  assert.equal(lowered.notes.length, 0);
});

test("an unlabeled UNPROT field is named through a note rather than given an invented name", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
         DFHMDF POS=(07,01),LENGTH=8,ATTRB=(UNPROT)
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  assert.deepEqual(lowered.fields, []);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.ok(lowered.notes.some((n) => /field open for typing at row 7, column 1 carries no label/.test(n)));
});

test("a NUM field is rendered as a plain text input, with the numeric-only fact named", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
CUSTNO   DFHMDF POS=(03,15),LENGTH=8,ATTRB=(UNPROT,NUM,IC)
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  assert.match(lowered.template, /<input id="f-CUSTNO" type="text" ng-model="CUSTNO">/);
  assert.ok(lowered.notes.some((n) => /`CUSTNO` is declared numeric only/.test(n)));
  assert.doesNotMatch(lowered.notes.join(" "), /\bIC\b/, "IC carries no rendering meaning and is ignored silently");
});

test("an INITIAL value that is not a clean quoted literal is named rather than guessed", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
GREETING DFHMDF POS=(01,01),LENGTH=20,ATTRB=(PROT),INITIAL=&GREETVAR
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  assert.doesNotMatch(lowered.template, /<p>/);
  assert.ok(lowered.notes.some((n) => /`GREETING`'s initial value is not a plain quoted literal/.test(n)));
});

test("a GRPNAME grouping is named once per map, never turned into a radio group", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
OPT1     DFHMDF POS=(01,01),LENGTH=1,ATTRB=(UNPROT),GRPNAME=OPTGRP
OPT2     DFHMDF POS=(02,01),LENGTH=1,ATTRB=(UNPROT),GRPNAME=OPTGRP
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  const grpNotes = lowered.notes.filter((n) => /GRPNAME grouping/.test(n));
  assert.equal(grpNotes.length, 1, "named once per map, not once per field");
  assert.match(grpNotes[0], /OPTGRP/);
  assert.doesNotMatch(lowered.template, /radio/);
});

test("fields are ordered by position, top to bottom, left to right, regardless of declaration order", () => {
  const src = `CUSTMAP  DFHMSD TYPE=MAP
CUSTMAP1 DFHMDI SIZE=(24,80)
SECOND   DFHMDF POS=(05,01),LENGTH=4,ATTRB=(UNPROT)
FIRST    DFHMDF POS=(01,10),LENGTH=4,ATTRB=(UNPROT)
THIRD    DFHMDF POS=(05,20),LENGTH=4,ATTRB=(UNPROT)
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  const order = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["FIRST", "SECOND", "THIRD"]);
});

test("multiple DFHMDI maps in one mapset become multiple screens", () => {
  const src = `ORDMAP   DFHMSD TYPE=MAP
ORDMAP1  DFHMDI SIZE=(24,80)
ORDNO    DFHMDF POS=(01,01),LENGTH=6,ATTRB=(UNPROT)
ORDMAP2  DFHMDI SIZE=(24,80)
ORDQTY   DFHMDF POS=(01,01),LENGTH=3,ATTRB=(UNPROT)
         DFHMSD TYPE=FINAL`;
  const { mapsets } = parseCics(src);
  assert.equal(mapsets.length, 1);
  assert.equal(mapsets[0].maps.length, 2);
  const screens = mapsets[0].maps.map((m) => lowerCics(m, mapsets[0].label));
  assert.deepEqual(screens.map((s) => s.title), ["ORDMAP1", "ORDMAP2"]);
  assert.deepEqual(screens[0].fields, ["ORDNO"]);
  assert.deepEqual(screens[1].fields, ["ORDQTY"]);
});

test("continuation lines, with and without a trailing X marker, join into one logical macro", () => {
  const src = [
    "CUSTMAP  DFHMSD TYPE=&SYSPARM,                                        X",
    "               MODE=INOUT,                                            X",
    "               LANG=COBOL,                                            X",
    "               CTRL=FREEKB",
    "CUSTMAP1 DFHMDI SIZE=(24,80)",
    "CUSTNOL  DFHMDF POS=(03,01),LENGTH=9,ATTRB=(PROT),",
    "               INITIAL='Cust No:'",
    "         DFHMSD TYPE=FINAL",
  ].join("\n");
  const { mapsets, problems } = parseCics(src);
  assert.deepEqual(problems, []);
  assert.equal(mapsets.length, 1);
  const lowered = lowerCics(mapsets[0].maps[0], mapsets[0].label);
  assert.match(lowered.template, /<p>Cust No:<\/p>/);
});

test("a DFHMDI with no open DFHMSD, and a DFHMDF with no open DFHMDI, are named as structural problems and skipped", () => {
  const src = [
    "STRAY1   DFHMDI SIZE=(24,80)",
    "CUSTMAP  DFHMSD TYPE=MAP",
    "STRAY2   DFHMDF POS=(01,01),LENGTH=4,ATTRB=(UNPROT)",
    "         DFHMSD TYPE=FINAL",
  ].join("\n");
  const { mapsets, problems } = parseCics(src);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /DFHMDI.*no DFHMSD mapset open/);
  assert.match(problems[1], /DFHMDF.*no DFHMDI map open/);
  assert.equal(mapsets[0].maps.length, 0);
});

test("a CICS BMS login/lookup screen ports to React through the unchanged pipeline, with no raw BMS syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/cics") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "cics");
    assert.ok(screen, "the CICS BMS map was read");
    assert.deepEqual(screen.outputs, [], "BMS states no button, event or navigation, so no output is ever produced");
    assert.equal(screen.className, "Custmap1");

    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");
    assert.match(jsx, /CUSTOMER MAINTENANCE/);
    assert.match(jsx, /Cust No:/);
    assert.match(jsx, /Name:/);
    assert.match(jsx, /ng-model|value=\{CUSTNO\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setCUSTNO\(event\.target\.value\)\}/);
    assert.match(jsx, /onChange=\{\(event\) => setCUSTNAM\(event\.target\.value\)\}/);
    assert.doesNotMatch(
      jsx,
      /DFHMDF|DFHMSD|DFHMDI|ATTRB=|POS=\(|PROT|UNPROT/,
      "no raw BMS macro or operand syntax survived into the port",
    );

    const md = await readFile(join(run.out, "CICS.md"), "utf8");
    assert.match(md, /CUSTMAP\.bms/);
    assert.match(md, /CUSTMAP1/);
    assert.match(md, /is declared numeric only/);
    assert.doesNotMatch(
      md,
      /DFHMDF|DFHMSD|DFHMDI|ATTRB=|POS=\(|PROT|UNPROT/,
      "no raw BMS macro or operand syntax reaches the report",
    );
  } finally {
    await run.cleanup();
  }
});
