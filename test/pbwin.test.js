import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parsePbwin, parsePbwinString } from "../plugins/input-pbwin/parse.js";
import { lowerPbwin } from "../plugins/input-pbwin/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * PowerBASIC for Windows (PB/Win): DDT dialogs built entirely by ordinary
 * `DIALOG NEW`/`CONTROL ADD` executable statements, no separate designer
 * file at all, the same "screen built one statement in source" pattern
 * input-autoit already establishes. `DIALOG NEW ... TO handle` is a real
 * screen boundary, so a file with more than one is more than one screen. A
 * control's own field name comes from its plain numeric id, since DDT binds
 * a control to a name no other way, and a button's wiring comes from a
 * clean, trailing `CALL procname` clause on its own statement.
 */

test("a label with a plain literal caption renders with no input", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg\nCONTROL ADD LABEL, hDlg, 100, "Cust No:", 10, 10, 80, 20');
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.match(lowered.template, /<p>Cust No:<\/p>/);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
});

test("a textbox's field name is derived from its own numeric id", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg\nCONTROL ADD TEXTBOX, hDlg, 101, "", 100, 10, 100, 20');
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.match(lowered.template, /<input id="f-control101" type="text" ng-model="control101">/);
  assert.deepEqual(lowered.fields, ["control101"]);
  assert.equal(lowered.usesTwoWay, true);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a checkbox's own text argument is its label, paired directly", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg\nCONTROL ADD CHECKBOX, hDlg, 102, "Active", 10, 40, 100, 20');
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="control102"> Active<\/label>/);
});

test("two consecutive OPTION controls form one group sharing the first option's own field", () => {
  const read = parsePbwin([
    'DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg',
    'CONTROL ADD OPTION, hDlg, 103, "Small", 10, 70, 80, 20',
    'CONTROL ADD OPTION, hDlg, 104, "Medium", 100, 70, 80, 20',
  ].join("\n"));
  const lowered = lowerPbwin(read.dialogs[0]);
  const models = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(models, ["control103", "control103"]);
  assert.deepEqual(lowered.fields, ["control103"], "the group is one field, not one per option");
});

test("a non-option control between two OPTION runs starts a new group", () => {
  const read = parsePbwin([
    'DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg',
    'CONTROL ADD OPTION, hDlg, 103, "Small", 10, 70, 80, 20',
    'CONTROL ADD OPTION, hDlg, 104, "Medium", 100, 70, 80, 20',
    'CONTROL ADD FRAME, hDlg, 105, "Shipping", 10, 100, 200, 60',
    'CONTROL ADD OPTION, hDlg, 106, "Overnight", 10, 130, 100, 20',
  ].join("\n"));
  const lowered = lowerPbwin(read.dialogs[0]);
  const models = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(models, ["control103", "control103", "control106"]);
  assert.deepEqual(lowered.fields, ["control103", "control106"]);
});

test("a FRAME's own text renders as a heading, the way input-glade turns a GtkFrame's label into one", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg\nCONTROL ADD FRAME, hDlg, 105, "Shipping", 10, 100, 200, 60');
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.match(lowered.template, /<h2>Shipping<\/h2>/);
});

test("a button with a trailing CALL clause resolves that procname as its output, a clean explicit reference", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg\nCONTROL ADD BUTTON, hDlg, 108, "OK", 10, 240, 80, 25, CALL OkProc');
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.match(lowered.template, /<button type="button" ng-click="onOkProc\(\)">OK<\/button>/);
  assert.deepEqual(lowered.outputs, ["okProc"]);
});

test("a button with no CALL clause at all is named as unwired, never guessed", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg\nCONTROL ADD BUTTON, hDlg, 109, "Cancel", 100, 240, 80, 25');
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.deepEqual(lowered.outputs, []);
  assert.ok(lowered.notes.some((n) => /carries no `CALL` clause/.test(n)));
});

test("an unrecognised control type is named through a note, never approximated", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg\nCONTROL ADD LISTBOX, hDlg, 107, "", 10, 170, 150, 60');
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.equal(lowered.template, "<div>\n</div>");
  assert.ok(lowered.notes.some((n) => /`LISTBOX` is not a recognised CONTROL ADD type/.test(n)));
});

test("a CONTROL ADD statement continued across lines with a trailing underscore is joined before parsing", () => {
  const read = parsePbwin([
    'DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg',
    'CONTROL ADD BUTTON, hDlg, 108, "OK", _',
    "    10, 240, 80, 25, CALL OkProc",
  ].join("\n"));
  assert.equal(read.dialogs[0].controls.length, 1);
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.match(lowered.template, /ng-click="onOkProc\(\)"/);
});

test("a second DIALOG NEW opens a second dialog, not a second screen carved out of the first", () => {
  const read = parsePbwin([
    'DIALOG NEW 0, "Customer Maintenance", , , 300, 200, 0, TO hDlg',
    'CONTROL ADD LABEL, hDlg, 100, "Cust No:", 10, 10, 80, 20',
    'DIALOG NEW 0, "Order Detail", , , 260, 160, 0, TO hOrderDlg',
    'CONTROL ADD LABEL, hOrderDlg, 200, "Order No:", 10, 10, 80, 20',
  ].join("\n"));
  assert.equal(read.dialogs.length, 2);
  assert.equal(read.dialogs[0].title, "Customer Maintenance");
  assert.equal(read.dialogs[1].title, "Order Detail");
});

test("a CONTROL ADD naming a dialog handle no DIALOG NEW opened is collected as an orphan, never guessed into a screen", () => {
  const read = parsePbwin([
    'DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg',
    'CONTROL ADD LABEL, hSomeOtherDlg, 100, "Stray", 10, 10, 80, 20',
  ].join("\n"));
  assert.equal(read.dialogs[0].controls.length, 0);
  assert.equal(read.orphanControls.length, 1);
  assert.equal(read.orphanControls[0].dialogVar, "hSomeOtherDlg");
});

test("DIALOG NEW with no TO handle clause is skipped, since its dialog could never be referenced", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0');
  assert.equal(read.dialogs.length, 0);
  assert.ok(read.problems.some((p) => /carries no `TO` handle clause/.test(p)));
});

test("PowerBASIC keywords are matched case-insensitively", () => {
  const read = parsePbwin('dialog new 0, "W", , , 300, 200, 0, to hDlg\ncontrol add textbox, hDlg, 101, "", 10, 10, 80, 20');
  assert.equal(read.dialogs.length, 1);
  const lowered = lowerPbwin(read.dialogs[0]);
  assert.match(lowered.template, /ng-model="control101"/);
});

test("a single quote starts a comment to end of line, outside a quoted string", () => {
  const read = parsePbwin([
    'DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg \' opens the dialog',
    "' a whole line comment",
    'CONTROL ADD LABEL, hDlg, 100, "Cust No:", 10, 10, 80, 20 \' trailing',
  ].join("\n"));
  assert.equal(read.dialogs[0].controls.length, 1);
});

test("REM starts a comment to end of line, the same as a single quote", () => {
  const read = parsePbwin([
    'DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg',
    "REM a whole line remark",
    'DIALOG SHOW MODAL hDlg REM trailing remark',
  ].join("\n"));
  assert.equal(read.dialogs.length, 1);
});

test("a doubled double quote inside a string literal decodes to one literal quote character", () => {
  assert.equal(parsePbwinString('"She said ""hi"""'), 'She said "hi"');
  assert.equal(parsePbwinString('""'), "");
});

test("empty positional slots (two consecutive commas) before TO are tolerated, not choked on", () => {
  const read = parsePbwin('DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg');
  assert.equal(read.dialogs.length, 1);
  assert.equal(read.dialogs[0].handle, "hDlg");
});

test("DIALOG SHOW MODAL and other DIALOG variants beyond NEW carry no field content and are skipped silently", () => {
  const read = parsePbwin([
    'DIALOG NEW 0, "W", , , 300, 200, 0, TO hDlg',
    "DIALOG SHOW MODAL hDlg",
    "DIALOG SHOW MODELESS hDlg",
  ].join("\n"));
  assert.equal(read.dialogs.length, 1);
  assert.equal(read.problems.length, 0);
});

test(
  "a full PowerBASIC customer maintenance file ports to React through the unchanged pipeline, with no raw PowerBASIC syntax leaking",
  async () => {
    const run = await runPipeline({ src: join(ROOT, "test/fixtures/pbwin") });
    try {
      assert.equal(run.error, null);
      const pbwinScreens = run.ctx.screens.filter((s) => s.readBy === "pbwin");
      assert.equal(pbwinScreens.length, 2, "one screen per DIALOG NEW");

      const customer = pbwinScreens.find((s) => s.title === "Customer Maintenance");
      const order = pbwinScreens.find((s) => s.title === "Order Detail");
      assert.ok(customer, "the first dialog is its own screen");
      assert.ok(order, "the second dialog is its own screen");
      assert.ok(customer.outputs.includes("okProc"), "the OK button's CALL clause resolved to a real output");

      const jsx = await readFile(join(run.out, `src/features/${customer.className}/${customer.className}.jsx`), "utf8");
      assert.match(jsx, /Cust No:/);
      assert.match(jsx, /Active/);
      assert.match(jsx, /Small/);
      assert.match(jsx, /Medium/);
      assert.match(jsx, /Overnight/);
      assert.match(jsx, /Shipping/);
      assert.match(jsx, /onClick=\{\(\) => onOkProc\(\)\}/);
      assert.doesNotMatch(
        jsx,
        /CONTROL ADD (LABEL|TEXTBOX|CHECKBOX|OPTION|BUTTON|FRAME|LISTBOX)\b|DIALOG NEW \d|CALL OkProc\b|\bhDlg\b/,
        "no raw PowerBASIC statement syntax or dialog handle names survived into the port",
      );
      // 100 (the label), 105 (the frame), 107 (the unrecognised listbox) and 108/109 (the buttons) are
      // ids no field ever binds to; they must not surface bare, only ever as part of a generated field name.
      assert.doesNotMatch(
        jsx,
        /(?<!control)\b(100|104|105|107|108|109)\b/,
        "a control's own numeric id must appear only as part of a generated field name, never bare",
      );

      const md = await readFile(join(run.out, "PBWIN.md"), "utf8");
      assert.match(md, /customer\.bas/);
      assert.match(md, /CustomerMaintenance/);
      assert.match(md, /OrderDetail/);
      assert.match(md, /carries no `CALL` clause/);
      assert.match(md, /not a recognised CONTROL ADD type/);
      assert.doesNotMatch(
        md,
        /DIALOG NEW 0|CONTROL ADD LABEL|CONTROL ADD BUTTON/,
        "no raw PowerBASIC statement syntax reaches the report",
      );
    } finally {
      await run.cleanup();
    }
  },
);
