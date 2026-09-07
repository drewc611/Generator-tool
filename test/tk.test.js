import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseTk } from "../plugins/input-tk/parse.js";
import { lowerTk } from "../plugins/input-tk/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Tcl/Tk scripts: a GUI built by ordinary executable widget-creation
 * commands, `widgetType .path.name -option value ...`, with no separate
 * declarative designer file at all, the same "screen built one executable
 * statement at a time" pattern input-xbase already reads for dBase/
 * Clipper's `@ SAY/GET`. It lowers onto the AngularJS attribute dialect the
 * rest of the tool already reads, a whole file becoming one screen.
 */

test("a label with -text renders a caption, no field", () => {
  const { widgets } = parseTk('label .heading -text "Customer Maintenance"');
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<p>Customer Maintenance<\/p>/);
  assert.doesNotMatch(lowered.template, /<input/);
  assert.deepEqual(lowered.fields, []);
});

test("an entry with -textvariable renders a real input bound to that field", () => {
  const { widgets } = parseTk("entry .custNo -textvariable custNo");
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<input id="f-custNo" type="text" ng-model="custNo">/);
  assert.deepEqual(lowered.fields, ["custNo"]);
  assert.equal(lowered.usesTwoWay, true);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("-show with a non-empty value marks the entry a password field", () => {
  const { widgets } = parseTk("entry .pw -textvariable pw -show *");
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<input id="f-pw" type="password" ng-model="pw">/);
});

test("an entry with no -textvariable at all is still rendered as an input, with no field bound", () => {
  const { widgets } = parseTk("entry .notesPlain");
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<input type="text">/);
  assert.doesNotMatch(lowered.template, /ng-model/);
  assert.deepEqual(lowered.fields, []);
  assert.ok(lowered.notes.some((n) => /`notesPlain` binds no variable/.test(n)));
  assert.doesNotMatch(lowered.notes.join(" "), /\.notesPlain\b/, "the widget's own dotted path is never printed into a note");
});

test("a checkbutton with -variable renders a real checkbox bound to that field", () => {
  const { widgets } = parseTk('checkbutton .active -text "Active" -variable activeFlag');
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="activeFlag"> Active<\/label>/);
  assert.deepEqual(lowered.fields, ["activeFlag"]);
});

test("a checkbutton with no -variable is rendered with no field bound, and named", () => {
  const { widgets } = parseTk('checkbutton .active -text "Active"');
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<label><input type="checkbox"> Active<\/label>/);
  assert.doesNotMatch(lowered.template, /ng-model/);
  assert.ok(lowered.notes.some((n) => /checkbutton named `active` binds no variable/.test(n)));
});

test("radiobuttons sharing one -variable are grouped under one field, however far apart", () => {
  const src = [
    'radiobutton .small -text "Small" -variable size -value small',
    'label .filler -text "unrelated"',
    'radiobutton .medium -text "Medium" -variable size -value medium',
  ].join("\n");
  const { widgets } = parseTk(src);
  const lowered = lowerTk(widgets, "screen");
  const models = [...lowered.template.matchAll(/type="radio" ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(models, ["size", "size"]);
  assert.deepEqual(lowered.fields, ["size"], "the group's field is registered exactly once");
  assert.match(lowered.template, /value="small"/);
  assert.match(lowered.template, /value="medium"/);
});

test("a radiobutton with a different -variable is its own separate group", () => {
  const src = [
    'radiobutton .small -text "Small" -variable size -value small',
    'radiobutton .expedited -text "Expedited" -variable shipping -value expedited',
  ].join("\n");
  const { widgets } = parseTk(src);
  const lowered = lowerTk(widgets, "screen");
  const models = [...lowered.template.matchAll(/type="radio" ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(models, ["size", "shipping"]);
  assert.deepEqual(lowered.fields, ["size", "shipping"]);
});

test("a button with a clean bare proc name -command becomes a real wired output", () => {
  const { widgets } = parseTk('button .ok -text "OK" -command handleOk');
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<button type="button" ng-click="onHandleOk\(\)">OK<\/button>/);
  assert.deepEqual(lowered.outputs, ["handleOk"]);
});

test("a button with a brace-quoted inline script -command is named, never printed raw, and left unwired", () => {
  const { widgets } = parseTk('button .cancel -text "Cancel" -command {destroy .}');
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.deepEqual(lowered.outputs, []);
  assert.ok(lowered.notes.some((n) => /`Cancel`'s -command is an inline script/.test(n)));
  assert.doesNotMatch(lowered.notes.join(" "), /destroy \./, "the inline script's own body is never captured or printed");
});

test("a button with no -command at all is named as unwired", () => {
  const { widgets } = parseTk('button .ok -text "OK"');
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<button type="button">OK<\/button>/);
  assert.ok(lowered.notes.some((n) => /`OK` has no -command/.test(n)));
});

test("a bare text or listbox widget is noted present, never rendered as an invented input", () => {
  const { widgets } = parseTk("text .comments\nlistbox .items");
  const lowered = lowerTk(widgets, "screen");
  assert.doesNotMatch(lowered.template, /<input|<textarea/);
  assert.ok(lowered.notes.some((n) => /`text` at `comments` exists/.test(n)));
  assert.ok(lowered.notes.some((n) => /`listbox` at `items` exists/.test(n)));
});

test("a labelframe's own -text renders as a heading; a plain frame renders and notes nothing", () => {
  const { widgets } = parseTk('labelframe .details -text "Details"\nframe .spacer');
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /<h3>Details<\/h3>/);
  assert.equal(lowered.notes.length, 0);
});

test("menu, menubutton, scale, scrollbar and canvas are recognised only well enough to be named, never approximated", () => {
  const { widgets } = parseTk("menu .m\nmenubutton .mb\nscale .s\nscrollbar .sb\ncanvas .c");
  const lowered = lowerTk(widgets, "screen");
  assert.equal(lowered.template.match(/<h3>|<input|<button|<p>/g), null);
  assert.equal(lowered.notes.length, 5);
  for (const kind of ["menu", "menubutton", "scale", "scrollbar", "canvas"]) {
    assert.ok(lowered.notes.some((n) => n.includes(`\`${kind}\` widget command`)), `${kind} is named`);
  }
});

test("ttk:: prefixed commands are read as the same widget type, minus the prefix", () => {
  const { widgets } = parseTk("ttk::entry .custNo -textvariable custNo\nttk::button .ok -text OK -command handleOk");
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /ng-model="custNo"/);
  assert.match(lowered.template, /ng-click="onHandleOk\(\)"/);
});

test("a backslash-continued widget command is joined before parsing", () => {
  const src = ['radiobutton .expedited -text "Expedited" \\', '  -variable shipping -value expedited'].join("\n");
  const { widgets } = parseTk(src);
  assert.equal(widgets.length, 1);
  const lowered = lowerTk(widgets, "screen");
  assert.match(lowered.template, /value="expedited"/);
  assert.match(lowered.template, /Expedited/);
});

test("a # comment at the start of a logical line is skipped", () => {
  const { widgets } = parseTk('# label .fake -text "not real"\nlabel .real -text "Real"');
  const lowered = lowerTk(widgets, "screen");
  assert.equal(widgets.length, 1);
  assert.match(lowered.template, /Real/);
  assert.doesNotMatch(lowered.template, /not real/);
});

test("ordinary Tcl control flow around widget commands, proc/if/set, is not matched at all", () => {
  const src = [
    "proc handleOk {} { puts ok }",
    'set title "Customer Maintenance"',
    'if {$title ne ""} {',
    '  label .heading -text "Customer Maintenance"',
    "}",
  ].join("\n");
  const { widgets } = parseTk(src);
  assert.equal(widgets.length, 1, "only the one label command was read; proc, set and if were not");
  assert.equal(widgets[0].command, "label");
});

test("pack, grid and place calls are recognised only well enough to be skipped, never reproduced", () => {
  const src = 'label .heading -text "Hi"\npack .heading\ngrid .heading -row 0\nplace .heading -x 0 -y 0';
  const { widgets } = parseTk(src);
  assert.equal(widgets.length, 1);
});

test("a full Tcl/Tk customer maintenance dialog ports to React through the unchanged pipeline, with no raw Tcl syntax surviving", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/tk") });
  try {
    assert.equal(run.error, null);
    const tkScreens = run.ctx.screens.filter((s) => s.readBy === "tk");
    assert.equal(tkScreens.length, 1, "the whole file is one screen");

    const screen = tkScreens[0];
    assert.deepEqual(screen.outputs, ["handleOk"]);
    const jsx = await readFile(join(run.out, `src/features/${screen.className}/${screen.className}.jsx`), "utf8");

    assert.match(jsx, /Customer Maintenance/);
    assert.match(jsx, /Cust No:/);
    assert.match(jsx, /Details/);
    assert.match(jsx, /Active/);
    assert.match(jsx, /Small/);
    assert.match(jsx, /Medium/);
    assert.match(jsx, /Expedited/);
    assert.match(jsx, /onChange=\{\(event\) => setCustNo\(event\.target\.value\)\}/);
    assert.match(jsx, /type="password"/);
    assert.match(jsx, /onHandleOk/);

    assert.doesNotMatch(
      jsx,
      /-textvariable|-command|destroy \.|\bpack \.|\bgrid \.|\.custNo\b/,
      "no raw Tcl syntax (an option name, an inline script body, a layout call, or a widget's own dotted path) survived into the port",
    );

    const md = await readFile(join(run.out, "TK.md"), "utf8");
    assert.match(md, /customer\.tcl/);
    assert.match(md, /inline script/);
    assert.doesNotMatch(
      md,
      /destroy \.|\bpack \.|\bgrid \.|\.custNo\b/,
      "no raw statement text (an inline script body, a layout call, or a widget's own dotted path) reaches the report; the report may still discuss option names in prose",
    );
  } finally {
    await run.cleanup();
  }
});
