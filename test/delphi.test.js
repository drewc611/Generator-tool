import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { decodeShortcut, kindOf, modelForm, parseString, parseValue, readDfm } from "../plugins/input-delphi/dfm.js";
import { lowerForm } from "../plugins/input-vb6/forms.js";
import { translate } from "../plugins/output-react/template.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A Delphi or Lazarus form file is a legacy front end whose interface is
 * text: nested object blocks, each a list of properties in pixels, a main
 * menu as nested items, and the data sources, queries and connections the
 * code read through, which draw nothing. input-delphi walks the blocks with
 * a stack, joins the lines a value spans by its bracket, and lowers the form
 * through the lowering input-vb6 shares. The fixtures are a real .dfm, a
 * Lazarus .lfm and a FireMonkey .fmx under test/fixtures/delphi.
 */

const FIXTURES = join(ROOT, "test/fixtures/delphi");
const login = async () => readDfm(await readFile(join(FIXTURES, "Login.dfm"), "utf8"));

test("the .dfm scanner walks the object tree and joins the lines a string list, a binary block, a collection and a concatenation span", async () => {
  const read = await login();
  assert.equal(read.error, undefined); assert.deepEqual(read.problems, []);
  assert.equal(read.forms.length, 1);
  const [form] = read.forms;
  assert.equal(form.name, "frmLogin"); assert.equal(form.className, "TfrmLogin"); assert.equal(form.props.Caption.string, "Log in");
  assert.equal(form.props["Font.Name"].string, "Tahoma", "a dotted property keeps its dots");
  assert.deepEqual(form.props["Font.Style"], { set: "[]" });
  assert.equal(form.children.length, 20);
  const by = (name) => form.children.find((c) => c.name === name);
  assert.deepEqual(by("rgRole").props["Items.Strings"], { list: ["Clerk", "Manager"] }, "one item per line, not one string");
  assert.deepEqual(by("cbRegion").props["Items.Strings"], { list: ["North", "South", "It's complicated"] }, "a doubled quote is a literal one");
  assert.deepEqual(by("imgLogo").props["Picture.Data"], { binary: true }, "binary data is noted, never kept");
  assert.deepEqual(by("grdUsers").props.Columns, { collection: true }, "a collection of items is consumed whole");
  assert.equal(by("grdUsers").props.TabOrder, 7, "the properties after the collection are still the grid's");
  assert.equal(by("lblLocked").props.Caption.string, "Locked out", "a string continued with + over a line break and a #32 code");
  assert.deepEqual(by("qryUsers").props["SQL.Strings"].list.length, 3);
  assert.deepEqual(by("mnuMain").children.map((c) => c.name), ["mnuFile", "mnuHelp"]);
  assert.equal(by("mnuMain").children[0].children[1].props.Caption.string, "-");
  assert.deepEqual(by("pgOptions").children.map((c) => `${c.name}: ${c.className}`), ["tsNotes: TTabSheet", "tsExtra: TTabSheet"]);

  assert.deepEqual(parseString("'it''s'"), { string: "it's", end: 7 });
  assert.equal(parseString("'a'#13#10'b'").string, "a\r\nb"); assert.equal(parseString("#$41'b'").string, "Ab");
  assert.equal(parseString("'a' + 'b'").string, "ab"); assert.equal(parseString("'a' 'b'").string, "a", "bare whitespace ends the string; the next run is another item");
  assert.equal(parseString("x"), null);
  assert.equal(parseValue("True"), true); assert.equal(parseValue("False"), false); assert.equal(parseValue("16463"), 16463); assert.equal(parseValue("8.000000000000000000"), 8);
  assert.deepEqual(parseValue("edtUser"), { ident: "edtUser" }); assert.deepEqual(parseValue("(\n  'a'\n  'b')"), { list: ["a", "b"] }); assert.deepEqual(parseValue("{ 00FF }"), { binary: true }); assert.deepEqual(parseValue("<>"), { collection: true });

  assert.equal(readDfm("unit Login;\n").error, "no object block: not a Delphi form file");
  const open = readDfm("object frmX: TfrmX\n  Caption = 'x'\n  object edtA: TEdit\n    Left = 1\n");
  assert.match(open.problems[0], /the block edtA: TEdit opened at line 3 is never closed/);
  const stray = readDfm("object frmX: TfrmX\n  Caption = 'x'\n  item\nend\nend\n");
  assert.match(stray.problems[0], /line 3 inside frmX is neither a property nor a block and was skipped/);
  assert.match(stray.problems[1], /an end at line 5 closes nothing/);
  assert.equal(readDfm("inherited frmChild: TfrmChild\n  inline frame1: TFrame1\n  end\nend\n").forms[0].children[0].className, "TFrame1", "inherited and inline open blocks as object does");
});

test("kinds from class, a class with no rectangle draws nothing, shortcuts spelled out", () => {
  const k = (className, props = {}) => kindOf({ className, props, children: [] });
  const drawn = { Width: 1, Height: 1 };
  assert.equal(k("TEdit", drawn), "input"); assert.equal(k("TMemo", drawn), "textarea"); assert.equal(k("TRadioGroup", drawn), "radiogroup"); assert.equal(k("TGroupBox", drawn), "group"); assert.equal(k("TPanel", drawn), "section");
  assert.equal(k("TPageControl", drawn), "tabs"); assert.equal(k("TTabSheet"), "tab"); assert.equal(k("TBitBtn", drawn), "button"); assert.equal(k("TSpinEdit", drawn), "number"); assert.equal(k("TTrackBar", drawn), "range");
  assert.equal(k("TDateTimePicker", drawn), "date"); assert.equal(k("TDateTimePicker", { ...drawn, Kind: { ident: "dtkTime" } }), "time"); assert.equal(k("TDBGrid", drawn), "table"); assert.equal(k("TDBEdit", drawn), "input", "a data aware control is the control it wraps");
  assert.equal(k("TMainMenu"), "menu"); assert.equal(k("TMenuItem"), "menuitem"); assert.equal(k("TQuery", { Left: 1, Top: 1 }), "nonvisual"); assert.equal(k("TTimer"), "nonvisual");
  assert.equal(k("TChart", drawn), "unknown", "a class the reader does not know, with a rectangle, is a control it does not guess at");
  assert.equal(k("TLabel", { "Size.Width": 1, "Size.Height": 1 }), "label", "FireMonkey spells the size as Size.Width");
  assert.equal(decodeShortcut(16463), "Ctrl+O"); assert.equal(decodeShortcut(0x2000 | 0x4000 | 0x53), "Shift+Ctrl+S"); assert.equal(decodeShortcut(0x74), "F5"); assert.equal(decodeShortcut(0x8000 | 0x2e), "Alt+Del"); assert.equal(decodeShortcut(0), null); assert.equal(decodeShortcut("Ctrl+O"), "Ctrl+O");
});

test("a form lowers onto the dialect: an explicit label, a radio group with its items, radios by group box, a select with real options, tab pages, a grid, the buttons by ModalResult", async () => {
  const notes = [];
  const form = modelForm((await login()).forms[0]);
  assert.deepEqual(form.size, { width: 420, height: 330 }); assert.deepEqual(form.events, ["Create"]);
  assert.deepEqual(form.nonvisual.map((n) => [n.name, n.className, n.note]), [
    ["dsUsers", "TDataSource", "a data source the port must supply"],
    ["qryUsers", "TQuery", "a query the port must supply; its SQL is not printed"],
    ["tmrIdle", "TTimer", "a timer; its interval and OnTimer handler are behaviour the port must reimplement"],
  ]);
  assert.equal(form.menus.length, 1);
  const { template, outputs, fields, title, usesTwoWay, usesNgFor, usesNgIf } = lowerForm(form, (n) => notes.push(n));
  assert.equal(title, "Log in"); assert.equal(usesTwoWay, true); assert.equal(usesNgFor, false, "every list's items are in the file, so nothing repeats"); assert.equal(usesNgIf, true);
  assert.deepEqual(outputs, ["about", "cancel", "exit", "help", "ok", "open"]);
  assert.deepEqual(fields, ["userName", "password", "role", "shift", "region", "rememberMe", "notes", "count", "level", "since"]);
  assert.match(template, /^<form class="window" ng-submit="onOk\(\{ userName: userName, password: password, role: role, shift: shift, region: region, rememberMe: rememberMe, notes: notes, count: count, level: level, since: since \}\)">\n  <h2>Log in<\/h2>\n  <nav class="menu-bar" aria-label="menu">/, "mrOk is the submit and hands every field back by name, the pages' fields included");
  assert.match(template, /<label for="f-user-name">User name<\/label>\n\s*<input id="f-user-name" type="text" ng-model="userName">/, "FocusControl names the field explicitly");
  assert.match(template, /<label for="f-password">Password<\/label>\n\s*<input id="f-password" type="password" ng-model="password">/, "a label on the row with no FocusControl still names its field");
  assert.match(template, /<fieldset>\n\s*<legend>Role<\/legend>\n\s*<label><input type="radio" ng-model="role" value="clerk"> Clerk<\/label>\n\s*<label><input type="radio" ng-model="role" value="manager"> Manager<\/label>\n\s*<\/fieldset>/, "a radio group's items are its radios");
  assert.match(template, /<fieldset>\n\s*<legend>Shift<\/legend>\n\s*<label><input type="radio" ng-model="shift" value="day"> Day<\/label>\n\s*<label><input type="radio" ng-model="shift" value="night"> Night<\/label>\n\s*<\/fieldset>/, "radio buttons in a group box share its name");
  assert.match(template, /<select id="f-region" ng-model="region">\n\s*<option>North<\/option>\n\s*<option>South<\/option>\n\s*<option>It's complicated<\/option>\n\s*<\/select>/, "items known at design time are real options");
  assert.match(template, /<label><input type="checkbox" ng-model="rememberMe" accesskey="r"> Remember me<\/label>/);
  assert.match(template, /<div role="tablist">\n\s*<section role="tabpanel" aria-label="Notes">\n\s*<textarea id="f-notes" ng-model="notes" readonly><\/textarea>\n\s*<\/section>\n\s*<section role="tabpanel" aria-label="Extra">\n\s*<input id="f-count" type="number" ng-model="count">\n\s*<input id="f-level" type="range" ng-model="level">\n\s*<input id="f-since" type="date" ng-model="since">\n\s*<\/section>\n\s*<\/div>/, "every page is in the template; a spin edit is a number, a track bar a range, a date picker a date");
  assert.match(template, /<p ng-show="shown.lockedOutShown">Locked out<\/p>\n\s*<table class="grid"><\/table>/);
  assert.match(template, /<button type="button" ng-click="onHelp\(\)" accesskey="h" disabled>Help<\/button>\n\s*<button type="submit" accesskey="s">Save<\/button>\n\s*<button type="button" ng-click="onCancel\(\)">Cancel<\/button>\n<\/form>$/);
  assert.match(template, /<li role="none"><button type="button" role="menuitem" ng-click="onOpen\(\)" accesskey="o">Open<\/button><\/li>\n\s*<li role="separator"><\/li>/);
  assert.doesNotMatch(template, /Line one|select id, name|secret_token|Ledger|44927/, "a memo's lines, the SQL, the database name and a date value are never printed");

  assert.ok(notes.some((n) => /1 control\(s\) start hidden \(Locked out\)/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) start disabled \(Help\)/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) are data aware \(grdUsers\), bound to a data source the port must supply/.test(n)));
  assert.ok(notes.some((n) => /3 component\(s\) draw nothing \(dsUsers: TDataSource, qryUsers: TQuery, tmrIdle: TTimer\)/.test(n)));
  assert.ok(notes.some((n) => /Ctrl\+O fired Open in the original/.test(n)));
  assert.ok(notes.some((n) => /3 handler\(s\) wired in code are behaviour the port must reimplement \(edtUser Change, frmLogin Create, tmrIdle Timer\)/.test(n)));
  assert.ok(notes.some((n) => /role starts on clerk in the original/.test(n)), "ItemIndex is the initial state");
  assert.ok(notes.some((n) => /shift starts on day in the original/.test(n)));
  assert.ok(notes.some((n) => /rememberMe starts checked in the original/.test(n)));
  assert.ok(notes.some((n) => /the page control pgOptions shows one of 2 page\(s\) at a time \(Notes, Extra\); which is shown is state the port drives/.test(n)));
  assert.ok(notes.some((n) => /notes starts with text the file holds/.test(n)), "a memo's lines exist and are not printed");
  assert.ok(notes.some((n) => /the grid grdUsers is a table whose columns and rows the code supplies/.test(n)));

  const ir = buildIr(template);
  assert.deepEqual(ir.collections, []);
  assert.deepEqual(ir.reads, ["onAbout", "onCancel", "onExit", "onHelp", "onOk", "onOpen", "shown"]);
  const jsx = translate(template).jsx;
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(/);
  assert.match(jsx, /It's complicated/);
});

test("the review pass: a keyword caption, a FocusControl on a button, bkCancel, a popup menu, a data aware edit, a check list box, an empty radio group, a labelled edit, a time picker", () => {
  const notes = [];
  const src = [
    "object frmMore: TfrmMore", "  Caption = 'More'", "  ClientHeight = 300", "  ClientWidth = 300",
    "  object lblClass: TLabel", "    Left = 8", "    Top = 8", "    Width = 30", "    Height = 13", "    Caption = 'Class:'", "    FocusControl = edtClass", "  end",
    "  object edtClass: TDBEdit", "    Left = 60", "    Top = 5", "    Width = 100", "    Height = 21", "    DataField = 'CLASS'", "    DataSource = dsMain", "    TabOrder = 0", "  end",
    "  object lblGo: TLabel", "    Left = 8", "    Top = 40", "    Width = 30", "    Height = 13", "    Caption = 'Go'", "    FocusControl = btnGo", "  end",
    "  object lstTags: TCheckListBox", "    Left = 8", "    Top = 60", "    Width = 100", "    Height = 60", "    TabOrder = 1", "  end",
    "  object rgEmpty: TRadioGroup", "    Left = 120", "    Top = 60", "    Width = 100", "    Height = 60", "    Caption = 'Mode'", "    TabOrder = 2", "  end",
    "  object ledPhone: TLabeledEdit", "    Left = 8", "    Top = 140", "    Width = 100", "    Height = 21", "    EditLabel.Width = 30", "    EditLabel.Caption = '&Phone:'", "    TabOrder = 3", "  end",
    "  object dtpAt: TDateTimePicker", "    Left = 120", "    Top = 140", "    Width = 100", "    Height = 21", "    Kind = dtkTime", "    TabOrder = 4", "  end",
    "  object btnGo: TBitBtn", "    Left = 8", "    Top = 260", "    Width = 75", "    Height = 25", "    Kind = bkOK", "    TabOrder = 5", "  end",
    "  object btnBack: TBitBtn", "    Left = 100", "    Top = 260", "    Width = 75", "    Height = 25", "    Kind = bkCancel", "    Caption = 'Back'", "    TabOrder = 6", "  end",
    "  object pmGrid: TPopupMenu", "    Left = 200", "    Top = 200",
    "    object pmCopy: TMenuItem", "      Caption = '&Copy'", "      ShortCut = 16451", "    end",
    "  end",
    "  object dsMain: TDataSource", "    Left = 240", "    Top = 200", "  end",
    "end",
  ].join("\n");
  const read = readDfm(src);
  assert.deepEqual(read.problems, []);
  const { template, outputs, fields } = lowerForm(modelForm(read.forms[0]), (n) => notes.push(n));
  assert.match(template, /<label for="f-class">Class<\/label>\n\s*<input id="f-class" type="text" ng-model="classField">/, "a caption spelling a keyword gets a suffix the emitted JavaScript can declare");
  assert.match(template, /<p>Go<\/p>/, "a label whose FocusControl is a button stays text");
  assert.match(template, /<select id="f-tags" ng-model="tags" multiple>\n\s*<option ng-repeat="option in tagsOptions">\{\{ option \}\}<\/option>\n\s*<\/select>/, "a check list box is a multiple select; with no items in the file, a list the port is handed");
  assert.match(template, /<fieldset>\n\s*<legend>Mode<\/legend>\n\s*<\/fieldset>/, "an empty radio group is an empty fieldset, not invented buttons");
  assert.match(template, /<input id="f-phone" type="text" ng-model="phone">/, "a labelled edit's own label names it");
  assert.match(template, /<input id="f-at" type="time" ng-model="at">/);
  assert.match(template, /<button type="submit"><\/button>\n\s*<button type="button" ng-click="onCancel\(\)">Back<\/button>/, "bkOK is the submit with no caption of its own in the file; bkCancel is the cancel whatever its caption");
  assert.match(template, /<nav class="menu-bar" aria-label="pmGrid \(context menu\)">[\s\S]*ng-click="onCopy\(\)" accesskey="c">Copy/, "a popup menu is a menu bar named as the context menu it was");
  assert.deepEqual(outputs, ["cancel", "copy", "ok"]);
  assert.deepEqual(fields, ["classField", "tags", "mode", "phone", "at"]);
  assert.ok(notes.some((n) => /the label lblGo names btnGo as its control, which is not a field this reader lowered; the label stays text/.test(n)));
  assert.ok(notes.some((n) => /the list\(s\) tags are filled by the code at runtime/.test(n)));
  assert.ok(notes.some((n) => /the radio group rgEmpty declares no items/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) are data aware \(edtClass\)/.test(n)));
  assert.ok(notes.some((n) => /Ctrl\+C fired Copy in the original/.test(n)));
  assert.doesNotMatch(template, /CLASS|dsMain/, "the data field and source are never in the template");
});

test("a folder of .dfm, .lfm and .fmx files becomes screens, a report and notes, and ports to React with every state", async (t) => {
  const run = await runPipeline({ src: FIXTURES, shots: join(FIXTURES, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["form-login", "form-mobile", "form-settings"], "the frm prefix is stripped from the selector");
  const login = run.ctx.screens.find((s) => s.selector === "form-login");
  assert.equal(login.readBy, "delphi"); assert.equal(login.file, "Login.dfm"); assert.equal(login.title, "Log in"); assert.equal(login.className, "FormLogin");
  assert.deepEqual(login.inputs, ["shown"], "every list's items are in the file, so the only input is the hidden state"); assert.deepEqual(login.outputs, ["about", "cancel", "exit", "help", "ok", "open"]);
  assert.equal(login.usesNgFor, false); assert.deepEqual(login.rxjs, []); assert.match(login.templateOrigin, /form frmLogin in Login\.dfm/);
  const settings = run.ctx.screens.find((s) => s.selector === "form-settings");
  assert.equal(settings.file, "settings.lfm"); assert.equal(settings.title, "Settings"); assert.deepEqual(settings.outputs, ["ok"]);
  assert.match(settings.template, /<label for="f-folder">Folder<\/label>\n\s*<input id="f-folder" type="text" ng-model="folder">\n\s*<button type="submit">OK<\/button>/, "a Lazarus form reads the same; Default = True is the submit");
  const mobile = run.ctx.screens.find((s) => s.selector === "form-mobile");
  assert.equal(mobile.file, "Mobile.fmx"); assert.equal(mobile.title, "Sign in");
  assert.match(mobile.template, /<label for="f-name">Name<\/label>\n\s*<input id="f-name" type="text" ng-model="name">\n\s*<label><input type="checkbox" ng-model="staySignedIn"> Stay signed in<\/label>\n\s*<button type="submit">Go<\/button>/, "FireMonkey positions, sizes and Text captions read the same");

  const jsx = await readFile(join(run.out, "src/features/FormLogin/FormLogin.jsx"), "utf8");
  assert.match(jsx, /export default function FormLogin\(\{ shown, onAbout, onCancel, onExit, onHelp, onOk, onOpen, loading, error, onRetry \}\)/);
  assert.match(jsx, /const \[userName, setUserName\] = useState\(""\);/); assert.match(jsx, /const \[role, setRole\] = useState\(""\);/); assert.match(jsx, /const \[since, setSince\] = useState\(""\);/);
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(\{ userName: userName/, "submit prevents the navigation and hands the fields back");
  assert.match(jsx, /if \(loading\) return/); assert.match(jsx, /if \(error\)/);
  assert.match(jsx, /No collection is bound, so the empty state cannot occur/);

  const report = await readFile(join(run.out, "FORMS_DELPHI.md"), "utf8");
  assert.match(report, /^# Forms \(Delphi\)/);
  assert.match(report, /### frmLogin \(TfrmLogin\): Log in\n\n420 × 330 px, 24 control\(s\), form handlers: Create\./);
  assert.match(report, /\| edtPassword \| TEdit \| input \|  \| 104, 41 \| 200 × 21 \| 1 \|  \|/, "the rectangle in pixels and the tab order");
  assert.match(report, /\| edtUser \| TEdit \| input \|  \| 104, 13 \| 200 × 21 \| 0 \| Change \|/);
  assert.match(report, /\| grpShift\.rbDay \| TRadioButton \| radio \| Day \| 8, 16 \| 60 × 17 \| 0 \|  \|/, "a nested control is named through its container");
  assert.match(report, /\| pgOptions\.tsExtra\.spnCount \| TSpinEdit \| number \|  \| 3, 3 \| 60 × 22 \| 0 \|  \|/);
  assert.match(report, /\| btnSave \| TBitBtn \| button \| Save \| 240, 296 \| 75 × 25 \| 9 \| Click \|/);
  assert.match(report, /#### menu\n\n- File\n  - Open \(Ctrl\+O\)\n  - ———\n  - Exit\n- Help\n  - About disabled/);
  assert.match(report, /#### Components that draw nothing\n\n- dsUsers \(TDataSource\): a data source the port must supply\n- qryUsers \(TQuery\): a query the port must supply; its SQL is not printed\n- tmrIdle \(TTimer\)/);
  assert.doesNotMatch(report, /secret_token|select id|Ledger|60000|Tahoma|Line one/, "no property value other than a caption is printed, and no SQL");
  assert.match(report, /### frmSettings \(TfrmSettings\): Settings/); assert.match(report, /### frmMobile \(TfrmMobile\): Sign in/);
  assert.match(report, /\| edtName \| TEdit \| input \|  \| 72, 4 \| 200 × 22 \| 0 \|  \|/, "FireMonkey's floating point rectangle is rounded to pixels");

  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /Login\.dfm, form frmLogin: 3 component\(s\) draw nothing/);
  assert.match(notes, /settings\.lfm, form frmSettings: folder starts with text the file holds/);
  assert.match(notes, /Mobile\.fmx, form frmMobile: staySignedIn starts checked/);
  assert.match(await readFile(join(run.out, "READERS.md"), "utf8"), /Login\.dfm/, "the census counts the form file as read");
  assert.ok(!run.ctx.report.unverified.some((n) => /no reader claimed/.test(n) && /\.(dfm|lfm|fmx)/.test(n)), "no form file is an unread markup file");
});

test("a binary .dfm and a file that is not a form are notes, never exceptions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-delphi-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "Binary.dfm"), Buffer.from([0xff, 0x0a, 0x54, 0x50, 0x46, 0x30, 0x08, 0x54, 0x66, 0x72, 0x6d, 0x58, 0x00]));
  await writeFile(join(dir, "Unit.dfm"), "unit Login;\ninterface\nend.\n");
  await writeFile(join(dir, "Bom.dfm"), "﻿object frmBom: TfrmBom\n  Caption = 'Bom'\n  object btnOk: TButton\n    Left = 1\n    Top = 1\n    Width = 1\n    Height = 1\n    Caption = 'OK'\n    ModalResult = 1\n  end\nend\n");
  const run = await runPipeline({ src: dir, shots: join(dir, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /Binary\.dfm is a binary form file; save it as text \(the IDE's Text DFM setting, or convert\.exe\) and it will be read\. Nothing was read from it\./);
  assert.match(notes, /Unit\.dfm: no object block: not a Delphi form file; nothing was read from it\./);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector), ["form-bom"], "a byte order mark does not hide the first block");
  assert.match(run.ctx.screens[0].template, /<form class="window" ng-submit="onOk\(\)">\n  <h2>Bom<\/h2>\n  <button type="submit">OK<\/button>\n<\/form>/, "a form with no fields still submits, with nothing to hand back");
});
