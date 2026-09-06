import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseFbp } from "../plugins/input-fbp/parse.js";
import { lowerFbp } from "../plugins/input-fbp/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * wxFormBuilder's `.fbp` project files, the visual designer XML for
 * wxWidgets, the cross platform C++ GUI toolkit whose dialogs wxFormBuilder
 * built by hand through the 2000s and 2010s. An `<object class="...">` tree
 * is a real component boundary somebody drew with the designer, so this
 * reader lowers it onto the AngularJS attribute dialect the rest of the tool
 * already reads, the same target every desktop form reader lowers onto.
 */

test("a login form's sizeritems unwrap and its choices and event lower onto the dialect", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <wxFormBuilder_Project>
   <FileVersion major="1" minor="17"/>
   <object class="Project">
    <object class="Dialog" name="LoginDialog">
     <property name="title">Sign in</property>
     <object class="wxBoxSizer">
      <property name="orient">wxVERTICAL</property>
      <object class="sizeritem">
       <object class="wxStaticText" name="usernameLabel">
        <property name="label">Username</property>
       </object>
      </object>
      <object class="sizeritem">
       <object class="wxTextCtrl" name="usernameCtrl"/>
      </object>
      <object class="sizeritem">
       <object class="wxTextCtrl" name="passwordCtrl">
        <property name="style">wxTE_PASSWORD</property>
       </object>
      </object>
      <object class="sizeritem">
       <object class="wxCheckBox" name="rememberCheck">
        <property name="label">Remember me</property>
       </object>
      </object>
      <object class="sizeritem">
       <object class="wxChoice" name="roleChoice">
        <property name="choices">&quot;Administrator&quot; &quot;User&quot;</property>
       </object>
      </object>
      <object class="sizeritem">
       <object class="wxButton" name="loginButton">
        <property name="label">Login</property>
        <event name="OnButtonClick">OnLoginButtonClick</event>
       </object>
      </object>
     </object>
    </object>
   </object>
  </wxFormBuilder_Project>`;

  const projectRoot = parseFbp(src);
  assert.ok(projectRoot, "the <wxFormBuilder_Project> root element was read");
  const lowered = lowerFbp(projectRoot, "LoginDialog.fbp");
  assert.match(lowered.template, /<h2>Sign in<\/h2>/);
  assert.match(lowered.template, /<p>Username<\/p>/);
  assert.match(lowered.template, /<input id="f-usernameCtrl" type="text" ng-model="usernameCtrl">/);
  assert.match(lowered.template, /<input id="f-passwordCtrl" type="password" ng-model="passwordCtrl">/);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="rememberCheck"> Remember me<\/label>/);
  assert.match(lowered.template, /<option>Administrator<\/option>/);
  assert.match(lowered.template, /<option>User<\/option>/);
  assert.match(lowered.template, /<button type="button" ng-click="onLoginButtonClick\(\)">Login<\/button>/);
  assert.deepEqual(lowered.outputs, ["loginButtonClick"]);
  assert.deepEqual(lowered.fields.sort(), ["passwordCtrl", "rememberCheck", "roleChoice", "usernameCtrl"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a property this reader does not interpret is named by name only, never its value", () => {
  const src = `<wxFormBuilder_Project><object class="Project">
   <object class="Dialog" name="Prefs">
    <object class="wxTextCtrl" name="nameCtrl">
     <property name="fg">0,0,0</property>
     <property name="font">Sans,10,,,,,0</property>
    </object>
   </object>
  </object></wxFormBuilder_Project>`;
  const lowered = lowerFbp(parseFbp(src), "Prefs.fbp");
  assert.ok(lowered.notes.some((n) => /nameCtrl.*fg, font/.test(n)), "the properties are named, by name only");
  assert.ok(!lowered.notes.some((n) => /0,0,0|Sans,10/.test(n)), "the properties' own raw values never reach a note");
  assert.doesNotMatch(lowered.template, /0,0,0|Sans,10/, "no property value reaches the template either");
});

test("a choice control with no choices declared is named as a gap the port must be handed", () => {
  const src = `<wxFormBuilder_Project><object class="Project">
   <object class="Dialog" name="Prefs">
    <object class="wxChoice" name="roleChoice"/>
   </object>
  </object></wxFormBuilder_Project>`;
  const lowered = lowerFbp(parseFbp(src), "Prefs.fbp");
  assert.equal(lowered.usesNgFor, true);
  assert.match(lowered.template, /ng-repeat="option in roleChoiceOptions"/);
  assert.ok(lowered.notes.some((n) => /roleChoice.*no choices/.test(n)));
});

test("a choice control whose choices property is present but empty is the same named gap", () => {
  const src = `<wxFormBuilder_Project><object class="Project">
   <object class="Dialog" name="Prefs">
    <object class="wxComboBox" name="cityBox">
     <property name="choices"></property>
    </object>
   </object>
  </object></wxFormBuilder_Project>`;
  const lowered = lowerFbp(parseFbp(src), "Prefs.fbp");
  assert.match(lowered.template, /ng-repeat="option in cityBoxOptions"/);
  assert.ok(lowered.notes.some((n) => /cityBox.*no choices/.test(n)));
});

test("a button with no OnButtonClick event is emitted with the gap named", () => {
  const src = `<wxFormBuilder_Project><object class="Project">
   <object class="Dialog" name="Prefs">
    <object class="wxButton" name="cancelButton">
     <property name="label">Cancel</property>
    </object>
   </object>
  </object></wxFormBuilder_Project>`;
  const lowered = lowerFbp(parseFbp(src), "Prefs.fbp");
  assert.deepEqual(lowered.outputs, []);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /cancelButton.*no `OnButtonClick` event wired/.test(n)));
});

test("wxRB_GROUP starts a new radio group and the following buttons join it, faithfully", () => {
  // Two groups of two, back to back, with no wrapping container distinguishing them:
  // only the wxRB_GROUP style flag says where one group ends and the next begins.
  const src = `<wxFormBuilder_Project><object class="Project">
   <object class="Dialog" name="Prefs">
    <object class="wxBoxSizer">
     <object class="sizeritem"><object class="wxRadioButton" name="sizeSmall">
      <property name="label">Small</property>
      <property name="style">wxRB_GROUP</property>
     </object></object>
     <object class="sizeritem"><object class="wxRadioButton" name="sizeLarge">
      <property name="label">Large</property>
     </object></object>
     <object class="sizeritem"><object class="wxRadioButton" name="colorRed">
      <property name="label">Red</property>
      <property name="style">wxRB_GROUP</property>
     </object></object>
     <object class="sizeritem"><object class="wxRadioButton" name="colorBlue">
      <property name="label">Blue</property>
     </object></object>
    </object>
   </object>
  </object></wxFormBuilder_Project>`;
  const lowered = lowerFbp(parseFbp(src), "Prefs.fbp");
  assert.equal(lowered.fields.length, 2, "two groups, two fields, however many radios each has");

  const small = /ng-model="(\w+)" value="small"/.exec(lowered.template)?.[1];
  const large = /ng-model="(\w+)" value="large"/.exec(lowered.template)?.[1];
  const red = /ng-model="(\w+)" value="red"/.exec(lowered.template)?.[1];
  const blue = /ng-model="(\w+)" value="blue"/.exec(lowered.template)?.[1];
  assert.ok(small && large && red && blue, "every radio rendered with its group as ng-model");
  assert.equal(small, large, "Small and Large share the group Small's wxRB_GROUP opened");
  assert.equal(red, blue, "Red and Blue share the second group Red's wxRB_GROUP opened");
  assert.notEqual(small, red, "the second wxRB_GROUP started a genuinely new group");
});

test("an opaque property never leaks and an unrecognized widget class is named, never approximated", () => {
  const src = `<wxFormBuilder_Project><object class="Project">
   <object class="Dialog" name="Prefs">
    <object class="wxGauge" name="progressGauge"/>
    <object class="wxStaticBoxSizer">
     <property name="label">Appearance</property>
     <object class="sizeritem"><object class="wxCheckBox" name="darkModeCheck">
      <property name="label">Dark mode</property>
     </object></object>
    </object>
   </object>
  </object></wxFormBuilder_Project>`;
  const lowered = lowerFbp(parseFbp(src), "Prefs.fbp");
  assert.ok(lowered.notes.some((n) => /widget class `wxGauge`.*progressGauge.*not lowered/.test(n)));
  assert.match(lowered.template, /<h2>Appearance<\/h2>/, "the wxStaticBoxSizer's label became a heading");
  assert.match(lowered.template, /Dark mode/);
});

test("a wxFormBuilder login form ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/fbp") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "fbp");
    assert.ok(screen, "the wxFormBuilder project was read");
    assert.deepEqual(screen.outputs, ["loginButtonClick"]);

    const jsx = await readFile(join(run.out, "src/features/LoginDialog/LoginDialog.jsx"), "utf8");
    assert.match(jsx, /ng-model|value=\{usernameCtrl\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setUsernameCtrl\(event\.target\.value\)\}/);
    assert.match(jsx, /type="password"/);
    assert.match(jsx, /<option>\s*Administrator\s*<\/option>/);
    assert.doesNotMatch(jsx, /<object|<property|<event|wxDialog|wxTextCtrl|OnLoginButtonClick/, "no wxFormBuilder XML or handler name survived into the port");

    const fbpMd = await readFile(join(run.out, "FBP.md"), "utf8");
    assert.match(fbpMd, /LoginDialog/);
    assert.match(fbpMd, /bg/, "the opaque bg property is named");
    assert.doesNotMatch(fbpMd, /255,255,255/, "the property's own raw colour value is never printed");
    assert.doesNotMatch(fbpMd, /<object|<property/, "no raw XML reaches the report");
  } finally {
    await run.cleanup();
  }
});
