import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { lowerMxml } from "../plugins/input-flex/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Adobe Flex, the MXML based rich internet application framework. An
 * Application or WindowedApplication is a real screen the way a XAML window
 * is, so this reader lowers its widget tree onto the AngularJS attribute
 * dialect the rest of the tool already reads, the same target every other
 * reader lowers onto.
 */

const LOGIN = `
  <mx:Application xmlns:mx="library://ns.adobe.com/flex/mx" xmlns:fx="http://ns.adobe.com/mxml/2009" layout="vertical">
    <fx:Script>
      <![CDATA[
        [Bindable]
        private var errorMessage:String = "";

        private function onLogin(event:MouseEvent):void {
          Alert.show("Logging in as " + usernameInput.text);
        }
      ]]>
    </fx:Script>
    <mx:Panel title="Sign in">
      <mx:Form>
        <mx:FormItem label="Username">
          <mx:TextInput id="usernameInput"/>
        </mx:FormItem>
        <mx:FormItem label="Password">
          <mx:TextInput id="passwordInput" displayAsPassword="true"/>
        </mx:FormItem>
        <mx:CheckBox id="rememberBox" label="Remember me"/>
        <mx:ComboBox id="roleBox">
          <mx:dataProvider>
            <mx:ArrayCollection>
              <mx:source>
                <mx:Object label="Administrator" data="admin"/>
                <mx:Object label="User" data="user"/>
              </mx:source>
            </mx:ArrayCollection>
          </mx:dataProvider>
        </mx:ComboBox>
        <mx:Button label="Login" click="onLogin(event)"/>
      </mx:Form>
    </mx:Panel>
  </mx:Application>
`;

test("a login form lowers onto the dialect the tool already reads", () => {
  const notes = [];
  const { screen } = lowerMxml(LOGIN, "Login.mxml", (n) => notes.push(n));
  assert.ok(screen, "the Application was read as a screen");
  assert.match(screen.template, /<h2>Sign in<\/h2>/);
  assert.match(screen.template, /ng-model="usernameInput"/);
  assert.match(screen.template, /type="password" ng-model="passwordInput"/);
  assert.match(screen.template, /type="checkbox" ng-model="rememberBox"/);
  assert.match(screen.template, /<option value="admin">Administrator<\/option>/);
  assert.match(screen.template, /<option value="user">User<\/option>/);
  assert.match(screen.template, /<button type="button" ng-click="onLogin\(\)">Login<\/button>/);
  assert.deepEqual(screen.outputs, ["login"]);
  assert.deepEqual(screen.fields.sort(), ["passwordInput", "rememberBox", "roleBox", "usernameInput"]);
  assert.equal(detectDialect(screen.template).name, "angularjs", "the lowering is read as the dialect it targets");

  // The handler exists on the record, and never as its own source.
  assert.ok(notes.some((n) => /onLogin.*line\(s\) of code/.test(n)));
  assert.ok(!notes.some((n) => n.includes("Alert.show") || n.includes("Logging in as")), "the handler body is never quoted");
  assert.ok(!screen.template.includes("Alert.show"), "the handler body never reaches the template");

  // A [Bindable] property is named as existing; its type and its value are not.
  assert.ok(notes.some((n) => /\[Bindable\] propert.* declared \(errorMessage\)/.test(n)));
  assert.ok(!notes.some((n) => n.includes("String") || n.includes('""')), "the property's type and value are never printed");
});

test("a {expression} binding is named, never printed as static text", () => {
  const src = `
    <mx:Application xmlns:mx="library://ns.adobe.com/flex/mx">
      <mx:Panel title="Status">
        <mx:Label text="{statusMessage}"/>
      </mx:Panel>
    </mx:Application>
  `;
  const notes = [];
  const { screen } = lowerMxml(src, "Status.mxml", (n) => notes.push(n));
  assert.doesNotMatch(screen.template, /<p>\{statusMessage\}<\/p>/, "the brace expression is never shown as if it were literal text");
  assert.match(screen.template, /\{\{\s*statusMessage\s*\}\}/, "a binding becomes the dialect's own interpolation, not a guess at its value");
  assert.ok(notes.some((n) => /binding.*\{statusMessage\}/.test(n)), "the binding is named in the report");
});

test("a dataProvider bound to a variable is named, never approximated", () => {
  const src = `
    <mx:Application xmlns:mx="library://ns.adobe.com/flex/mx">
      <mx:Panel title="Team">
        <mx:ComboBox id="roleBox" dataProvider="{roleList}"/>
      </mx:Panel>
    </mx:Application>
  `;
  const notes = [];
  const { screen } = lowerMxml(src, "Team.mxml", (n) => notes.push(n));
  assert.match(screen.template, /ng-repeat="option in roleBoxOptions"/);
  assert.doesNotMatch(screen.template, /<option value="admin">/, "no data was invented for an unresolved dataProvider");
  assert.ok(notes.some((n) => /dataProvider.*\{roleList\}.*roleBoxOptions/.test(n)));
});

test("a click handler with no matching function is named as a gap, not wired", () => {
  const src = `
    <mx:Application xmlns:mx="library://ns.adobe.com/flex/mx">
      <fx:Script xmlns:fx="http://ns.adobe.com/mxml/2009">
        <![CDATA[
          private function onLogin(event:MouseEvent):void {}
        ]]>
      </fx:Script>
      <mx:Panel title="Team">
        <mx:Button label="Delete" click="onDelete(event)"/>
      </mx:Panel>
    </mx:Application>
  `;
  const notes = [];
  const { screen } = lowerMxml(src, "Team.mxml", (n) => notes.push(n));
  assert.doesNotMatch(screen.template, /ng-click/, "an unmatched handler is not wired");
  assert.match(screen.template, /<button type="button">Delete<\/button>/);
  assert.deepEqual(screen.outputs, []);
  assert.ok(notes.some((n) => /onDelete.*not a function this reader found/.test(n)));
});

test("an unrecognised MX tag and a custom component are named, never approximated", () => {
  const src = `
    <mx:Application xmlns:mx="library://ns.adobe.com/flex/mx" xmlns:local="*">
      <mx:Panel title="Team">
        <mx:DataGrid id="rows"/>
        <local:TeamPicker/>
      </mx:Panel>
    </mx:Application>
  `;
  const notes = [];
  const { screen } = lowerMxml(src, "Team.mxml", (n) => notes.push(n));
  assert.doesNotMatch(screen.template, /DataGrid|TeamPicker/i);
  assert.ok(notes.some((n) => /DataGrid.*not a recognised MX or Spark tag/.test(n)));
  assert.ok(notes.some((n) => /TeamPicker.*custom component/.test(n)));
});

test("an mx:Style block is named to exist and never parsed", () => {
  const src = `
    <mx:Application xmlns:mx="library://ns.adobe.com/flex/mx">
      <mx:Style>
        .loginPanel { color: #333333; }
      </mx:Style>
      <mx:Panel title="Sign in"/>
    </mx:Application>
  `;
  const notes = [];
  const { screen } = lowerMxml(src, "Login.mxml", (n) => notes.push(n));
  assert.doesNotMatch(screen.template, /loginPanel|#333333/);
  assert.ok(notes.some((n) => /declares a style block/.test(n)));
});

test("a login form ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/flex") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "flex");
    assert.ok(screen, "the MXML form was read");
    assert.deepEqual(screen.outputs, ["login"]);

    const jsx = await readFile(join(run.out, "src/features/Login/Login.jsx"), "utf8");
    assert.match(jsx, /ng-model|value=\{usernameInput\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /<option value="admin">/);
    // templateOrigin says the tag it came from, in prose; that is provenance, not syntax.
    assert.doesNotMatch(jsx, /<mx:|<fx:|<!\[CDATA|displayAsPassword=|dataProvider=/, "no MXML syntax survived into the port");
    assert.doesNotMatch(jsx, /Alert\.show|Logging in as|Username is required/, "the script's own body never reaches the port");

    const notes = run.ctx.report.unverified.join("\n");
    assert.doesNotMatch(notes, /Alert\.show|Logging in as|Username is required/, "the script body is never quoted in the notes either");
    assert.match(notes, /Login\.mxml: /, "each gap names the MXML file that produced it");

    const flexMd = await readFile(join(run.out, "FLEX.md"), "utf8");
    assert.match(flexMd, /Login\.mxml/);
    assert.doesNotMatch(flexMd, /Alert\.show|Logging in as|Username is required/);
  } finally {
    await run.cleanup();
  }
});
