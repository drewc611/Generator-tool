import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseOpenEdge } from "../plugins/input-openedge/parse.js";
import { lowerOpenEdge } from "../plugins/input-openedge/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Progress OpenEdge ABL (4GL): a business application language still running
 * ERP, banking and logistics back offices today, whose screens are declared
 * directly in `DEFINE VARIABLE`/`DEFINE BUTTON`/`FORM ... WITH FRAME`
 * statements in ordinary procedure source, the same "the screen is just more
 * of the language" shape input-cobolscreen and input-xbase already read.
 */

test("AS LOGICAL becomes a real checkbox", () => {
  const src = `
    DEFINE VARIABLE activeFlag AS LOGICAL LABEL "Active" .
    FORM activeFlag WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.match(lowered.template, /<input id="f-activeFlag" type="checkbox" ng-model="activeFlag">/);
  assert.deepEqual(lowered.fields, ["activeFlag"]);
});

test("a non-LOGICAL type becomes a real text input, and FORMAT is never translated", () => {
  const src = `
    DEFINE VARIABLE custNo AS INTEGER FORMAT ">>>>>>9" LABEL "Cust No" .
    FORM custNo WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.match(lowered.template, /<input id="f-custNo" type="text" ng-model="custNo">/);
  assert.doesNotMatch(lowered.template, />>>>>>9|FORMAT/);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a DEFINE VARIABLE with no LABEL is still a real field, rendered with no caption invented", () => {
  const src = `
    DEFINE VARIABLE internalNote AS CHARACTER .
    FORM internalNote WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.match(lowered.template, /<input id="f-internalNote" type="text" ng-model="internalNote">/);
  assert.doesNotMatch(lowered.template, /<label/);
  assert.deepEqual(lowered.fields, ["internalNote"]);
  assert.ok(lowered.notes.some((n) => /`internalNote` declares no LABEL/.test(n)));
});

test("DEFINE BUTTON pairs its own LABEL directly as its caption", () => {
  const src = `
    DEFINE BUTTON btnOk LABEL "OK".
    FORM btnOk WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.match(lowered.template, />OK<\/button>/);
});

test("a clean RUN name. wiring becomes a real output, resolved by name", () => {
  const src = `
    DEFINE BUTTON btnOk LABEL "OK".
    FORM btnOk WITH FRAME frmMain.
    ON CHOOSE OF btnOk IN FRAME frmMain DO:
        RUN handleOk.
    END.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.match(lowered.template, /<button type="button" ng-click="onHandleOk\(\)">OK<\/button>/);
  assert.deepEqual(lowered.outputs, ["handleOk"]);
  assert.equal(lowered.notes.length, 0);
});

test("a DO/END block with more than one statement is named rather than approximated", () => {
  const src = `
    DEFINE BUTTON btnCancel LABEL "Cancel".
    FORM btnCancel WITH FRAME frmMain.
    ON CHOOSE OF btnCancel IN FRAME frmMain DO:
        MESSAGE "sure?".
        RETURN.
    END.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.deepEqual(lowered.outputs, []);
  assert.ok(lowered.notes.some((n) => /`btnCancel`'s ON CHOOSE handler is wired to something not read for what it does/.test(n)));
});

test("a button never referenced by any ON CHOOSE OF at all is named unwired", () => {
  const src = `
    DEFINE BUTTON btnHelp LABEL "Help".
    FORM btnHelp WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /`btnHelp` has no ON CHOOSE wiring anywhere in the file/.test(n)));
});

test("a name in FORM with no matching DEFINE anywhere is named, never invented", () => {
  const src = `
    DEFINE VARIABLE custNo AS INTEGER LABEL "Cust No" .
    FORM custNo ghostField WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.doesNotMatch(lowered.template, /ghostField/);
  assert.ok(lowered.notes.some((n) => /`ghostField` appears in the FORM naming frame frmMain but was never DEFINEd/.test(n)));
});

test("multiple FORM ... WITH FRAME blocks in one file become multiple screens", () => {
  const src = `
    DEFINE VARIABLE custNo AS INTEGER LABEL "Cust No" .
    FORM custNo WITH FRAME frmMain.
    FORM custNo WITH FRAME frmLookup.`;
  const { frames } = parseOpenEdge(src);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((f) => f.frame), ["frmMain", "frmLookup"]);
});

test("a DEFINEd field never listed in any FORM block is simply not part of a screen", () => {
  const src = `
    DEFINE VARIABLE custNo AS INTEGER LABEL "Cust No" .
    DEFINE VARIABLE neverShown AS CHARACTER LABEL "Never" .
    FORM custNo WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.doesNotMatch(lowered.template, /neverShown|Never/);
  assert.equal(lowered.notes.length, 0, "not being on any screen is not a gap");
});

test("FORM lists fields and buttons in its own order, not DEFINE order", () => {
  const src = `
    DEFINE VARIABLE second AS CHARACTER LABEL "Second" .
    DEFINE VARIABLE first AS CHARACTER LABEL "First" .
    FORM first second WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  const order = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["first", "second"]);
});

test("ABL keywords are recognised case-insensitively; names keep their own case", () => {
  const variants = [
    `DEFINE VARIABLE custNo AS INTEGER LABEL "Cust No" .\nFORM custNo WITH FRAME frmMain.`,
    `define variable custNo as integer label "Cust No" .\nform custNo with frame frmMain.`,
    `Define Variable custNo As Integer Label "Cust No" .\nForm custNo With Frame frmMain.`,
  ];
  for (const src of variants) {
    const { declarations, frames, onChoose } = parseOpenEdge(src);
    assert.equal(frames.length, 1, src);
    const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
    assert.match(lowered.template, /ng-model="custNo"/, src);
  }
});

test("ON CHOOSE OF and DO/END are recognised case-insensitively", () => {
  const src = `
    DEFINE BUTTON btnOk LABEL "OK".
    FORM btnOk WITH FRAME frmMain.
    on choose of btnOk in frame frmMain do:
        run handleOk.
    end.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.deepEqual(lowered.outputs, ["handleOk"]);
});

test("a hyphenated ABL identifier is camelCased for the emitted binding; a name already in camelCase keeps its own case", () => {
  const src = `
    DEFINE VARIABLE cust-no AS INTEGER LABEL "Cust No" .
    DEFINE VARIABLE custName AS CHARACTER LABEL "Name" .
    FORM cust-no custName WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.match(lowered.template, /ng-model="custNo"/, "cust-no becomes custNo");
  assert.match(lowered.template, /ng-model="custName"/, "custName is kept exactly as written");
});

test("a FORM statement can span several physical lines before its terminating period", () => {
  const src = `
    DEFINE VARIABLE custNo AS INTEGER LABEL "Cust No" .
    DEFINE VARIABLE custName AS CHARACTER LABEL "Name" .
    FORM
        custNo
        custName
    WITH FRAME frmMain.`;
  const { frames } = parseOpenEdge(src);
  assert.deepEqual(frames[0].names, ["custNo", "custName"]);
});

test("a quoted LABEL containing a literal period does not end the statement early", () => {
  const src = `
    DEFINE VARIABLE custNo AS INTEGER LABEL "Cust No." .
    FORM custNo WITH FRAME frmMain.`;
  const { declarations, frames, onChoose } = parseOpenEdge(src);
  const lowered = lowerOpenEdge(frames[0], declarations, onChoose);
  assert.match(lowered.template, /<label for="f-custNo">Cust No\.<\/label>/);
});

test("an OpenEdge ABL screen ports to React through the unchanged pipeline, with no raw ABL syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/openedge") });
  try {
    assert.equal(run.error, null);
    const screens = run.ctx.screens.filter((s) => s.readBy === "openedge");
    assert.equal(screens.length, 2, "two FORM ... WITH FRAME blocks, two screens");

    const main = screens.find((s) => s.title === "frmMain");
    assert.ok(main, "the frmMain screen was read");
    assert.deepEqual(main.outputs, ["handleOk"], "only the clean RUN handleOk. wiring becomes a real output");

    const jsx = await readFile(join(run.out, `src/features/${main.className}/${main.className}.jsx`), "utf8");
    assert.match(jsx, /Cust No/);
    assert.match(jsx, /Name/);
    assert.match(jsx, /Active/);
    assert.match(jsx, /type="checkbox"/);
    assert.match(jsx, /OK/);
    assert.match(jsx, /Cancel/);
    assert.match(jsx, /Help/);
    assert.match(jsx, /onHandleOk/);
    assert.doesNotMatch(
      jsx,
      /DEFINE VARIABLE|LABEL "|FORMAT "|WITH FRAME|ON CHOOSE OF|RUN handleOk\./,
      "no raw ABL syntax survived into the port",
    );

    const md = await readFile(join(run.out, "OPENEDGE.md"), "utf8");
    assert.match(md, /custmaint\.p/);
    assert.match(md, /frmMain/);
    assert.match(md, /frmLookup/);
    assert.match(md, /ghostField/, "a FORM entry with no matching DEFINE is named");
    assert.match(md, /wired to something not read for what it does/);
    assert.doesNotMatch(md, /btnGhost/, "a button DEFINEd but never listed in any FORM block is simply not part of a screen, not a gap");
    assert.doesNotMatch(
      md,
      /DEFINE VARIABLE|LABEL "|FORMAT "|WITH FRAME|ON CHOOSE OF/,
      "no raw ABL syntax reaches the report",
    );
  } finally {
    await run.cleanup();
  }
});
