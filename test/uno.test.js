import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseXdl } from "../plugins/input-uno/parse.js";
import { lowerXdl } from "../plugins/input-uno/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * LibreOffice/OpenOffice Basic's UNO dialog `.xdl` files, the declarative XML
 * format the Dialog Editor in the Basic IDE has written since the early
 * 2000s. A `<dlg:window>`'s `<dlg:bulletinboard>` is a real component
 * boundary somebody drew with the editor, so this reader lowers it onto the
 * AngularJS attribute dialect the rest of the tool already reads, the same
 * target every desktop form reader lowers onto.
 */

test("a login form lowers onto the dialect the tool already reads", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <dlg:window xmlns:dlg="http://openoffice.org/2000/dialog" xmlns:script="http://openoffice.org/2000/script" dlg:id="LoginDialog" dlg:title="Sign in">
   <dlg:bulletinboard>
    <dlg:text dlg:id="usernameLabel" dlg:value="Username"/>
    <dlg:textfield dlg:id="usernameField"/>
    <dlg:textfield dlg:id="passwordField" dlg:echochar="*"/>
    <dlg:checkbox dlg:id="rememberCheck" dlg:value="Remember me"/>
    <dlg:menulist dlg:id="roleList">
     <dlg:menupopup>
      <dlg:menuitem dlg:value="Administrator"/>
      <dlg:menuitem dlg:value="User"/>
     </dlg:menupopup>
    </dlg:menulist>
    <dlg:button dlg:id="loginButton" dlg:value="Login">
     <script:event script:event-name="on-performaction" script:macro-name="LoginDialog.onLoginClick" script:language="Basic"/>
    </dlg:button>
   </dlg:bulletinboard>
  </dlg:window>`;

  const win = parseXdl(src);
  assert.ok(win, "the <dlg:window> root element was read");
  const lowered = lowerXdl(win, "LoginDialog.xdl");
  assert.match(lowered.template, /<h2>Sign in<\/h2>/);
  assert.match(lowered.template, /<p>Username<\/p>/);
  assert.match(lowered.template, /<input id="f-usernameField" type="text" ng-model="usernameField">/);
  assert.match(lowered.template, /<input id="f-passwordField" type="password" ng-model="passwordField">/);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="rememberCheck"> Remember me<\/label>/);
  assert.match(lowered.template, /<option>Administrator<\/option>/);
  assert.match(lowered.template, /<option>User<\/option>/);
  assert.match(lowered.template, /<button type="button" ng-click="onLoginClick\(\)">Login<\/button>/);
  assert.deepEqual(lowered.outputs, ["loginClick"]);
  assert.deepEqual(lowered.fields.sort(), ["passwordField", "rememberCheck", "roleList", "usernameField"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a menulist with no inline items is named as a gap the port must be handed", () => {
  const src = `<dlg:window xmlns:dlg="http://openoffice.org/2000/dialog" dlg:id="Prefs">
   <dlg:bulletinboard>
    <dlg:menulist dlg:id="roleList"/>
   </dlg:bulletinboard>
  </dlg:window>`;
  const lowered = lowerXdl(parseXdl(src), "Prefs.xdl");
  assert.equal(lowered.usesNgFor, true);
  assert.match(lowered.template, /ng-repeat="option in roleListOptions"/);
  assert.ok(lowered.notes.some((n) => /roleList.*no <dlg:menupopup>/.test(n)));
});

test("a button with no on-performaction event is emitted with the gap named", () => {
  const src = `<dlg:window xmlns:dlg="http://openoffice.org/2000/dialog" dlg:id="Prefs">
   <dlg:bulletinboard>
    <dlg:button dlg:id="cancelButton" dlg:value="Cancel"/>
   </dlg:bulletinboard>
  </dlg:window>`;
  const lowered = lowerXdl(parseXdl(src), "Prefs.xdl");
  assert.deepEqual(lowered.outputs, []);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /cancelButton.*no `on-performaction` <script:event> child wired/.test(n)));
});

test("consecutive radiobuttons with no wrapping dlg:radiogroup are grouped as one field, this reader's own heuristic", () => {
  const src = `<dlg:window xmlns:dlg="http://openoffice.org/2000/dialog" dlg:id="Prefs">
   <dlg:bulletinboard>
    <dlg:radiobutton dlg:id="roleAdmin" dlg:value="Administrator"/>
    <dlg:radiobutton dlg:id="roleUser" dlg:value="User"/>
    <dlg:radiobutton dlg:id="roleGuest" dlg:value="Guest"/>
   </dlg:bulletinboard>
  </dlg:window>`;
  const lowered = lowerXdl(parseXdl(src), "Prefs.xdl");
  const models = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.equal(new Set(models).size, 1, "all three consecutive radio buttons share one field");
  assert.equal(lowered.fields.filter((f) => models.includes(f)).length, 1, "one field represents the whole run");
  assert.match(lowered.template, /value="administrator"/);
  assert.match(lowered.template, /value="guest"/);
});

test("an explicit dlg:radiogroup groups its own radiobuttons the schema's own way", () => {
  const src = `<dlg:window xmlns:dlg="http://openoffice.org/2000/dialog" dlg:id="Prefs">
   <dlg:bulletinboard>
    <dlg:radiogroup dlg:id="roleGroup">
     <dlg:radiobutton dlg:id="roleAdmin" dlg:value="Administrator"/>
     <dlg:radiobutton dlg:id="roleUser" dlg:value="User"/>
    </dlg:radiogroup>
    <dlg:textfield dlg:id="notesField"/>
   </dlg:bulletinboard>
  </dlg:window>`;
  const lowered = lowerXdl(parseXdl(src), "Prefs.xdl");
  const models = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.equal(new Set(models.filter((m) => m !== "notesField")).size, 1, "both radios in the explicit group share one field");
});

test("a checkbox's dlg:value left as a bare 0 or 1 with no dlg:label is named rather than guessed", () => {
  const src = `<dlg:window xmlns:dlg="http://openoffice.org/2000/dialog" dlg:id="Prefs">
   <dlg:bulletinboard>
    <dlg:checkbox dlg:id="rememberCheck" dlg:value="1"/>
    <dlg:checkbox dlg:id="notifyCheck" dlg:label="Notify me" dlg:value="0"/>
   </dlg:bulletinboard>
  </dlg:window>`;
  const lowered = lowerXdl(parseXdl(src), "Prefs.xdl");
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="rememberCheck"> <\/label>/, "the ambiguous value is left blank rather than printed as a caption");
  assert.ok(lowered.notes.some((n) => /rememberCheck.*dlg:value.*is `1`.*checked-state default/.test(n)));
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="notifyCheck"> Notify me<\/label>/, "dlg:label, when given, is the real caption source");
  assert.ok(!lowered.notes.some((n) => /notifyCheck/.test(n)), "a checkbox with a dlg:label is never treated as ambiguous");
});

test("an unrecognised element is named rather than approximated", () => {
  const src = `<dlg:window xmlns:dlg="http://openoffice.org/2000/dialog" dlg:id="Prefs">
   <dlg:bulletinboard>
    <dlg:spinfield dlg:id="quantityField"/>
   </dlg:bulletinboard>
  </dlg:window>`;
  const lowered = lowerXdl(parseXdl(src), "Prefs.xdl");
  assert.ok(lowered.notes.some((n) => /the element `dlg:spinfield` \(quantityField\).*not lowered/.test(n)));
  assert.doesNotMatch(lowered.template, /dlg:spinfield|quantityField/);
});

test("a table or tree control is a header only placeholder, its rows never invented", () => {
  const src = `<dlg:window xmlns:dlg="http://openoffice.org/2000/dialog" dlg:id="Prefs">
   <dlg:bulletinboard>
    <dlg:table dlg:id="resultsTable"/>
    <dlg:tree dlg:id="folderTree"/>
   </dlg:bulletinboard>
  </dlg:window>`;
  const lowered = lowerXdl(parseXdl(src), "Prefs.xdl");
  assert.match(lowered.template, /<table><\/table>\s*<table><\/table>/);
  assert.ok(lowered.notes.some((n) => /resultsTable.*<dlg:table>.*rows come from the code at runtime/.test(n)));
  assert.ok(lowered.notes.some((n) => /folderTree.*<dlg:tree>/.test(n)));
});

test("a UNO dialog login form ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/uno") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "uno");
    assert.ok(screen, "the UNO dialog was read");
    assert.deepEqual(screen.outputs, ["loginClick"]);

    const jsx = await readFile(join(run.out, "src/features/LoginDialog/LoginDialog.jsx"), "utf8");
    assert.match(jsx, /ng-model|value=\{passwordField\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setPasswordField\(event\.target\.value\)\}/i);
    assert.match(jsx, /type="password"/);
    assert.match(jsx, /<option>\s*Administrator\s*<\/option>/);
    // The handler's own method name, kept only as existing, is expected to survive as the JS handler's own name
    // (the same way input-qt's "onAccept" survives from a slot named "accept"); what must never survive is the
    // dialect's own namespace syntax or the macro's full dotted, class qualified path.
    assert.doesNotMatch(jsx, /dlg:|script:|on-performaction|LoginDialog\.onLoginClick/, "no UNO dialog XML or the macro's qualified name survived into the port");

    const unoMd = await readFile(join(run.out, "UNO.md"), "utf8");
    assert.match(unoMd, /LoginDialog\.xdl/);
    assert.match(unoMd, /Read as `LoginDialog`, 4 field\(s\), 1 output\(s\)\./);
    assert.doesNotMatch(unoMd, /dlg:|script:|LoginDialog\.onLoginClick/, "no raw XML or the macro's qualified name reaches the report");
  } finally {
    await run.cleanup();
  }
});
