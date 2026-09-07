import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseUi } from "../plugins/input-qt/parse.js";
import { lowerUi } from "../plugins/input-qt/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Qt Designer's `.ui` files, the declarative XML form format Qt's C++ and
 * PySide/PyQt Python apps have shared since Qt 4. A `<widget>` tree is a real
 * component boundary somebody drew with the Designer, so this reader lowers
 * it onto the AngularJS attribute dialect the rest of the tool already
 * reads, the same target every desktop form reader lowers onto.
 */

test("a login form lowers onto the dialect the tool already reads", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <ui version="4.0">
   <class>LoginDialog</class>
   <widget class="QDialog" name="LoginDialog">
    <property name="windowTitle"><string>Sign in</string></property>
    <layout class="QVBoxLayout" name="verticalLayout">
     <item><widget class="QLabel" name="usernameLabel">
       <property name="text"><string>Username</string></property>
       <property name="buddy"><cstring>usernameEdit</cstring></property>
     </widget></item>
     <item><widget class="QLineEdit" name="usernameEdit"/></item>
     <item><widget class="QLineEdit" name="passwordEdit">
       <property name="echoMode"><enum>QLineEdit::Password</enum></property>
     </widget></item>
     <item><widget class="QCheckBox" name="rememberCheckBox">
       <property name="text"><string>Remember me</string></property>
     </widget></item>
     <item><widget class="QComboBox" name="roleComboBox">
       <item><property name="text"><string>Administrator</string></property></item>
       <item><property name="text"><string>User</string></property></item>
     </widget></item>
     <item><widget class="QPushButton" name="okButton">
       <property name="text"><string>Login</string></property>
     </widget></item>
    </layout>
   </widget>
   <connections>
    <connection>
     <sender>okButton</sender>
     <signal>clicked()</signal>
     <receiver>LoginDialog</receiver>
     <slot>accept()</slot>
    </connection>
   </connections>
  </ui>`;

  const ui = parseUi(src);
  assert.ok(ui, "the <ui> root element was read");
  const lowered = lowerUi(ui, "LoginDialog.ui");
  assert.match(lowered.template, /<h2>Sign in<\/h2>/);
  assert.match(lowered.template, /<label for="f-usernameEdit">Username<\/label>/);
  assert.match(lowered.template, /<input id="f-usernameEdit" type="text" ng-model="usernameEdit">/);
  assert.match(lowered.template, /<input id="f-passwordEdit" type="password" ng-model="passwordEdit">/);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="rememberCheckBox"> Remember me<\/label>/);
  assert.match(lowered.template, /<option>Administrator<\/option>/);
  assert.match(lowered.template, /<option>User<\/option>/);
  assert.match(lowered.template, /<button type="button" ng-click="onAccept\(\)">Login<\/button>/);
  assert.deepEqual(lowered.outputs, ["accept"]);
  assert.deepEqual(lowered.fields.sort(), ["passwordEdit", "rememberCheckBox", "roleComboBox", "usernameEdit"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a property whose value is not string, bool or number is named, not guessed", () => {
  const src = `<ui version="4.0"><class>Prefs</class>
  <widget class="QDialog" name="Prefs">
   <widget class="QLineEdit" name="nameEdit">
    <property name="sizePolicy"><sizepolicy><hsizetype>0</hsizetype><vsizetype>0</vsizetype></sizepolicy></property>
   </widget>
  </widget>
  </ui>`;
  const lowered = lowerUi(parseUi(src), "Prefs.ui");
  assert.ok(lowered.notes.some((n) => /nameEdit.*sizePolicy \(sizepolicy\)/.test(n)), "the property is named by name and type");
  assert.ok(!lowered.notes.some((n) => /hsizetype|vsizetype/.test(n)), "the property's own raw value never reaches a note");
  assert.doesNotMatch(lowered.template, /sizepolicy|hsizetype/i, "no property value reaches the template either");
});

test("a combo box with no inline items is named as a gap the port must be handed", () => {
  const src = `<ui version="4.0"><class>Prefs</class>
  <widget class="QDialog" name="Prefs">
   <widget class="QComboBox" name="roleComboBox"/>
  </widget>
  </ui>`;
  const lowered = lowerUi(parseUi(src), "Prefs.ui");
  assert.equal(lowered.usesNgFor, true);
  assert.match(lowered.template, /ng-repeat="option in roleComboBoxOptions"/);
  assert.ok(lowered.notes.some((n) => /roleComboBox.*no inline items/.test(n)));
});

test("a button with no matching connection is emitted with the gap named", () => {
  const src = `<ui version="4.0"><class>Prefs</class>
  <widget class="QDialog" name="Prefs">
   <widget class="QPushButton" name="cancelButton">
    <property name="text"><string>Cancel</string></property>
   </widget>
  </widget>
  </ui>`;
  const lowered = lowerUi(parseUi(src), "Prefs.ui");
  assert.deepEqual(lowered.outputs, []);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /cancelButton.*no `clicked\(\)` connection wired/.test(n)));
});

test("a promoted widget is named with the class it is promoted to, never approximated", () => {
  const src = `<ui version="4.0"><class>Prefs</class>
  <widget class="QDialog" name="Prefs">
   <widget class="MyCustomWidget" name="chart"/>
   <widget class="QDial" name="volumeDial"/>
  </widget>
  <customwidgets>
   <customwidget>
    <class>MyCustomWidget</class>
    <extends>QWidget</extends>
    <header>mycustomwidget.h</header>
   </customwidget>
  </customwidgets>
  </ui>`;
  const lowered = lowerUi(parseUi(src), "Prefs.ui");
  assert.ok(lowered.notes.some((n) => /chart.*promoted to `MyCustomWidget`.*extends `QWidget`/.test(n)));
  assert.match(lowered.template, /<div class="mycustomwidget"><\/div>/);
  // A real Qt class this reader simply has no lowering for is named the same honest way, never confused for a promotion.
  assert.ok(lowered.notes.some((n) => /widget class `QDial`.*volumeDial.*not lowered/.test(n)));
});

test("a Qt Designer login form ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/qt") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "qt");
    assert.ok(screen, "the Qt Designer form was read");
    assert.deepEqual(screen.outputs, ["accept"]);

    const jsx = await readFile(join(run.out, "src/features/LoginDialog/LoginDialog.jsx"), "utf8");
    assert.match(jsx, /ng-model|value=\{usernameEdit\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setUsernameEdit\(event\.target\.value\)\}/);
    assert.match(jsx, /type="password"/);
    assert.match(jsx, /<option>\s*Administrator\s*<\/option>/);
    // templateOrigin says the file it came from, in prose; that is provenance, not syntax.
    assert.doesNotMatch(jsx, /<widget|<property|<layout|QLineEdit|QDialog/, "no Qt Designer XML survived into the port");

    const qtMd = await readFile(join(run.out, "QT.md"), "utf8");
    assert.match(qtMd, /LoginDialog/);
    assert.match(qtMd, /geometry \(rect\)/, "the opaque geometry property is named by type");
    assert.doesNotMatch(qtMd, /320|240/, "the geometry's own numbers are never printed");
    assert.doesNotMatch(qtMd, /<widget|<property/, "no raw XML reaches the report");
  } finally {
    await run.cleanup();
  }
});
