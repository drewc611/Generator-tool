import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Policy } from "../src/core/policy.js";
import { fetchSite, robotsRules } from "../plugins/input-fetch/fetch.js";
import { runPipeline } from "./helpers.js";

/**
 * The twentieth review pass, over the site copy, the console's intake and the
 * four desktop form readers. Each finding is held by the input that exposed
 * it: a redirect off the origin that used to be fetched before the policy was
 * asked, a robots wildcard that blocked everything, a link that threw, a
 * caption the IDE wrapped, a value printed where the report withheld it, a
 * second label that stole a field, a container whose children vanished, a
 * property no one said was unread, and a MsgBox that was not one.
 */

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

async function tree(files) {
  const dir = await mkdtemp(join(tmpdir(), "portamp-review20-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return dir;
}

test("robots rules are patterns with Allow honoured by the longest match, and a wildcard rule blocks what it names, not everything", async (t) => {
  assert.deepEqual(robotsRules("User-agent: *\nDisallow: /*.php$\nDisallow: /\nAllow: /public/\n"), [
    { allow: false, pattern: "/*.php$" }, { allow: false, pattern: "/" }, { allow: true, pattern: "/public/" },
  ]);
  const pages = { "/robots.txt": "User-agent: *\nDisallow: /*.php$\nDisallow: /private\nAllow: /private/open\n", "/": `<a href="/a.php">a</a><a href="/about">b</a><a href="/private/x">c</a><a href="/private/open/y">d</a>` };
  const hits = [];
  const server = createServer((req, res) => { hits.push(req.url); const body = pages[req.url]; if (!body) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": req.url === "/robots.txt" ? "text/plain" : "text/html" }); res.end(body); });
  await new Promise((d) => server.listen(0, "127.0.0.1", d));
  t.after(() => new Promise((d) => server.close(d)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(join(tmpdir(), "portamp-robots-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const m = await fetchSite({ url: `${base}/`, dir, policy: new Policy({ allowLive: true, log: quiet }), log: quiet, depth: 1 });
  const skipped = Object.fromEntries(m.skipped.map((s) => [s.url.replace(base, ""), s.reason]));
  assert.equal(skipped["/a.php"], "disallowed by robots.txt", "the wildcard rule matches what it names");
  assert.equal(skipped["/private/x"], "disallowed by robots.txt");
  assert.equal(skipped["/private/open/y"], "HTTP 404", "the longer Allow wins over the shorter Disallow: the page is asked for, and is simply not there");
  assert.equal(skipped["/about"], "HTTP 404", "a page the wildcard does not name is asked for");
  assert.ok(hits.includes("/about") && hits.includes("/private/open/y") && !hits.includes("/a.php") && !hits.includes("/private/x"));
});

test("a page whose path was already saved as a file, and a link with a literal percent, are skips or saves, never an abort", async (t) => {
  const pages = { "/": `<a href="/v2.0">v</a><a href="/docs/%zz">z</a>`, "/v2.0": `<a href="/v2.0/intro">intro</a>`, "/v2.0/intro": "<p>intro</p>", "/docs/%zz": "<p>zz</p>" };
  const server = createServer((req, res) => { const body = pages[req.url]; if (!body) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": "text/html" }); res.end(body); });
  await new Promise((d) => server.listen(0, "127.0.0.1", d));
  t.after(() => new Promise((d) => server.close(d)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = await mkdtemp(join(tmpdir(), "portamp-enotdir-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const m = await fetchSite({ url: `${base}/`, dir, policy: new Policy({ allowLive: true, log: quiet }), log: quiet, depth: 3 });
  assert.ok(m.pages.some((p) => p.file === "v2.0"), "a dotted path with no trailing slash is a file");
  assert.ok(m.pages.some((p) => p.file === "docs/%zz/index.html"), "the literal percent is saved as written");
  assert.ok(m.skipped.some((s) => /\/v2\.0\/intro$/.test(s.url) && /could not be saved as v2\.0\/intro\/index\.html \(ENOTDIR\)/.test(s.reason)), `the page under the file is a skip with its reason: ${JSON.stringify(m.skipped)}`);
  assert.ok(await readFile(join(dir, "FETCH.md"), "utf8"), "the report is written after a skip that used to abort");
});

test("the WinForms reader: a field's Text is never printed, a second label does not steal a field, an unknown container keeps its children, an unread property is named", async (t) => {
  const dir = await tree({
    "Secrets.Designer.cs": `namespace App { partial class Secrets { private void InitializeComponent() {
      this.txtKey = new System.Windows.Forms.TextBox();
      this.txtHidden = new System.Windows.Forms.TextBox();
      this.lblA = new System.Windows.Forms.Label();
      this.lblB = new System.Windows.Forms.Label();
      this.txtName = new System.Windows.Forms.TextBox();
      this.lblC = new System.Windows.Forms.Label();
      this.tsc = new System.Windows.Forms.ToolStripContainer();
      this.inner = new System.Windows.Forms.Button();
      this.txtKey.Text = "sk-live-SECRET";
      this.txtKey.Enabled = false;
      this.txtKey.Location = new System.Drawing.Point(10, 10);
      this.txtHidden.Text = "hunter2";
      this.txtHidden.Visible = false;
      this.txtHidden.Location = new System.Drawing.Point(10, 40);
      this.lblA.Text = "Name";
      this.lblA.Location = new System.Drawing.Point(10, 70);
      this.lblB.Text = "(optional)";
      this.lblB.Location = new System.Drawing.Point(60, 70);
      this.txtName.Location = new System.Drawing.Point(150, 70);
      this.lblC.Text = "Multi" + "part";
      this.lblC.Location = new System.Drawing.Point(10, 100);
      this.inner.Text = "Inside";
      this.inner.Location = new System.Drawing.Point(5, 5);
      this.tsc.Location = new System.Drawing.Point(10, 130);
      this.tsc.ContentPanel.Controls.Add(this.inner);
      this.Controls.Add(this.txtKey);
      this.Controls.Add(this.txtHidden);
      this.Controls.Add(this.lblA);
      this.Controls.Add(this.lblB);
      this.Controls.Add(this.txtName);
      this.Controls.Add(this.lblC);
      this.Controls.Add(this.tsc);
      this.Text = "Secrets";
    } } }`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = await runPipeline({ src: dir, shots: join(dir, "none") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const screen = run.ctx.screens.find((s) => s.readBy === "winforms");
  const notes = run.ctx.report.unverified.join("\n");
  const everything = screen.template + "\n" + notes + "\n" + (await readFile(join(run.out, "WINFORMS.md"), "utf8"));
  assert.ok(!/SECRET|hunter2/.test(everything), `a field's initial text is printed nowhere: ${everything.match(/.*(SECRET|hunter2).*/)?.[0]}`);
  assert.match(screen.template, /ng-show="shown\.hiddenShown"/, "the hidden field's state is named after the control, not its value");
  assert.match(notes, /start disabled \(key\)/); assert.match(notes, /start hidden \(hidden\)/);
  assert.match(screen.template, /<label for="f-name">Name<\/label>\n\s*<p>\(optional\)<\/p>\n\s*<input id="f-name" type="text" ng-model="name">/, "the first label names the field; the second on the row is copy");
  assert.match(screen.template, /<div class="toolstripcontainer">\n\s*<button type="button" ng-click="onInside\(\)">Inside<\/button>\n\s*<\/div>/, "a child placed on an unknown container's panel renders inside it");
  assert.match(notes, /lblC: Text could not be read exactly and left out/, "a concatenated Text is named as unread");
});

test("the XAML reader never prints a field's Text for a hidden or disabled control", async (t) => {
  const dir = await tree({
    "Keys.xaml": `<Window x:Class="App.Keys" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Keys">
  <StackPanel>
    <TextBox x:Name="txtKey" Text="sk-live-SECRET" IsEnabled="False" />
    <TextBox x:Name="txtHidden" Text="hunter2" Visibility="Collapsed" />
    <Button Content="Save" Click="Save_Click" />
  </StackPanel>
</Window>`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = await runPipeline({ src: dir, shots: join(dir, "none") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const screen = run.ctx.screens.find((s) => s.readBy === "xaml");
  const everything = screen.template + "\n" + run.ctx.report.unverified.join("\n") + "\n" + (await readFile(join(run.out, "LAYOUT.md"), "utf8"));
  assert.ok(!/SECRET|hunter2/.test(everything), `a field's initial text is printed nowhere: ${everything.match(/.*(SECRET|hunter2).*/)?.[0]}`);
  assert.match(screen.template, /ng-show="shown\.txtHiddenShown"|ng-show="shown\.hiddenShown"/);
});

test("the Delphi reader: a menu item with a drawing handler is a named behaviour, not a crash, and a caption the IDE wrapped is whole", async (t) => {
  const dir = await tree({
    "Main.dfm": `object frmMain: TfrmMain
  Left = 0
  Top = 0
  Caption =
    'A long caption that the IDE wraps onto the next li' +
    'ne'
  ClientHeight = 200
  ClientWidth = 300
  Menu = MainMenu1
  object lblHint: TLabel
    Left = 8
    Top = 8
    Width = 100
    Height = 13
    Caption =
      'Enter the ' +
      'name'
  end
  object edtName: TEdit
    Left = 8
    Top = 24
    Width = 200
    Height = 21
    TabOrder = 0
  end
  object MainMenu1: TMainMenu
    object File1: TMenuItem
      Caption = '&File'
      OnDrawItem = File1DrawItem
      object Open1: TMenuItem
        Caption = '&Open'
        OnClick = Open1Click
      end
    end
  end
end
`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = await runPipeline({ src: dir, shots: join(dir, "none") });
  t.after(run.cleanup);
  assert.equal(run.error, null, `the run must not die on a menu's drawing handler: ${run.error?.message}`);
  const screen = run.ctx.screens.find((s) => s.readBy === "delphi");
  assert.equal(screen.title, "A long caption that the IDE wraps onto the next line", "the wrapped caption is read whole");
  assert.match(screen.template, /<label for="f-enter-the-name">Enter the name<\/label>/, "a wrapped label caption labels its field");
  assert.match(run.ctx.report.unverified.join("\n"), /File1 DrawItem/, "the drawing handler is a behaviour the port must write again");
});

test("the VB6 reader reads MsgBox as a call only: not inside a string, not in a comment, and a continued message whole", async (t) => {
  const dir = await tree({
    "frmMsg.frm": `VERSION 5.00
Begin VB.Form frmMsg
   Caption         =   "Messages"
   ClientHeight    =   3000
   ClientLeft      =   60
   ClientTop       =   345
   ClientWidth     =   4000
   Begin VB.CommandButton cmdGo
      Caption         =   "Go"
      Height          =   375
      Left            =   120
      TabIndex        =   0
      Top             =   120
      Width           =   1215
   End
End
Attribute VB_Name = "frmMsg"
Private Sub cmdGo_Click()
    MsgBox "Hello " & _
        "World"
    s = "Call MsgBox here"
    x = 1 ' MsgBox "old"
    r = MsgBox("Really?", vbYesNo, "Title")
End Sub
`,
  });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = await runPipeline({ src: dir, shots: join(dir, "none") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const report = await readFile(join(run.out, "FORMS_VB6.md"), "utf8");
  assert.match(report, /Hello … World/, "a message continued onto the next line is read whole, the joined literals marked");
  assert.match(report, /Really\?/, "the function form is a call too");
  assert.ok(!/Call MsgBox here|old|built at runtime/.test(report), `the word inside a string or a comment is not a message: ${report.match(/.*(Call MsgBox here|old|built at runtime).*/)?.[0]}`);
});
