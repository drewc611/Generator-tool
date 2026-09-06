import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseFxml } from "../plugins/input-fxml/parse.js";
import { lowerFxml } from "../plugins/input-fxml/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * JavaFX's `.fxml` files, the declarative XML UI format desktop Java apps
 * have shared since JavaFX's introduction. A container or control tree is a
 * real component boundary somebody drew with Scene Builder or by hand, so
 * this reader lowers it onto the AngularJS attribute dialect the rest of the
 * tool already reads, the same target every desktop form reader lowers onto.
 */

test("a login form lowers onto the dialect the tool already reads", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <?import javafx.scene.control.*?>
  <?import javafx.scene.layout.*?>
  <GridPane xmlns:fx="http://javafx.com/fxml" xmlns="http://javafx.com/javafx" fx:controller="com.example.LoginController">
    <Label text="Username" GridPane.rowIndex="0" GridPane.columnIndex="0"/>
    <TextField fx:id="usernameField" GridPane.rowIndex="0" GridPane.columnIndex="1"/>
    <Label text="Password" GridPane.rowIndex="1" GridPane.columnIndex="0"/>
    <PasswordField fx:id="passwordField" GridPane.rowIndex="1" GridPane.columnIndex="1"/>
    <CheckBox fx:id="rememberCheck" text="Remember me" GridPane.rowIndex="2"/>
    <ComboBox fx:id="roleBox" GridPane.rowIndex="3">
      <items>
        <FXCollections fx:factory="observableArrayList">
          <String fx:value="Administrator"/>
          <String fx:value="User"/>
        </FXCollections>
      </items>
    </ComboBox>
    <Button text="Login" onAction="#handleLogin" GridPane.rowIndex="4"/>
  </GridPane>`;

  const root = parseFxml(src);
  assert.ok(root, "the root <GridPane> element was read");
  const lowered = lowerFxml(root, "LoginController.fxml");
  assert.equal(lowered.className, "LoginController", "fx:controller's simple class name, package prefix dropped");
  assert.match(lowered.template, /<p>Username<\/p>/);
  assert.match(lowered.template, /<input id="f-usernameField" type="text" ng-model="usernameField">/);
  assert.match(lowered.template, /<input id="f-passwordField" type="password" ng-model="passwordField">/);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="rememberCheck"> Remember me<\/label>/);
  assert.match(lowered.template, /<option>Administrator<\/option>/);
  assert.match(lowered.template, /<option>User<\/option>/);
  assert.match(lowered.template, /<button type="button" ng-click="onHandleLogin\(\)">Login<\/button>/);
  assert.deepEqual(lowered.outputs, ["handleLogin"]);
  assert.deepEqual(lowered.fields.sort(), ["passwordField", "rememberCheck", "roleBox", "usernameField"]);
  // Attached properties never reach the template, and never a per-control note either: one comment in the code says so.
  assert.doesNotMatch(lowered.template, /GridPane|rowIndex|columnIndex/);
  assert.ok(!lowered.notes.some((n) => /rowIndex|columnIndex/.test(n)), "layout positioning is dropped silently, not named one control at a time");
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a combo box with no inline items is named as a gap the port must be handed", () => {
  const src = `<VBox fx:controller="com.example.PrefsController"><ComboBox fx:id="roleBox"/></VBox>`;
  const lowered = lowerFxml(parseFxml(src), "Prefs.fxml");
  assert.equal(lowered.usesNgFor, true);
  assert.match(lowered.template, /ng-repeat="option in roleBoxOptions"/);
  assert.ok(lowered.notes.some((n) => /roleBox.*no `<items>`/.test(n)));
});

test("a combo box whose FXCollections carries no observableArrayList factory is the same gap", () => {
  const src = `<VBox><ComboBox fx:id="roleBox"><items><FXCollections fx:factory="observableList"><String fx:value="Administrator"/></FXCollections></items></ComboBox></VBox>`;
  const lowered = lowerFxml(parseFxml(src), "Prefs.fxml");
  assert.equal(lowered.usesNgFor, true);
  assert.doesNotMatch(lowered.template, /Administrator/, "a factory this reader does not recognise names no options, rather than guessing them from it");
});

test("a button with no onAction is emitted with the gap named", () => {
  const src = `<VBox><Button fx:id="cancelButton" text="Cancel"/></VBox>`;
  const lowered = lowerFxml(parseFxml(src), "Prefs.fxml");
  assert.deepEqual(lowered.outputs, []);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /cancelButton.*no `onAction`/.test(n)));
});

test("an onAction that is not FXML's own #method convention is named, never evaluated", () => {
  const src = `<VBox><Button text="Save" onAction="handleSave()"/></VBox>`;
  const lowered = lowerFxml(parseFxml(src), "Prefs.fxml");
  assert.deepEqual(lowered.outputs, []);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /Save.*binding expression/.test(n)));
  assert.doesNotMatch(lowered.notes.join("\n"), /handleSave\(\)/, "the raw expression is not printed, only that it exists");
});

test("radios that reference the same toggleGroup by $id share one field, however far apart", () => {
  const src = `<VBox>
    <RadioButton fx:id="adminRadio" text="Administrator" toggleGroup="$roleGroup"/>
    <Label text="a separator between them"/>
    <RadioButton fx:id="userRadio" text="User" toggleGroup="$roleGroup"/>
  </VBox>`;
  const lowered = lowerFxml(parseFxml(src), "Prefs.fxml");
  assert.equal(lowered.fields.length, 1, "one field for the whole referenced group, not one per radio");
  assert.match(lowered.template, /<input type="radio" ng-model="(\w+)" value="administrator">[\s\S]*<input type="radio" ng-model="\1" value="user">/);
});

test("consecutive radio buttons with no toggleGroup at all fall back to one field for the run", () => {
  const src = `<VBox>
    <RadioButton fx:id="smallRadio" text="Small"/>
    <RadioButton fx:id="mediumRadio" text="Medium"/>
    <RadioButton fx:id="largeRadio" text="Large"/>
  </VBox>`;
  const lowered = lowerFxml(parseFxml(src), "Prefs.fxml");
  assert.equal(lowered.fields.length, 1, "the whole consecutive run is one field, this reader's own convenience");
  assert.match(lowered.template, /ng-model="(\w+)" value="small"[\s\S]*ng-model="\1" value="medium"[\s\S]*ng-model="\1" value="large"/);
});

test("a control between two unreferenced radios closes the run, this reader's own convention rather than an FXML rule", () => {
  const src = `<VBox>
    <RadioButton fx:id="oneRadio" text="One"/>
    <Label text="breaks the run"/>
    <RadioButton fx:id="twoRadio" text="Two"/>
  </VBox>`;
  const lowered = lowerFxml(parseFxml(src), "Prefs.fxml");
  assert.equal(lowered.fields.length, 2, "no control type between them names a new run when one control interrupts it");
});

test("an element with no vocabulary entry is named through a note, never approximated, fully qualified names included", () => {
  const src = `<VBox>
    <MenuBar/>
    <com.example.Sparkline fx:id="chart"/>
  </VBox>`;
  const lowered = lowerFxml(parseFxml(src), "Prefs.fxml");
  assert.equal(lowered.template.trim(), "<div>\n</div>", "neither element rendered anything");
  // The shared XML scanner (dsp-ir/markup.js) lowercases every tag it reads, so a note prints `menubar`, not
  // `MenuBar`; the dots of a fully qualified name are the one thing this reader recovers past that lowercasing.
  assert.ok(lowered.notes.some((n) => /`menubar`.*not lowered/.test(n)));
  assert.ok(lowered.notes.some((n) => /`com\.example\.sparkline`.*not lowered/.test(n)), "a fully qualified custom control is read as the class it is, not mistaken for an attached property because it also contains dots");
});

test("a JavaFX login form ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/fxml") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "fxml");
    assert.ok(screen, "the FXML form was read");
    assert.deepEqual(screen.outputs, ["handleLogin"]);
    assert.equal(screen.className, "LoginController");

    const jsx = await readFile(join(run.out, "src/features/LoginController/LoginController.jsx"), "utf8");
    assert.match(jsx, /value=\{usernameField\}/, "the field survived the port in a recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setUsernameField\(event\.target\.value\)\}/);
    assert.match(jsx, /type="password"/);
    assert.match(jsx, /<option>\s*Administrator\s*<\/option>/);
    assert.match(jsx, /onHandleLogin/);
    // templateOrigin says the file it came from, in prose; that is provenance, not syntax.
    assert.doesNotMatch(
      jsx,
      /fx:id|fx:controller|onAction=|GridPane\.rowIndex|#handleLogin/,
      "no raw FXML syntax, and no controller method name with its # prefix, survived into the port"
    );

    const fxmlMd = await readFile(join(run.out, "FXML.md"), "utf8");
    assert.match(fxmlMd, /LoginController/);
    assert.doesNotMatch(fxmlMd, /fx:id|fx:controller|onAction=|GridPane\.rowIndex|#handleLogin/, "no raw FXML syntax reaches the report either");
  } finally {
    await run.cleanup();
  }
});
