import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseAutoit, parseAutoitString } from "../plugins/input-autoit/parse.js";
import { lowerAutoit } from "../plugins/input-autoit/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * AutoIt: a GUI built entirely by ordinary executable `GUICreate`/
 * `GUICtrlCreate*` statements, with no separate declarative designer file at
 * all, the same "screen built one statement in source" pattern
 * input-xbase's `@ SAY/GET` already establishes. A whole `.au3` file is one
 * screen; a control's own field name comes from the variable its return
 * value was assigned to, since AutoIt binds no control to a name any other
 * way, and a button's wiring comes from the event loop, not its own call.
 */

test("a plain literal label renders a caption with no input", () => {
  const read = parseAutoit('GUICreate("W", 100, 100)\nGUICtrlCreateLabel("Cust No:", 10, 10)');
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /<p>Cust No:<\/p>/);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
});

test("an input assigned to a variable takes its field name from that variable", () => {
  const read = parseAutoit('GUICreate("W", 100, 100)\n$custNo = GUICtrlCreateInput("", 100, 10, 200, 20)');
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /<input id="f-custNo" type="text" ng-model="custNo">/);
  assert.deepEqual(lowered.fields, ["custNo"]);
  assert.equal(lowered.usesTwoWay, true);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("an input never assigned to a variable is a real gap, named rather than invented", () => {
  const read = parseAutoit('GUICreate("W", 100, 100)\nGUICtrlCreateInput("", 100, 10, 200, 20)');
  const lowered = lowerAutoit(read);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
  assert.ok(lowered.notes.some((n) => /return value is never assigned to a variable/.test(n)));
});

test("GUICtrlCreatePassword renders a password field, a real function distinct from GUICtrlCreateInput", () => {
  const read = parseAutoit('GUICreate("W", 100, 100)\n$pw = GUICtrlCreatePassword("", 100, 10, 200, 20)');
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /<input id="f-pw" type="password" ng-model="pw">/);
});

test("a checkbox binds ng-model to its own assigned variable", () => {
  const read = parseAutoit('GUICreate("W", 100, 100)\n$active = GUICtrlCreateCheckbox("Active", 10, 10, 100, 20)');
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="active"> Active<\/label>/);
});

test("consecutive radios form one group sharing the first radio's own field", () => {
  const read = parseAutoit([
    'GUICreate("W", 100, 100)',
    '$sizeSmall = GUICtrlCreateRadio("Small", 10, 10, 80, 20)',
    '$sizeMedium = GUICtrlCreateRadio("Medium", 100, 10, 80, 20)',
  ].join("\n"));
  const lowered = lowerAutoit(read);
  const models = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(models, ["sizeSmall", "sizeSmall"]);
  assert.deepEqual(lowered.fields, ["sizeSmall"], "the group is one field, not one per radio");
});

test("a non-radio control between two radios starts a new group", () => {
  const read = parseAutoit([
    'GUICreate("W", 100, 100)',
    '$a = GUICtrlCreateRadio("A", 10, 10, 80, 20)',
    '$b = GUICtrlCreateRadio("B", 100, 10, 80, 20)',
    'GUICtrlCreateLabel("Shipping:", 10, 40)',
    '$c = GUICtrlCreateRadio("C", 10, 70, 80, 20)',
  ].join("\n"));
  const lowered = lowerAutoit(read);
  const models = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(models, ["a", "a", "c"]);
  assert.deepEqual(lowered.fields, ["a", "c"]);
});

test("a button wired to one clean Case call resolves that call as its output", () => {
  const read = parseAutoit([
    'GUICreate("W", 100, 100)',
    '$okButton = GUICtrlCreateButton("OK", 10, 10, 80, 25)',
    "While 1",
    "    $msg = GUIGetMsg()",
    "    Switch $msg",
    "        Case $okButton",
    "            HandleOk()",
    "    EndSwitch",
    "WEnd",
  ].join("\n"));
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /<button type="button" ng-click="onHandleOk\(\)">OK<\/button>/);
  assert.deepEqual(lowered.outputs, ["handleOk"]);
});

test("a Case block with more than one statement is named as wired to something not read, never approximated", () => {
  const read = parseAutoit([
    'GUICreate("W", 100, 100)',
    '$cancelButton = GUICtrlCreateButton("Cancel", 10, 10, 80, 25)',
    "Switch $msg",
    "    Case $cancelButton",
    '        MsgBox(0, "Cancelled", "Cancelled")',
    "        ExitLoop",
    "EndSwitch",
  ].join("\n"));
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.deepEqual(lowered.outputs, []);
  assert.ok(lowered.notes.some((n) => /not one clean function call/.test(n)));
});

test("a Case block whose only statement is a bare keyword (ExitLoop) is not mistaken for a clean call", () => {
  const read = parseAutoit([
    'GUICreate("W", 100, 100)',
    '$closeButton = GUICtrlCreateButton("Close", 10, 10, 80, 25)',
    "Switch $msg",
    "    Case $closeButton",
    "        ExitLoop",
    "EndSwitch",
  ].join("\n"));
  const lowered = lowerAutoit(read);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /not one clean function call/.test(n)));
});

test("a button never referenced in any Case or If block is named as unwired", () => {
  const read = parseAutoit([
    'GUICreate("W", 100, 100)',
    '$deleteButton = GUICtrlCreateButton("Delete", 10, 10, 80, 25)',
    "Switch $msg",
    "    Case $somethingElse",
    "        DoOther()",
    "EndSwitch",
  ].join("\n"));
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /<button type="button">Delete<\/button>/);
  assert.ok(lowered.notes.some((n) => /never referenced in any Case or If block/.test(n)));
});

test("an unrecognised control creation call is named, never approximated", () => {
  const read = parseAutoit('GUICreate("W", 100, 100)\n$g = GUICtrlCreateList("", 10, 10, 100, 60)');
  const lowered = lowerAutoit(read);
  assert.equal(lowered.template, "<div>\n</div>");
  assert.ok(lowered.notes.some((n) => /GUICtrlCreateList.*not a recognised control creation call/.test(n)));
});

test("a second GUICreate call is named as an existing second window, never split into a second screen", () => {
  const read = parseAutoit([
    'GUICreate("First", 100, 100)',
    'GUICtrlCreateLabel("Hi", 10, 10)',
    'GUICreate("Second", 100, 100)',
  ].join("\n"));
  assert.equal(read.extraWindows, 1);
  const lowered = lowerAutoit(read);
  assert.equal(lowered.title, "First");
  assert.ok(lowered.notes.some((n) => /additional GUICreate call/.test(n)));
});

test("a statement continued across lines with a trailing underscore is joined before parsing", () => {
  const read = parseAutoit([
    'GUICreate("W", 100, 100)',
    '$ship = GUICtrlCreateRadio("Standard", 10, 10, _',
    "    100, 20)",
  ].join("\n"));
  assert.equal(read.controls.length, 1);
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /ng-model="ship"/);
});

test("function names are recognised case-insensitively", () => {
  const read = parseAutoit('guicreate("W", 100, 100)\n$x = guictrlcreateinput("", 10, 10, 100, 20)');
  const lowered = lowerAutoit(read);
  assert.match(lowered.template, /ng-model="x"/);
});

test("a semicolon starts a comment to end of line, outside a quoted string", () => {
  const read = parseAutoit([
    'GUICreate("W", 100, 100)',
    "; a whole line comment",
    '$x = GUICtrlCreateInput("", 10, 10, 100, 20) ; trailing comment',
  ].join("\n"));
  assert.equal(read.controls.length, 1);
});

test("a doubled quote inside a string literal decodes to one literal quote character", () => {
  assert.equal(parseAutoitString('"She said ""hi"""'), 'She said "hi"');
  assert.equal(parseAutoitString("'It''s fine'"), "It's fine");
});

test("a variable used as a label's text is not a plain literal and is named, never guessed", () => {
  const read = parseAutoit('GUICreate("W", 100, 100)\nGUICtrlCreateLabel($someVar, 10, 10)');
  const lowered = lowerAutoit(read);
  assert.doesNotMatch(lowered.template, /<p>/);
  assert.ok(lowered.notes.some((n) => /text argument is not a plain string literal/.test(n)));
});

test("ordinary AutoIt control flow around the recognised calls is passed over", () => {
  const read = parseAutoit([
    "#include <GUIConstantsEx.au3>",
    'GUICreate("W", 100, 100)',
    'GUICtrlCreateLabel("Hi", 10, 10)',
    "If 1 = 1 Then",
    "    DoSomething()",
    "EndIf",
  ].join("\n"));
  assert.equal(read.controls.length, 1);
  assert.equal(read.problems.length, 0);
});

test("a full AutoIt customer maintenance script ports to React through the unchanged pipeline, with no raw AutoIt syntax leaking", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/autoit") });
  try {
    assert.equal(run.error, null);
    const autoitScreens = run.ctx.screens.filter((s) => s.readBy === "autoit");
    assert.equal(autoitScreens.length, 1, "a whole .au3 file is one screen");

    const screen = autoitScreens[0];
    assert.equal(screen.title, "Customer Maintenance");
    assert.ok(screen.outputs.includes("handleOk"), "the OK button's clean Case call resolved to a real output");

    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");
    assert.match(jsx, /Cust No:/);
    assert.match(jsx, /Password:/);
    assert.match(jsx, /Active/);
    assert.match(jsx, /Small/);
    assert.match(jsx, /Medium/);
    assert.match(jsx, /Standard/);
    assert.match(jsx, /onClick=\{\(\) => onHandleOk\(\)\}/);
    assert.doesNotMatch(
      jsx,
      /GUICtrlCreate|GUIGetMsg|Case \$|\$custNo|\$okButton|\$cancelButton|\$deleteButton|MsgBox\(/,
      "no raw AutoIt syntax, sigil variable names or handler statement text survived into the port",
    );

    const md = await readFile(join(run.out, "AUTOIT.md"), "utf8");
    assert.match(md, /customer\.au3/);
    assert.match(md, /CustomerMaintenance/);
    assert.match(md, /never assigned to a variable/);
    assert.match(md, /not one clean function call/);
    assert.match(md, /never referenced in any Case or If block/);
    assert.doesNotMatch(
      md,
      /GUICtrlCreate\(|Case \$okButton|Case \$cancelButton|\$custNo|MsgBox\(/,
      "no raw AutoIt statement syntax reaches the report",
    );
  } finally {
    await run.cleanup();
  }
});
