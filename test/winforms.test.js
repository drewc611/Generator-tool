import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { caption, formsReport, kindOf, lowerForm, stem } from "../plugins/input-winforms/index.js";
import { designerBody, readDesigner, readNumber, readString } from "../plugins/input-winforms/designer.js";
import { applyResx, readResx } from "../plugins/input-winforms/resx.js";
import { translate } from "../plugins/output-react/template.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A Windows Forms application keeps its forms in code the designer wrote: the
 * InitializeComponent body declares every control, sets its properties, wires
 * its events and places it in a container. input-winforms reads that body
 * with a scanner that knows C# and VB strings and comments, cuts it into
 * statements, and lowers each form onto the shared dialect with the choices
 * input-exe makes for a native dialog, so a .NET form and a Win32 dialog with
 * the same controls come out as the same React. The fixtures are real designer
 * files under test/fixtures/winforms; the two plain .cs files beside them are
 * the code behind and a helper, and neither is a form. Localized.Designer.cs
 * is a form the designer marked Localizable, so every caption, location and
 * size sits in Localized.resx beside it and Localized.de.resx is the German
 * half the port must never read for it.
 */

const FIXTURES = join(ROOT, "test/fixtures/winforms");
const read = async (name) => readDesigner(await readFile(join(FIXTURES, name), "utf8"), name);

test("the scanner reads a C# designer body into declarations, properties, events and containment, strings and comments respected", async () => {
  const r = await read("LoginForm.Designer.cs");
  assert.equal(r.lang, "cs"); assert.equal(r.className, "LoginForm"); assert.equal(r.statements, 214); assert.equal(r.controls.size, 28); assert.deepEqual(r.problems, []);
  assert.equal(r.form.text, "Log in"); assert.deepEqual(r.form.clientSize, [334, 375]);
  assert.equal(r.form.acceptButton, "btnOK"); assert.equal(r.form.cancelButton, "btnCancel"); assert.equal(r.form.mainMenuStrip, "menuStrip1");
  assert.deepEqual(r.form.events.map((e) => [e.event, e.handler]), [["Load", "LoginForm_Load"], ["FormClosing", "LoginForm_FormClosing"]]);
  assert.deepEqual(r.form.children.slice(-2), ["lblUser", "menuStrip1"], "the form holds what this.Controls.Add gave it");
  const txtUser = r.controls.get("txtUser");
  assert.equal(txtUser.type, "TextBox"); assert.equal(txtUser.fullType, "System.Windows.Forms.TextBox"); assert.equal(txtUser.line, 39);
  assert.deepEqual(txtUser.location, [110, 37]); assert.deepEqual(txtUser.size, [200, 20]); assert.equal(txtUser.tabIndex, 2); assert.equal(txtUser.parent, "");
  assert.deepEqual(txtUser.events, [{ event: "TextChanged", handler: "txtUser_TextChanged", line: 133 }], "the first statement after a comment block is a statement, not a comment");
  assert.equal(r.controls.get("txtPassword").password, true); assert.equal(r.controls.get("txtPassword").maxLength, 64);
  assert.equal(r.controls.get("txtNotes").multiline, true); assert.equal(r.controls.get("txtNotes").readOnly, true);
  assert.equal(r.controls.get("txtPath").text, "C:\\ledger\\", "a verbatim string ending in a backslash closes where C# closes it");
  assert.equal(r.controls.get("lblMotto").text, 'Say "hi" to the ledger; {braces} stay', "the statement after the verbatim string is whole, with its escapes decoded and its braces kept");
  assert.deepEqual(r.controls.get("txtPath").anchor, ["Bottom", "Left", "Right"], "a cast around a bitwise or of anchor styles reads as the styles");
  assert.deepEqual(r.controls.get("grpRole").children, ["rbManager", "rbClerk"]); assert.equal(r.controls.get("rbClerk").parent, "grpRole"); assert.equal(r.controls.get("rbClerk").checked, true);
  assert.deepEqual(r.controls.get("cboRegion").items, ["North", "South", "East & West"]); assert.equal(r.controls.get("cboRegion").dropDownStyle, "DropDownList");
  assert.equal(r.controls.get("numAttempts").min, 1); assert.equal(r.controls.get("numAttempts").max, 5, "new decimal(new int[] {...}) reads as the number it encodes");
  assert.equal(r.controls.get("lblLocked").visible, false); assert.equal(r.controls.get("btnHelp").enabled, false); assert.equal(r.controls.get("aboutToolStripMenuItem").enabled, false);
  assert.deepEqual(r.controls.get("menuStrip1").children, ["fileToolStripMenuItem", "helpToolStripMenuItem"]);
  assert.deepEqual(r.controls.get("fileToolStripMenuItem").children, ["openToolStripMenuItem", "toolStripSeparator1", "exitToolStripMenuItem"]);
  assert.deepEqual(r.controls.get("timer1").events.map((e) => e.event), ["Tick"]);
  assert.ok(!r.controls.has("ClientSize") && !r.controls.has("AutoScaleDimensions"), "a value constructed with new is a property set, not a control declared");
});

test("the scanner reads a VB designer body the same way: Me, New, doubled quotes, CType casts, Or, AddRange initializers", async () => {
  const r = await read("OrdersForm.Designer.vb");
  assert.equal(r.lang, "vb"); assert.equal(r.className, "OrdersForm"); assert.equal(r.controls.size, 21); assert.deepEqual(r.problems, []);
  assert.equal(r.form.text, "Orders"); assert.equal(r.form.acceptButton, null); assert.deepEqual(r.form.events, [], "a VB designer wires nothing; Handles clauses live in the code file");
  assert.deepEqual(r.form.children, ["lblNote", "btnRefresh", "Chart1", "lnkTerms", "prgSync", "pbLogo", "TabControl1"], "Controls.AddRange with a collection initializer");
  assert.deepEqual(r.controls.get("TabControl1").children, ["TabPage1", "TabPage2"]); assert.equal(r.controls.get("TabControl1").dock, "Top");
  assert.equal(r.controls.get("DataGridView1").parent, "TabPage1"); assert.equal(r.controls.get("DataGridView1").dock, "Fill");
  assert.deepEqual(r.controls.get("DataGridView1").columns, ["colOrder", "colTotal"]); assert.equal(r.controls.get("colOrder").headerText, "Order #");
  assert.deepEqual(r.controls.get("lstCarriers").items, ["Post", "Courier", 'Say "hi" freight'], "a doubled quote in a VB string is one quote");
  assert.equal(r.controls.get("lstCarriers").selectionMode, "MultiExtended");
  assert.equal(r.controls.get("lblNote").text, 'Totals include "VAT"');
  assert.equal(r.controls.get("dtpShipped").format, "Time"); assert.equal(r.controls.get("trkDiscount").max, 50); assert.equal(r.controls.get("prgSync").max, 200);
  assert.deepEqual(r.controls.get("btnRefresh").anchor, ["Bottom", "Right"], "CType(... Or ...) reads as the styles");
  assert.equal(r.controls.get("lnkTerms").localized, true, "resources.ApplyResources marks the control's text as living in the .resx");
  assert.equal(r.controls.get("pbLogo").hasImage, true);
  assert.equal(r.controls.get("Chart1").fullType, "Telerik.WinControls.UI.RadChartView");
});

test("a file that calls InitializeComponent or never names it is not a designer file, and the literal readers are exact", async () => {
  assert.equal(await read("LoginForm.cs"), null, "the code behind calls the method; it does not define it");
  assert.equal(await read("Helpers.cs"), null);
  assert.equal(designerBody("class A { public A() { InitializeComponent(); } void Other() {} }"), null, "a call is not a definition");
  assert.equal(designerBody("Partial Class A\n  Sub New()\n    InitializeComponent()\n  End Sub\nEnd Class\n"), null);
  const cut = readDesigner("partial class Cut { private void InitializeComponent() {\n this.a = new System.Windows.Forms.Button();\n this.a.Text = \"Go\";\n", "Cut.Designer.cs");
  assert.equal(cut.controls.get("a").text, "Go"); assert.deepEqual(cut.problems, ["InitializeComponent never closes; what was read before the end of the file is kept"]);
  assert.equal(readString('"a\\"b\\\\c\\n"', "cs"), 'a"b\\c\n'); assert.equal(readString('@"C:\\x\\"', "cs"), "C:\\x\\"); assert.equal(readString('"say ""hi"""', "vb"), 'say "hi"');
  assert.equal(readString('"a" + "b"', "cs"), null, "a concatenation is not one literal"); assert.equal(readString("resources.GetString(\"x\")", "cs"), null);
  assert.equal(readNumber("100"), 100); assert.equal(readNumber("6.5F"), 6.5); assert.equal(readNumber("50!"), 50);
  assert.equal(readNumber("new decimal(new int[] { 1250, 0, 0, 131072 })"), 12.5, "the scale is in bits 16 to 23");
  assert.equal(readNumber("new decimal(new int[] { 7, 0, 0, -2147483648 })"), -7, "the sign is bit 31");
  assert.equal(readNumber("new decimal(new int[] { 1, 1, 0, 0 })"), null, "a value past 2^32 is not read rather than read wrong");
  assert.equal(readNumber("System.Decimal.MaxValue"), null);
  assert.deepEqual(caption("&User name:"), { text: "User name", accesskey: "u" }); assert.deepEqual(caption("Search && Replace"), { text: "Search & Replace", accesskey: null });
  assert.deepEqual(caption("R&&D &Options"), { text: "R&D Options", accesskey: "o" }); assert.deepEqual(caption("A & B", false), { text: "A & B", accesskey: null });
  assert.equal(stem("txtUser"), "user"); assert.equal(stem("cboRegion"), "region"); assert.equal(stem("pbLogo"), "logo"); assert.equal(stem("DataGridView1"), "dataGridView1"); assert.equal(stem("rbx"), "rbx", "a prefix not followed by a capital is the name");
  assert.equal(kindOf("TextBox"), "input"); assert.equal(kindOf("RichTextBox"), "textarea"); assert.equal(kindOf("DataGridViewCheckBoxColumn"), "column"); assert.equal(kindOf("Timer"), "component"); assert.equal(kindOf("RadChartView"), "unknown");
});

test("a C# form lowers onto the dialect in reading order: menu bar, labels, fields, a group of radios, a select with its items, the buttons", async () => {
  const notes = [];
  const { template, outputs, fields, title, usesTwoWay, usesNgFor, usesNgIf } = lowerForm(await read("LoginForm.Designer.cs"), (n) => notes.push(n));
  assert.equal(title, "Log in"); assert.equal(usesTwoWay, true); assert.equal(usesNgFor, false, "options declared in the designer are options, not a list the port is handed"); assert.equal(usesNgIf, true);
  assert.deepEqual(outputs, ["about", "cancel", "exit", "help", "ok", "open"], "outputs are events; the emitter names the handler on<Event>");
  assert.deepEqual(fields, ["userName", "password", "rememberMe", "role", "region", "attempts", "notes", "path"]);
  assert.match(template, /^<form class="winform" ng-submit="onOk\(\{ userName: userName, password: password, rememberMe: rememberMe, role: role, region: region, attempts: attempts, notes: notes, path: path \}\)">\n  <h2>Log in<\/h2>/, "the AcceptButton makes the form a form and OK hands every field back by name, as input-exe's IDOK does");
  assert.match(template, /<nav class="menu-bar" aria-label="menu">\n\s*<ul role="menubar">\n\s*<li>\n\s*<button type="button" accesskey="f" aria-haspopup="menu">File<\/button>\n\s*<ul role="menu">\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onOpen\(\)" accesskey="o">Open<\/button><\/li>\n\s*<li role="separator"><\/li>\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onExit\(\)" accesskey="x">Exit<\/button><\/li>/, "the MenuStrip at 0, 0 reads first, as input-exe's lowerMenu draws it");
  assert.match(template, /ng-click="onAbout\(\)" accesskey="a" disabled>About</);
  assert.match(template, /<label for="f-user-name">User name<\/label>\n\s*<input id="f-user-name" type="text" ng-model="userName">/, "a label on the row of a field names it; the mnemonic and the colon are gone");
  assert.match(template, /<label for="f-password">Password<\/label>\n\s*<input id="f-password" type="password" ng-model="password" maxlength="64">/);
  assert.match(template, /<label><input type="checkbox" ng-model="rememberMe" accesskey="r"> Remember me<\/label>/);
  assert.match(template, /<fieldset>\n\s*<legend>Role<\/legend>\n\s*<label><input type="radio" ng-model="role" value="clerk" accesskey="c"> Clerk<\/label>\n\s*<label><input type="radio" ng-model="role" value="manager" accesskey="m"> Manager<\/label>\n\s*<\/fieldset>/, "radios inside a group box share its name and read left to right, whatever order Controls.Add used");
  assert.match(template, /<label for="f-region">Region<\/label>\n\s*<select id="f-region" ng-model="region">\n\s*<option>North<\/option>\n\s*<option>South<\/option>\n\s*<option>East &amp; West<\/option>\n\s*<\/select>/, "items the designer declared are real options");
  assert.match(template, /<label for="f-attempts">Attempts<\/label>\n\s*<input id="f-attempts" type="number" ng-model="attempts" min="1" max="5">/);
  assert.match(template, /<p ng-show="shown.lockedOutShown">Locked out<\/p>/, "a control that starts hidden is shown by a named state");
  assert.match(template, /<textarea id="f-notes" ng-model="notes" readonly><\/textarea>\n\s*<input id="f-path" type="text" ng-model="path">\n\s*<p>Say &quot;hi&quot; to the ledger; \{braces\} stay<\/p>/, "the text box's initial value is not in the template");
  assert.doesNotMatch(template, /ledger\\/, "the designer's initial text is a value and never printed");
  assert.match(template, /<button type="button" ng-click="onHelp\(\)" accesskey="h" disabled>Help<\/button>\n\s*<button type="submit">OK<\/button>\n\s*<button type="button" ng-click="onCancel\(\)">Cancel<\/button>\n<\/form>$/, "the bottom row reads left to right; the CancelButton is the cancel event");
  assert.ok(notes.some((n) => /1 control\(s\) start hidden \(Locked out\)/.test(n)));
  assert.ok(notes.some((n) => /2 control\(s\) start disabled \(About, Help\)/.test(n)));
  assert.ok(notes.some((n) => /initial state set in the designer: rememberMe, role = clerk/.test(n)));
  assert.ok(notes.some((n) => /1 text box\(es\) start with a text the designer set \(txtPath\); the value is not reprinted/.test(n)));
  assert.ok(notes.some((n) => /event\(s\) wired beyond Click: txtUser\.TextChanged → txtUser_TextChanged; chkRemember\.CheckedChanged → chkRemember_CheckedChanged; cboRegion\.SelectedIndexChanged → cboRegion_SelectedIndexChanged; LoginForm\.Load → LoginForm_Load; LoginForm\.FormClosing → LoginForm_FormClosing; each handler is in the code behind, which is not read/.test(n)));
  assert.ok(notes.some((n) => /no Click wired in the designer \(btnHelp\)/.test(n)));
  assert.ok(notes.some((n) => /component\(s\) with no visual: components \(Container\), timer1 \(Timer, Tick wired\)/.test(n)));
  assert.ok(!notes.some((n) => /list\(s\)/.test(n)), "no list is filled at runtime on this form");
  const ir = buildIr(template);
  assert.deepEqual(ir.collections, [], "no collection, so no empty state to guard");
  assert.deepEqual(ir.reads, ["onAbout", "onCancel", "onExit", "onHelp", "onOk", "onOpen", "shown"]);
  const jsx = translate(template).jsx;
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(/, "ng-submit swallows the navigation in the port");
  assert.match(jsx, /accessKey="r"/);
});

test("a VB form lowers its tab pages as sections, its grid with the columns the designer declared, and names what the code fills", async () => {
  const notes = [];
  const { template, outputs, fields, usesNgFor, usesNgIf } = lowerForm(await read("OrdersForm.Designer.vb"), (n) => notes.push(n));
  assert.deepEqual(outputs, ["refresh", "terms"]); assert.deepEqual(fields, ["shipAt", "discount", "priority", "carriers", "warehouse"]);
  assert.equal(usesNgFor, true); assert.equal(usesNgIf, false);
  assert.match(template, /^<div class="winform">\n  <h2>Orders<\/h2>\n  <div class="tab-control">\n    <section aria-label="Orders">\n      <table class="data-grid-view">\n        <thead><tr><th>Order #<\/th><th>Total<\/th><\/tr><\/thead>\n      <\/table>\n    <\/section>\n    <section aria-label="Shipping">/, "no AcceptButton, no form; every tab page is in the template");
  assert.match(template, /<label for="f-ship-at">Ship at<\/label>\n\s*<input id="f-ship-at" type="datetime-local" ng-model="shipAt">/, "a picker whose Format is Time keeps the date it held");
  assert.match(template, /<label for="f-discount">Discount<\/label>\n\s*<input id="f-discount" type="range" ng-model="discount" max="50">/, "a label directly above a field names it");
  assert.match(template, /<div class="panel">\n\s*<label><input type="radio" ng-model="priority" value="normal"> Normal<\/label>\n\s*<label><input type="radio" ng-model="priority" value="rush"> Rush<\/label>\n\s*<\/div>/, "radios in a panel share the panel's name");
  assert.match(template, /<select id="f-carriers" ng-model="carriers" multiple>\n\s*<option>Post<\/option>\n\s*<option>Courier<\/option>\n\s*<option>Say &quot;hi&quot; freight<\/option>\n\s*<\/select>/);
  assert.match(template, /<select id="f-warehouse" ng-model="warehouse">\n\s*<option ng-repeat="option in warehouseOptions">\{\{ option \}\}<\/option>\n\s*<\/select>/, "a combo box with no items is filled at runtime, exactly as input-exe reads a native one");
  assert.match(template, /<span class="image" role="img" aria-label="logo"><\/span>\n\s*<progress max="200"><\/progress>\n\s*<button type="button" class="link" ng-click="onTerms\(\)">lnkTerms<\/button>\n\s*<div class="radchartview"><\/div>\n\s*<p>Totals include &quot;VAT&quot;<\/p>\n\s*<button type="button" ng-click="onRefresh\(\)" accesskey="r">Refresh<\/button>\n<\/div>$/, "a localized caption is stood in for by the control's name; a third party type is a div");
  assert.ok(notes.some((n) => /the tab control TabControl1 switches between 2 page\(s\) \(Orders, Shipping\); every page is in the template and which one shows is a state the port drives/.test(n)));
  assert.ok(notes.some((n) => /the grid DataGridView1 has 2 column\(s\) the designer declared \(Order #, Total\) and rows the code supplies/.test(n)));
  assert.ok(notes.some((n) => /the list\(s\) warehouse declare no items in the designer/.test(n)));
  assert.ok(notes.some((n) => /combo box\(es\) warehouse accepted typed text/.test(n)));
  assert.ok(notes.some((n) => /the date picker shipAt shows its time in the original; the port takes a datetime-local/.test(n)));
  assert.ok(notes.some((n) => /the text of 1 control\(s\) \(lnkTerms\) lives in the \.resx/.test(n)));
  assert.ok(notes.some((n) => /kept as divs: Telerik\.WinControls\.UI\.RadChartView \(Chart1\)/.test(n)));
  assert.ok(notes.some((n) => /a VB designer file wires no handlers; they are bound by Handles clauses/.test(n)));
  assert.ok(notes.some((n) => /1 picture box\(es\) are placeholders/.test(n)));
  assert.deepEqual(buildIr(template).collections, [], "the runtime list is what the screen is handed, not the data it is of");
});

test("a folder of designer files becomes screens, WINFORMS.md and notes, and ports to React with every state", async (t) => {
  const run = await runPipeline({ src: FIXTURES, shots: join(FIXTURES, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["form-localized", "form-login-form", "form-orders-form"], "the code behind and the helper class are not forms");
  const login = run.ctx.screens.find((s) => s.selector === "form-login-form");
  assert.equal(login.className, "FormLoginForm"); assert.equal(login.readBy, "winforms"); assert.equal(login.file, "LoginForm.Designer.cs"); assert.equal(login.title, "Log in");
  assert.deepEqual(login.inputs, ["shown"], "the fields are the form's own state; only the shown states are handed in");
  assert.deepEqual(login.outputs, ["about", "cancel", "exit", "help", "ok", "open"]);
  assert.match(login.templateOrigin, /^InitializeComponent in LoginForm\.Designer\.cs \(line 28\)/);
  const orders = run.ctx.screens.find((s) => s.selector === "form-orders-form");
  assert.deepEqual(orders.inputs, ["warehouseOptions"]); assert.equal(orders.usesNgFor, true);
  const jsx = await readFile(join(run.out, "src/features/FormLoginForm/FormLoginForm.jsx"), "utf8");
  assert.match(jsx, /export default function FormLoginForm\(\{ shown, onAbout, onCancel, onExit, onHelp, onOk, onOpen, loading, error, onRetry \}\)/);
  for (const f of ["userName", "password", "rememberMe", "role", "region", "attempts", "notes", "path"]) assert.match(jsx, new RegExp(`const \\[${f}, set${f[0].toUpperCase()}${f.slice(1)}\\] = useState\\(""\\);`), `${f} is declared with useState`);
  assert.match(jsx, /No collection is bound, so the empty state cannot occur/, "declared options are not a collection to guard on");
  assert.match(jsx, /if \(loading\) return/); assert.match(jsx, /if \(error\)/);
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(\{ userName: userName/);
  assert.match(jsx, /<option>\n\s*East & West\n\s*<\/option>/, "the declared options reach the port as options");
  assert.match(jsx, /accessKey="f"/); assert.match(jsx, /htmlFor="f-user-name"/);
  const forms = await readFile(join(run.out, "WINFORMS.md"), "utf8");
  assert.match(forms, /^# Windows Forms\n/, "the designer tables are their own report, beside dsp-forms's FORMS.md");
  assert.match(forms, /## LoginForm \(LoginForm\.Designer\.cs\)\n\ntitle "Log in", client size 334 × 375, accepts on btnOK, cancels on btnCancel, menu menuStrip1\. 28 control\(s\), 214 statement\(s\) read, C#\./);
  assert.match(forms, /Form events wired: Load → LoginForm_Load, FormClosing → LoginForm_FormClosing\./);
  assert.match(forms, /\| txtUser \| TextBox \|  \| 110, 37 \| 200 × 20 \| 2 \|  \| TextChanged → txtUser_TextChanged \|/);
  assert.match(forms, /\| txtPath \| TextBox \| \(initial value withheld\) \| 12, 290 \| 298 × 20 \| 9 \| anchor Bottom, Left, Right \|  \|/, "a text box's text is a value; the anchor is the layout the report keeps");
  assert.doesNotMatch(forms, /ledger\\/, "the value is withheld in the report too");
  assert.match(forms, /\| lblUser \| Label \| User name \| 12, 40 \| 63 × 13 \| 1 \|  \|  \|/, "captions are printed without their mnemonic");
  assert.match(forms, /## OrdersForm \(OrdersForm\.Designer\.vb\)\n\ntitle "Orders", client size 520 × 495\. 21 control\(s\), 151 statement\(s\) read, VB\./);
  assert.match(forms, /\| DataGridView1 \| DataGridView \|  \| 0, 0 \| 512 × 234 \| 0 \| dock Fill \|  \|/);
  assert.match(forms, /\| colOrder \| DataGridViewTextBoxColumn \| Order # \|/); assert.match(forms, /\| lnkTerms \| LinkLabel \| \(from \.resx\) \|/); assert.match(forms, /\| Chart1 \| RadChartView \|/);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /LoginForm\.Designer\.cs, form LoginForm: 1 control\(s\) start hidden \(Locked out\)/);
  assert.match(notes, /OrdersForm\.Designer\.vb, form OrdersForm: the list\(s\) warehouse declare no items/);
  assert.match(notes, /OrdersForm\.Designer\.vb, form OrdersForm: a VB designer file wires no handlers/);
  const readers = await readFile(join(run.out, "READERS.md"), "utf8");
  assert.match(readers, /- \*\*winforms\*\*: 3 file\(s\)/); assert.match(readers, /`LoginForm\.Designer\.cs` by winforms/); assert.match(readers, /`OrdersForm\.Designer\.vb` by winforms/);
  assert.ok(!run.ctx.report.unverified.some((n) => /no reader claimed/.test(n)), "no designer file is an unread markup file");
  assert.equal(run.ctx.provenance["WINFORMS.md"].plugin, "input-winforms");
  // The localized form went through the same run: the .resx beside it was read from disk, the German one only named.
  const localized = run.ctx.screens.find((s) => s.selector === "form-localized");
  assert.equal(localized.title, "Customer & Co"); assert.deepEqual(localized.outputs, ["cancel", "ok"]); assert.deepEqual(localized.inputs, ["shown"]);
  const ljsx = await readFile(join(run.out, "src/features/FormLocalized/FormLocalized.jsx"), "utf8");
  assert.match(ljsx, /accessKey="s"/); assert.match(ljsx, /<option>\n\s*Süd\n\s*<\/option>/, "the options the .resx declared reach the port as options");
  assert.match(ljsx, /htmlFor="f-name"/); assert.match(ljsx, /Send notifications/);
  assert.match(forms, /## Localized \(Localized\.Designer\.cs\)\n\ntitle "Customer & Co" \(from Localized\.resx\), accepts on btnSave, cancels on btnCancel\. 12 control\(s\), 66 statement\(s\) read, C#\./);
  assert.match(forms, /Culture variant\(s\) named and not read: Localized\.de\.resx\./);
  assert.match(notes, /Localized\.Designer\.cs, form Localized: the text of 6 control\(s\) \(lblName, lblRegion, chkNotify, lblHint, btnSave, btnCancel\) came from Localized\.resx beside the designer/);
  assert.match(notes, /OrdersForm\.Designer\.vb, form OrdersForm: the text of 1 control\(s\) \(lnkTerms\) lives in the \.resx \(resources\.ApplyResources or GetString\); the control names stand in/, "a localized form with no .resx beside it keeps exactly the note it had");
  for (const german of [/Speichern/, /Abbrechen/, /Kunde\b/]) { assert.doesNotMatch(forms, german); assert.doesNotMatch(notes, german); assert.doesNotMatch(ljsx, german); }
  assert.doesNotMatch(forms + notes + ljsx, /logo\.png|AAEAAAD|Segoe UI|999, 999/, "a file path, a base64 blob, a font and an overridden location are never printed");
});

/**
 * The review pass over this reader, with inline designer bodies: a caption
 * that spells a JavaScript keyword, a doubled ampersand, a label told not to
 * read mnemonics, a hidden label beside a field, a form with no AcceptButton
 * whose AcceptButton names nothing placed, a context menu, a split container,
 * a tool strip with a text box on it, a status strip, a list view's column
 * headers, and a selector that repeats.
 */
const cs = (body, name = "Options") => `namespace X { partial class ${name} { private void InitializeComponent() {\n${body}\n} } }`;
const ctl = (n, type, props = {}) => [`this.${n} = new System.Windows.Forms.${type}();`, ...Object.entries(props).map(([k, v]) => `this.${n}.${k} = ${v};`)].join("\n");

test("the review pass: keywords, literal ampersands, mnemonics off, a hidden label, no accept button, strips, splits, columns", () => {
  const notes = [];
  const source = cs([
    ctl("grpExport", "GroupBox", { Text: '"Export"', Location: "new System.Drawing.Point(0, 0)", Size: "new System.Drawing.Size(200, 60)" }),
    ctl("rbDefault", "RadioButton", { Text: '"&Default"', Location: "new System.Drawing.Point(4, 20)" }),
    ctl("rbCustom", "RadioButton", { Text: '"Custom"', Location: "new System.Drawing.Point(80, 20)" }),
    "this.grpExport.Controls.Add(this.rbDefault); this.grpExport.Controls.Add(this.rbCustom);",
    ctl("lblClass", "Label", { Text: '"Class:"', Location: "new System.Drawing.Point(0, 70)" }),
    ctl("txtClass", "TextBox", { Location: "new System.Drawing.Point(60, 67)" }),
    ctl("chkSearch", "CheckBox", { Text: '"Search && Replace"', Location: "new System.Drawing.Point(0, 100)" }),
    ctl("lblPlain", "Label", { Text: '"Salt & Pepper"', UseMnemonic: "false", Location: "new System.Drawing.Point(0, 120)" }),
    ctl("lblGhost", "Label", { Text: '"Ghost"', Visible: "false", Location: "new System.Drawing.Point(0, 140)" }),
    ctl("txtBeside", "TextBox", { Location: "new System.Drawing.Point(60, 137)" }),
    ctl("split", "SplitContainer", { Location: "new System.Drawing.Point(0, 170)" }),
    ctl("txtLeft", "TextBox", { Location: "new System.Drawing.Point(0, 0)" }),
    ctl("txtRight", "TextBox", { Location: "new System.Drawing.Point(0, 0)" }),
    "this.split.Panel1.Controls.Add(this.txtLeft); this.split.Panel2.Controls.Add(this.txtRight);",
    ctl("toolStrip1", "ToolStrip", { Location: "new System.Drawing.Point(0, 200)" }),
    ctl("tsbRun", "ToolStripButton", { Text: '"&Run"' }),
    ctl("tsSep", "ToolStripSeparator"),
    ctl("tsFilter", "ToolStripTextBox"),
    "this.toolStrip1.Items.AddRange(new System.Windows.Forms.ToolStripItem[] { this.tsbRun, this.tsSep, this.tsFilter });",
    "this.tsbRun.Click += new System.EventHandler(this.tsbRun_Click);",
    ctl("listView1", "ListView", { Location: "new System.Drawing.Point(0, 230)", ContextMenuStrip: "this.cmsRows" }),
    ctl("colName", "ColumnHeader", { Text: '"Name"' }),
    "this.listView1.Columns.AddRange(new System.Windows.Forms.ColumnHeader[] { this.colName });",
    ctl("cmsRows", "ContextMenuStrip"),
    ctl("deleteToolStripMenuItem", "ToolStripMenuItem", { Text: '"&Delete"' }),
    "this.cmsRows.Items.AddRange(new System.Windows.Forms.ToolStripItem[] { this.deleteToolStripMenuItem });",
    "this.deleteToolStripMenuItem.Click += new System.EventHandler(this.deleteToolStripMenuItem_Click);",
    ctl("statusStrip1", "StatusStrip", { Location: "new System.Drawing.Point(0, 260)" }),
    ctl("tsslReady", "ToolStripStatusLabel", { Text: '"Ready"' }),
    "this.statusStrip1.Items.AddRange(new System.Windows.Forms.ToolStripItem[] { this.tsslReady });",
    ctl("btnNext", "Button", { Text: '"Next >"', Location: "new System.Drawing.Point(0, 290)" }),
    "this.btnNext.Click += this.btnNext_Click;",
    "this.AcceptButton = this.btnGone;",
    "this.Controls.Add(this.grpExport); this.Controls.Add(this.lblClass); this.Controls.Add(this.txtClass); this.Controls.Add(this.chkSearch); this.Controls.Add(this.lblPlain);",
    "this.Controls.Add(this.lblGhost); this.Controls.Add(this.txtBeside); this.Controls.Add(this.split); this.Controls.Add(this.toolStrip1); this.Controls.Add(this.listView1); this.Controls.Add(this.statusStrip1); this.Controls.Add(this.btnNext);",
    'this.Text = "Options";',
  ].join("\n"));
  const r = readDesigner(source, "Options.Designer.cs");
  assert.equal(r.controls.get("txtLeft").parent, "split.Panel1"); assert.equal(r.controls.get("listView1").contextMenu, "cmsRows");
  assert.deepEqual(r.controls.get("btnNext").events, [{ event: "Click", handler: "btnNext_Click", line: 65 }], "a handler wired without new EventHandler reads the same");
  const { template, outputs, fields } = lowerForm(r, (n) => notes.push(n));
  assert.ok(/^<div class="winform">/.test(template) && !/type="submit"/.test(template), "an AcceptButton naming no placed button makes no form");
  assert.ok(notes.some((n) => /the AcceptButton btnGone is not a button the designer placed, so the form has no submit/.test(n)));
  assert.match(template, /<legend>Export<\/legend>\n\s*<label><input type="radio" ng-model="exportField" value="default" accesskey="d"> Default<\/label>/, "a group box captioned Export names a field the emitted JavaScript can declare");
  assert.match(template, /<label for="f-class">Class<\/label>\n\s*<input id="f-class" type="text" ng-model="classField">/);
  assert.match(template, /<label><input type="checkbox" ng-model="searchReplace"> Search &amp; Replace<\/label>/, "a doubled ampersand is a literal one and names no access key");
  assert.match(template, /<p>Salt &amp; Pepper<\/p>/, "UseMnemonic false keeps the ampersand as text");
  assert.match(template, /<p ng-show="shown.ghostShown">Ghost<\/p>\n\s*<input id="f-beside" type="text" ng-model="beside">/, "a hidden label labels nothing; the field beside it is named from its own name");
  assert.match(template, /<div class="split-container">\n\s*<div class="panel">\n\s*<input id="f-left" type="text" ng-model="left">\n\s*<\/div>\n\s*<div class="panel">\n\s*<input id="f-right" type="text" ng-model="right">\n\s*<\/div>\n\s*<\/div>/);
  assert.match(template, /<div role="toolbar" aria-label="toolStrip1">\n\s*<button type="button" ng-click="onRun\(\)" accesskey="r">Run<\/button>\n\s*<span role="separator"><\/span>\n\s*<input id="f-filter" type="text" ng-model="filter">\n\s*<\/div>/, "a text box on the strip is a field in the strip's order");
  assert.match(template, /<table class="list-view">\n\s*<thead><tr><th>Name<\/th><\/tr><\/thead>\n\s*<\/table>/, "a list view's column headers are what the designer declared");
  assert.match(template, /<footer class="status-bar">\n\s*<span>Ready<\/span>\n\s*<\/footer>/);
  assert.match(template, /<button type="button" ng-click="onNext\(\)">Next &gt;<\/button>\n\s*<nav class="context-menu" aria-label="rows">\n\s*<ul role="menu">\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onDelete\(\)" accesskey="d">Delete<\/button><\/li>\n\s*<\/ul>\n\s*<\/nav>\n<\/div>$/, "a context menu is rendered after the body and its trigger is named");
  assert.ok(notes.some((n) => /the context menu cmsRows opens on right click of listView1; the port must wire the trigger/.test(n)));
  assert.ok(notes.some((n) => /the list view listView1 has 1 column\(s\) the designer declared \(Name\) and rows the code supplies/.test(n)));
  assert.deepEqual(outputs, ["delete", "next", "run"]); assert.deepEqual(fields, ["exportField", "classField", "searchReplace", "beside", "left", "right", "filter"]);
  assert.doesNotMatch(template, /accesskey=" "/);
  const report = formsReport([{ rel: "Options.Designer.cs", read: r }]);
  assert.match(report, /no title set|title "Options"/); assert.match(report, /\| btnNext \| Button \| Next > \| 0, 290 \|  \|  \|  \| Click → btnNext_Click \|/);
  assert.match(report, /\| lblPlain \| Label \| Salt & Pepper \|/);
  const piped = readDesigner(cs('this.lbl = new System.Windows.Forms.Label();\nthis.lbl.Text = "a | b";\nthis.Controls.Add(this.lbl);', "Pipes"), "Pipes.Designer.cs");
  assert.match(formsReport([{ rel: "Pipes.Designer.cs", read: piped }]), /\| lbl \| Label \| a \\\| b \|/, "a pipe in a caption is escaped in the table");
});

/**
 * The localized half. When a form is Localizable the designer writes every
 * caption, location and size into `<Form>.resx` and loads them back with
 * `resources.ApplyResources`; the reader takes the neutral .resx beside the
 * designer as the designer's other half, applies exactly what was asked for
 * on the controls that asked, names what was present and not asked for, and
 * names the culture variants without opening one.
 */
test("readResx reads a .resx structurally: entries by kind, entities decoded, metadata rows and the header comment's examples set aside", async () => {
  const resx = readResx(await readFile(join(FIXTURES, "Localized.resx"), "utf8"));
  const names = resx.entries.map((e) => e.name);
  assert.equal(resx.entries.length, 44);
  assert.ok(!names.some((n) => n.startsWith(">>") || n.startsWith("&gt;")), "the >> rows are metadata in either spelling");
  assert.ok(!names.some((n) => /^(Name1|Color1|Bitmap1|Icon1)$/.test(n)), "the Visual Studio header comment's example entries are a comment, not entries");
  assert.ok(!names.some((n) => /^(resmimetype|version|reader|writer)$/.test(n)), "resheader rows are not data");
  const by = new Map(resx.entries.map((e) => [e.name, e]));
  assert.equal(by.get("lblName.Text").value, "&Name:"); assert.equal(by.get("lblName.Text").kind, "text"); assert.equal(by.get("lblName.Text").type, null);
  assert.equal(by.get("cboRegion.Items1").value, "Süd", "a numeric entity decodes"); assert.equal(by.get("cboRegion.Items2").value, "Ost & West");
  assert.equal(by.get("lblHint.Text").value, "Hint: <keep> the \"quoted\" 'part'", "the five named entities decode");
  assert.equal(by.get("lblName.Location").value, "12, 15"); assert.equal(by.get("lblName.Location").type, "System.Drawing.Point, System.Drawing");
  assert.equal(by.get("lblHint.Visible").value, "False");
  assert.deepEqual([by.get("pbLogo.Image").kind, by.get("pbLogo.Image").value], ["file", null], "a ResXFileRef is named, its path never kept");
  assert.deepEqual([by.get("imageList1.ImageStream").kind, by.get("imageList1.ImageStream").value], ["binary", null], "a base64 object is named, never decoded");
  assert.deepEqual(readResx("<root><data name=\"a.Text\"><value>x</value></data></root>").entries, [{ name: "a.Text", type: null, kind: "text", value: "x" }]);
  assert.deepEqual(readResx("").entries, []); assert.deepEqual(readResx("<data name=\"loose.Text\"><value>x</value></data>").entries, [], "an entry outside <root> is not a resource");
});

test("the designer half of a localized form: ApplyResources on every control and $this, Items filled from GetString are items in the .resx and not unread", async () => {
  const r = await read("Localized.Designer.cs");
  assert.equal(r.statements, 66); assert.equal(r.controls.size, 12); assert.deepEqual(r.problems, []);
  assert.equal(r.form.localized, true); assert.equal(r.form.text, null);
  for (const n of ["lblName", "txtName", "lblRegion", "cboRegion", "chkNotify", "lblHint", "pbLogo", "btnSave", "btnCancel"]) assert.equal(r.controls.get(n).localized, true, `${n} is passed to ApplyResources`);
  assert.equal(r.controls.get("lblStatic").localized, false); assert.equal(r.controls.get("lblStatic").text, "Static");
  const cbo = r.controls.get("cboRegion");
  assert.equal(cbo.itemsResource, true); assert.deepEqual(cbo.items, []); assert.deepEqual(cbo.unreadProps, [], "resources.GetString in Items.AddRange is a resource, not a literal the scanner failed on");
  assert.deepEqual(r.controls.get("chkNotify").inline.filter((p) => p === "Location"), ["Location"], "an inline Location after ApplyResources is remembered");
  assert.ok(!r.controls.get("btnSave").inline.includes("Location") && !r.controls.get("btnSave").inline.includes("Text"));
  assert.equal(r.controls.get("imageList1").hasImage, false, "ImageStream is not one of the image properties; the component is named as a component");
  // Read alone, with no .resx applied, the form is exactly what it was before this half existed: names stand in and the note says so.
  const notes = [];
  const { template, title } = lowerForm(r, (n) => notes.push(n));
  assert.equal(title, "");
  assert.match(template, /<button type="submit">btnSave<\/button>/); assert.match(template, /<p>lblName<\/p>/, "a label with no caption and no field it names is a paragraph of its name");
  assert.match(template, /<option ng-repeat="option in region(Options|Field)/, "items in a .resx nobody read are a list the port is handed");
  assert.ok(notes.some((n) => /^the text of 9 control\(s\) \(lblName, txtName, lblRegion, cboRegion, chkNotify, lblHint, pbLogo, btnSave, btnCancel\) lives in the \.resx \(resources\.ApplyResources or GetString\); the control names stand in and the port must take each caption from the resource file\.$/.test(n)));
  assert.ok(notes.some((n) => /^the form's own title lives in the \.resx; the port must take it from there\.$/.test(n)));
});

test("the neutral .resx applied: captions, mnemonics, labels, options, a hidden and a disabled control and the title come from it; inline wins; the rest is named", async () => {
  const r = await read("Localized.Designer.cs");
  const summary = applyResx(r, readResx(await readFile(join(FIXTURES, "Localized.resx"), "utf8")), { file: "Localized.resx", cultures: ["Localized.de.resx"] });
  assert.equal(summary, r.resx);
  assert.deepEqual(summary.captions, ["lblName", "lblRegion", "chkNotify", "lblHint", "btnSave", "btnCancel"]); assert.equal(summary.title, true); assert.equal(summary.applied, 35);
  assert.deepEqual(summary.unapplied, ["lblStatic.Text", "lblOld.Text"], "an entry for a control the designer never passed to ApplyResources, or for no control, is present and not applied");
  assert.deepEqual(summary.files, ["pbLogo.Image", "imageList1.ImageStream"]);
  assert.deepEqual([...summary.left], [["lblName", ["AutoSize"]], ["chkNotify", ["Location"]], ["btnSave", ["Font"]], ["$this", ["AutoScaleDimensions", "ClientSize"]]], "names only, never a value");
  assert.equal(r.form.text, "Customer & Co"); assert.equal(r.form.resxText, true);
  assert.equal(r.controls.get("btnSave").text, "&Save"); assert.deepEqual(r.controls.get("btnSave").location, [60, 130]); assert.deepEqual(r.controls.get("btnSave").size, [75, 23]); assert.equal(r.controls.get("btnSave").tabIndex, 6);
  assert.equal(r.controls.get("btnCancel").enabled, false); assert.equal(r.controls.get("lblHint").visible, false);
  assert.deepEqual(r.controls.get("chkNotify").location, [12, 70], "the designer set Location inline after ApplyResources, so the .resx does not override it");
  assert.deepEqual(r.controls.get("cboRegion").items, ["Nord", "Süd", "Ost & West"]); assert.equal(r.controls.get("cboRegion").resxItems, true);
  assert.equal(r.controls.get("lblStatic").text, "Static", "a control with no ApplyResources keeps its inline text whatever the .resx says");
  assert.equal(r.controls.get("txtName").text, null, "no Text entry, no text: a text box's empty value is not invented");
  assert.equal(r.controls.get("pbLogo").hasImage, false, "the file reference is named, not applied");

  const notes = [];
  const { template, outputs, fields, title, usesNgFor, usesNgIf } = lowerForm(r, (n) => notes.push(n));
  assert.equal(title, "Customer & Co"); assert.deepEqual(outputs, ["cancel", "ok"]); assert.deepEqual(fields, ["name", "region", "sendNotifications"]);
  assert.equal(usesNgFor, false, "options from the .resx are options, not a list the port is handed"); assert.equal(usesNgIf, true);
  assert.match(template, /^<form class="winform" ng-submit="onOk\(\{ name: name, region: region, sendNotifications: sendNotifications \}\)">\n  <h2>Customer &amp; Co<\/h2>\n  <label for="f-name">Name<\/label>\n  <input id="f-name" type="text" ng-model="name">/, "the .resx caption labels the field beside it exactly as an inline one would, mnemonic and colon gone");
  assert.match(template, /<label for="f-region">Region<\/label>\n\s*<select id="f-region" ng-model="region">\n\s*<option>Nord<\/option>\n\s*<option>Süd<\/option>\n\s*<option>Ost &amp; West<\/option>\n\s*<\/select>/, "Items, Items1, Items2 are the options in index order");
  assert.match(template, /<label><input type="checkbox" ng-model="sendNotifications" accesskey="n"> Send notifications<\/label>/, "the mnemonic in a .resx caption is the access key");
  assert.match(template, /<p ng-show="shown\.hintKeepTheQuotedPartShown">Hint: &lt;keep&gt; the &quot;quoted&quot; 'part'<\/p>\n\s*<p>Static<\/p>/, "Visible False in the .resx hides the control by a named state; the entities decode once");
  assert.match(template, /<button type="submit" accesskey="s">Save<\/button>\n\s*<button type="button" ng-click="onCancel\(\)" disabled>Cancel<\/button>\n<\/form>$/, "Enabled False in the .resx disables the control");
  assert.doesNotMatch(template, /btnSave|lblName|Speichern|Kunde/, "no name stands in and no German is read");
  assert.ok(notes.some((n) => n === "the text of 6 control(s) (lblName, lblRegion, chkNotify, lblHint, btnSave, btnCancel) came from Localized.resx beside the designer (resources.ApplyResources); culture variant(s) Localized.de.resx sit beside it and were not read, because the language the port speaks is a decision about the product."), notes.join("\n"));
  assert.ok(notes.some((n) => n === "the form's own title came from Localized.resx."));
  assert.ok(notes.some((n) => n === "2 entries in Localized.resx (lblStatic.Text, lblOld.Text) name no control the designer passed to ApplyResources and are not applied; WINFORMS.md lists them."));
  assert.ok(notes.some((n) => n === "2 resource(s) in Localized.resx (pbLogo.Image, imageList1.ImageStream) are a file or a serialized object, named and not decoded."));
  assert.ok(notes.some((n) => /1 control\(s\) start hidden \(Hint:/.test(n))); assert.ok(notes.some((n) => /1 control\(s\) start disabled \(Cancel\)/.test(n)));
  assert.ok(!notes.some((n) => /lives in the \.resx/.test(n)), "with the .resx read, nothing is left living in it unread");
  assert.ok(!notes.some((n) => /could not be read exactly/.test(n)));
  assert.deepEqual(buildIr(template).collections, []);
  const jsx = translate(template).jsx;
  assert.match(jsx, /accessKey="s"/); assert.match(jsx, /Customer & Co/);

  const report = formsReport([{ rel: "Localized.Designer.cs", read: r }]);
  assert.match(report, /title "Customer & Co" \(from Localized\.resx\), accepts on btnSave, cancels on btnCancel\. 12 control\(s\), 66 statement\(s\) read, C#\./);
  assert.match(report, /\nLocalized: the caption\(s\) of lblName, lblRegion, chkNotify, lblHint, btnSave, btnCancel and the title came from Localized\.resx, 35 entries applied\. Culture variant\(s\) named and not read: Localized\.de\.resx\. Present and not applied \(no ApplyResources on that control\): lblStatic\.Text, lblOld\.Text\. File or serialized resource\(s\), named and not decoded: pbLogo\.Image, imageList1\.ImageStream\. Left in the file, by property name: lblName \(AutoSize\); chkNotify \(Location\); btnSave \(Font\); \$this \(AutoScaleDimensions, ClientSize\)\.\n/);
  assert.match(report, /\| lblName \| Label \| Name \(from \.resx\) \| 12, 15 \| 38 × 13 \| 0 \|  \|  \|/, "a caption from the .resx says so; its location, size and tab index came with it");
  assert.match(report, /\| txtName \| TextBox \|  \| 60, 12 \| 200 × 20 \| 1 \|  \|  \|/, "a text box the .resx gives no Text has none, and is not said to have one in the file");
  assert.match(report, /\| cboRegion \| ComboBox \| \(3 item\(s\) from \.resx\) \| 60, 40 \| 200 × 21 \| 3 \|  \|  \|/);
  assert.match(report, /\| chkNotify \| CheckBox \| Send notifications \(from \.resx\) \| 12, 70 \| 124 × 17 \| 4 \|  \|  \|/, "the inline location, not the .resx one");
  assert.match(report, /\| lblStatic \| Label \| Static \| 12, 115 \|/); assert.match(report, /\| btnCancel \| Button \| Cancel \(from \.resx\) \| 141, 130 \| 75 × 23 \| 7 \|/);
  assert.doesNotMatch(report, /999, 999|Segoe|logo\.png|AAEAAAD|Speichern|Kunde|Not asked for|old label/, "no value other than a caption or an item is printed, and the German file is not read");
});

test("the .resx corner cases: a control asked for with no Text entry, a form with no $this.Text, unreadable values, a HeaderText, and no .resx at all", () => {
  const body = cs([
    ctl("btnGo", "Button"), 'resources.ApplyResources(this.btnGo, "btnGo");',
    ctl("lblA", "Label"), 'resources.ApplyResources(this.lblA, "lblA");',
    ctl("grid", "DataGridView"), ctl("colName", "DataGridViewTextBoxColumn"), 'resources.ApplyResources(this.colName, "colName");',
    "this.grid.Columns.AddRange(new System.Windows.Forms.DataGridViewColumn[] { this.colName });",
    'resources.ApplyResources(this, "$this");',
    "this.Controls.Add(this.btnGo); this.Controls.Add(this.lblA); this.Controls.Add(this.grid);",
  ].join("\n"), "Corner");
  const resx = readResx([
    '<root><data name="lblA.Text"><value>Alpha</value></data><data name="lblA.Location"><value>not a point</value></data>',
    '<data name="btnGo.Visible"><value>maybe</value></data><data name="colName.HeaderText"><value>Name</value></data>',
    '<data name="$this.ClientSize"><value>1, 1</value></data></root>',
  ].join(""));
  const r = readDesigner(body, "Corner.Designer.cs");
  applyResx(r, resx, { file: "Corner.resx" });
  assert.equal(r.form.text, null); assert.equal(r.form.resxText, undefined);
  assert.deepEqual(r.controls.get("lblA").unreadProps, ["Location"]); assert.deepEqual(r.controls.get("btnGo").unreadProps, ["Visible"]);
  assert.equal(r.controls.get("colName").headerText, "Name");
  const notes = [];
  const { template, title } = lowerForm(r, (n) => notes.push(n));
  assert.equal(title, ""); assert.match(template, /^<div class="winform">\n  <button type="button" ng-click="onGo\(\)">btnGo<\/button>\n  <p>Alpha<\/p>\n  <table class="data-grid-view">\n    <thead><tr><th>Name<\/th><\/tr><\/thead>/, "with no locations the controls keep declaration order; a caption the .resx lacks keeps the name; a column head the .resx gives is the head");
  assert.ok(notes.some((n) => n === "the form's own title lives in the .resx and Corner.resx carries no $this.Text; the class name stands in."));
  assert.ok(notes.some((n) => n === "1 control(s) (btnGo) take their text from the .resx and Corner.resx carries no Text for them; the control names stand in."));
  assert.ok(notes.some((n) => n === "the text of 2 control(s) (lblA, colName) came from Corner.resx beside the designer (resources.ApplyResources); no culture variant sits beside it."), notes.join("\n"));
  assert.ok(notes.some((n) => /lblA: Location could not be read exactly and left out/.test(n)) && notes.some((n) => /btnGo: Visible could not be read exactly and left out/.test(n)));
  assert.equal(formsReport([{ rel: "Corner.Designer.cs", read: r }]).includes("| btnGo | Button | (no Text in Corner.resx) |"), true);
  // No .resx at all: the read is untouched and the notes are the ones a designer file alone has always produced.
  const alone = readDesigner(body, "Corner.Designer.cs");
  const aloneNotes = [];
  lowerForm(alone, (n) => aloneNotes.push(n));
  assert.equal(alone.resx, undefined);
  assert.ok(aloneNotes.some((n) => n === "the text of 3 control(s) (btnGo, lblA, colName) lives in the .resx (resources.ApplyResources or GetString); the control names stand in and the port must take each caption from the resource file."));
  assert.ok(aloneNotes.some((n) => n === "the form's own title lives in the .resx; the port must take it from there."));
});
