import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { kindOf, lowerDialog, lowerMenu } from "../plugins/input-exe/index.js";
import { readDialog, readExecutable, readHeaders, readMenu } from "../plugins/input-exe/pe.js";
import { translate } from "../plugins/output-react/template.js";
import { ATOM, WS_DISABLED, WS_GROUP, WS_TABSTOP, buildExe, dialogTemplate, menuTemplate } from "./fixtures/exe/build.mjs";
import { runPipeline } from "./helpers.js";

/**
 * A native Windows executable is a legacy front end whose interface is data:
 * dialog templates, menus, a string table and a version block in its resource
 * section. input-exe reads them with no dependency and lowers each dialog and
 * menu onto the shared dialect, so a program from 1998 comes out the far end
 * as the same React, Vue and Svelte every other reader produces. What the
 * resources cannot say is named. The fixture is built in memory by
 * test/fixtures/exe/build.mjs; no binary is committed.
 */

const LOGIN = {
  id: 101, title: "Log in", cx: 220, cy: 140, font: { size: 8, face: "MS Shell Dlg" },
  controls: [
    { className: "Static", caption: "&User name:", id: 65535, x: 7, y: 10, cx: 50, cy: 8 },
    { className: "Edit", caption: "", id: 1001, x: 60, y: 8, cx: 120, cy: 12, style: WS_TABSTOP },
    { className: "Static", caption: "Password:", id: 65535, x: 7, y: 26, cx: 50, cy: 8 },
    { className: "Edit", caption: "", id: 1002, x: 60, y: 24, cx: 120, cy: 12, style: WS_TABSTOP | 0x20 },
    { className: "Button", caption: "&Remember me", id: 1003, x: 60, y: 40, cx: 100, cy: 10, style: 3 | WS_TABSTOP },
    { className: "Button", caption: "Role", id: 1010, x: 7, y: 54, cx: 200, cy: 30, style: 7 },
    { className: "Button", caption: "&Clerk", id: 1011, x: 14, y: 66, cx: 60, cy: 10, style: 9 | WS_GROUP },
    { className: "Button", caption: "&Manager", id: 1012, x: 90, y: 66, cx: 60, cy: 10, style: 9 },
    { className: "Static", caption: "Region", id: 65535, x: 7, y: 90, cx: 50, cy: 8 },
    { className: "ComboBox", caption: "", id: 1004, x: 60, y: 88, cx: 120, cy: 60, style: WS_TABSTOP },
    { className: "Static", caption: "Locked out", id: 1020, x: 7, y: 104, cx: 100, cy: 8, hidden: true },
    { className: "Edit", caption: "", id: 1021, x: 7, y: 112, cx: 200, cy: 4, style: 0x4 | 0x800 },
    { className: "SysListView32", caption: "", id: 1030, x: 7, y: 116, cx: 200, cy: 2 },
    { className: "Button", caption: "OK", id: 1, x: 100, y: 120, cx: 50, cy: 14, style: 1 | WS_TABSTOP },
    { className: "Button", caption: "Cancel", id: 2, x: 160, y: 120, cx: 50, cy: 14, style: WS_TABSTOP },
    { className: "Button", caption: "&Help", id: 9, x: 7, y: 120, cx: 50, cy: 14, style: WS_TABSTOP | WS_DISABLED },
  ],
};
const MENU = { id: 200, items: [
  { text: "&File", children: [{ text: "&Open...", id: 40001 }, { separator: true }, { text: "E&xit", id: 40002 }] },
  { text: "&Help", children: [{ text: "&About", id: 40003, disabled: true }] },
] };
const FIXTURE = {
  dialogs: [LOGIN, { id: 102, ex: false, title: "About", controls: [{ className: "Static", caption: "Ledger 4.2", id: 65535, x: 1, y: 1, cx: 60, cy: 8 }, { className: "Button", caption: "Close", id: 2, x: 1, y: 20, cx: 40, cy: 14 }] }],
  menus: [MENU, { id: 201, ex: true, items: [{ text: "Edit", children: [{ text: "Cut", id: 5 }, { text: "Paste", id: 6, checked: true }] }] }],
  strings: [{ id: 300, text: "Saved." }, { id: 317, text: "Could not save." }],
  version: { ProductName: "Ledger", FileDescription: "Ledger desktop", ProductVersion: "4.2.0" },
};

test("the PE reader finds the resource tree and reads dialogs, menus, strings and the version block", () => {
  const read = readExecutable(buildExe(FIXTURE));
  assert.equal(read.error, undefined); assert.equal(read.clr, false); assert.deepEqual(read.problems, []);
  assert.deepEqual(read.types, [4, 5, 6, 16]);
  const [login, about] = read.dialogs;
  assert.equal(login.title, "Log in"); assert.equal(login.ex, true); assert.equal(login.controls.length, 16);
  assert.deepEqual(login.font, { size: 8, weight: 400, italic: false, face: "MS Shell Dlg" });
  assert.deepEqual(login.controls[1], { style: WS_TABSTOP | 0x10000000, exStyle: 0, helpId: 0, x: 60, y: 8, cx: 120, cy: 12, id: 1001, className: "Edit", caption: "", captionOrdinal: null });
  assert.equal(login.controls[12].className, "SysListView32", "a class named by string, not atom");
  assert.equal(about.ex, false); assert.equal(about.controls[1].caption, "Close");
  const [file, edit] = read.menus;
  assert.equal(file.items[0].text, "&File"); assert.equal(file.items[0].children[1].separator, true); assert.equal(file.items[0].children[2].id, 40002);
  assert.equal(file.items[1].children[0].disabled, true);
  assert.equal(edit.ex, true); assert.equal(edit.items[0].children[1].checked, true); assert.equal(edit.items[0].children[1].id, 6);
  assert.deepEqual(read.strings, [{ id: 300, text: "Saved.", truncated: false }, { id: 317, text: "Could not save.", truncated: false }]);
  assert.deepEqual(read.version, { ProductName: "Ledger", FileDescription: "Ledger desktop", ProductVersion: "4.2.0" });
  assert.equal(readExecutable(buildExe({ ...FIXTURE, plus: true })).plus, true, "PE32+ moves the data directories and is read the same");
});

test("what is not a native executable, or not whole, is a reason and never an exception", () => {
  assert.equal(readHeaders(Buffer.from("hello")).error, "not an executable: no MZ header");
  assert.match(readExecutable(Buffer.from("MZ" + "\0".repeat(200))).error, /no PE signature/);
  const whole = buildExe(FIXTURE);
  for (const cut of [0x100, 0x210, 0x260, 0x300, whole.length - 40]) {
    const read = readExecutable(whole.subarray(0, cut));
    assert.ok(read.error || read.problems.length, `a file cut at ${cut} names a problem`);
  }
  const clr = readExecutable(buildExe({ clr: true }));
  assert.equal(clr.clr, true); assert.equal(clr.dialogs.length, 0);
  assert.equal(readExecutable(buildExe({})).hasResources, true);
  assert.deepEqual(readDialog(Buffer.from([1, 0])).problems, ["the dialog header is truncated"]);
  assert.deepEqual(readMenu(Buffer.from([0, 0, 0, 0, 0x10, 0])).problems, ["the menu is truncated"]);
  const d = { id: 1, title: "T", controls: [{ className: "Edit", id: 5, x: 0, y: 0, cx: 1, cy: 1 }, { className: "Edit", id: 6, x: 0, y: 0, cx: 1, cy: 1 }] };
  const truncated = readDialog(Buffer.from(dialogTemplate(d).slice(0, -10)));
  assert.equal(truncated.controls.length, 1); assert.match(truncated.problems[0], /control 2 of 2 is truncated/);
  assert.equal(readMenu(Buffer.from(menuTemplate(MENU))).items.length, 2);
});

test("a dialog lowers onto the dialect in reading order: labels, fields, a group of radios, a select, the buttons", () => {
  const notes = [];
  const { template, outputs, title, usesTwoWay } = lowerDialog({ ...readDialog(Buffer.from(dialogTemplate(LOGIN))), id: 101 }, (n) => notes.push(n));
  assert.equal(title, "Log in"); assert.equal(usesTwoWay, true);
  assert.deepEqual(outputs, ["cancel", "help", "ok"], "outputs are events; the emitter names the handler on<Event>");
  assert.match(template, /^<form class="dialog" ng-submit="onOk\(\{ userName: userName, password: password, rememberMe: rememberMe, role: role, region: region, control1021: control1021 \}\)">/, "OK hands every field back by name, as the dialog's return did");
  assert.match(template, /<label for="f-user-name">User name<\/label>\n\s*<input id="f-user-name" type="text" ng-model="userName">/, "a static beside a field labels it; the mnemonic and the colon are gone");
  assert.match(template, /<input id="f-password" type="password" ng-model="password">/);
  assert.match(template, /<label><input type="checkbox" ng-model="rememberMe" accesskey="r"> Remember me<\/label>/, "the mnemonic is the access key");
  assert.match(template, /<fieldset>\n\s*<legend>Role<\/legend>\n\s*<label><input type="radio" ng-model="role" value="clerk" accesskey="c"> Clerk<\/label>\n\s*<label><input type="radio" ng-model="role" value="manager" accesskey="m"> Manager<\/label>\n\s*<\/fieldset>/, "controls inside a group box's rectangle are its children and the radios share the group's name");
  assert.match(template, /<select id="f-region" ng-model="region">\n\s*<option ng-repeat="option in regionOptions">\{\{ option \}\}<\/option>\n\s*<\/select>/);
  assert.match(template, /<p ng-show="shown.lockedOutShown">Locked out<\/p>/, "a control that starts hidden is shown by a named state");
  assert.match(template, /<textarea id="f-control1021" ng-model="control1021" readonly><\/textarea>/, "a multiline read only edit");
  assert.match(template, /<table class="list-view"><\/table>/);
  assert.match(template, /<button type="button" ng-click="onHelp\(\)" accesskey="h" disabled>Help<\/button>\n\s*<button type="submit">OK<\/button>\n\s*<button type="button" ng-click="onCancel\(\)">Cancel<\/button>/, "the bottom row reads left to right");
  assert.ok(notes.some((n) => /list\(s\) region are filled by the code at runtime/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) start hidden \(Locked out\)/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) start disabled \(Help\)/.test(n)));
  assert.ok(notes.some((n) => /list view 1030 is a table whose columns and rows the code supplies/.test(n)));
  assert.equal(kindOf({ className: "Button", style: 7 }), "group"); assert.equal(kindOf({ className: "Static", style: 3 }), "image"); assert.equal(kindOf({ className: "Static", style: 0x10 }), "rule"); assert.equal(kindOf({ className: "Edit", style: 4 }), "textarea"); assert.equal(kindOf({ className: "Whatever" }), "unknown");
  const ir = buildIr(template);
  assert.deepEqual(ir.collections, [], "a select's options are a list the screen is handed, not the data it is of");
  assert.deepEqual(ir.reads, ["onCancel", "onHelp", "onOk", "regionOptions", "shown"], "the IR reads the handlers too; the screen's inputs skip its fields");
  const jsx = translate(template).jsx;
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(/, "ng-submit swallows the navigation in the port as it did in AngularJS");
  assert.match(jsx, /accessKey="r"/, "React spells the attribute in camel case");
});

test("a menu lowers to a menu bar of buttons with access keys, nested popups, separators and commands as events", () => {
  const { template, outputs } = lowerMenu(readMenu(Buffer.from(menuTemplate(MENU))));
  assert.deepEqual(outputs, ["about", "exit", "open"]);
  assert.match(template, /<button type="button" accesskey="f" aria-haspopup="menu">File<\/button>\n\s*<ul role="menu">/);
  assert.match(template, /<li role="none"><button type="button" role="menuitem" ng-click="onOpen\(\)" accesskey="o">Open<\/button><\/li>\n\s*<li role="separator"><\/li>\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onExit\(\)" accesskey="x">Exit<\/button><\/li>/);
  assert.match(template, /ng-click="onAbout\(\)" accesskey="a" disabled>About/);
});

test("an executable in the source tree becomes screens, three reports and notes, and ports to React with every state", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-exe-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "ledger.exe"), buildExe(FIXTURE));
  await writeFile(join(dir, "forms.dll"), buildExe({ clr: true }));
  await writeFile(join(dir, "bare.exe"), buildExe({}));
  const run = await runPipeline({ src: dir, shots: join(dir, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["dialog-about", "dialog-log-in", "menu-200", "menu-201"]);
  const login = run.ctx.screens.find((s) => s.selector === "dialog-log-in");
  assert.equal(login.readBy, "exe"); assert.equal(login.file, "ledger.exe"); assert.equal(login.title, "Log in");
  assert.deepEqual(login.inputs, ["regionOptions", "shown"]); assert.deepEqual(login.outputs, ["cancel", "help", "ok"]);
  assert.equal(run.ctx.screens.find((s) => s.selector === "menu-200").title, "Ledger menu 200", "the version block names the product");
  const jsx = await readFile(join(run.out, "src/features/DialogLogIn/DialogLogIn.jsx"), "utf8");
  assert.match(jsx, /export default function DialogLogIn\(\{ regionOptions, shown, onCancel, onHelp, onOk, loading, error, onRetry \}\)/);
  assert.match(jsx, /No collection is bound, so the empty state cannot occur/, "an empty option list does not blank the dialog");
  assert.match(jsx, /if \(loading\) return/); assert.match(jsx, /if \(error\)/);
  assert.match(jsx, /const \[userName, setUserName\] = useState\(""\);/);
  const dialogs = await readFile(join(run.out, "DIALOGS.md"), "utf8");
  assert.match(dialogs, /\| ProductName \| Ledger \|/); assert.match(dialogs, /### Log in \(id 101, DIALOGEX\)/); assert.match(dialogs, /\| 1002 \| Edit \| input \|  \| 60, 24, 120 × 12 \|/);
  assert.match(dialogs, /## forms\.dll\n\nA \.NET assembly/);
  const menus = await readFile(join(run.out, "MENUS.md"), "utf8");
  assert.match(menus, /- File\n  - Open \(40001\)\n  - ———\n  - Exit \(40002\)\n- Help\n  - About \(40003\) disabled/);
  assert.match(await readFile(join(run.out, "STRINGS.md"), "utf8"), /\| 317 \| Could not save\. \|/);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /forms\.dll is a \.NET assembly\. Its forms are code/);
  assert.match(notes, /bare\.exe carries resources but no dialog or menu template \(types present: \)/);
  assert.match(notes, /ledger\.exe: 2 string table entr\(ies\)/);
  assert.match(await readFile(join(run.out, "READERS.md"), "utf8"), /ledger\.exe/, "the census counts the executable as read");
  assert.ok(!run.ctx.report.unverified.some((n) => /no reader claimed/.test(n) && /exe|dll/.test(n)), "no executable is an unread markup file");
});

/**
 * The nineteenth review pass, over this reader: a caption that spells a JavaScript
 * keyword, a literal ampersand, a default button that is not OK, creation data
 * on a control, a resource pointing into a section's virtual tail, a string the
 * block ends inside, and a version value with a pipe in it.
 */
test("the nineteenth review pass: keywords, literal ampersands, the default button, creation data, the virtual tail, cut strings", () => {
  const notes = [];
  const reserved = lowerDialog({ ...readDialog(Buffer.from(dialogTemplate({ id: 5, title: "Options", controls: [
    { className: "Button", caption: "Export", id: 10, x: 0, y: 0, cx: 100, cy: 40, style: 7 },
    { className: "Button", caption: "&Default", id: 11, x: 4, y: 10, cx: 40, cy: 10, style: 9 | WS_GROUP },
    { className: "Button", caption: "Custom", id: 12, x: 50, y: 10, cx: 40, cy: 10, style: 9 },
    { className: "Static", caption: "Class:", id: 65535, x: 0, y: 50, cx: 30, cy: 8 },
    { className: "Edit", caption: "", id: 13, x: 40, y: 48, cx: 60, cy: 12 },
    { className: "Button", caption: "Search && Replace", id: 14, x: 0, y: 70, cx: 80, cy: 14, style: 3 },
    { className: "Button", caption: "R&&D &Options", id: 15, x: 0, y: 90, cx: 80, cy: 14 },
    { className: "Button", caption: "Next >", id: 0x3024, x: 0, y: 110, cx: 40, cy: 14, style: 1 },
    { className: "Button", caption: "Cancel", id: 2, x: 50, y: 110, cx: 40, cy: 14 },
  ] }))), id: 5 }, (n) => notes.push(n));
  assert.match(reserved.template, /ng-model="exportField" value="default"/, "a group box captioned Export names a field the emitted JavaScript can declare");
  assert.match(reserved.template, /<input id="f-class" type="text" ng-model="classField">/);
  assert.match(reserved.template, /<label><input type="checkbox" ng-model="searchReplace"> Search &amp; Replace<\/label>/, "a doubled ampersand is a literal one and names no access key");
  assert.match(reserved.template, /ng-click="onRDOptions\(\)" accesskey="o">R&amp;D Options</, "the mnemonic is the single ampersand, not the escaped pair");
  assert.match(reserved.template, /<button type="button" ng-click="onNext\(\)">Next &gt;<\/button>/, "a default push button that is not IDOK is its own event, never the submit");
  assert.ok(!/type="submit"/.test(reserved.template) && !/<form/.test(reserved.template), "no IDOK, no form");
  assert.ok(notes.some((n) => /the default button is Next > \(id 12324\), which Enter fired in the original; the port raises onNext from a click only/.test(n)));
  assert.doesNotMatch(reserved.template, /accesskey=" "/);

  const withData = { id: 6, title: "Data", controls: [
    { className: "Edit", caption: "", id: 20, x: 1, y: 1, cx: 10, cy: 10, extra: [1, 2, 3, 4] },
    { className: "Button", caption: "After", id: 21, x: 1, y: 20, cx: 10, cy: 10, extra: [9, 9, 9] },
    { className: "Static", caption: "Last", id: 22, x: 1, y: 40, cx: 10, cy: 10 },
  ] };
  for (const ex of [true, false]) {
    const d = readDialog(Buffer.from(dialogTemplate({ ...withData, ex })));
    assert.deepEqual(d.problems, [], `creation data in a ${ex ? "DIALOGEX" : "DIALOG"} keeps the controls after it aligned`);
    assert.deepEqual(d.controls.map((c) => [c.className, c.caption, c.id]), [["Edit", "", 20], ["Button", "After", 21], ["Static", "Last", 22]]);
  }

  const phantom = readExecutable(buildExe({ ...FIXTURE, phantom: true }));
  assert.ok(phantom.problems.some((p) => /a resource's data lies outside the file/.test(p)), "an RVA in the section's virtual tail is zero fill, not the next section's bytes");
  assert.equal(phantom.dialogs.length + phantom.menus.length + (phantom.version.ProductName ? 1 : 0) + (phantom.strings.length ? 1 : 0), 5, "every other resource still reads; only the phantom is refused");

  const block = Buffer.from([6, 0, ...[..."Saved."].flatMap((c) => [c.charCodeAt(0), 0]), 40, 0, ...[..."Could not"].flatMap((c) => [c.charCodeAt(0), 0])]);
  const cut = readExecutable(buildExe({ raw: [{ type: 6, id: 20, bytes: [...block] }] }));
  assert.deepEqual(cut.strings, [{ id: 304, text: "Saved.", truncated: false }, { id: 305, text: "Could not", truncated: true }]);
  assert.deepEqual(cut.problems, ["string 305 is cut off after 9 of 40 characters"]);
});

test("the nineteenth review pass: a version value with a pipe, a keyword field and a cut string reach the reports whole", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-exe2-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const block = [3, 0, ...[..."Hi!"].flatMap((c) => [c.charCodeAt(0), 0]), 40, 0, ...[..."Could not"].flatMap((c) => [c.charCodeAt(0), 0])];
  await writeFile(join(dir, "pipes.exe"), buildExe({
    dialogs: [{ id: 7, title: "Import", controls: [{ className: "Static", caption: "Class:", id: 65535, x: 0, y: 0, cx: 30, cy: 8 }, { className: "Edit", caption: "", id: 1, x: 40, y: 0, cx: 60, cy: 12 }, { className: "Button", caption: "OK", id: 1, x: 0, y: 20, cx: 40, cy: 14, style: 1 }] }],
    version: { ProductName: "Ledger | Accounts", FileDescription: "Two\nlines" },
    raw: [{ type: 6, id: 20, bytes: block }],
  }));
  const run = await runPipeline({ src: dir, shots: join(dir, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const dialogs = await readFile(join(run.out, "DIALOGS.md"), "utf8");
  assert.match(dialogs, /\| ProductName \| Ledger \\\| Accounts \|/); assert.match(dialogs, /\| FileDescription \| Two lines \|/);
  const strings = await readFile(join(run.out, "STRINGS.md"), "utf8");
  assert.match(strings, /\| 305 \| Could not \(cut off in the file\) \|/);
  assert.ok(run.ctx.report.unverified.some((n) => /pipes\.exe: string 305 is cut off in the file/.test(n)));
  const jsx = await readFile(join(run.out, "src/features/DialogImport/DialogImport.jsx"), "utf8");
  assert.match(jsx, /const \[classField, setClassField\] = useState\(""\);/, "the emitted component declares a name JavaScript allows");
});
