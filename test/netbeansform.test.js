import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseForm } from "../plugins/input-netbeansform/parse.js";
import { lowerForm } from "../plugins/input-netbeansform/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * NetBeans' own Matisse GUI Builder writes a `.form` XML sidecar beside every
 * JFrame, JDialog or JPanel subclass it built, and edits it directly as the
 * source of truth: a property value, a layout constraint and an event
 * handler's real method name are all explicit XML here, never buried in
 * imperative statements the way input-swing has to read them from the
 * generated `initComponents()` method. input-netbeansform reads a
 * `<Component>` tree under `<SubComponents>` the same structural way
 * input-qt reads a Qt Designer `.ui` file, lowering it onto the shared
 * AngularJS attribute dialect. What has no honest equivalent, an opaque
 * property, a combo box with no inline `<StringArray>` model, a button with
 * no `actionPerformed` wired, a radio with no explicit ButtonGroup
 * reference, a widget class this reader does not lower, is named through
 * the caller's `note` rather than guessed at.
 */

function form(xml) {
  const el = parseForm(xml);
  const structural = [];
  const lowered = lowerForm(el, (n) => structural.push(n));
  return { el, lowered, notes: lowered ? lowered.notes : structural };
}

const HAPPY = `<?xml version="1.0" encoding="UTF-8" ?>
<Form version="1.9" maxVersion="1.9" type="org.netbeans.modules.form.forminfo.JFrameFormInfo">
  <SubComponents>
    <Component class="javax.swing.JLabel" name="usernameLabel">
      <Properties>
        <Property name="text" type="java.lang.String"><String value="Username"/></Property>
        <Property name="labelFor" type="javax.swing.JComponent"><ComponentRef name="usernameField"/></Property>
      </Properties>
    </Component>
    <Component class="javax.swing.JTextField" name="usernameField">
      <Properties></Properties>
    </Component>
    <Component class="javax.swing.JPasswordField" name="passwordField">
      <Properties></Properties>
    </Component>
    <Component class="javax.swing.JCheckBox" name="rememberCheckBox">
      <Properties>
        <Property name="text" type="java.lang.String"><String value="Remember me"/></Property>
      </Properties>
    </Component>
    <Component class="javax.swing.JComboBox" name="roleComboBox">
      <Properties>
        <Property name="model" type="javax.swing.ComboBoxModel">
          <StringArray count="2">
            <StringItem index="0" value="Administrator"/>
            <StringItem index="1" value="User"/>
          </StringArray>
        </Property>
      </Properties>
    </Component>
    <Component class="javax.swing.JButton" name="loginButton">
      <Properties>
        <Property name="text" type="java.lang.String"><String value="Login"/></Property>
      </Properties>
      <Events>
        <EventHandler event="actionPerformed" listener="java.awt.event.ActionListener" parameters="java.awt.event.ActionEvent" handler="loginButtonActionPerformed"/>
      </Events>
    </Component>
  </SubComponents>
</Form>`;

test("a login form lowers onto the dialect: a label paired by labelFor, a password field, a checkbox, a StringArray combo box, a button wired by its own EventHandler", () => {
  const { lowered, notes } = form(HAPPY);
  assert.ok(lowered);
  assert.match(lowered.template, /<label for="f-username-field">Username<\/label>/);
  assert.match(lowered.template, /<input id="f-username-field" type="text" ng-model="usernameField">/);
  assert.match(lowered.template, /<input id="f-password-field" type="password" ng-model="passwordField">/);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="rememberCheckBox"> Remember me<\/label>/);
  assert.match(lowered.template, /<option>Administrator<\/option>/);
  assert.match(lowered.template, /<option>User<\/option>/);
  assert.match(lowered.template, /<button type="button" ng-click="onLoginButton\(\)">Login<\/button>/);
  assert.deepEqual(lowered.outputs, ["loginButton"]);
  assert.deepEqual(lowered.fields.sort(), ["passwordField", "rememberCheckBox", "roleComboBox", "usernameField"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
  assert.ok(notes.some((n) => /loginButtonActionPerformed exists, wired from `loginButton`'s actionPerformed/.test(n)));
  // The label's own <p> never renders separately once it is paired to its field.
  assert.doesNotMatch(lowered.template, /<p>Username<\/p>/);
});

test("a Property's own bare value attribute is read, not just the nested <String>/<StringArray> element shape", () => {
  const src = `<Form><SubComponents>
    <Component class="javax.swing.JCheckBox" name="activeCheckBox">
      <Properties>
        <Property name="text" type="java.lang.String"><String value="Active"/></Property>
        <Property name="opaque" type="boolean" value="true"/>
      </Properties>
    </Component>
  </SubComponents></Form>`;
  const { lowered, notes } = form(src);
  assert.ok(lowered);
  assert.match(lowered.template, /Active/);
  // A bare-attribute boolean property is read as a real boolean, not flagged as an opaque, unread property.
  assert.ok(!notes.some((n) => /opaque \(/.test(n)), "a recognised bare-value property is never reported as opaque");
});

test("a property whose value is a Color, Font or other structural element is named as opaque, never read for what it holds", () => {
  const src = `<Form><SubComponents>
    <Component class="javax.swing.JLabel" name="warningLabel">
      <Properties>
        <Property name="text" type="java.lang.String"><String value="Warning"/></Property>
        <Property name="foreground" type="java.awt.Color"><Color id="Warning.foreground"/></Property>
      </Properties>
    </Component>
  </SubComponents></Form>`;
  const { lowered, notes } = form(src);
  assert.ok(lowered);
  assert.ok(notes.some((n) => /warningLabel.*foreground \(color\)/.test(n)), "the opaque property is named by its own tag, lowercase the way the shared markup reader lowercases every tag");
  assert.doesNotMatch(notes.join("\n"), /Warning\.foreground/, "an opaque property's own value is never printed, only its name and type");
});

test("a combo box with no <StringArray> model is named as a gap and takes an ng-repeat placeholder", () => {
  const src = `<Form><SubComponents>
    <Component class="javax.swing.JComboBox" name="regionComboBox">
      <Properties>
        <Property name="model" type="javax.swing.ComboBoxModel"><RuntimeModel class="com.example.RegionModel"/></Property>
      </Properties>
    </Component>
  </SubComponents></Form>`;
  const { lowered, notes } = form(src);
  assert.ok(lowered);
  assert.match(lowered.template, /ng-repeat="option in regionComboBoxOptions"/);
  assert.ok(notes.some((n) => /regionComboBox.*declares no inline <StringArray> model/.test(n)));
  assert.equal(lowered.usesNgFor, true);

  const srcNoModel = `<Form><SubComponents><Component class="javax.swing.JComboBox" name="plainComboBox"><Properties></Properties></Component></SubComponents></Form>`;
  const { lowered: lowered2, notes: notes2 } = form(srcNoModel);
  assert.match(lowered2.template, /ng-repeat="option in plainComboBoxOptions"/);
  assert.ok(notes2.some((n) => /plainComboBox.*declares no inline <StringArray> model/.test(n)));
});

test("a button with no <Events> child at all is named as a gap, with no wiring invented", () => {
  const src = `<Form><SubComponents>
    <Component class="javax.swing.JButton" name="cancelButton">
      <Properties><Property name="text" type="java.lang.String"><String value="Cancel"/></Property></Properties>
    </Component>
  </SubComponents></Form>`;
  const { lowered, notes } = form(src);
  assert.ok(lowered);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.deepEqual(lowered.outputs, []);
  assert.ok(notes.some((n) => /cancelButton.*has no actionPerformed EventHandler wired/.test(n)));
});

test("a button wired to an event other than actionPerformed is also named as a gap", () => {
  const src = `<Form><SubComponents>
    <Component class="javax.swing.JButton" name="hoverButton">
      <Properties><Property name="text" type="java.lang.String"><String value="Hover"/></Property></Properties>
      <Events><EventHandler event="mouseEntered" listener="java.awt.event.MouseListener" parameters="java.awt.event.MouseEvent" handler="hoverButtonMouseEntered"/></Events>
    </Component>
  </SubComponents></Form>`;
  const { lowered, notes } = form(src);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(notes.some((n) => /hoverButton.*has no actionPerformed EventHandler wired/.test(n)));
});

test("radios naming different ButtonGroups through NonVisualComponents land in distinct fields", () => {
  const src = `<Form>
    <NonVisualComponents>
      <Component class="javax.swing.ButtonGroup" name="genderButtonGroup"/>
      <Component class="javax.swing.ButtonGroup" name="planButtonGroup"/>
    </NonVisualComponents>
    <SubComponents>
      <Component class="javax.swing.JRadioButton" name="maleRadio">
        <Properties>
          <Property name="text" type="java.lang.String"><String value="Male"/></Property>
          <Property name="buttonGroup" type="javax.swing.ButtonGroup"><ComponentRef name="genderButtonGroup"/></Property>
        </Properties>
      </Component>
      <Component class="javax.swing.JRadioButton" name="femaleRadio">
        <Properties>
          <Property name="text" type="java.lang.String"><String value="Female"/></Property>
          <Property name="buttonGroup" type="javax.swing.ButtonGroup"><ComponentRef name="genderButtonGroup"/></Property>
        </Properties>
      </Component>
      <Component class="javax.swing.JRadioButton" name="basicRadio">
        <Properties>
          <Property name="text" type="java.lang.String"><String value="Basic"/></Property>
          <Property name="buttonGroup" type="javax.swing.ButtonGroup"><ComponentRef name="planButtonGroup"/></Property>
        </Properties>
      </Component>
    </SubComponents>
  </Form>`;
  const { lowered } = form(src);
  const maleField = /ng-model="(\w+)" value="male"/.exec(lowered.template)[1];
  const basicField = /ng-model="(\w+)" value="basic"/.exec(lowered.template)[1];
  assert.notEqual(maleField, basicField, "two different ButtonGroup references land in two different fields");
  assert.match(lowered.template, new RegExp(`ng-model="${maleField}" value="female"`), "both radios naming the same ButtonGroup share its field");
  assert.deepEqual(lowered.fields.sort(), [basicField, maleField].sort());
});

test("radios with no ButtonGroup reference at all fall back to this reader's own consecutive-siblings convenience", () => {
  const src = `<Form><SubComponents>
    <Component class="javax.swing.JRadioButton" name="smallRadio">
      <Properties><Property name="text" type="java.lang.String"><String value="Small"/></Property></Properties>
    </Component>
    <Component class="javax.swing.JRadioButton" name="largeRadio">
      <Properties><Property name="text" type="java.lang.String"><String value="Large"/></Property></Properties>
    </Component>
    <Component class="javax.swing.JLabel" name="noteLabel">
      <Properties><Property name="text" type="java.lang.String"><String value="Note"/></Property></Properties>
    </Component>
    <Component class="javax.swing.JRadioButton" name="hugeRadio">
      <Properties><Property name="text" type="java.lang.String"><String value="Huge"/></Property></Properties>
    </Component>
  </SubComponents></Form>`;
  const { lowered } = form(src);
  const smallField = /ng-model="(\w+)" value="small"/.exec(lowered.template)[1];
  const largeField = /ng-model="(\w+)" value="large"/.exec(lowered.template)[1];
  const hugeField = /ng-model="(\w+)" value="huge"/.exec(lowered.template)[1];
  assert.equal(smallField, largeField, "a consecutive run of radios with no ButtonGroup reference is grouped as one field");
  assert.notEqual(largeField, hugeField, "a non-radio component between two radios closes the run: the next radio starts a fresh group");
});

test("a widget class with no vocabulary entry is named through note, never approximated", () => {
  const src = `<Form><SubComponents>
    <Component class="com.toedter.calendar.JDateChooser" name="birthDateChooser">
      <Properties></Properties>
    </Component>
  </SubComponents></Form>`;
  const { lowered, notes } = form(src);
  assert.ok(lowered);
  assert.doesNotMatch(lowered.template, /JDateChooser|birthDateChooser/);
  assert.ok(notes.some((n) => /the widget class `JDateChooser` \(birthDateChooser\) has no vocabulary entry this reader lowers/.test(n)));
});

test("a NetBeans login form ports to React through the unchanged pipeline, with no .form XML or Java identifiers leaking", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/netbeansform") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "netbeansform");
    assert.ok(screen, "the NetBeans form was read");
    assert.deepEqual(screen.outputs, ["loginButton"]);

    const jsx = await readFile(join(run.out, "src/features", screen.className, `${screen.className}.jsx`), "utf8");
    assert.match(jsx, /onChange=\{\(event\) => setUsernameField\(event\.target\.value\)\}/);
    assert.match(jsx, /type="password"/);
    assert.match(jsx, /<option>\s*Administrator\s*<\/option>/);
    assert.doesNotMatch(jsx, /javax\.swing|ComponentRef|StringArray|EventHandler|<Property/, "no .form XML syntax survived into the port");
    // The handler name derives the port's own event name (onLoginButton), but the emitted component never quotes
    // the Java method itself, ActionPerformed suffix and all.
    assert.doesNotMatch(jsx, /loginButtonActionPerformed/, "the Java handler's own method name, suffix and all, never reaches the port");

    // The handler is kept only as existing, in prose, the same restraint input-swing's own notes keep over a
    // handler method it never reads further than its name.
    const notes = run.ctx.report.unverified.join("\n");
    assert.match(notes, /loginButtonActionPerformed exists, wired from `loginButton`'s actionPerformed/);

    const md = await readFile(join(run.out, "NETBEANSFORM.md"), "utf8");
    assert.match(md, /LoginForm/);
    assert.doesNotMatch(md, /<Property|<String value|ComponentRef/, "no raw .form XML leaks into the report");
  } finally {
    await run.cleanup();
  }
});
