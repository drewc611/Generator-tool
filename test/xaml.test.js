import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildIr, detectDialect } from "../plugins/dsp-ir/ir.js";
import { decodeEntities, parseExtension, readBinding, resourceKey, staticMember } from "../plugins/input-xaml/extension.js";
import { gridShape, kindOf, lowerXaml, mnemonic, ordered, parseXaml, pathJs } from "../plugins/input-xaml/lower.js";
import { translate } from "../plugins/output-react/template.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A XAML window is a legacy front end whose interface is data: a tree of
 * panels and controls, each naming its bindings in its attributes, with the
 * code behind holding nothing the layout needs. input-xaml parses it
 * structurally and lowers each Window, Page, UserControl and ContentPage onto
 * the shared dialect with the same choices input-exe makes, so a dialog from
 * 2008 comes out the far end as the same React, Vue and Svelte every other
 * reader produces. What the markup cannot say is named.
 */

const FIXTURES = join(ROOT, "test/fixtures/xaml");
const lower = async (file, notes = []) => lowerXaml(await readFile(join(FIXTURES, file), "utf8"), file, (n) => notes.push(n));

test("markup extensions are read into their parts, nested, with escapes and entities honoured", () => {
  assert.deepEqual(parseExtension("{Binding UserName}"), { type: "Binding", positional: ["UserName"], named: {} });
  const b = readBinding(parseExtension("{Binding Path=IsBusy, Mode=OneWay, Converter={StaticResource BoolToVis}, StringFormat='{}{0:n0} items'}"));
  assert.equal(b.path, "IsBusy"); assert.equal(b.mode, "OneWay"); assert.equal(resourceKey(b.converter), "BoolToVis"); assert.equal(b.format, "{}{0:n0} items");
  assert.equal(readBinding(parseExtension("{x:Bind ViewModel.Query, Mode=TwoWay}")).compiled, true, "the namespace prefix is the file's, not the type's");
  assert.equal(readBinding(parseExtension("{Binding ElementName=Slider1, Path=Value}")).elementName, "Slider1");
  assert.equal(readBinding(parseExtension("{Binding}")).path, "", "a bare Binding binds the data context itself");
  assert.equal(staticMember(parseExtension("{x:Static res:Strings.Login}")), "Strings.Login");
  assert.equal(resourceKey(parseExtension("{DynamicResource ResourceKey=Accent}")), "Accent");
  assert.equal(parseExtension("{}{not a binding}"), null, "a {} prefix escapes the brace");
  assert.equal(parseExtension("{Binding X} and more"), null, "text after the closing brace is a caption with a brace in it");
  assert.equal(parseExtension("{Binding X"), null, "a brace that never closes is text");
  assert.equal(readBinding(parseExtension("{StaticResource X}")), null);
  assert.equal(decodeEntities("South &amp; East &lt;3 &#x41;&#66; &quot;q&quot;"), 'South & East <3 AB "q"');
  assert.equal(pathJs("ViewModel.Query"), "viewModel.query"); assert.equal(pathJs("Items[0].ID"), "items[0].id"); assert.equal(pathJs("(Grid.Row)"), "grid.row"); assert.equal(pathJs("Current/Name"), "current.name");
  assert.deepEqual(mnemonic("_User name:"), { text: "User name", accesskey: "u" });
  assert.deepEqual(mnemonic("Search __ Replace"), { text: "Search _ Replace", accesskey: null }, "a doubled underscore is a literal one and names no key");
  assert.deepEqual(mnemonic("R__D _Options..."), { text: "R_D Options", accesskey: "o" });
  assert.equal(kindOf("passwordbox"), "input"); assert.equal(kindOf("groupbox"), "group"); assert.equal(kindOf("verticalstacklayout"), "container"); assert.equal(kindOf("webbrowser"), "unknown");
});

test("the tree is parsed structurally: namespaces, property elements set aside, a Grid ordered by row then column", () => {
  const { root, x, flavor } = parseXaml(`<?xml version="1.0"?><Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:y="http://schemas.microsoft.com/winfx/2006/xaml" y:Class="A.B">
    <!-- <Button Content="in a comment"/> -->
    <Grid><Grid.RowDefinitions><RowDefinition/><RowDefinition/></Grid.RowDefinitions><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition/><ColumnDefinition/></Grid.ColumnDefinitions>
      <TextBox Grid.Row="1" Grid.Column="0" Name="c"/><TextBox Grid.Row="0" Grid.Column="1" Name="b"/><TextBox Grid.Row="0" Grid.Column="0" Name="a"/><TextBox Name="a0"/>
      <Button><Button.Content>Go</Button.Content></Button>
    </Grid></Window>`);
  assert.equal(x, "y", "the xaml namespace prefix is whatever the file bound");
  assert.equal(flavor, "wpf");
  const grid = root.children[0];
  assert.equal(grid.name, "Grid", "the tree keeps the file's spelling of every tag");
  assert.equal(grid.children.length, 5, "property elements are not children");
  assert.deepEqual(gridShape(grid), { rows: 2, columns: 3 });
  assert.deepEqual(ordered(grid).map((n) => n.el.attrs.find((a) => a.name === "Name")?.value ?? n.tag), ["a", "a0", "button", "b", "c"], "row then column; a child placed in no cell sits in the first, the file's order breaking ties");
  assert.equal(grid.children[4].props.content.text, "Go");
  assert.deepEqual(gridShape(parseXaml(`<Grid xmlns="http://schemas.microsoft.com/dotnet/2021/maui" RowDefinitions="Auto,*,Auto" ColumnDefinitions="*,*"/>`).root), { rows: 3, columns: 2 }, "MAUI spells the definitions as an attribute");
  assert.equal(parseXaml(`<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"/>`).flavor, "maui");
  assert.deepEqual(ordered(parseXaml(`<Canvas xmlns="x"><Button Canvas.Left="50" Canvas.Top="10" Name="right"/><Button Canvas.Left="0" Canvas.Top="10" Name="left"/><Button Canvas.Top="0" Name="top"/></Canvas>`).root).map((n) => n.el.attrs.find((a) => a.name === "Name").value), ["top", "left", "right"], "a Canvas orders by top then left");
});

test("a WPF window lowers onto the dialect: labels, fields, a group of radios, selects, a menu bar, the buttons", async () => {
  const notes = [];
  const { screen, layout } = await lower("LoginWindow.xaml", notes);
  const { template, outputs, fields, title, usesTwoWay, usesNgFor, usesNgIf, selector, className } = screen;
  assert.equal(selector, "login-window"); assert.equal(className, "LoginWindow"); assert.equal(title, "Log in"); assert.equal(screen.readBy, "xaml");
  assert.equal(usesTwoWay, true); assert.equal(usesNgFor, true); assert.equal(usesNgIf, true);
  assert.deepEqual(outputs, ["about", "cancel", "exit", "help", "ok", "open"], "outputs are events; the emitter names the handler on<Event>");
  assert.deepEqual(fields, ["userName", "password", "rememberMe", "role", "region", "branch", "notes"]);
  assert.match(template, /^<form class="window" ng-submit="onOk\(\{ userName: userName, password: password, rememberMe: rememberMe, role: role, region: region, branch: branch, notes: notes \}\)">\n  <h2>Log in<\/h2>/, "the default button is the form's submit and hands every field back by name, as input-exe's OK does");
  assert.match(template, /<nav class="menu-bar" aria-label="menu">\n\s*<ul role="menubar">\n\s*<li>\n\s*<button type="button" accesskey="f" aria-haspopup="menu">File<\/button>\n\s*<ul role="menu">\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onOpen\(\)" accesskey="o">Open<\/button><\/li>\n\s*<li role="separator"><\/li>\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onExit\(\)" accesskey="x">Exit<\/button><\/li>/, "a Menu is a menu bar: the underscore is the access key, the ellipsis is gone, Click and Command both name the event");
  assert.match(template, /ng-click="onAbout\(\)" accesskey="a" disabled>About</);
  assert.match(template, /<\/nav>\n  <label for="f-user-name" accesskey="u">User name<\/label>\n  <input id="f-user-name" type="text" ng-model="userName">/, "the label written after its field in the file comes first in the grid, and its Target names the field");
  assert.match(template, /<label for="f-password">Password<\/label>\n  <input id="f-password" type="password" ng-model="password">/, "a PasswordBox with no name is named by its label");
  assert.match(template, /<label><input type="checkbox" ng-model="rememberMe" accesskey="r"> Remember me<\/label>/);
  assert.match(template, /<fieldset>\n\s*<legend>Role<\/legend>\n\s*<label><input type="radio" ng-model="role" value="clerk" accesskey="c"> Clerk<\/label>\n\s*<label><input type="radio" ng-model="role" value="manager" accesskey="m"> Manager<\/label>\n\s*<\/fieldset>/, "a GroupBox is a fieldset and radios share the GroupName as their model");
  assert.match(template, /<label for="f-region">Region<\/label>\n  <select id="f-region" ng-model="region">\n\s*<option>North<\/option>\n\s*<option>South &amp; East<\/option>\n\s*<\/select>/, "literal items are real options, from Content or the element's text");
  assert.match(template, /<select id="f-branch" ng-model="branch">\n\s*<option ng-repeat="item in branches">\{\{ item\.name \}\}<\/option>\n\s*<\/select>/, "a bound ItemsSource is a real input and DisplayMemberPath names the shown member");
  assert.match(template, /<p ng-show="shown.lockedOutShown">Locked out<\/p>/, "a collapsed control is shown by a named state");
  assert.match(template, /<p ng-show="isBusy">\{\{ status \}\}<\/p>/, "a bound Visibility shows on the value; the converter is named, not read");
  assert.match(template, /<textarea id="f-notes" ng-model="notes" readonly><\/textarea>/, "AcceptsReturn is a textarea and IsReadOnly is readonly");
  assert.match(template, /<button type="button" ng-click="onHelp\(\)" accesskey="h" disabled>Help<\/button>\n  <button type="submit" ng-disabled="!canLogin">Log in<\/button>\n  <button type="button" ng-click="onCancel\(\)">Cancel<\/button>\n<\/form>$/, "a literal IsEnabled is the attribute, a bound one is ng-disabled inverted, IsCancel is onCancel");
  assert.doesNotMatch(template, /RowDefinition|Style|Resources|Window_Loaded|Login_Click/, "definitions, styles, resources and handler names never reach the template");
  assert.equal(detectDialect(template).name, "angularjs", "the lowering is read as the dialect it targets");
  const ir = buildIr(template);
  assert.deepEqual(ir.collections, [], "a select's options are a list the screen is handed, not the data it is of, so no empty state guards on them");
  assert.deepEqual(ir.reads, ["branches", "canLogin", "isBusy", "onAbout", "onCancel", "onExit", "onHelp", "onOk", "onOpen", "shown", "status"]);
  const jsx = translate(template).jsx;
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(/, "ng-submit swallows the navigation in the port");
  assert.match(jsx, /disabled=\{!canLogin\}/); assert.match(jsx, /accessKey="u"/);
  assert.ok(notes.some((n) => /1 control\(s\) start collapsed \(Locked out\)/.test(n)));
  assert.ok(notes.some((n) => /1 control\(s\) start disabled \(Help\)/.test(n)));
  assert.ok(notes.some((n) => /converter that is not read \(TextBlock Visibility \(BoolToVis\)\)/.test(n)));
  assert.ok(notes.some((n) => /field\(s\) notes were bound one way/.test(n)));
  assert.ok(notes.some((n) => /2 resource\(s\) declared in the window \(FieldStyle \(Style\), BoolToVis \(BooleanToVisibilityConverter\)\)/.test(n)));
  assert.ok(notes.some((n) => /1 resource\(s\) referenced \(FieldStyle\)/.test(n)));
  assert.ok(notes.some((n) => /Loaded="Window_Loaded" on the window/.test(n)), "a handler the dialect has no event for is a behaviour named");
  assert.ok(notes.some((n) => /1 field\(s\) \(role\) declare an initial value in the markup; the port starts them empty and the values are not reprinted/.test(n)));
  assert.ok(notes.some((n) => /the default button Log in is the form's submit; the port raises onOk with every field, not onLogin/.test(n)));
  assert.ok(notes.every((n) => n.startsWith("LoginWindow.xaml")), "every note names its file");
  const report = layout.join("\n");
  assert.match(report, /^## LoginWindow\.xaml\n\nWindow `Ledger\.Desktop\.LoginWindow`, title "Log in", WPF or UWP namespace, 7 field\(s\), 6 event\(s\)\.\n\nResources: FieldStyle \(Style\), BoolToVis \(BooleanToVisibilityConverter\)\./);
  assert.match(report, /- DockPanel\n  - Menu \[dock Top\]\n    - MenuItem "_File"\n      - MenuItem "_Open"\n      - Separator\n      - MenuItem "E_xit" Command=\{Binding ExitCommand\}/);
  assert.match(report, /  - Grid \(10 row\(s\) × 2 column\(s\)\)\n    - Label "_User name" \[row 0, column 0\] Target=\{Binding ElementName=UserNameBox\}\n    - TextBox `UserNameBox` \[row 0, column 1\] Text=\{Binding UserName\} Style=\{StaticResource FieldStyle\}/, "the layout report carries the grid, the cell and every binding as written");
  assert.match(report, /- GroupBox "Role" \[row 3, columnspan 2\]\n      - StackPanel\n        - RadioButton "_Clerk"/);
});

test("a UWP page lowers: x:Bind, a Header as label, a row template, a ProgressRing, a Pivot, a HyperlinkButton", async () => {
  const notes = [];
  const { screen } = await lower("MainPage.xaml", notes);
  const { template } = screen;
  assert.equal(screen.selector, "main-page"); assert.equal(screen.title, "main page", "a Page with no Title is named by its class");
  assert.deepEqual(screen.outputs, ["open"]); assert.deepEqual(screen.fields, [], "a dotted model path names the view model the port is handed, not the screen's own state");
  assert.match(template, /^<div class="page">\n  <p>\{\{ strings\.pageTitle \}\}<\/p>/, "x:Uid text comes from a resource file the port is handed");
  assert.match(template, /<label for="f-view-model-query">Search<\/label>\n  <input id="f-view-model-query" type="text" ng-model="viewModel\.query" placeholder="Find an account">/, "a Header labels its own field and PlaceholderText is the placeholder");
  assert.match(template, /<progress ng-show="viewModel\.isBusy"><\/progress>/, "an indeterminate ring shows while active");
  assert.match(template, /<ul class="list-view">\n\s*<li ng-repeat="item in viewModel\.accounts">\n\s*<span>\{\{ item\.name \}\}<\/span>\n\s*<span>\{\{ item\.balance \}\}<\/span>\n\s*<\/li>\n\s*<\/ul>/, "a DataTemplate of text is the row, its bindings in the row's scope, a horizontal panel's text inline");
  assert.match(template, /<button type="button" class="link" ng-click="onOpen\(\)">Open ledger<\/button>/);
  assert.match(template, /<label><input type="checkbox" ng-model="viewModel\.showClosed"> Show closed<\/label>/, "a ToggleSwitch is a checkbox captioned by its Header");
  assert.match(template, /<section aria-label="Summary">\n\s*<p>Totals<\/p>\n\s*<\/section>\n\s*<section aria-label="Detail">\n\s*<p>Lines<\/p>\n\s*<\/section>\n<\/div>$/, "every tab is a section named by its header");
  assert.ok(notes.some((n) => /2 handler\(s\) are wired in code behind that is not read \(TextChanged="Query_TextChanged" on TextBox; SelectionChanged="Accounts_SelectionChanged" on ListView\)/.test(n)));
  assert.ok(notes.some((n) => /TextBlock x:Uid PageTitle takes its text from a resource file/.test(n)));
  assert.ok(notes.some((n) => /1 tab control\(s\) render every tab as a section; which is shown is state the port drives/.test(n)));
  assert.ok(notes.some((n) => /1 resource\(s\) referenced \(TitleTextBlockStyle\)/.test(n)));
  assert.ok(!notes.some((n) => /ThemeResource|ApplicationPageBackground/.test(n)), "the page background is a theme brush, not a screen's concern");
  const ir = buildIr(template);
  assert.deepEqual(ir.collections, ["viewModel.accounts"], "a list the page is of is the collection the empty state guards on");
});

test("a MAUI page lowers with no mnemonics: Entry keyboards, Pickers literal and bound, a Switch named by its neighbour, a Command", async () => {
  const notes = [];
  const { screen, layout } = await lower("SettingsPage.xaml", notes);
  const { template } = screen;
  assert.equal(screen.selector, "settings-page"); assert.equal(screen.title, "Settings");
  assert.deepEqual(screen.outputs, ["reset", "save"]); assert.deepEqual(screen.fields, ["email", "pin", "currency", "themeIndex", "notify", "limit"]);
  assert.match(template, /^<div class="page">\n  <h2>Settings<\/h2>\n  <p>Account<\/p>\n  <label for="f-email">Email<\/label>\n  <input id="f-email" type="email" ng-model="email" placeholder="Email">\n  <input id="f-pin" type="password" ng-model="pin" maxlength="4" placeholder="PIN">/, "a heading before a label is text, Keyboard names the type, IsPassword is a password, MaxLength travels");
  assert.match(template, /<label for="f-currency">Currency<\/label>\n  <select id="f-currency" ng-model="currency">\n\s*<option ng-repeat="item in currencies">\{\{ item \}\}<\/option>\n\s*<\/select>/);
  assert.match(template, /<label for="f-theme-index">Theme<\/label>\n  <select id="f-theme-index" ng-model="themeIndex">\n\s*<option>Light<\/option>\n\s*<option>Dark<\/option>\n\s*<\/select>/, "Picker.Items of x:String are options and an unlabelled Picker's Title is its label");
  assert.match(template, /<label><input type="checkbox" ng-model="notify"> Notifications<\/label>/, "the Label beside a captionless Switch is its caption");
  assert.doesNotMatch(template, /<p>Notifications<\/p>/);
  assert.match(template, /<input id="f-limit" type="range" ng-model="limit" min="0" max="10">/);
  assert.match(template, /<span class="image" role="img" aria-label="image"><\/span>\n  <progress ng-show="isSaving"><\/progress>/);
  assert.match(template, /<button type="button" ng-click="onSave\(\)" ng-disabled="!canSave">Save<\/button>\n  <button type="button" ng-click="onReset\(\)">\{\{ strings\.reset \}\}<\/button>\n<\/div>$/, "a Command names the event without its suffix, Clicked without its, and x:Static text is a string the port is handed");
  assert.ok(notes.some((n) => /1 image\(s\) are placeholders/.test(n)));
  assert.ok(notes.some((n) => /Button Text is x:Static Strings\.Reset/.test(n)));
  assert.match(layout.join("\n"), /Page `Ledger\.Mobile\.SettingsPage`, title "Settings", MAUI or Xamarin\.Forms namespace, 6 field\(s\), 2 event\(s\)\./);
  assert.match(layout.join("\n"), /- Picker "Theme" SelectedIndex=\{Binding ThemeIndex\}\n      - x:String "Light"/);
});

test("what is not a screen is named, never guessed: a resource dictionary, an application, a root with no class, an empty file", async () => {
  const notes = [];
  const { screen, layout } = await lower("Theme.xaml", notes);
  assert.equal(screen, null);
  assert.deepEqual(notes, ["Theme.xaml is a resource dictionary, not a screen: 3 resource(s) declared (AccentBrush (SolidColorBrush), FieldStyle (Style), Button (Style)); styles and templates are not read and every screen that used them is named where it did."]);
  assert.match(layout.join("\n"), /^## Theme\.xaml\n\nResourceDictionary, 3 resource\(s\)/);
  const app = []; lowerXaml(`<Application x:Class="Ledger.App" xmlns="p" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Application.Resources><Style x:Key="S"/></Application.Resources></Application>`, "App.xaml", (n) => app.push(n));
  assert.match(app[0], /^App\.xaml is the application definition, not a screen: 1 resource\(s\) declared \(S \(Style\)\)/);
  const bare = []; assert.equal(lowerXaml(`<DataTemplate xmlns="p"><TextBlock Text="x"/></DataTemplate>`, "Row.xaml", (n) => bare.push(n)).screen, null);
  assert.match(bare[0], /the root <DataTemplate> is not a window, page or control and declares no x:Class/);
  const empty = []; assert.equal(lowerXaml("", "Empty.xaml", (n) => empty.push(n)).screen, null); assert.match(empty[0], /no root element/);
  const partial = lowerXaml(`<Grid x:Class="A.Shell" xmlns="p" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Button Content="Go" Click="Go_Click"/></Grid>`, "Shell.xaml");
  assert.equal(partial.screen.selector, "shell", "a root of any kind with an x:Class is a screen; the class says so");
});

test("the XAML in a source tree becomes screens, LAYOUT.md and notes, and ports to React with every state", async (t) => {
  const run = await runPipeline({ src: FIXTURES, shots: join(FIXTURES, "no-shots") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.deepEqual(run.ctx.screens.map((s) => s.selector).sort(), ["login-window", "main-page", "settings-page"]);
  const login = run.ctx.screens.find((s) => s.selector === "login-window");
  assert.equal(login.readBy, "xaml"); assert.equal(login.file, "LoginWindow.xaml"); assert.equal(login.title, "Log in");
  assert.deepEqual(login.inputs, ["branches", "canLogin", "isBusy", "shown", "status"], "fields are the screen's own state; what it reads is what it is handed");
  assert.deepEqual(login.outputs, ["about", "cancel", "exit", "help", "ok", "open"]);
  assert.equal(login.fields, undefined, "the fields list is the reader's own, not a screen field other plugins read");
  const main = run.ctx.screens.find((s) => s.selector === "main-page");
  assert.deepEqual(main.inputs, ["strings", "viewModel"], "a view model bound by x:Bind is one input the page is handed");
  const jsx = await readFile(join(run.out, "src/features/LoginWindow/LoginWindow.jsx"), "utf8");
  assert.match(jsx, /export default function LoginWindow\(\{ branches, canLogin, isBusy, shown, status, onAbout, onCancel, onExit, onHelp, onOk, onOpen, loading, error, onRetry \}\)/);
  assert.match(jsx, /No collection is bound, so the empty state cannot occur/, "an empty option list does not blank the window");
  assert.match(jsx, /if \(loading\) return/); assert.match(jsx, /if \(error\)/);
  assert.match(jsx, /const \[userName, setUserName\] = useState\(""\);/); assert.match(jsx, /const \[role, setRole\] = useState\(""\);/); assert.match(jsx, /const \[notes, setNotes\] = useState\(""\);/);
  assert.match(jsx, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onOk\(\{ userName: userName, password: password/, "the port prevents the navigation the original never had");
  assert.match(jsx, /accessKey="u"/);
  const mainJsx = await readFile(join(run.out, "src/features/MainPage/MainPage.jsx"), "utf8");
  assert.match(mainJsx, /export default function MainPage\(\{ strings, viewModel, onOpen, loading, error, onRetry \}\)/);
  assert.match(mainJsx, /if \(!viewModel\.accounts \|\| viewModel\.accounts\.length === 0\)/, "a page that is of its list has an empty state for it");
  assert.match(mainJsx, /viewModel\.accounts\.map\(\(item\)/);
  const layout = await readFile(join(run.out, "LAYOUT.md"), "utf8");
  assert.match(layout, /^# Layout\n\nEvery XAML file read, as the panel tree it declares/);
  for (const h of ["## LoginWindow.xaml", "## MainPage.xaml", "## SettingsPage.xaml", "## Theme.xaml"]) assert.ok(layout.includes(h), `${h} is in LAYOUT.md`);
  assert.match(layout, /- Grid \(4 row\(s\) × 0 column\(s\)\)\n  - TextBlock \[row 0\] Style=\{StaticResource TitleTextBlockStyle\}/);
  assert.match(layout, /- ListView \[row 2\] ItemsSource=\{x:Bind ViewModel\.Accounts\}\n    - DataTemplate\n      - StackPanel\n        - TextBlock Text=\{x:Bind Name\}/);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /Theme\.xaml is a resource dictionary, not a screen/);
  assert.match(notes, /LoginWindow\.xaml: 1 control\(s\) start collapsed \(Locked out\)/);
  assert.match(notes, /SettingsPage\.xaml: 1 caption\(s\) come from resources/);
  assert.ok(!/Password|Login_Click|admin/.test(notes.replace(/PasswordBox|Password:/g, "")), "no handler name or value reaches the notes as anything but a caption");
  const readers = await readFile(join(run.out, "READERS.md"), "utf8");
  assert.match(readers, /LoginWindow\.xaml/); assert.match(readers, /xaml/);
  assert.ok(!run.ctx.report.unverified.some((n) => /no reader claimed/.test(n) && /xaml/.test(n)), "no XAML file is an unread markup file");
});

/**
 * The review pass, over this reader: a caption spelling a keyword, a
 * DataGrid's columns, a context menu, an expander, a tab control, a custom
 * element from the app's own namespace, bindings that reach outside the data
 * context, a second default button, a select with nothing to show, a resource
 * as the list, a TreeView, and inline Runs with a Hyperlink.
 */
test("the review pass: keywords, a DataGrid, a context menu, reaching bindings, custom elements, inline runs", () => {
  const notes = [];
  const { screen } = lowerXaml(`<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:local="clr-namespace:Ledger" x:Class="Ledger.Options" Title="{Binding WindowTitle}" DataContext="{StaticResource Locator}">
    <StackPanel>
      <Label Content="Class:"/><TextBox/>
      <TextBlock>Hello <Run Text="{Binding Name}"/><LineBreak/><Bold>world</Bold> <Hyperlink Click="Docs_Click" NavigateUri="https://example.test/docs">Docs</Hyperlink></TextBlock>
      <DataGrid ItemsSource="{Binding Rows}" AutoGenerateColumns="False">
        <DataGrid.Columns>
          <DataGridTextColumn Header="Name" Binding="{Binding Name}"/>
          <DataGridCheckBoxColumn Header="Paid" Binding="{Binding IsPaid}"/>
          <DataGridTemplateColumn Header="Actions"/>
        </DataGrid.Columns>
      </DataGrid>
      <DataGrid ItemsSource="{Binding Auto}"/>
      <ListBox x:Name="Tags" SelectionMode="Multiple"/>
      <ComboBox ItemsSource="{StaticResource Countries}" SelectedValue="{Binding Country}" SelectedValuePath="Code" DisplayMemberPath="Name"/>
      <TreeView x:Name="Folders" ItemsSource="{Binding Folders}"/>
      <Slider x:Name="Zoom" Minimum="1" Maximum="4"/>
      <TextBlock Text="{Binding ElementName=Zoom, Path=Value}"/>
      <TextBlock Text="{Binding DataContext.Title, RelativeSource={RelativeSource AncestorType=Window}}"/>
      <TextBox Text="{Binding Search}" IsEnabled="{Binding CanSearch}" IsReadOnly="{Binding Locked}"/>
      <Expander Header="Advanced"><CheckBox Content="Search __ Replace" IsChecked="{Binding Replace}"/></Expander>
      <TabControl>
        <TabItem Header="General"><Border><TextBlock Text="a"/></Border></TabItem>
        <TabItem Header="Paths"><TextBlock Text="b"/></TabItem>
      </TabControl>
      <local:AddressEditor Address="{Binding Home}" Compact="True" Margin="4"/>
      <WebBrowser x:Name="Preview"/>
      <Grid>
        <Grid.ContextMenu><ContextMenu><MenuItem Header="Cu_t" Command="{Binding CutCommand}"/><MenuItem Header="Paste" Click="Paste_Click" IsCheckable="True" IsChecked="True"/></ContextMenu></Grid.ContextMenu>
        <Button Content="{}{Braces}" Click="Braces_Click"/>
      </Grid>
      <Button Content="Next &gt;" IsDefault="True" Click="Next_Click"/>
      <Button Content="Finish" IsDefault="True" Click="Finish_Click"/>
      <Button Content="Cancel" IsCancel="True"/>
    </StackPanel>
  </Window>`, "Options.xaml", (n) => notes.push(n));
  const { template, outputs } = screen;
  assert.match(template, /<h2>\{\{ windowTitle \}\}<\/h2>/, "a bound title is interpolated");
  assert.match(template, /<label for="f-class-field">Class<\/label>\n  <input id="f-class-field" type="text" ng-model="classField">/, "a label spelling a keyword names a field the emitted JavaScript can declare");
  assert.match(template, /<p>Hello \{\{ name \}\}<br><b>world<\/b> <button type="button" class="link" ng-click="onDocs\(\)">Docs<\/button><\/p>/, "inline runs, breaks, bold and a hyperlink");
  assert.match(template, /<table class="data-grid">\n\s*<thead><tr><th>Name<\/th><th>Paid<\/th><th>Actions<\/th><\/tr><\/thead>\n\s*<tbody>\n\s*<tr ng-repeat="row in rows"><td>\{\{ row\.name \}\}<\/td><td>\{\{ row\.isPaid \}\}<\/td><td><\/td><\/tr>\n\s*<\/tbody>\n\s*<\/table>/, "declared columns are a table with its headers and cells; a template column's cell is empty and named");
  assert.match(template, /<table class="data-grid"><\/table>/, "auto generated columns are a table the data names at runtime");
  assert.match(template, /<select id="f-tags" ng-model="tags" multiple>\n\s*<option ng-repeat="item in tagsOptions">\{\{ item \}\}<\/option>/, "a list with nothing declared is handed its options, as input-exe does");
  assert.match(template, /<select id="f-country" ng-model="country">\n\s*<option ng-repeat="item in countries" ng-value="item\.code">\{\{ item\.name \}\}<\/option>/, "a resource as the list is named as an input; SelectedValuePath is the option's value");
  assert.match(template, /<ul role="tree"><\/ul>/);
  assert.match(template, /<input id="f-zoom" type="range" ng-model="zoom" min="1" max="4">\n  <p>\{\{ zoom\.value \}\}<\/p>\n  <p>\{\{ dataContext\.title \}\}<\/p>/, "an ElementName binding reads the named field; a RelativeSource one reads the path it names");
  assert.match(template, /<input id="f-search" type="text" ng-model="search" ng-readonly="locked" ng-disabled="!canSearch">/);
  assert.match(template, /<details>\n\s*<summary>Advanced<\/summary>\n\s*<label><input type="checkbox" ng-model="replace"> Search _ Replace<\/label>\n\s*<\/details>/, "an Expander is details; a doubled underscore is literal");
  assert.match(template, /<section aria-label="General">\n\s*<p>a<\/p>\n\s*<\/section>\n\s*<section aria-label="Paths">\n\s*<p>b<\/p>\n\s*<\/section>/, "a Border is transparent inside a tab");
  assert.match(template, /<address-editor ng-attr-address="home" compact="True"><\/address-editor>/, "an element from the app's own namespace names another screen, its bindings as bound attributes and its layout attributes dropped");
  assert.match(template, /<div class="web-browser"><\/div>/);
  assert.match(template, /<button type="button" ng-click="onBraces\(\)">\{Braces\}<\/button>\n  <nav class="context-menu" aria-label="context menu">\n\s*<ul role="menubar">\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onCut\(\)" accesskey="t">Cut<\/button><\/li>\n\s*<li role="none"><button type="button" role="menuitem" ng-click="onPaste\(\)" aria-checked="true">Paste<\/button><\/li>/, "an escaped brace is a caption; the context menu lands beside its element");
  assert.match(template, /<button type="submit">Next &gt;<\/button>\n  <button type="button" ng-click="onFinish\(\)">Finish<\/button>\n  <button type="button" ng-click="onCancel\(\)">Cancel<\/button>/, "the first default button is the submit; a second is its own event");
  assert.deepEqual(outputs, ["braces", "cancel", "cut", "docs", "finish", "ok", "paste"]);
  assert.match(template, /ng-submit="onOk\(\{ classField: classField, tags: tags, country: country, zoom: zoom, search: search, replace: replace \}\)"/);
  const has = (re) => assert.ok(notes.some((n) => re.test(n)), `a note matches ${re}`);
  has(/the window's DataContext is set in the markup from the resource Locator; the port is handed its view model/);
  has(/the link Docs navigated to https:\/\/example\.test\/docs; the port raises onDocs instead/);
  has(/the template column Actions of DataGrid has a cell template this reader does not carry/);
  has(/the DataGrid generates its columns from the data at runtime, so the port has a table with no columns/);
  has(/the list\(s\) tags declare no items and bind no source; the port takes each as `<name>Options`/);
  has(/the list country is the resource Countries; the port takes it as `countries`, which it must be handed/);
  has(/the tree view Folders has nodes the code supplies/);
  has(/2 binding\(s\) reach outside the data context \(TextBlock Text reads Zoom\.Value \(ElementName\), lowered to `zoom\.value`; TextBlock Text binds through RelativeSource, outside the data context; lowered to `dataContext\.title`\)/);
  has(/control\(s\) with no HTML equivalent kept as divs: WebBrowser Preview\./);
  has(/the context menu on Grid opened on right click; the port renders it beside the element/);
  has(/a second default button Finish cannot be the submit too; the port raises onFinish from a click only/);
  has(/the default button Next > is the form's submit; the port raises onOk with every field, not onNext/);
  has(/1 tab control\(s\) render every tab as a section/);
  assert.ok(!notes.some((n) => /Countries.*styles, templates or values/.test(n)) || notes.some((n) => /resource\(s\) referenced \((Countries|Locator)/.test(n)), "a resource referenced is named once, as a resource");
  const ir = buildIr(template);
  assert.deepEqual(ir.collections, ["rows"], "the grid's rows are the data; the select's list is handed");
  assert.match(translate(template).jsx, /<AddressEditor address=\{home\} compact="True" \/>|<address-editor/, "the custom tag reaches React as a component or as itself, never as an error");
});
