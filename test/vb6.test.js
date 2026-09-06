import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { camel, caption, lowerForm, lowerMenu, stripPrefix } from "../plugins/input-vb6/forms.js";
import { decodeShortcut, kindOf, modelForm, parseValue, readFrm } from "../plugins/input-vb6/frm.js";
import { applyFrx, decodeAnsi, describe, expectedKind, readRecord } from "../plugins/input-vb6/frx.js";
import { translate } from "../plugins/output-react/template.js";
import { LOGIN_ITEMS, bitmap, emptyPictureRecord, frx, hex, itemDataRecord, listRecord, loginFrx, pictureRecord, shortTextRecord, sizedListRecord, textRecord } from "./fixtures/vb6/frx.mjs";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A Visual Basic 6 form file is a legacy front end whose interface is text:
 * one Begin VB.Form block nesting a block per control, each a list of
 * properties in twips, a menu as nested VB.Menu blocks, and after the form
 * the code. input-vb6 walks the blocks with a stack, lowers the form onto the
 * shared dialect through the lowering input-delphi shares, reads which
 * handlers the code wires and which messages MsgBox shows, and reads the
 * binary .frx companion for the two things a port needs from it: a combo or
 * list box's items, and that a long text exists. The fixtures are real .frm
 * files under test/fixtures/vb6; the .frx beside them is built by
 * test/fixtures/vb6/frx.mjs, so the bytes and the offsets the .frm spells are
 * one source.
 */

const FIXTURES = join(ROOT, "test/fixtures/vb6");
const login = async () => readFrm(await readFile(join(FIXTURES, "frmLogin.frm"), "latin1"));
const loginBytes = async () => readFile(join(FIXTURES, "frmLogin.frx"));

test("the .frm scanner walks the block tree, skips property groups whole, and reads the handlers and messages from the code", async () => {
  const read = await login();
  assert.equal(read.error, undefined); assert.deepEqual(read.problems, []);
  assert.equal(read.form.className, "VB.Form"); assert.equal(read.form.name, "frmLogin"); assert.equal(read.name, "frmLogin");
  assert.deepEqual(read.objects, ["MSCOMCTL.OCX"], "the OCX references in the header");
  assert.equal(read.form.props.Caption.string, "Log in");
  assert.equal(read.form.props.Font, undefined, "a BeginProperty group is skipped whole, its lines never read as the form's own");
  assert.equal(read.form.children.length, 20);
  const frame = read.form.children.find((c) => c.name === "fraRole");
  assert.deepEqual(frame.children.map((c) => c.name), ["optManager", "optClerk"], "controls inside a frame are its children in file order");
  assert.deepEqual(read.form.children.find((c) => c.name === "mnuFile").children.map((c) => c.props.Caption.string), ["&Open...", "-", "E&xit"]);

  assert.deepEqual(parseValue('"&Save"'), { string: "&Save" });
  assert.deepEqual(parseValue('"say ""hi"""'), { string: 'say "hi"' }, "a doubled quote is a literal one");
  assert.equal(parseValue("-1  'True"), -1); assert.equal(parseValue("0   'False"), 0); assert.equal(parseValue("8.25"), 8.25);
  assert.deepEqual(parseValue('"frmLogin.frx":000A'), { frx: true, file: "frmLogin.frx", offset: 10, dollar: false }, "a pointer is the file and the offset it names, in hex");
  assert.deepEqual(parseValue('$"frmLogin.frx":0000'), { frx: true, file: "frmLogin.frx", offset: 0, dollar: true }, "a dollar marks a string stored in the companion");
  assert.deepEqual(parseValue("^O"), { raw: "^O" }); assert.deepEqual(parseValue("&H00FFFFFF&"), { raw: "&H00FFFFFF&" }, "a colour is a token, not a number");

  assert.deepEqual(read.handlers.map((h) => `${h.control}_${h.event}`), ["Form_Load", "cmdSave_Click", "cmdCancel_Click", "txtUser_Change", "mnuOpen_Click", "txtField_LostFocus", "tmrIdle_Timer"]);
  assert.deepEqual(read.messages.map((m) => [m.in, m.text]), [["cmdSave_Click", "Enter a user name."], ["cmdSave_Click", "Welcome, … !"], ["mnuOpen_Click", "Nothing to open."]],
    "the first argument's literals only: the title is not read, a variable between literals is an ellipsis, and a MsgBox in a comment is not a message");

  assert.equal(readFrm("Option Explicit\n").error, "no Begin block: not a VB6 form file");
  const open = readFrm('VERSION 5.00\nBegin VB.Form frmX\n   Caption = "x"\n   Begin VB.TextBox txtA\n      Left = 1\n');
  assert.match(open.problems[0], /VB\.TextBox txtA opened at line 4 is never closed/);
  const two = readFrm('Begin VB.Form frmA\nEnd\nBegin VB.Form frmB\nEnd\n');
  assert.match(two.problems[0], /a second top level block \(VB\.Form frmB\) at line 3 is not read/);
});

test("kinds from class and properties, shortcuts spelled out, prefixes stripped, mnemonics lifted", () => {
  const k = (className, props = {}, children = []) => kindOf({ className, props, children });
  assert.equal(k("VB.TextBox"), "input"); assert.equal(k("VB.TextBox", { MultiLine: -1 }), "textarea"); assert.equal(k("VB.Frame"), "group");
  assert.equal(k("VB.PictureBox"), "image"); assert.equal(k("VB.PictureBox", {}, [{}]), "section", "a picture box holding controls is a container");
  assert.equal(k("VB.Timer"), "nonvisual"); assert.equal(k("VB.HScrollBar"), "range"); assert.equal(k("VB.Line"), "rule"); assert.equal(k("VB.Shape"), "decoration"); assert.equal(k("VB.Menu"), "menuitem");
  assert.equal(k("MSComctlLib.ProgressBar", { Width: 1, Height: 1 }), "unknown", "an OCX class is not guessed at");
  assert.equal(k("MSComDlg.CommonDialog", { Left: 1, Top: 1 }), "nonvisual", "a class with no rectangle draws nothing");
  assert.equal(decodeShortcut("^O"), "Ctrl+O"); assert.equal(decodeShortcut("+{F2}"), "Shift+F2"); assert.equal(decodeShortcut("^+{DEL}"), "Ctrl+Shift+Del"); assert.equal(decodeShortcut("{F5}"), "F5"); assert.equal(decodeShortcut(undefined), null);
  assert.equal(stripPrefix("txtUserName"), "UserName"); assert.equal(stripPrefix("frame"), "frame", "a prefix is stripped only before a capital"); assert.equal(stripPrefix("cmd_Go"), "Go"); assert.equal(stripPrefix("lbl"), "lbl");
  assert.equal(camel("UserName"), "userName", "a name's humps are words"); assert.equal(camel("Remember me"), "rememberMe");
  assert.deepEqual(caption("&User name:"), { text: "User name", accesskey: "u" });
  assert.deepEqual(caption("Search && Replace"), { text: "Search & Replace", accesskey: null }, "a doubled ampersand is a literal one and names no key");
  assert.deepEqual(caption("R&&D &Options..."), { text: "R&D Options", accesskey: "o" });
});

test("a form lowers onto the dialect in reading order: menu bar, labels, fields, a frame of radios, a select with its items from the frx, a control array, the buttons", async () => {
  const notes = [];
  const form = modelForm(await login());
  assert.deepEqual(form.size, { width: 6000, height: 3900 }); assert.equal(form.frxRefs, 4, "ItemData, List, Text and Picture point into the frx");
  assert.deepEqual(form.controls.find((c) => c.name === "cboRegion").frx.map((p) => [p.property, p.offset]), [["ItemData", 0], ["List", 0x12]], "a control carries its pointers");
  assert.deepEqual(form.nonvisual.map((n) => [n.name, n.className, n.events]), [["tmrIdle", "VB.Timer", ["Timer"]]]);
  assert.deepEqual(form.events, ["Load"]);
  const bytes = await loginBytes();
  const records = await applyFrx(form, (name) => (name === "frmLogin.frx" ? bytes : null));
  assert.deepEqual(records.sort((a, b) => a.offset - b.offset).map((r) => [r.owner, r.property, r.kind]), [["cboRegion", "ItemData", "itemdata"], ["cboRegion", "List", "list"], ["txtNotes", "Text", "text"], ["imgLogo", "Picture", "picture"]]);
  assert.deepEqual(form.controls.find((c) => c.name === "cboRegion").options, LOGIN_ITEMS, "the list's items are the select's options");
  const { template, outputs, fields, title, usesTwoWay, usesNgFor, usesNgIf } = lowerForm(form, (n) => notes.push(n));
  assert.equal(title, "Log in"); assert.equal(usesTwoWay, true); assert.equal(usesNgFor, false, "no list is handed in, so nothing repeats"); assert.equal(usesNgIf, true);
  assert.deepEqual(outputs, ["about", "cancel", "exit", "help", "ok", "open"], "outputs are events; the emitter names the handler on<Event>");
  assert.deepEqual(fields, ["userName", "password", "role", "region", "rememberMe", "field0", "field1", "notes"]);
  assert.match(template, /^<form class="window" ng-submit="onOk\(\{ userName: userName, password: password, role: role, region: region, rememberMe: rememberMe, field0: field0, field1: field1, notes: notes \}\)">\n  <h2>Log in<\/h2>\n  <nav class="menu-bar" aria-label="menu">/, "the default button is the submit and hands every field back by name; the menu bar comes first");
  assert.match(template, /<label for="f-user-name">User name<\/label>\n\s*<input id="f-user-name" type="text" ng-model="userName">/, "a label on the row of a field names it; the mnemonic and the colon are gone");
  assert.match(template, /<input id="f-password" type="password" ng-model="password">/, "a PasswordChar is a password input");
  assert.match(template, /<fieldset>\n\s*<legend>Role<\/legend>\n\s*<label><input type="radio" ng-model="role" value="clerk" accesskey="c"> Clerk<\/label>\n\s*<label><input type="radio" ng-model="role" value="manager" accesskey="m"> Manager<\/label>\n\s*<\/fieldset>/, "option buttons share their frame's name and read left to right whatever the file order");
  assert.match(template, /<label for="f-region">Region<\/label>\n\s*<select id="f-region" ng-model="region">\n\s*<option>North<\/option>\n\s*<option>South<\/option>\n\s*<option>East<\/option>\n\s*<option>West<\/option>\n\s*<\/select>/, "a list held in the frx is read into real options");
  assert.match(template, /<label><input type="checkbox" ng-model="rememberMe" accesskey="r"> Remember me<\/label>/, "the mnemonic is the access key");
  assert.match(template, /<input id="f-field0" type="text" ng-model="field0">\n\s*<input id="f-field1" type="text" ng-model="field1">/, "a control array is one field per index, left to right");
  assert.match(template, /<p ng-show="shown.lockedOutShown">Locked out<\/p>\n\s*<textarea id="f-notes" ng-model="notes" readonly><\/textarea>/, "a hidden label labels nothing; a locked multiline text box is a read only textarea");
  assert.match(template, /<button type="button" ng-click="onHelp\(\)" accesskey="h" disabled>Help<\/button>\n\s*<button type="submit" accesskey="s">Save<\/button>\n\s*<button type="button" ng-click="onCancel\(\)">Cancel<\/button>/, "the bottom row reads left to right; Cancel is the cancel event whatever its caption");
  assert.match(template, /<div class="mscomctl-lib-progress-bar"><\/div>\n<\/form>$/, "an OCX class with no HTML equivalent is a named div");
  assert.match(template, /<span class="image" role="img" aria-label="Logo"><\/span>/, "an image is a placeholder named from the control");
  assert.match(template, /<button type="button" accesskey="f" aria-haspopup="menu">File<\/button>\n\s*<ul role="menu">\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onOpen\(\)" accesskey="o">Open<\/button><\/li>\n\s*<li role="separator"><\/li>\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onExit\(\)" accesskey="x">Exit<\/button><\/li>/);
  assert.match(template, /ng-click="onAbout\(\)" accesskey="a" disabled>About/);
  assert.doesNotMatch(template, /tmrIdle|Interval|60000/, "a timer is not a control and its interval is not printed");

  assert.ok(notes.some((n) => /^region has 4 option\(s\) read from the binary \.frx companion; anything the code adds to the list at runtime is not read$/.test(n)), "Form_Load's AddItem is code, and code is not read");
  assert.ok(!notes.some((n) => /regionOptions|Enter notes here/.test(n)), "no list is handed in, and the long text is never printed");
  assert.ok(notes.some((n) => /1 control\(s\) start hidden \(Locked out\)/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) start disabled \(Help\)/.test(n)));
  assert.ok(notes.some((n) => /1 picture control\(s\) are placeholders/.test(n)));
  assert.ok(notes.some((n) => /no HTML equivalent kept as divs: MSComctlLib\.ProgressBar \(prgLoad\)/.test(n)));
  assert.ok(notes.some((n) => /1 component\(s\) draw nothing \(tmrIdle: VB\.Timer\)/.test(n)));
  assert.ok(notes.some((n) => /Ctrl\+O fired Open in the original; the port binds no keyboard shortcut/.test(n)));
  assert.ok(notes.some((n) => /4 handler\(s\) wired in code are behaviour the port must reimplement \(txtField LostFocus, txtUser Change, frmLogin Load, tmrIdle Timer\)/.test(n)), "a click on a button or menu item is its event; every other handler is behaviour, once per control array");
  assert.ok(notes.some((n) => /role starts on clerk in the original/.test(n)));
  assert.ok(notes.some((n) => /notes starts with text the file holds; the port starts it empty/.test(n)));

  const ir = buildIr(template);
  assert.deepEqual(ir.collections, [], "a select's options are a list the screen is handed, not the data it is of");
  assert.deepEqual(ir.reads, ["onAbout", "onCancel", "onExit", "onHelp", "onOk", "onOpen", "shown"]);
  const jsx = translate(template).jsx;
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(/, "ng-submit swallows the navigation in the port");
  assert.match(jsx, /accessKey="r"/);
});

test("a menu alone lowers to a menu bar; a form with no default button is a div with no submit", () => {
  const { template, outputs } = lowerMenu({ label: "menu", items: [{ name: "mnuEdit", caption: "&Edit", children: [{ name: "mnuCut", caption: "Cu&t", shortcut: "Ctrl+X" }, { name: "mnuPaste", caption: "&Paste", checked: true }] }] });
  assert.deepEqual(outputs, ["cut", "paste"]);
  assert.match(template, /^<nav class="menu-bar" aria-label="menu">\n  <ul role="menubar">\n    <li>\n      <button type="button" accesskey="e" aria-haspopup="menu">Edit<\/button>/);
  assert.match(template, /ng-click="onPaste\(\)" accesskey="p" aria-checked="true">Paste/);
  const about = lowerForm(modelForm(readFrm('Begin VB.Form frmAbout\n   Caption = "About"\n   Begin VB.CommandButton cmdClose\n      Caption = "Close"\n      Cancel = -1\n      Left = 1\n      Top = 1\n      Width = 1\n      Height = 1\n   End\nEnd\n')), () => {});
  assert.equal(about.template, '<div class="window">\n  <h2>About</h2>\n  <button type="button" ng-click="onCancel()">Close</button>\n</div>');
  assert.deepEqual(about.outputs, ["cancel"]); assert.deepEqual(about.fields, []);
});

test("the review pass: keyword captions, a label above its field, a second default button, radios in two frames, a picture box container, a scroll bar and a line", () => {
  const notes = [];
  const src = [
    "Begin VB.Form frmOptions", '   Caption = "Options"',
    '   Begin VB.Label lblClass', '      Caption = "Class:"', "      Left = 240", "      Top = 120", "      Width = 1000", "      Height = 255", "   End",
    "   Begin VB.TextBox txtClass", "      Left = 240", "      Top = 400", "      Width = 2000", "      Height = 285", "   End",
    "   Begin VB.CheckBox chkDefault", '      Caption = "Default"', "      Left = 240", "      Top = 800", "      Width = 2000", "      Height = 255", "      Value = 1  'Checked", "   End",
    "   Begin VB.Frame fraExport", '      Caption = "Export"', "      Left = 240", "      Top = 1200", "      Width = 5000", "      Height = 600",
    "      Begin VB.OptionButton optCsv", '         Caption = "CSV"', "         Left = 100", "         Top = 250", "         Width = 800", "         Height = 255", "      End",
    "      Begin VB.OptionButton optXml", '         Caption = "XML"', "         Left = 1200", "         Top = 250", "         Width = 800", "         Height = 255", "      End",
    "   End",
    "   Begin VB.PictureBox picTools", "      Left = 240", "      Top = 2000", "      Width = 5000", "      Height = 400",
    "      Begin VB.OptionButton optA", '         Caption = "A"', "         Left = 10", "         Top = 10", "         Width = 500", "         Height = 255", "      End",
    "      Begin VB.HScrollBar hsbZoom", "         Left = 1000", "         Top = 10", "         Width = 2000", "         Height = 255", "      End",
    "   End",
    "   Begin VB.Line linSep", "      X1 = 240", "      X2 = 5240", "      Y1 = 2500", "      Y2 = 2500", "   End",
    "   Begin VB.CommandButton cmdNext", '      Caption = "Next >"', "      Default = -1  'True", "      Left = 240", "      Top = 2600", "      Width = 1200", "      Height = 375", "   End",
    "   Begin VB.CommandButton cmdApply", '      Caption = "&Apply"', "      Default = -1  'True", "      Left = 1600", "      Top = 2600", "      Width = 1200", "      Height = 375", "   End",
    "End", 'Attribute VB_Name = "frmOptions"', "", "Private Sub cmdApply_Click()", "End Sub", "Private Sub cmdGhost_Click()", "End Sub",
  ].join("\n");
  const read = readFrm(src);
  assert.deepEqual(read.problems, []);
  const form = modelForm(read);
  assert.deepEqual(form.orphans, ["cmdGhost_Click"], "a handler for a control that is not on the form is named, never invented");
  const { template, outputs, fields } = lowerForm(form, (n) => notes.push(n));
  assert.match(template, /<label for="f-class">Class<\/label>\n\s*<input id="f-class" type="text" ng-model="classField">/, "a label on the row above names the field; a caption spelling a keyword gets a suffix the emitted JavaScript can declare");
  assert.match(template, /<label><input type="checkbox" ng-model="defaultField"> Default<\/label>/);
  assert.match(template, /<legend>Export<\/legend>\n\s*<label><input type="radio" ng-model="exportField" value="csv"> CSV<\/label>\n\s*<label><input type="radio" ng-model="exportField" value="xml"> XML<\/label>/, "a frame captioned Export names a field JavaScript allows");
  assert.match(template, /<section>\n\s*<label><input type="radio" ng-model="tools" value="a"> A<\/label>\n\s*<input id="f-zoom" type="range" ng-model="zoom">\n\s*<\/section>/, "a picture box holding controls is a section; its radios take its name; a scroll bar is a value control, so a range");
  assert.match(template, /<hr>\n\s*<button type="submit">Next &gt;<\/button>\n\s*<button type="button" ng-click="onApply\(\)" accesskey="a">Apply<\/button>/, "the first default button is the submit; a second is its own event");
  assert.deepEqual(outputs, ["apply", "ok"]);
  assert.deepEqual(fields, ["classField", "defaultField", "exportField", "tools", "zoom"]);
  assert.ok(notes.some((n) => /cmdApply is also marked as the default button; only the first default is the submit, so the port raises onApply from a click only/.test(n)));
  assert.ok(notes.some((n) => /defaultField starts checked in the original/.test(n)));
  assert.ok(notes.some((n) => /cmdGhost_Click \(no control by that name\)/.test(n)));
});

test("the .frx reader takes a record against the layouts its property is known to write, accepts only a reading that fits, and never keeps a text's bytes", async () => {
  assert.deepEqual(await loginBytes(), loginFrx().bytes, "the .frx fixture is what the builder writes; node test/fixtures/vb6/frx.mjs rebuilds it");
  const pointers = Object.fromEntries((await login()).form.children.flatMap((c) => Object.entries(c.props).filter(([, v]) => v?.frx).map(([k, v]) => [k, v.offset])));
  assert.deepEqual(pointers, loginFrx().offsets, "the .frm's pointers spell the offsets the records landed at");
  assert.equal(hex(0x2e), "002E", "an offset is spelled as the .frm spells it");

  // Both list layouts and both text layouts read; which one a record took is not the port's business, only that it fits.
  const items = ["North", "S\u00e9ville", "", "West"];
  const built = frx([listRecord(items), sizedListRecord(items), textRecord("Enter notes here.\r\nTwo lines."), shortTextRecord("short"), itemDataRecord([7, 8, 9]), pictureRecord(bitmap()), emptyPictureRecord(), [0xff, 0xfe, 0xfd, 0xfc, 0xfb]]);
  const [words, sized, long, short, paired, pic, empty, junk] = built.offsets;
  const rec = (property, offset, dollar = false) => readRecord(built.bytes, { property, offset, dollar });
  assert.deepEqual(rec("List", words).items, items, "the 2 byte count layout, an accented letter read as Windows 1252, an empty item kept in place");
  assert.deepEqual(rec("List", sized).items, items, "the layout behind a 4 byte payload count, which the items fill exactly");
  assert.equal(rec("List", words).end, sized, "a record ends where the next begins");
  assert.deepEqual(rec("Text", long), { property: "Text", offset: long, kind: "text", length: 29, end: short }, "a long text is its length, never its bytes");
  assert.equal(rec("Text", short).length, 5, "the 2 byte length layout");
  assert.equal(rec("Caption", long, true).kind, "text", "a dollar pointer is a string whatever the property");
  assert.deepEqual(rec("ItemData", paired), { property: "ItemData", offset: paired, kind: "itemdata", count: 3, end: pic }, "the numbers are counted, not read");
  assert.deepEqual(rec("Picture", pic), { property: "Picture", offset: pic, kind: "picture", format: "a bitmap", length: 58, end: empty });
  assert.deepEqual(rec("Icon", empty), { property: "Icon", offset: empty, kind: "picture", format: "none", length: 0, end: junk }, "a size of zero is no picture");
  assert.equal(JSON.stringify(rec("Text", long)).includes("Enter"), false, "the text is in no field of the result");

  // What does not fit is named, never guessed at.
  assert.deepEqual(rec("List", junk), { property: "List", offset: junk, kind: "unread", reason: "the record fits neither list layout" });
  assert.deepEqual(rec("List", long), { property: "List", offset: long, kind: "unread", reason: "the record reads as one string of 29 byte(s), not as a list" }, "a list pointer at a text record says what it found");
  assert.deepEqual(rec("Text", words), { property: "Text", offset: words, kind: "unread", reason: "the record reads as a list of 4 item(s), not as text" });
  assert.equal(rec("Picture", words).reason, "the record does not carry the picture header VB writes");
  assert.equal(rec("ItemData", junk).reason, "the record's count of numbers runs past the end of the file");
  assert.deepEqual(rec("List", built.bytes.length), { property: "List", offset: built.bytes.length, kind: "beyond", reason: `the offset ${hex(built.bytes.length)} is past the end of the file (${built.bytes.length} byte(s))` });
  assert.equal(rec("List", -1).kind, "beyond");
  assert.equal(rec("Whatever", pic).kind, "picture", "an unknown property is tried against every layout, the picture's marker first");
  assert.equal(rec("Whatever", sized).kind, "list"); assert.equal(rec("Whatever", short).kind, "text");
  assert.deepEqual(rec("Whatever", junk), { property: "Whatever", offset: junk, kind: "unread", reason: "the record fits no layout this reader knows" });
  assert.equal(expectedKind("MouseIcon"), "picture"); assert.equal(expectedKind("ToolTipText"), "text"); assert.equal(expectedKind("Sorted"), "unknown");
  assert.equal(decodeAnsi(Buffer.from([0x80, 0xe9])).length, 2);

  // Applied to a form: only a select's List becomes options, and only when it holds something; everything else is described.
  const src = (listAt, textAt, extra = "") => readFrm(["Begin VB.Form frmX", '   Caption = "X"', `   Icon = "frmX.frx":${hex(empty)}`,
    "   Begin VB.ListBox lstA", `      List = "frmX.frx":${hex(listAt)}`, "      Left = 1", "      Top = 1", "      Width = 100", "      Height = 100", "   End",
    "   Begin VB.TextBox txtA", `      Text = "frmX.frx":${hex(textAt)}`, "      Left = 1", "      Top = 300", "      Width = 100", "      Height = 100", "   End",
    `   Begin VB.Label lblA`, `      Caption = $"other.frx":0000`, "      Left = 1", "      Top = 600", "      Width = 100", "      Height = 100", "   End",
    extra, "End"].join("\n"));
  const form = modelForm(src(sized, long));
  const records = await applyFrx(form, (name) => (name === "frmX.frx" ? built.bytes : null));
  assert.deepEqual(records.map((r) => [r.owner, r.property, r.kind, r.applied ?? false]), [["frmX", "Icon", "picture", false], ["lstA", "List", "list", true], ["txtA", "Text", "text", false], ["lblA", "Caption", "missing", false]]);
  assert.deepEqual(form.controls.find((c) => c.name === "lstA").options, items);
  assert.equal(describe(records[1]), `lstA.List at ${hex(sized)}, 4 item(s) read as its options`);
  assert.equal(describe(records[0]), `frmX.Icon at ${hex(empty)}, an empty picture record`);
  assert.equal(describe(records[2]), `txtA.Text at ${hex(long)}, 29 byte(s) of text, a value the port is not handed and this report does not print`);
  assert.equal(describe(records[3]), "lblA.Caption at 0000, in other.frx, which is not in the tree");
  const notes = [];
  const { template, usesNgFor } = lowerForm(form, (n) => notes.push(n));
  assert.match(template, /<select id="f-a" ng-model="a">\n\s*<option>North<\/option>\n\s*<option>S\u00e9ville<\/option>\n\s*<option><\/option>\n\s*<option>West<\/option>\n\s*<\/select>/);
  assert.equal(usesNgFor, false);
  assert.ok(notes.some((n) => /^a has 4 option\(s\) read from the binary \.frx companion/.test(n)));

  const emptyList = frx([listRecord([]), listRecord(["", ""])]);
  const none = modelForm(src(0, long));
  const noneRecs = await applyFrx(none, () => emptyList.bytes);
  assert.equal(noneRecs[1].applied, undefined); assert.equal(none.controls[0].options, null);
  assert.equal(describe(noneRecs[1]), "lstA.List at 0000, a list of 0 item(s) not carried (the record holds no items)");
  const blank = modelForm(src(emptyList.offsets[1], long));
  assert.equal(describe((await applyFrx(blank, () => emptyList.bytes))[1]), `lstA.List at ${hex(emptyList.offsets[1])}, a list of 2 item(s) not carried (every item is empty)`);
  const handed = [];
  lowerForm(blank, (n) => handed.push(n));
  assert.ok(handed.some((n) => /the list\(s\) a are filled from the binary \.frx companion and were not read from it; the port takes each as `<name>Options`/.test(n)), "a list that did not read is still handed to the port");
  const unread = modelForm(src(junk, built.bytes.length + 10));
  const unreadRecs = await applyFrx(unread, () => built.bytes);
  assert.equal(describe(unreadRecs[1]), `lstA.List at ${hex(junk)}, not read: the record fits neither list layout`);
  assert.match(describe(unreadRecs[2]), /not read: the offset .* is past the end of the file/);
  const onDiv = modelForm(src(sized, long, ['   Begin Other.Grid grdA', `      List = "frmX.frx":${hex(words)}`, "      Left = 1", "      Top = 900", "      Width = 100", "      Height = 100", "   End"].join("\n")));
  const onDivRecs = await applyFrx(onDiv, () => built.bytes);
  assert.equal(describe(onDivRecs.find((r) => r.owner === "grdA")), `grdA.List at ${hex(words)}, a list of 4 item(s) not carried (on a control that is not a select)`);
});

test("a folder of .frm files becomes screens, a report and notes, reads the .frx beside each, and ports to React with every state", async (t) => {
  const run = await runPipeline({ src: FIXTURES, shots: join(FIXTURES, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["form-about", "form-login"], "the frm prefix is stripped from the selector");
  const login = run.ctx.screens.find((s) => s.selector === "form-login");
  assert.equal(login.readBy, "vb6"); assert.equal(login.file, "frmLogin.frm"); assert.equal(login.title, "Log in"); assert.equal(login.className, "FormLogin");
  assert.deepEqual(login.inputs, ["shown"], "the fields are the form's own state, not inputs, and the region list is no longer handed in"); assert.deepEqual(login.outputs, ["about", "cancel", "exit", "help", "ok", "open"]);
  assert.equal(login.usesTwoWay, true); assert.deepEqual(login.rxjs, []); assert.match(login.templateOrigin, /form frmLogin in frmLogin\.frm/);
  const about = run.ctx.screens.find((s) => s.selector === "form-about");
  assert.equal(about.title, "About Ledger"); assert.deepEqual(about.outputs, ["cancel"]);

  const jsx = await readFile(join(run.out, "src/features/FormLogin/FormLogin.jsx"), "utf8");
  assert.match(jsx, /export default function FormLogin\(\{ shown, onAbout, onCancel, onExit, onHelp, onOk, onOpen, loading, error, onRetry \}\)/);
  assert.match(jsx, /<option>\s*North\s*<\/option>\s*<option>\s*South\s*<\/option>\s*<option>\s*East\s*<\/option>\s*<option>\s*West\s*<\/option>/, "the options read from the .frx reach the port");
  assert.doesNotMatch(jsx, /Enter notes here/, "the long text is a value and is never printed");
  assert.match(jsx, /const \[userName, setUserName\] = useState\(""\);/); assert.match(jsx, /const \[password, setPassword\] = useState\(""\);/);
  assert.match(jsx, /const \[field0, setField0\] = useState\(""\);/, "a control array's elements are fields");
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(\{ userName: userName/, "submit prevents the navigation and hands the fields back");
  assert.match(jsx, /if \(loading\) return/); assert.match(jsx, /if \(error\)/);
  assert.match(jsx, /No collection is bound, so the empty state cannot occur/, "an empty option list does not blank the form");

  const report = await readFile(join(run.out, "FORMS_VB6.md"), "utf8");
  assert.match(report, /^# Forms \(Visual Basic 6\)/);
  assert.match(report, /## frmLogin\.frm\n\nThe binary companion frmLogin\.frx was read for the 4 propert\(ies\) the text points into it: cboRegion\.ItemData at 0000, 4 number\(s\) paired with the list's items, not carried; cboRegion\.List at 0012, 4 item\(s\) read as its options; txtNotes\.Text at 002E, 17 byte\(s\) of text, a value the port is not handed and this report does not print; imgLogo\.Picture at 0043, a bitmap of 58 byte\(s\), an image resource not carried\./);
  assert.doesNotMatch(report, /Enter notes here|North/, "the text is never printed, and the options belong to the component, not the report");
  assert.match(report, /### frmLogin \(VB\.Form\): Log in\n\n6000 × 3900 twips, 19 control\(s\), form handlers: Load\./);
  assert.match(report, /\| txtPassword \| VB\.TextBox \| input \|  \| 1560, 450 \| 2500 × 285 \| 1 \|  \|/, "the rectangle in twips and the tab index");
  assert.match(report, /\| fraRole\.optClerk \| VB\.OptionButton \| radio \| Clerk \| 240, 300 \| 1500 × 255 \| 1 \|  \|/, "a nested control is named through its container");
  assert.match(report, /\| txtField\(0\) \| VB\.TextBox \| input \|  \| 240, 2400 \| 2500 × 285 \| 4 \| LostFocus \|/, "a control array element carries its index and the shared handler");
  assert.match(report, /\| cmdSave \| VB\.CommandButton \| button \| Save \| 3240, 3000 \| 1200 × 375 \| 6 \| Click \|/);
  assert.match(report, /#### menu\n\n- File\n  - Open \(Ctrl\+O\)\n  - ———\n  - Exit\n- Help\n  - About disabled/);
  assert.match(report, /#### Components that draw nothing\n\n- tmrIdle \(VB\.Timer\): a timer; its interval and Timer handler are behaviour the port must reimplement/);
  assert.match(report, /#### Messages the code shows\n\n\| in \| message \|\n\| --- \| --- \|\n\| cmdSave_Click \| Enter a user name\. \|\n\| cmdSave_Click \| Welcome, … ! \|\n\| mnuOpen_Click \| Nothing to open\. \|/);
  assert.doesNotMatch(report, /60000|MS Sans Serif|vbExclamation/, "no property value other than a caption or a message is printed");
  assert.match(report, /### frmAbout \(VB\.Form\): About Ledger/);

  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /frmLogin\.frm: txtNotes\.Text is 17 byte\(s\) of text in frmLogin\.frx; it is a value, noted and never printed\./);
  assert.match(notes, /frmLogin\.frm: 1 picture\(s\) in frmLogin\.frx \(imgLogo\.Picture: a bitmap\) are image resources not carried into the port\./);
  assert.match(notes, /frmLogin\.frm: ItemData in frmLogin\.frx pairs a number with each item of cboRegion; the numbers are not carried\./);
  assert.match(notes, /frmAbout\.frm: 1 propert\(ies\) point into frmAbout\.frx, which is not in the tree/);
  assert.match(notes, /frmLogin\.frm: 3 MsgBox message\(s\) the code shows are listed in FORMS_VB6\.md/);
  assert.match(notes, /frmLogin\.frm, form frmLogin: region has 4 option\(s\) read from the binary \.frx companion/);
  assert.doesNotMatch(notes, /regionOptions|named and not read|Enter notes here/);
  assert.match(await readFile(join(run.out, "READERS.md"), "utf8"), /frmLogin\.frm/, "the census counts the form file as read");
  assert.ok(!run.ctx.report.unverified.some((n) => /no reader claimed/.test(n) && /\.frm/.test(n)), "no form file is an unread markup file");
});

test("a form file the scanner cannot read is a note, never an exception", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-vb6-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "broken.frm"), "Option Explicit\nPrivate Sub Main()\nEnd Sub\n");
  await writeFile(join(dir, "open.frm"), 'VERSION 5.00\nBegin VB.Form frmOpen\n   Caption = "Open"\n   Begin VB.TextBox txtA\n      Left = 1\n      Top = 1\n      Width = 1\n      Height = 1\n');
  const run = await runPipeline({ src: dir, shots: join(dir, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /broken\.frm: no Begin block: not a VB6 form file; nothing was read from it\./);
  assert.match(notes, /open\.frm: the block VB\.TextBox txtA opened at line 4 is never closed\./);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector), ["form-open"], "what was read of an unclosed form is still a screen");
});
