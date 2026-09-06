import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { lowerDialog, lowerMenu } from "../plugins/input-exe/index.js";
import { readDialog } from "../plugins/input-exe/pe.js";
import { numeric, preprocess, readHeader, readScript, stripComments } from "../plugins/input-rc/rc.js";
import { STYLE_BITS, WS_CHILD } from "../plugins/input-rc/styles.js";
import { translate } from "../plugins/output-react/template.js";
import { dialogTemplate } from "./fixtures/exe/build.mjs";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A resource script is the source form of what input-exe reads from a
 * compiled executable. input-rc reads the .rc as Visual C++ writes it, the
 * resource.h beside it for the names, and the .rc2 the editor leaves alone,
 * into exactly the control shape the binary reader produces, and lowers each
 * dialog and menu through the same two functions. The proof that the two
 * agree is in here: the same login dialog written as a script and compiled
 * into a template yields one template. What the script cannot say is named.
 */

const FIXTURE = join(ROOT, "test/fixtures/rc");
const S = STYLE_BITS;
const WS_VISIBLE = S.WS_VISIBLE;

async function readFixture() {
  const header = readHeader(await readFile(join(FIXTURE, "resource.h"), "utf8"));
  const rc = readScript(await readFile(join(FIXTURE, "app.rc"), "utf8"), { headers: [header] });
  const rc2 = readScript(await readFile(join(FIXTURE, "res/app.rc2"), "utf8"), { headers: [header] });
  return { header, rc, rc2 };
}

test("the preprocessor skips what the editor owns, keeps what rc.exe compiles, and names every condition it did not decide", async () => {
  assert.equal(stripComments('LTEXT "a // not a comment", 1 // real\n/* gone\nstill */ CTEXT'), 'LTEXT "a // not a comment", 1        \n       \n         CTEXT', "comments blank to spaces, strings and line count untouched");
  const pre = preprocess(await readFile(join(FIXTURE, "app.rc"), "utf8"));
  const kept = pre.lines.map((l) => l.text.trim()).filter(Boolean);
  assert.ok(!kept.some((l) => /TEXTINCLUDE/.test(l)), "the APSTUDIO_INVOKED block is the editor's and is skipped");
  assert.ok(kept.includes("IDD_LOGIN DIALOGEX 0, 0, 220, 140"));
  assert.deepEqual(pre.includes.map((i) => i.file), ["resource.h", "afxres.h", "res\\app.rc2"], "the include inside #ifndef APSTUDIO_INVOKED is compiled and so is read");
  assert.deepEqual(pre.defines.map(([n]) => n), ["APSTUDIO_READONLY_SYMBOLS", "_AFX_NO_SPLITTER_RESOURCES"]);
  assert.deepEqual(pre.unevaluated.map((u) => [u.n, u.source, u.elseSkipped]), [[18, "#if !defined(AFX_RESOURCE_DLL) || defined(AFX_TARG_ENU)", false], [148, "#ifdef _DEBUG", true]], "a name the compiler does not always set is not decided; the first branch is read and the else named as skipped");
  assert.ok(kept.includes("FILEFLAGS 0x1L") && !kept.includes("FILEFLAGS 0x0L"));
  assert.deepEqual(pre.problems, []);

  const both = preprocess("#ifdef _WIN32\nA\n#else\nB\n#endif\n#ifndef APSTUDIO_INVOKED\nC\n#endif\n#if 0\nD\n#elif defined(RC_INVOKED) && !defined(APSTUDIO_INVOKED)\nE\n#else\nF\n#endif\n#define X\n#ifdef X\nG\n#endif\n#undef X\n#ifdef X\nH\n#endif\n#endif\n");
  assert.deepEqual(both.lines.map((l) => l.text).filter(Boolean), ["A", "C", "E", "G"], "_WIN32 and RC_INVOKED are always set, APSTUDIO_INVOKED never; #if 0, #elif, #define and #undef are honoured");
  assert.deepEqual(both.unevaluated, []);
  assert.deepEqual(both.problems, ["line 24: #endif with no #if"]);
  assert.deepEqual(preprocess("#ifdef Y\n").problems, ["1 conditional(s) never reach #endif"]);
});

test("resource.h resolves the names, in order, with the SDK's ids underneath and an expression read through its brackets", async () => {
  const { header, rc } = await readFixture();
  assert.ok(header.some(([n, v]) => n === "IDC_UPDATES" && v === "(IDC_LIST + 10)"));
  assert.ok(!header.some(([n]) => n.startsWith("_APS_NEXT")), "the editor's next value block is behind APSTUDIO_INVOKED and skipped");
  assert.equal(rc.symbols.get("IDC_UPDATES"), 1040, "a define that names another define resolves after it");
  assert.equal(rc.symbols.get("IDOK"), 1); assert.equal(rc.symbols.get("IDC_STATIC"), 65535); assert.equal(rc.symbols.get("ID_HELP"), 0xe146, "afxres's command ids are the SDK's, not the project's");
  assert.equal(rc.symbols.get("ID_FILE_OPEN"), 32771, "the project's resource.h redefines an afxres command and wins");
  assert.equal(numeric("(-1)", rc.symbols), -1); assert.equal(numeric("0x3fL", rc.symbols), 63); assert.equal(numeric("IDC_LIST - 30", rc.symbols), 1000); assert.equal(numeric("(IDC_LIST) + (2 + 3)", rc.symbols), 1035);
  assert.equal(numeric("NOT_DEFINED", rc.symbols), null); assert.equal(numeric("a * b", rc.symbols), null);
  assert.deepEqual([...rc.unresolved], ["IDC_IMPORT"], "an id in no header keeps its name");
  assert.deepEqual([...rc.unknownStyles], ["MYAPP_FLAT"], "a style name in no table is named and contributes no bits");
  assert.deepEqual(rc.problems, []);
});

test("a DIALOGEX reads into exactly the control shape the binary reader produces, with the style bits each shorthand implies", async () => {
  const { rc } = await readFixture();
  assert.equal(rc.dialogs.length, 2);
  const [login, about] = rc.dialogs;
  assert.equal(login.name, "IDD_LOGIN"); assert.equal(login.id, 101); assert.equal(login.ex, true); assert.equal(login.title, "Log in"); assert.equal(login.line, 70);
  assert.deepEqual([login.x, login.y, login.cx, login.cy], [0, 0, 220, 140]);
  assert.deepEqual(login.font, { size: 8, face: "MS Shell Dlg", weight: 400, italic: false }, "the DIALOGEX font block carries weight and italic, as readDialog reads it");
  assert.equal(login.style, (S.DS_SETFONT | S.DS_MODALFRAME | S.DS_FIXEDSYS | S.WS_POPUP | S.WS_CAPTION | S.WS_SYSMENU) >>> 0);
  assert.equal(login.controls.length, 16);
  assert.deepEqual(login.controls[1], { helpId: 0, exStyle: 0, style: (WS_CHILD | WS_VISIBLE | S.ES_LEFT | S.WS_BORDER | S.WS_TABSTOP | S.ES_AUTOHSCROLL) >>> 0, x: 60, y: 8, cx: 120, cy: 12, id: 1001, className: "Edit", caption: "", captionOrdinal: null, name: "IDC_USER", line: 76, styles: "ES_AUTOHSCROLL" }, "EDITTEXT is Edit with ES_LEFT, WS_BORDER and WS_TABSTOP under its own styles; the symbolic name and the line travel beside the binary shape");
  const bits = (i) => login.controls[i].style;
  assert.equal(bits(0), (WS_CHILD | WS_VISIBLE | S.SS_LEFT | S.WS_GROUP) >>> 0, "LTEXT is Static with SS_LEFT and WS_GROUP"); assert.equal(login.controls[0].id, 65535, "IDC_STATIC is the no id the template stores as 65535");
  assert.equal(bits(3) & S.ES_PASSWORD, S.ES_PASSWORD);
  assert.equal(bits(4) & 0xf, 3, "AUTOCHECKBOX is BS_AUTOCHECKBOX"); assert.equal(bits(5) & 0xf, 7, "GROUPBOX is BS_GROUPBOX"); assert.equal(bits(6) & 0xf, 9, "AUTORADIOBUTTON is BS_AUTORADIOBUTTON");
  assert.equal(bits(6) & S.WS_GROUP, S.WS_GROUP); assert.equal(bits(7) & S.WS_GROUP, 0, "WS_GROUP is written on the first radio only");
  assert.equal(bits(9) & 0xf, S.CBS_DROPDOWNLIST, "COMBOBOX's own style replaces nothing: CBS_SIMPLE (1) is under CBS_DROPDOWNLIST (3)");
  assert.equal(bits(10) & WS_VISIBLE, 0, "NOT WS_VISIBLE clears the bit every control starts with"); assert.equal(login.controls[10].styles, "NOT WS_VISIBLE");
  assert.equal(bits(11) & S.WS_BORDER, 0, "NOT WS_BORDER clears the border EDITTEXT implies"); assert.equal(bits(11) & (S.ES_MULTILINE | S.ES_READONLY), S.ES_MULTILINE | S.ES_READONLY);
  assert.equal(login.controls[12].className, "SysListView32"); assert.equal(login.controls[12].styles, "LVS_REPORT | LVS_SINGLESEL | WS_BORDER | WS_TABSTOP", "a CONTROL line wrapped after its bar is one statement");
  assert.equal(bits(12), (WS_CHILD | WS_VISIBLE | S.LVS_REPORT | S.LVS_SINGLESEL | S.WS_BORDER | S.WS_TABSTOP) >>> 0);
  assert.equal(bits(13) & 0xf, 1, "DEFPUSHBUTTON is BS_DEFPUSHBUTTON"); assert.equal(login.controls[13].id, 1); assert.equal(login.controls[14].id, 2); assert.equal(login.controls[15].id, 9, "IDOK, IDCANCEL and IDHELP are the SDK's and need no header");
  assert.equal(bits(15) & S.WS_DISABLED, S.WS_DISABLED);

  assert.equal(about.ex, false); assert.equal(about.title, 'About "Ledger"', "a doubled quote is one quote"); assert.deepEqual(about.font, { size: 8, face: "MS Sans Serif" });
  assert.equal(about.style, (S.WS_POPUP | S.WS_CAPTION | S.WS_SYSMENU | S.DS_SETFONT) >>> 0, "a FONT statement sets DS_SETFONT as rc.exe does");
  assert.deepEqual(about.controls.map((c) => [c.className, c.caption, c.id]), [["Static", "IDI_APP", 65535], ["Static", "Ledger 4.2", 65535], ["Button", "Check for &updates", 1040], ["Button", "&Import", "IDC_IMPORT"], ["Button", "Close", 2]]);
  assert.equal(about.controls[0].captionOrdinal, 129, "ICON names its image by id; the ordinal is kept beside the name"); assert.equal(about.controls[0].style & 0x1f, S.SS_ICON);
  assert.equal(about.controls[2].className, "Button", "a CONTROL's quoted class is the atom rc.exe writes");
  assert.equal(about.controls[3].style, (WS_CHILD | WS_VISIBLE | S.WS_TABSTOP) >>> 0, "the unknown style name contributed nothing");
});

test("the rest of the script: menus with accelerator text split off, MENUEX flags, strings, the version block, accelerators, images", async () => {
  const { rc, rc2 } = await readFixture();
  const [main] = rc.menus;
  assert.equal(main.name, "IDR_MAIN"); assert.equal(main.id, 128); assert.equal(main.ex, false); assert.equal(main.line, 112);
  assert.deepEqual(main.items[0], { text: "&File", id: null, disabled: false, checked: false, children: [
    { text: "&Open...", id: 32771, disabled: false, checked: false, name: "ID_FILE_OPEN" },
    { text: "", id: 0, disabled: false, checked: false, separator: true },
    { text: "E&xit", id: 32772, disabled: false, checked: false, name: "ID_APP_EXIT" },
  ] }, "the shape readMenu produces, the symbolic name beside it, the \\t accelerator gone from the text");
  assert.deepEqual(main.accelerators, [{ item: "&Open...", key: "Ctrl+O" }]);
  assert.equal(main.items[1].children[0].disabled, true, "GRAYED disables");
  const [edit] = rc2.menus;
  assert.equal(edit.ex, true); assert.equal(edit.id, 201);
  assert.equal(edit.items[0].children[1].checked, true, "MFS_CHECKED"); assert.equal(edit.items[0].children[2].separator, true, "MFT_SEPARATOR");
  assert.deepEqual(rc.strings, [{ name: "IDS_SAVED", id: 300, text: "Saved." }, { name: "IDS_NOT_SAVED", id: 317, text: "Could not save." }]);
  assert.deepEqual(rc.version, { CompanyName: "Ledger Co.", FileDescription: "Ledger desktop", FileVersion: "4.2.0.0", ProductName: "Ledger", ProductVersion: "4.2.0" }, "the string pairs only; Translation is numbers");
  assert.deepEqual(rc.fixedVersion, { FILEVERSION: "4.2.0.0", PRODUCTVERSION: "4.2.0.0" });
  assert.deepEqual(rc.accelerators, [{ name: "IDR_ACCEL", id: 131, line: 132, entries: [{ key: "Ctrl+O", command: "ID_FILE_OPEN", id: 32771 }, { key: "F1", command: "ID_HELP", id: 0xe146 }] }]);
  assert.deepEqual(rc.images, [{ kind: "icon", name: "IDI_APP", id: 129, file: "res\\app.ico", line: 56 }, { kind: "bitmap", name: "IDB_LOGO", id: 130, file: "res\\logo.bmp", line: 63 }]);
  assert.deepEqual(rc.others, [], "TEXTINCLUDE is the editor's and never reaches the reader");
});

test("the script's dialog lowers to the same template the executable's does, and the menu to the same menu bar", async () => {
  const { rc } = await readFixture();
  const notes = [];
  const { template, outputs, title, usesTwoWay } = lowerDialog(rc.dialogs[0], (n) => notes.push(n));
  assert.equal(title, "Log in"); assert.equal(usesTwoWay, true); assert.deepEqual(outputs, ["cancel", "help", "ok"]);
  assert.match(template, /^<form class="dialog" ng-submit="onOk\(\{ userName: userName, password: password, rememberMe: rememberMe, role: role, region: region, control1021: control1021 \}\)">/);
  assert.match(template, /<label for="f-user-name">User name<\/label>\n\s*<input id="f-user-name" type="text" ng-model="userName">/);
  assert.match(template, /<input id="f-password" type="password" ng-model="password">/, "ES_PASSWORD is a password input");
  assert.match(template, /<label><input type="checkbox" ng-model="rememberMe" accesskey="r"> Remember me<\/label>/);
  assert.match(template, /<fieldset>\n\s*<legend>Role<\/legend>\n\s*<label><input type="radio" ng-model="role" value="clerk" accesskey="c"> Clerk<\/label>\n\s*<label><input type="radio" ng-model="role" value="manager" accesskey="m"> Manager<\/label>\n\s*<\/fieldset>/, "the GROUPBOX rectangle holds the radios and WS_GROUP opens the group");
  assert.match(template, /<select id="f-region" ng-model="region">\n\s*<option ng-repeat="option in regionOptions">\{\{ option \}\}<\/option>\n\s*<\/select>/, "CBS_DROPDOWNLIST is a select whose options the code filled");
  assert.match(template, /<p ng-show="shown.lockedOutShown">Locked out<\/p>/, "NOT WS_VISIBLE is a named state");
  assert.match(template, /<textarea id="f-control1021" ng-model="control1021" readonly><\/textarea>/);
  assert.match(template, /<table class="list-view"><\/table>/);
  assert.match(template, /<button type="button" ng-click="onHelp\(\)" accesskey="h" disabled>Help<\/button>\n\s*<button type="submit">OK<\/button>\n\s*<button type="button" ng-click="onCancel\(\)">Cancel<\/button>/, "WS_DISABLED is disabled; IDOK is the submit");
  assert.ok(notes.some((n) => /list\(s\) region are filled by the code at runtime/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) start hidden \(Locked out\)/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) start disabled \(Help\)/.test(n)));
  assert.deepEqual(buildIr(template).reads, ["onCancel", "onHelp", "onOk", "regionOptions", "shown"]);
  assert.match(translate(template).jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(/);

  const about = lowerDialog(rc.dialogs[1], () => {});
  assert.match(about.template, /<h2>About &quot;Ledger&quot;<\/h2>\n\s*<span class="image" role="img" aria-label="IDI_APP"><\/span>\n\s*<p>Ledger 4\.2<\/p>/, "the icon is a placeholder naming its resource");
  assert.match(about.template, /<button type="button" ng-click="onImport\(\)" accesskey="i">Import<\/button>\n\s*<button type="button" ng-click="onCancel\(\)">Close<\/button>/, "an unresolved id still lowers; IDCANCEL is cancel whatever its caption");
  assert.deepEqual(about.outputs, ["cancel", "import"]);

  const menu = lowerMenu(rc.menus[0]);
  assert.deepEqual(menu.outputs, ["aboutLedger", "exit", "open"]);
  assert.match(menu.template, /<button type="button" accesskey="f" aria-haspopup="menu">File<\/button>\n\s*<ul role="menu">\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onOpen\(\)" accesskey="o">Open<\/button><\/li>\n\s*<li role="separator"><\/li>/, "Ctrl+O is gone from the caption");
  assert.match(menu.template, /ng-click="onAboutLedger\(\)" accesskey="a" disabled>About Ledger</);
});

/**
 * The claim the reader makes: a dialog written as a script and the same
 * dialog compiled into a template are one screen. The compiled side is
 * spelled here by hand as rc.exe would write it, every control's bits from
 * the published constants, built into a real DIALOGEX template by the exe
 * fixture builder and read back by pe.js, the reader the binary goes through.
 */
test("the same login dialog compiled and read by input-exe lowers to the identical template the script does", async () => {
  const { rc } = await readFixture();
  const V = WS_VISIBLE;
  const TAB = S.WS_TABSTOP;
  const COMPILED = {
    id: 101, title: "Log in", cx: 220, cy: 140, font: { size: 8, face: "MS Shell Dlg" },
    style: S.DS_SETFONT | S.DS_MODALFRAME | S.DS_FIXEDSYS | S.WS_POPUP | S.WS_CAPTION | S.WS_SYSMENU,
    controls: [
      { className: "Static", caption: "&User name:", id: 65535, x: 7, y: 10, cx: 50, cy: 8, style: WS_CHILD | S.WS_GROUP },
      { className: "Edit", caption: "", id: 1001, x: 60, y: 8, cx: 120, cy: 12, style: WS_CHILD | S.WS_BORDER | TAB | S.ES_AUTOHSCROLL },
      { className: "Static", caption: "Password:", id: 65535, x: 7, y: 26, cx: 50, cy: 8, style: WS_CHILD | S.WS_GROUP },
      { className: "Edit", caption: "", id: 1002, x: 60, y: 24, cx: 120, cy: 12, style: WS_CHILD | S.WS_BORDER | TAB | S.ES_PASSWORD | S.ES_AUTOHSCROLL },
      { className: "Button", caption: "&Remember me", id: 1003, x: 60, y: 40, cx: 100, cy: 10, style: WS_CHILD | S.BS_AUTOCHECKBOX | TAB },
      { className: "Button", caption: "Role", id: 1010, x: 7, y: 54, cx: 200, cy: 30, style: WS_CHILD | S.BS_GROUPBOX },
      { className: "Button", caption: "&Clerk", id: 1011, x: 14, y: 66, cx: 60, cy: 10, style: WS_CHILD | S.BS_AUTORADIOBUTTON | TAB | S.WS_GROUP },
      { className: "Button", caption: "&Manager", id: 1012, x: 90, y: 66, cx: 60, cy: 10, style: WS_CHILD | S.BS_AUTORADIOBUTTON | TAB },
      { className: "Static", caption: "Region", id: 65535, x: 7, y: 90, cx: 50, cy: 8, style: WS_CHILD | S.WS_GROUP },
      { className: "ComboBox", caption: "", id: 1004, x: 60, y: 88, cx: 120, cy: 60, style: WS_CHILD | S.CBS_DROPDOWNLIST | S.WS_VSCROLL | TAB },
      { className: "Static", caption: "Locked out", id: 1020, x: 7, y: 104, cx: 100, cy: 8, style: WS_CHILD | S.WS_GROUP, hidden: true },
      { className: "Edit", caption: "", id: 1021, x: 7, y: 112, cx: 200, cy: 4, style: WS_CHILD | TAB | S.ES_MULTILINE | S.ES_READONLY },
      { className: "SysListView32", caption: "", id: 1030, x: 7, y: 116, cx: 200, cy: 2, style: WS_CHILD | S.LVS_REPORT | S.LVS_SINGLESEL | S.WS_BORDER | TAB },
      { className: "Button", caption: "OK", id: 1, x: 100, y: 120, cx: 50, cy: 14, style: WS_CHILD | S.BS_DEFPUSHBUTTON | TAB },
      { className: "Button", caption: "Cancel", id: 2, x: 160, y: 120, cx: 50, cy: 14, style: WS_CHILD | TAB },
      { className: "Button", caption: "&Help", id: 9, x: 7, y: 120, cx: 50, cy: 14, style: WS_CHILD | TAB | S.WS_DISABLED },
    ],
  };
  const binary = readDialog(Buffer.from(dialogTemplate(COMPILED)));
  assert.deepEqual(binary.problems, []);
  const script = rc.dialogs[0];
  const shape = (c) => ({ className: c.className, caption: c.caption, captionOrdinal: c.captionOrdinal, id: c.id, x: c.x, y: c.y, cx: c.cx, cy: c.cy, style: c.style, exStyle: c.exStyle, helpId: c.helpId });
  assert.deepEqual(script.controls.map(shape), binary.controls.map(shape), "every control agrees on class, caption, id, rectangle and every style bit");
  assert.deepEqual([script.title, script.ex, script.font, script.style >>> 0, script.cx, script.cy], [binary.title, binary.ex, binary.font, binary.style >>> 0, binary.cx, binary.cy]);
  const fromScript = lowerDialog(script, () => {});
  const fromBinary = lowerDialog({ ...binary, id: 101 }, () => {});
  assert.equal(fromScript.template, fromBinary.template, "one screen, whichever form it was read from");
  assert.deepEqual(fromScript.outputs, fromBinary.outputs); assert.deepEqual(fromScript.fields, fromBinary.fields);
  assert.equal(translate(fromScript.template).jsx, translate(fromBinary.template).jsx);
});

test("a resource script tree becomes screens, RESOURCES.md and notes, and ports to React with every state", async (t) => {
  const run = await runPipeline({ src: FIXTURE, shots: join(FIXTURE, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["dialog-about-ledger", "dialog-log-in", "menu-128", "menu-201"], "the .rc2's MENUEX resolves its id through the .rc that includes it");
  const login = run.ctx.screens.find((s) => s.selector === "dialog-log-in");
  assert.equal(login.readBy, "rc"); assert.equal(login.file, "app.rc"); assert.equal(login.title, "Log in"); assert.equal(login.className, "DialogLogIn");
  assert.equal(login.templateOrigin, "dialog IDD_LOGIN (101) in app.rc, read from its resource script at line 70");
  assert.deepEqual(login.inputs, ["regionOptions", "shown"]); assert.deepEqual(login.outputs, ["cancel", "help", "ok"]);
  assert.equal(login.usesNgFor, true); assert.equal(login.usesNgIf, true); assert.equal(login.usesTwoWay, true);
  assert.equal(run.ctx.screens.find((s) => s.selector === "menu-128").title, "Ledger menu IDR_MAIN", "the version block names the product");
  assert.equal(run.ctx.screens.find((s) => s.selector === "menu-201").file, "res/app.rc2");

  const jsx = await readFile(join(run.out, "src/features/DialogLogIn/DialogLogIn.jsx"), "utf8");
  assert.match(jsx, /export default function DialogLogIn\(\{ regionOptions, shown, onCancel, onHelp, onOk, loading, error, onRetry \}\)/);
  assert.match(jsx, /const \[userName, setUserName\] = useState\(""\);/); assert.match(jsx, /const \[password, setPassword\] = useState\(""\);/); assert.match(jsx, /const \[region, setRegion\] = useState\(""\);/);
  assert.match(jsx, /No collection is bound, so the empty state cannot occur/, "an empty option list does not blank the dialog");
  assert.match(jsx, /if \(loading\) return/); assert.match(jsx, /if \(error\)/);
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(/);

  const report = await readFile(join(run.out, "RESOURCES.md"), "utf8");
  assert.match(report, /## app\.rc\n\n\| version field \| value \|\n\| --- \| --- \|\n\| FILEVERSION \(fixed\) \| 4\.2\.0\.0 \|\n/);
  assert.match(report, /\| ProductName \| Ledger \|/);
  assert.match(report, /### Log in \(IDD_LOGIN \(101\), DIALOGEX, line 70\)\n\n220 × 140 dialog units, font MS Shell Dlg 8pt, 16 control\(s\), style DS_SETFONT \| DS_MODALFRAME/);
  assert.match(report, /\| IDC_PASSWORD \(1002\) \| Edit \| input \|  \| 60, 24, 120 × 12 \| ES_PASSWORD \\\| ES_AUTOHSCROLL \|/, "one table per dialog, the DIALOGS.md columns plus the style as written, pipes escaped");
  assert.match(report, /\| IDC_STATIC \(65535\) \| Static \| text \| User name \| 7, 10, 50 × 8 \| \(default\) \|/, "captions are spelled as DIALOGS.md spells them");
  assert.match(report, /\| IDC_IMPORT \| Button \| button \| Import \| 7, 40, 50 × 14 \| MYAPP_FLAT \|/, "an unresolved id shows its name alone");
  assert.match(report, /### menu IDR_MAIN \(128\), line 112\n\n- File\n  - Open \(ID_FILE_OPEN \(32771\)\)\n  - ———\n  - Exit \(ID_APP_EXIT \(32772\)\)\n- Help\n  - About Ledger \(ID_APP_ABOUT \(32773\)\) disabled\n\nAccelerator text on 1 item\(s\), not carried: Open Ctrl\+O\./);
  assert.match(report, /### string table\n\n\| id \| value \| text \|\n\| --- \| --- \| --- \|\n\| IDS_SAVED \| 300 \| Saved\. \|\n\| IDS_NOT_SAVED \| 317 \| Could not save\. \|/);
  assert.match(report, /### accelerators IDR_ACCEL \(131\), line 132\n\nKey bindings the port does not carry\.\n\n\| key \| command \|\n\| --- \| --- \|\n\| Ctrl\+O \| ID_FILE_OPEN \(32771\) \|\n\| F1 \| ID_HELP \(57670\) \|/);
  assert.match(report, /### images, not carried\n\n\| kind \| id \| file \|\n\| --- \| --- \| --- \|\n\| icon \| IDI_APP \(129\) \| res\\\\app\.ico \|/);
  assert.match(report, /### conditions not evaluated\n\n- line 18: `#if !defined\(AFX_RESOURCE_DLL\) \|\| defined\(AFX_TARG_ENU\)`, first branch read\n- line 148: `#ifdef _DEBUG`, first branch read, #else branch skipped/);
  assert.match(report, /Ids no header defined, kept by name: IDC_IMPORT\./); assert.match(report, /Style names in no table, contributing no bits: MYAPP_FLAT\./);
  assert.match(report, /## res\/app\.rc2\n\nNo dialog templates\.\n\n### menu IDR_EDIT \(201\) \(MENUEX\), line 13\n\n- Edit\n  - Cut \(ID_EDIT_CUT \(32774\)\)\n  - Paste \(ID_EDIT_PASTE \(32775\)\) checked\n  - ———/);

  const notes = run.ctx.report.unverified;
  const has = (re) => assert.ok(notes.some((n) => re.test(n)), `a note matches ${re}`);
  has(/^app\.rc, line 148: `#ifdef _DEBUG` was not evaluated .* the first branch was read and the #else branch skipped\.$/);
  has(/^app\.rc, line 18: `#if !defined\(AFX_RESOURCE_DLL\) \|\| defined\(AFX_TARG_ENU\)` was not evaluated/);
  has(/^app\.rc: id\(s\) IDC_IMPORT are defined in no header beside the script; each keeps its name/);
  has(/^app\.rc: style name\(s\) MYAPP_FLAT are in no table this reader has; each contributed no bits/);
  has(/^app\.rc, dialog IDD_LOGIN \(line 70\): the list\(s\) region are filled by the code at runtime/);
  has(/^app\.rc, dialog IDD_LOGIN \(line 70\): 1 control\(s\) start hidden \(Locked out\)/);
  has(/^app\.rc, menu IDR_MAIN: 1 item\(s\) carry accelerator text \(Open: Ctrl\+O\); a key binding the port does not carry/);
  has(/^app\.rc: the accelerator table IDR_ACCEL binds 2 key\(s\) to commands \(Ctrl\+O → ID_FILE_OPEN, F1 → ID_HELP\)/);
  has(/^app\.rc: 2 image resource\(s\) \(icon IDI_APP, bitmap IDB_LOGO\) are named in RESOURCES\.md and not carried/);
  has(/^app\.rc: 2 string table entr\(ies\) are messages the code shows at runtime/);
  assert.ok(!notes.some((n) => /afxres\.h/.test(n)), "an SDK header the tree never carries is not a missing include");
  assert.ok(!notes.some((n) => /res\/app\.rc2: id\(s\)/.test(n)), "the .rc2 resolved every id through its includer's headers");
});

test("what the reader cannot read is a problem named, never an exception, and a project header it cannot find is a note", async (t) => {
  const r = readScript([
    '"MYDLG" DIALOG DISCARDABLE 10, 10, 100, 50',
    "{",
    '    LTEXT "Name", -1, 1, 1, 30, 8',
    '    EDITTEXT 200, 40, 1, 50, 12, ES_NUMBER | (WS_BORDER | WS_TABSTOP)',
    '    CONTROL "short", 201, "Button"',
    '    WIDGET "x", 202, 1, 1, 1, 1',
    '    PUSHBUTTON "Go", IDOK, 1, 20, 40, 14',
    "}",
    "IDR_T TOOLBAR 16, 15",
    "BEGIN",
    "    BUTTON ID_FILE_NEW",
    "END",
    "IDD_X DLGINIT",
    "BEGIN",
    "    0",
    "END",
    '24 RT_MANIFEST "app.manifest"',
    "STRINGTABLE",
    "BEGIN",
    "    5",
    '    6, "six" "teen"',
    "END",
    "IDR_M MENU",
    "BEGIN",
    '    POPUP "Lonely"',
    '    MENUITEM "Dangling", 7',
    "    NOTASTATEMENT",
    "END",
    "IDD_OPEN DIALOG 0, 0, 10, 10",
    "BEGIN",
  ].join("\n"), {});
  assert.deepEqual(r.problems, [
    "1 BEGIN(s) never reach END",
    "line 5: CONTROL has 3 argument(s) where eight are needed; skipped",
    "line 6: `WIDGET` is not a control statement this reader knows; skipped",
    "line 20: a string table entry with no string; skipped",
    'line 25: POPUP "Lonely" has no BEGIN block',
    "line 27: `NOTASTATEMENT` is not a menu statement; skipped",
  ]);
  const [dlg, open] = r.dialogs;
  assert.equal(dlg.name, "MYDLG"); assert.equal(dlg.id, "MYDLG", "a quoted resource name is its own id and is never unresolved"); assert.deepEqual([...r.unresolved], ["IDR_M", "IDD_OPEN"], "a resource named by an undefined symbol is unresolved; a type not read never asks");
  assert.equal(dlg.style, (S.WS_POPUP | S.WS_BORDER | S.WS_SYSMENU) >>> 0, "no STYLE and no FONT: the default and no DS_SETFONT"); assert.equal(dlg.styles, "(default)"); assert.equal(dlg.font, null);
  assert.deepEqual(dlg.controls.map((c) => [c.className, c.id]), [["Static", 65535], ["Edit", 200], ["Button", 1]], "-1 is the static id; the two bad lines are gone; braces close the block");
  assert.equal(dlg.controls[1].style, (WS_CHILD | WS_VISIBLE | S.ES_NUMBER | S.WS_BORDER | S.WS_TABSTOP) >>> 0, "a parenthesised group in a style expression");
  assert.equal(open.name, "IDD_OPEN"); assert.equal(open.controls.length, 0);
  assert.deepEqual(r.others.map((o) => [o.type, o.name, o.file]), [["TOOLBAR", "IDR_T", null], ["DLGINIT", "IDD_X", null], ["RT_MANIFEST", "24", "app.manifest"]], "a block or file resource of a type not read is named with its file");
  assert.deepEqual(r.strings, [{ name: null, id: 6, text: "sixteen" }], "adjacent strings concatenate");
  assert.deepEqual(r.menus[0].items.map((i) => [i.text, i.id, Boolean(i.children)]), [["Lonely", null, true], ["Dangling", 7, false]]);

  const dir = await mkdtemp(join(tmpdir(), "portamp-rc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "app.rc"), '#include "resource.h"\n#include "extra.h"\n#include <afxres.h>\nIDD_ONE DIALOG 0, 0, 10, 10\nBEGIN\n    PUSHBUTTON "Go", IDC_GO, 1, 1, 8, 8\nEND\n');
  await writeFile(join(dir, "resource.h"), "#define IDD_ONE 1\n");
  const run = await runPipeline({ src: dir, shots: join(dir, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector), ["dialog-1"], "a dialog with no caption is named by its id");
  assert.equal(run.ctx.screens[0].title, "app.rc dialog IDD_ONE", "with no version block the script names the dialog");
  assert.ok(run.ctx.report.unverified.some((n) => n === 'app.rc: #include "extra.h" was not found beside the script; the ids it defines stay unresolved.'));
  assert.ok(run.ctx.report.unverified.some((n) => /^app\.rc: id\(s\) IDC_GO are defined in no header/.test(n)));
  assert.ok(!run.ctx.report.unverified.some((n) => /afxres/.test(n)), "the SDK's own header is not missing");
  const report = await readFile(join(run.out, "RESOURCES.md"), "utf8");
  assert.match(report, /### dialog IDD_ONE \(IDD_ONE \(1\), DIALOG, line 4\)/);
});

/**
 * The twenty first review pass. What a script can spell that rc.exe would
 * refuse, or that a person never writes, is fed to the reader here: a string
 * or a comment that never closes, a condition that does not parse, a second
 * #else, a DIALOG or MENU with no block, a control or a string with no id, a
 * block hanging on nothing, popups and version blocks nested past any menu,
 * expressions long enough to make the bracket matching quadratic and the
 * splitting recursive. Each is a problem by line, none an exception or a
 * silent decision, and the shapes a real script does write read as the
 * compiled template stores them.
 */
test("the twenty first review pass: what never closes, never parses or nests without end is a problem by line, and the escapes, ids and DIALOGEX fields read as the template stores them", () => {
  const problems = [];
  assert.equal(stripComments('A /* open\nB "x" // c\nC', problems), "A        \n          \n ", "an unterminated comment blanks to the end, every line its own length");
  assert.deepEqual(problems, ["line 1: a comment opened with /* never closes; everything after it is blank"]);
  assert.equal(stripComments('LTEXT "oops, 1 // still text?\nCTEXT "ok" // gone\n'), 'LTEXT "oops, 1 // still text?\nCTEXT "ok"        \n', "an unterminated string ends at its line, so the next line's comment is still a comment");

  const open = readScript('IDD DIALOG 0,0,10,10\nBEGIN\n  LTEXT "never ends, IDC_STATIC, 1,1,1,1\n  PUSHBUTTON "Go", IDOK, 1,1,1,1\n  PUSHBUTTON "No id", , 1,1,1,1\n  PUSHBUTTON "Hang", 5, 1,1,1,1\n  BEGIN\n  END\n  BEGIN\n  END\nEND\nIDR MENU\nBEGIN\n  BEGIN\n  END\n  MENUITEM "a", 1\nEND\nIDD2 DIALOG 0,0,10,10\nCAPTION "x"\nIDR2 MENU\nSTRINGTABLE\nBEGIN\n  "orphan"\n  IDS_BASE + 1 "one"\n  (IDS_BASE+2), "two"\n  IDS_BASE*2 "three"\nEND\n#define IDS_BASE 100\n', {});
  assert.deepEqual(open.problems, [
    "line 3: a string opened at column 9 never closes; the line is skipped",
    "line 5: PUSHBUTTON has no id; skipped",
    "line 6: PUSHBUTTON is followed by a BEGIN block it cannot take; the block is skipped",
    "line 9: a BEGIN block hangs on no statement; skipped",
    "line 14: a BEGIN block hangs on no statement; skipped",
    "line 18: DIALOG IDD2 has no BEGIN block; read with no controls",
    "line 20: MENU IDR2 has no BEGIN block; read with no items",
    "line 23: a string table entry with no id; skipped",
    "line 26: the id `IDS_BASE * 2` could not be read as a number or a name",
  ], "a block after a control, a block on nothing, a resource with no block, an entry with no id: each is the line it is on");
  assert.deepEqual(open.dialogs[0].controls.map((c) => [c.caption, c.id]), [["Go", 1], ["Hang", 5]], "the unterminated line and the control with no id are gone; the rest read");
  assert.deepEqual(open.menus.map((m) => [m.name, m.items.length]), [["IDR", 1], ["IDR2", 0]]);
  assert.deepEqual(open.strings.map((s) => [s.id, s.text]), [[101, "one"], [102, "two"], ["IDS_BASE * 2", "three"]], "an id that is an expression resolves; one the reader cannot read keeps its spelling and is named");

  const pre = (src) => { const p = preprocess(src); return { kept: p.lines.map((l) => l.text).filter(Boolean), unevaluated: p.unevaluated.length, problems: p.problems }; };
  for (const bad of ["(", "1 &&", "!!!", ")(", "1 > 0", "", "1 1", "(1"]) assert.deepEqual(pre(`#if ${bad}\nA\n#else\nB\n#endif\n`), { kept: ["A"], unevaluated: 1, problems: [] }, `#if ${bad} does not parse, so it is not decided false in silence: the first branch is read and the condition named`);
  assert.deepEqual(pre("#if !!1 && (0 || !0)\nA\n#else\nB\n#endif\n"), { kept: ["A"], unevaluated: 0, problems: [] }, "a run of bangs and a bracket still evaluate");
  assert.deepEqual(pre("#if 1\nA\n#else\nB\n#else\nC\n#elif 1\nD\n#endif\n"), { kept: ["A"], unevaluated: 0, problems: ["line 5: a second #else for one #if; skipped", "line 7: #elif after #else; skipped"] });
  assert.deepEqual(pre(`#if ${"!".repeat(100000)}1\nA\n#endif\n`), { kept: ["A"], unevaluated: 1, problems: [] }, "an expression longer than any person writes is named, not walked");
  assert.deepEqual(pre(`#if ${"(".repeat(100000)}1${")".repeat(100000)}\nA\n#endif\n`).kept, ["A"]);
  let nested = "";
  for (let i = 0; i < 100; i += 1) nested += "#ifdef _WIN32\n";
  nested += "A\n";
  for (let i = 0; i < 100; i += 1) nested += "#endif\n";
  assert.deepEqual(pre(nested), { kept: ["A"], unevaluated: 0, problems: [] }, "a hundred nested conditionals");
  assert.deepEqual(pre("\\\n#define X 1\n").kept, ["\\"], "a line that is only a backslash is a line, not a continuation of nothing");
  assert.deepEqual(preprocess('#include "self.rc"\n#include "self.rc"\n').includes.map((i) => i.file), ["self.rc", "self.rc"], "includes are listed, never followed, so a file including itself cannot loop the preprocessor");

  const none = new Map();
  assert.equal(numeric(`${"(".repeat(100000)}1${")".repeat(100000)}`, none), null, "past the length cap an expression is not a number the reader knows");
  assert.equal(numeric(Array(30000).fill("1").join("+"), none), null);
  assert.equal(numeric(`${"(".repeat(60)}1${")".repeat(60)}`, none), 1); assert.equal(numeric(Array(100).fill("1").join("+"), none), 100, "within it, the same shapes read");

  let popups = "IDR MENU\nBEGIN\n";
  for (let i = 0; i < 20000; i += 1) popups += `POPUP "P${i}"\nBEGIN\n`;
  popups += 'MENUITEM "leaf", 1\n';
  for (let i = 0; i < 20000; i += 1) popups += "END\n";
  const deep = readScript(`${popups}END\n`, {});
  const depthOf = (items) => (items.length ? 1 + Math.max(0, ...items.map((i) => (i.children ? depthOf(i.children) : 0))) : 0);
  assert.equal(depthOf(deep.menus[0].items), 17, "the menu is read to the depth pe.js reads a compiled menu");
  assert.deepEqual(deep.problems, ["line 37: the menu nests deeper than any menu bar; the items below are not read"]);
  let blocks = "1 VERSIONINFO\nBEGIN\n";
  for (let i = 0; i < 20000; i += 1) blocks += 'BLOCK "b"\nBEGIN\n';
  blocks += 'VALUE "ProductName", "deep"\n';
  for (let i = 0; i < 20000; i += 1) blocks += "END\n";
  assert.deepEqual(readScript(`${blocks}END\n`, {}).version, { ProductName: "deep" }, "a version block nested past any stack is walked, not recursed");
  const wide = readScript(`IDD DIALOG 0,0,10,10\nBEGIN\n  LTEXT "x", -1, 1,1,1,1, ${"(".repeat(50000)}WS_BORDER${")".repeat(50000)}\n  LTEXT "y", -1, 1,1,1,1, ${"WS_BORDER | ".repeat(50000)}NOT WS_VISIBLE\n  LTEXT "z", -1, 1,1,1,1, ${"1,".repeat(100000)}1\nEND\n`, {});
  assert.equal(wide.dialogs[0].controls[0].style, (WS_CHILD | WS_VISIBLE | S.WS_GROUP | S.WS_BORDER) >>> 0, "brackets in a style expression are a stack, not a recursion");
  assert.equal(wide.dialogs[0].controls[1].style, (WS_CHILD | S.WS_GROUP | S.WS_BORDER) >>> 0);
  assert.equal(wide.dialogs[0].controls.length, 3, "a hundred thousand tokens on one line tokenize in linear time");

  const shapes = readScript([
    "IDD DIALOGEX 0, 0, 100, 50, 0x1234",
    "EXSTYLE WS_EX_TOPMOST | WS_EX_TOOLWINDOW",
    'CAPTION "Say ""hi""\\tnow\\nthen\\\\ \\"x\\" \\101\\x42 \\0 gone"',
    "BEGIN",
    '  PUSHBUTTON "Go", IDOK, -5, -1, 40, 14, BS_FLAT, WS_EX_CLIENTEDGE, 77',
    '  CONTROL "c", 5, "Button", BS_FLAT, 1, 1, 1, 1, WS_EX_STATICEDGE, 99',
    "  EDITTEXT 6, 1, 1, 1, 1, ES_LEFT, , 44",
    '  LTEXT "a", 65535, 1,1,1,1',
    '  LTEXT "b", IDC_STATIC, 1,1,1,1',
    '  LTEXT "c", -1, 1,1,1,1',
    '  LTEXT "d", (-1), 1,1,1,1',
    '  CONTROL "e", 7, "BUTTON", 0, 1,1,1,1',
    '  CONTROL "f", 8, BUTTON, 0, 1,1,1,1',
    '  CONTROL "g", 9, "static", 0, 1,1,1,1',
    '  CONTROL "h", 10, "SysListView32", 0, 1,1,1,1',
    "END",
  ].join("\n"), {});
  assert.deepEqual(shapes.problems, []);
  const [d] = shapes.dialogs;
  assert.equal(d.helpId, 0x1234); assert.equal(d.exStyle, (S.WS_EX_TOPMOST | S.WS_EX_TOOLWINDOW) >>> 0, "a DIALOGEX help id and EXSTYLE");
  assert.equal(d.title, 'Say "hi"\tnow\nthen\\ "x" AB ', "doubled quotes, the C escapes, an octal and a hex escape decode, and the string ends at its NUL as the compiled template's does");
  assert.deepEqual(d.controls.slice(0, 3).map((c) => [c.x, c.y, c.helpId, c.exStyle]), [[-5, -1, 77, S.WS_EX_CLIENTEDGE], [1, 1, 99, S.WS_EX_STATICEDGE], [1, 1, 44, 0]], "a negative coordinate is the signed short the template stores; a control's help id and extended style read for both statement forms");
  assert.deepEqual(d.controls.slice(3, 7).map((c) => c.id), [65535, 65535, 65535, 65535], "65535, IDC_STATIC, -1 and (-1) are the one no id");
  assert.deepEqual(d.controls.slice(7).map((c) => c.className), ["Button", "Button", "Static", "SysListView32"], "a class in a string or as a bare atom is the atom rc.exe writes; a common control class keeps its spelling");
});

test("the twenty first review pass: a UTF 16 script decodes by its mark, one holding NULs with no mark is named, and scripts including each other read once", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-rc-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const utf16 = (text) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  await writeFile(join(dir, "app.rc"), utf16('#include "resource.h"\nIDD_WIDE DIALOGEX 0, 0, 100, 40\nCAPTION "Wide"\nBEGIN\n  PUSHBUTTON "Go", IDC_GO, 1, 1, 40, 14\n  DEFPUSHBUTTON "OK", IDOK, 50, 20, 40, 14\nEND\n#include "res\\extra.rc2"\n'));
  await writeFile(join(dir, "resource.h"), utf16('#include "resource.h"\n#define IDD_WIDE 7\n#define IDC_GO 1001\n#define IDR_BACK 9\n'));
  await mkdir(join(dir, "res"));
  await writeFile(join(dir, "res", "extra.rc2"), '﻿#include "..\\app.rc"\nIDR_BACK MENU\nBEGIN\n  MENUITEM "Back", IDC_GO\nEND\n');
  await writeFile(join(dir, "raw.rc"), Buffer.from('I\0D\0D\0 \0D\0I\0A\0L\0O\0G\0\n\0', "latin1"));
  const run = await runPipeline({ src: dir, shots: join(dir, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.deepEqual(run.ctx.screens.map((s) => [s.selector, s.file]), [["dialog-wide", "app.rc"], ["menu-9", "res/extra.rc2"]], "the UTF 16 script and header read as text, the .rc2 resolves its id through the .rc that includes it, and the two including each other read once each");
  assert.deepEqual(run.ctx.screens[0].outputs, ["go", "ok"]);
  const notes = run.ctx.report.unverified;
  assert.ok(notes.some((n) => n === "raw.rc: holds NUL bytes; it is not text this reader decodes; nothing was read from it."), "a script of wide characters with no mark is named, not read as resources of one letter each");
  assert.ok(!notes.some((n) => /raw\.rc:.*resource\(s\)/.test(n)) && !notes.some((n) => /id\(s\) .* are defined in no header/.test(n)), "no resource is invented from it, and every id in the marked files resolved");
  const report = await readFile(join(run.out, "RESOURCES.md"), "utf8");
  assert.match(report, /### Wide \(IDD_WIDE \(7\), DIALOGEX, line 2\)/);
  assert.ok(!/## raw\.rc/.test(report), "a script nothing was read from has no section");
});
