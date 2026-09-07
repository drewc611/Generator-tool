import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseArrayLiteral, parseString, readSrw } from "../plugins/input-powerbuilder/parse.js";
import { lowerSrw } from "../plugins/input-powerbuilder/lower.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A PowerBuilder `.srw` window export is a legacy front end whose interface
 * is text: a `forward` section declares every control's name and class up
 * front, then the real, later `type <name> from <class> within <window> ...
 * end type` block for each carries its actual properties, and after every
 * control an `event <control>::<event>; ... end event` block carries
 * PowerScript. input-powerbuilder walks the file with a block stack, tells
 * the forward shell apart from the real block by whether it sits nested
 * inside `forward`, and lowers the window onto the shared dialect. The
 * fixture is the real `.srw` shape under test/fixtures/powerbuilder.
 */

const FIXTURE = join(ROOT, "test/fixtures/powerbuilder/w_login.srw");
const login = async () => readFile(FIXTURE, "utf8");

/** A minimal, valid `.srw`: a window block naming its controls in order, then each control's real block. No
 * `forward` section is required for a file to be read; PowerBuilder's IDE always writes one, but nothing in the
 * grammar this reader depends on needs it, so the smaller unit tests below leave it out. */
const srw = (order, blocks, { title = "X", events = "" } = {}) => [
  "global type w_x from window",
  `string title = "${title}"`,
  ...order.map((n) => `${n} ${n}`),
  "end type",
  "",
  ...blocks,
  events,
].join("\n");

test("the string literal and array literal readers", () => {
  assert.equal(parseString('"Sign in"'), "Sign in");
  assert.equal(parseString('"say ""hi"""'), 'say "hi"', "a doubled quote is a literal one");
  assert.equal(parseString("Sign in"), null, "not one whole quoted literal");
  assert.deepEqual(parseArrayLiteral('{"Administrator","User"}'), ["Administrator", "User"]);
  assert.deepEqual(parseArrayLiteral("{}"), [], "an empty array literal is a real empty list, not a gap");
  assert.equal(parseArrayLiteral("Administrator"), null, "not one whole brace pair");
});

test("the forward section is read for names and classes only; the real, later type block is where properties come from", async () => {
  const read = readSrw(await login());
  assert.equal(read.header, "w_login.srw");
  assert.deepEqual(read.forward.map((f) => [f.name, f.class]), [
    ["w_login", "window"], ["st_1", "statictext"], ["sle_username", "singlelineedit"], ["sle_password", "singlelineedit"],
    ["cbx_remember", "checkbox"], ["ddlb_role", "dropdownlistbox"], ["cb_login", "commandbutton"],
  ]);
  // The forward-declared shell for st_1 carries no properties at all; only the real, non-forward block does.
  const real = read.controls.get("st_1");
  assert.equal(real.class, "statictext");
  assert.equal(real.properties.text.value, "Username");
  assert.deepEqual(read.window.order, ["st_1", "sle_username", "sle_password", "cbx_remember", "ddlb_role", "cb_login"]);
  assert.equal(read.window.properties.title.value, "Sign in");
  assert.equal(read.controls.get("sle_password").properties.password.value, true);
  assert.deepEqual(read.controls.get("ddlb_role").properties.item, { type: "string", array: true, items: ["Administrator", "User"] });
  assert.deepEqual(read.events.map((e) => [e.control, e.event, e.lines]), [["cb_login", "clicked", 4]]);
  assert.deepEqual(read.problems, []);
});

test("a login window lowers: static text, a field, a password field, a checkbox, a select from an inline item array, a button wired from its own clicked event block", async () => {
  const notes = [];
  const read = readSrw(await login());
  const { template, fields, outputs, title, usesNgFor } = lowerSrw(read, (n) => notes.push(n));
  assert.equal(title, "Sign in");
  assert.deepEqual(fields, ["username", "password", "remember", "role"]);
  assert.deepEqual(outputs, ["login"]);
  assert.equal(usesNgFor, false, "the select's items came from its own item[] array, so nothing repeats");
  assert.equal(template, [
    "<div>",
    "  <h2>Sign in</h2>",
    "  <p>Username</p>",
    '  <input id="f-username" type="text" ng-model="username">',
    '  <input id="f-password" type="password" ng-model="password">',
    '  <label><input type="checkbox" ng-model="remember"> Remember me</label>',
    '  <select id="f-role" ng-model="role">',
    "    <option>Administrator</option>",
    "    <option>User</option>",
    "  </select>",
    '  <button type="button" ng-click="onLogin()">Login</button>',
    "</div>",
  ].join("\n"));
  assert.deepEqual(notes, [], "every gap this window carries has an honest reading; nothing here is a gap");
});

test("an opaque property (its type is not integer, string or boolean) is named by key, its value never read", () => {
  const src = srw(["st_2"], [
    "type st_2 from statictext within w_x",
    "long tag = 12345",
    "borderstyle style = stylelowered!",
    'string text = "Label"',
    "end type",
  ]);
  const read = readSrw(src);
  const ctrl = read.controls.get("st_2");
  assert.deepEqual(ctrl.properties.tag, { type: "long", opaque: true });
  assert.deepEqual(ctrl.properties.style, { type: "borderstyle", opaque: true });
  assert.equal(ctrl.properties.text.value, "Label", "a property read for a reason is not also reported as opaque");
  const notes = [];
  lowerSrw(read, (n) => notes.push(n));
  assert.ok(notes.some((n) => n === "`st_2` declares properties this reader does not interpret: tag, style."));
  assert.ok(!notes.join("\n").includes("12345"), "an opaque property's value is never printed");
  assert.ok(!notes.join("\n").includes("stylelowered"));
});

test("a dropdownlistbox with no item array is a gap, not a guess", () => {
  const src = srw(["ddlb_x"], ["type ddlb_x from dropdownlistbox within w_x", "integer width = 100", "end type"]);
  const read = readSrw(src);
  const notes = [];
  const { template, usesNgFor } = lowerSrw(read, (n) => notes.push(n));
  assert.match(template, /<option ng-repeat="option in xOptions">\{\{ option \}\}<\/option>/);
  assert.equal(usesNgFor, true);
  assert.ok(notes.some((n) => /declares no `string item\[\]` array \(or an empty one\); its items are populated from code at runtime, so the port takes them as `xOptions`/.test(n)));

  // An explicitly empty array is the same gap as none at all.
  const empty = readSrw(srw(["ddlb_y"], ["type ddlb_y from dropdownlistbox within w_x", 'string item[] = {}', "end type"]));
  const notes2 = [];
  lowerSrw(empty, (n) => notes2.push(n));
  assert.ok(notes2.some((n) => /`ddlb_y` declares no `string item\[\]` array \(or an empty one\)/.test(n)));
});

test("a commandbutton with no clicked event found elsewhere in the file is emitted with no wiring", () => {
  const src = srw(["cb_x"], ['type cb_x from commandbutton within w_x', 'string text = "Go"', "end type"]);
  const read = readSrw(src);
  const notes = [];
  const { template, outputs } = lowerSrw(read, (n) => notes.push(n));
  assert.match(template, /<button type="button">Go<\/button>/, "no ng-click when no clicked event was found");
  assert.deepEqual(outputs, []);
  assert.ok(notes.some((n) => n === "`cb_x` has no `clicked` event block found elsewhere in the file; it is emitted with no wiring found."));
});

test("a non clicked event, and a second event on a wired button, are named as behaviour the port must reimplement, never invented", () => {
  const src = srw(["sle_x", "cb_go"], [
    "type sle_x from singlelineedit within w_x", "end type",
    "type cb_go from commandbutton within w_x", 'string text = "Go"', "end type",
  ], {
    events: [
      "event sle_x::modified;",
      "ls_touched = true",
      "end event",
      "",
      "event cb_go::clicked;",
      "parent.triggerevent(\"ue_go\")",
      "end event",
      "",
      "event cb_go::losefocus;",
      "beep()",
      "end event",
    ].join("\n"),
  });
  const read = readSrw(src);
  assert.deepEqual(read.events.map((e) => [e.control, e.event, e.lines]), [["sle_x", "modified", 1], ["cb_go", "clicked", 1], ["cb_go", "losefocus", 1]]);
  const notes = [];
  const { outputs } = lowerSrw(read, (n) => notes.push(n));
  assert.deepEqual(outputs, ["go"], "the clicked event wires the button; the other two are behaviour, not wiring");
  assert.ok(notes.some((n) => n === "`sle_x::modified` is 1 line(s) of PowerScript kept only as existing; the port must reimplement this behaviour."));
  assert.ok(notes.some((n) => n === "`cb_go::losefocus` is 1 line(s) of PowerScript kept only as existing; the port must reimplement this behaviour."));
  assert.ok(!notes.some((n) => n.includes("triggerevent") || n.includes("beep")), "an event's own PowerScript is never read into a note, only that it exists and how long it runs");
});

test("consecutive radiobuttons share one field; a control between two runs starts a second group", () => {
  const src = srw(["opt_a", "opt_b", "sle_x", "opt_c", "opt_d"], [
    'type opt_a from radiobutton within w_x', 'string text = "A"', "end type",
    'type opt_b from radiobutton within w_x', 'string text = "B"', "end type",
    "type sle_x from singlelineedit within w_x", "end type",
    'type opt_c from radiobutton within w_x', 'string text = "C"', "end type",
    'type opt_d from radiobutton within w_x', 'string text = "D"', "end type",
  ]);
  const read = readSrw(src);
  const { template, fields } = lowerSrw(read);
  assert.deepEqual(fields, ["a", "x", "c"], "the singlelineedit's own field splits the two radio runs apart");
  assert.match(template, /<label><input type="radio" ng-model="a" value="a"> A<\/label>\n\s*<label><input type="radio" ng-model="a" value="b"> B<\/label>/);
  assert.match(template, /<label><input type="radio" ng-model="c" value="c"> C<\/label>\n\s*<label><input type="radio" ng-model="c" value="d"> D<\/label>/);
});

test("a groupbox's own children are never nested beneath it; its text becomes a heading, and every control renders flat", () => {
  const src = srw(["gb_1", "sle_x"], [
    'type gb_1 from groupbox within w_x', 'string text = "Details"', "end type",
    "type sle_x from singlelineedit within w_x", "end type",
  ]);
  const read = readSrw(src);
  const notes = [];
  const { template } = lowerSrw(read, (n) => notes.push(n));
  assert.equal(template, [
    "<div>",
    "  <h2>X</h2>",
    "  <div>",
    "    <h2>Details</h2>",
    "  </div>",
    '  <input id="f-x" type="text" ng-model="x">',
    "</div>",
  ].join("\n"), "the field that sat inside the groupbox in the original layout is this div's next sibling, not its child");
  assert.ok(notes.some((n) => /a groupbox's own children are not nested beneath it/.test(n)));
});

test("a DataWindow is named as existing; the port gets an empty structural table, never invented rows", () => {
  const src = srw(["dw_1"], ["type dw_1 from datawindow within w_x", "end type"]);
  const read = readSrw(src);
  const notes = [];
  const { template } = lowerSrw(read, (n) => notes.push(n));
  assert.match(template, /<table><\/table>/);
  assert.ok(notes.some((n) => /`dw_1` is a DataWindow, PowerBuilder's own data bound grid or report object defined in a separate `\.srd`\/`\.pbl` artifact this reader does not have access to/.test(n)));
});

test("a control class with no vocabulary entry is named, never approximated", () => {
  const src = srw(["gau_1"], ["type gau_1 from gauge within w_x", "end type"]);
  const read = readSrw(src);
  const notes = [];
  const { template } = lowerSrw(read, (n) => notes.push(n));
  assert.equal(template, ["<div>", "  <h2>X</h2>", "</div>"].join("\n"), "an unrecognised class renders nothing rather than a guess");
  assert.ok(notes.some((n) => n === "the control class `gauge` (`gau_1`) is not lowered; it is named here rather than approximated."));
});

test("a control forward-declared but never given a real, non-forward type block is a named gap", () => {
  const src = [
    "forward",
    "type sle_ghost from singlelineedit within w_x",
    "end type",
    "end forward",
    "",
    "global type w_x from window",
    'string title = "X"',
    "sle_ghost sle_ghost",
    "end type",
  ].join("\n");
  const read = readSrw(src);
  assert.equal(read.controls.has("sle_ghost"), false);
  const notes = [];
  lowerSrw(read, (n) => notes.push(n));
  assert.ok(notes.some((n) => /`sle_ghost` \(singlelineedit\) was forward-declared but no real, non-forward `type` block for it was found later in the file/.test(n)));
});

test("a folder of .srw files becomes screens, a report and notes, and ports to React with every state and no leaked PowerScript", async (t) => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/powerbuilder"), shots: join(ROOT, "test/fixtures/powerbuilder/no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);

  const screen = run.ctx.screens.find((s) => s.readBy === "powerbuilder");
  assert.ok(screen, "the .srw window became a screen");
  assert.equal(screen.file, "w_login.srw");
  assert.equal(screen.title, "Sign in");
  assert.equal(screen.selector, "window-login");
  assert.equal(screen.className, "WindowLogin");
  assert.deepEqual(screen.outputs, ["login"]);
  assert.equal(screen.usesTwoWay, true);
  assert.match(screen.templateOrigin, /PowerBuilder \.srw window export.*w_login\.srw/);

  const jsx = await readFile(join(run.out, "src/features/WindowLogin/WindowLogin.jsx"), "utf8");
  assert.match(jsx, /export default function WindowLogin\(\{ onLogin, loading, error, onRetry \}\)/);
  assert.match(jsx, /<option>\s*Administrator\s*<\/option>\s*<option>\s*User\s*<\/option>/);
  assert.match(jsx, /type="password"/);
  assert.match(jsx, /if \(loading\) return/);
  assert.match(jsx, /if \(error\)/);
  for (const leak of ["$PBExportHeader$", "end type", "end forward", "end on", "end event", "create(", "triggerevent", "IsNull", "ls_user", "forward\n"]) {
    assert.ok(!jsx.includes(leak), `the emitted component leaks PowerBuilder source text: ${leak}`);
  }

  const report = await readFile(join(run.out, "POWERBUILDER.md"), "utf8");
  assert.match(report, /^# PowerBuilder windows/);
  assert.match(report, /## w_login\.srw/);
  assert.match(report, /Read as `Login`, 6 control\(s\), 4 field\(s\), 1 output\(s\)\./);
  // A caption like the window's own title is not withheld the way an opaque property's value or an event body is;
  // input-vb6's and input-uno's own reports print a caption too. Only the source's own literal syntax and any
  // PowerScript text are checked here.
  for (const leak of ["$PBExportHeader$", "triggerevent", "IsNull", "ls_user"]) {
    assert.ok(!report.includes(leak), `POWERBUILDER.md leaks PowerBuilder source or a value it should not print: ${leak}`);
  }

  const notes = run.ctx.report.unverified.join("\n");
  assert.ok(!notes.includes("triggerevent") && !notes.includes("ls_user"), "no note carries the event body's own PowerScript");

  assert.match(await readFile(join(run.out, "READERS.md"), "utf8"), /w_login\.srw/, "the census counts the .srw file as read");
  assert.ok(!run.ctx.report.unverified.some((n) => /no reader claimed/.test(n) && /\.srw/.test(n)), "no .srw file is an unread markup file");
});

test("an unterminated block is a problem noted against the file, never an exception, and a file with no window block still names why", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-pb-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "w_broken.srw"), 'global type w_broken from window\nstring title = "Broken"\nsle_a sle_a\nend type\n\ntype sle_a from singlelineedit within w_broken\ninteger x = 1\n');
  await writeFile(join(dir, "not_a_window.srw"), 'type st_1 from statictext within w_x\nstring text = "Orphan"\nend type\n');
  const run = await runPipeline({ src: dir, shots: join(dir, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /w_broken\.srw: the block opened at line \d+ is never closed\./);
  assert.match(notes, /not_a_window\.srw: no `global type \.\.\. from window` block; nothing was read\./);
  assert.deepEqual(run.ctx.screens.filter((s) => s.readBy === "powerbuilder").map((s) => s.file), ["w_broken.srw"], "what was read of an unclosed window is still a screen; a file with no window at all is not");
});
