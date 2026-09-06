import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { lowerUiBinder } from "../plugins/input-gwt/lower.js";
import { scanJava } from "../plugins/input-gwt/java.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Google Web Toolkit's UiBinder: a `.ui.xml` widget tree paired with a
 * `.java` class whose `@UiField` fields bind the widgets and `@UiHandler`
 * methods wire behaviour. The widget tree is a real component boundary, so
 * this reader lowers it onto the AngularJS attribute dialect the rest of the
 * tool already reads, the same target every other reader lowers onto.
 */

const LOGIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ui:UiBinder xmlns:ui="urn:ui:com.google.gwt.uibinder" xmlns:g="urn:import:com.google.gwt.user.client.ui">
  <g:HTMLPanel>
    <g:Label>Username</g:Label>
    <g:TextBox ui:field="usernameBox"/>
    <g:Label>Password</g:Label>
    <g:PasswordTextBox ui:field="passwordBox"/>
    <g:CheckBox ui:field="rememberBox">Remember me</g:CheckBox>
    <g:ListBox ui:field="roleList">
      <g:item value="admin">Administrator</g:item>
      <g:item value="user">User</g:item>
    </g:ListBox>
    <g:Button ui:field="loginButton">Login</g:Button>
  </g:HTMLPanel>
</ui:UiBinder>`;

const LOGIN_JAVA = `
package com.example.client;
public class Login extends Composite {
  @UiField TextBox usernameBox;
  @UiHandler("loginButton")
  void onLogin(ClickEvent event) {
    String username = usernameBox.getText();
    Window.alert("logging in " + username + "do-not-print-me");
  }
}
`;

test("a login view lowers onto the dialect the tool already reads", () => {
  const { handlers } = scanJava(LOGIN_JAVA);
  const map = new Map(handlers.map((h) => [h.field, h]));
  const notes = [];
  const { screen } = lowerUiBinder(LOGIN_XML, "Login.ui.xml", map, (n) => notes.push(n));

  assert.match(screen.template, /ng-model="usernameBox"/);
  assert.match(screen.template, /type="password" ng-model="passwordBox"/);
  assert.match(screen.template, /type="checkbox" ng-model="rememberBox"/);
  assert.match(screen.template, /<option value="admin">Administrator<\/option>/);
  assert.match(screen.template, /<option value="user">User<\/option>/);
  assert.match(screen.template, /ng-click="onLogin\(\)"/);
  assert.match(screen.template, /<button type="button" ng-click="onLogin\(\)">Login<\/button>/);
  assert.deepEqual(screen.outputs, ["login"]);
  assert.deepEqual(screen.fields.sort(), ["passwordBox", "rememberBox", "roleList", "usernameBox"]);
  assert.equal(detectDialect(screen.template).name, "angularjs", "the lowering is read as the dialect it targets");

  // The handler exists on the record, and never as its own source.
  assert.ok(notes.some((n) => /@UiHandler is wired to a method of \d+ line\(s\)/.test(n)));
  assert.ok(!notes.some((n) => n.includes("do-not-print-me")), "the handler body is never quoted in the notes");
  assert.ok(!screen.template.includes("do-not-print-me"), "the handler body never reaches the template");
  assert.ok(!screen.template.includes("getText"), "the handler body's calls never reach the template");
});

test("a template expression is named, never read as literal text", () => {
  const xml = `<ui:UiBinder xmlns:ui="urn:ui:com.google.gwt.uibinder" xmlns:g="urn:import:com.google.gwt.user.client.ui">
    <g:HTMLPanel>
      <g:Label>{msg.greeting}</g:Label>
      <g:CheckBox ui:field="agreeBox">{msg.agree}</g:CheckBox>
    </g:HTMLPanel>
  </ui:UiBinder>`;
  const notes = [];
  const { screen } = lowerUiBinder(xml, "Greeting.ui.xml", new Map(), (n) => notes.push(n));
  assert.doesNotMatch(screen.template, /msg\.greeting/, "the placeholder syntax never reaches the template");
  assert.doesNotMatch(screen.template, /msg\.agree/);
  assert.match(screen.template, /<p><\/p>/, "the label renders empty rather than showing the binding as if it were words");
  assert.ok(notes.some((n) => /the <Label> holds the template expression `\{msg\.greeting\}`/.test(n)));
  assert.ok(notes.some((n) => /the checkbox `agreeBox`'s label holds the template expression `\{msg\.agree\}`/.test(n)));
});

test("a widget with no vocabulary entry is named, never approximated", () => {
  const xml = `<ui:UiBinder xmlns:ui="urn:ui:com.google.gwt.uibinder" xmlns:g="urn:import:com.google.gwt.user.client.ui" xmlns:c="urn:import:com.example.client.widgets">
    <g:HTMLPanel>
      <g:Label>Results</g:Label>
      <c:FancyGrid ui:field="grid"/>
    </g:HTMLPanel>
  </ui:UiBinder>`;
  const notes = [];
  const { screen } = lowerUiBinder(xml, "Report.ui.xml", new Map(), (n) => notes.push(n));
  assert.doesNotMatch(screen.template, /FancyGrid/i);
  assert.match(screen.template, /<div class="unresolved-widget"><\/div>/);
  assert.ok(notes.some((n) => /<c:FancyGrid> is a custom widget or from an import namespace this reader has not been told the vocabulary for/.test(n)));
});

test("a <ui:with> resource injection is named, never resolved for what it provides", () => {
  const xml = `<ui:UiBinder xmlns:ui="urn:ui:com.google.gwt.uibinder" xmlns:g="urn:import:com.google.gwt.user.client.ui">
    <ui:with field="msg" type="com.example.MyMessages"/>
    <g:HTMLPanel>
      <g:Label>Static</g:Label>
    </g:HTMLPanel>
  </ui:UiBinder>`;
  const notes = [];
  const { screen } = lowerUiBinder(xml, "WithRes.ui.xml", new Map(), (n) => notes.push(n));
  assert.ok(screen, "the widget root still lowers to a screen despite the sibling <ui:with>");
  assert.ok(notes.some((n) => /<ui:with field="msg" type="com\.example\.MyMessages"\/> injects a resource; the field and type are named, never resolved/.test(n)));
});

test("a missing paired .java file still produces a screen, and names the gap", () => {
  const xml = `<ui:UiBinder xmlns:ui="urn:ui:com.google.gwt.uibinder" xmlns:g="urn:import:com.google.gwt.user.client.ui">
    <g:FlowPanel>
      <g:Label>No class</g:Label>
      <g:Button ui:field="goButton">Go</g:Button>
    </g:FlowPanel>
  </ui:UiBinder>`;
  const notes = [];
  // An absent .java file reaches this function as an empty handlers map, the
  // same shape index.js hands it when readFile on the paired file fails.
  const { screen } = lowerUiBinder(xml, "Solo.ui.xml", new Map(), (n) => notes.push(n));
  assert.ok(screen, "the screen is still read from the widget tree alone");
  assert.match(screen.template, /ng-click="onGo\(\)"/);
  assert.deepEqual(screen.outputs, ["go"]);
  assert.ok(notes.some((n) => /no @UiHandler\("goButton"\) was found in the paired \.java file/.test(n)));
});

test("a login and an unpaired view port to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/gwt") });
  try {
    assert.equal(run.error, null);
    const login = run.ctx.screens.find((s) => s.readBy === "gwt" && s.selector === "gwt-login");
    const solo = run.ctx.screens.find((s) => s.readBy === "gwt" && s.selector === "gwt-solo");
    assert.ok(login, "Login.ui.xml was read");
    assert.ok(solo, "Solo.ui.xml was read despite having no paired .java");
    assert.deepEqual(login.outputs, ["login"]);
    assert.deepEqual(login.inputs, []);
    assert.deepEqual(solo.outputs, ["solo"]);

    const jsx = await readFile(join(run.out, "src/features/GwtLogin/GwtLogin.jsx"), "utf8");
    assert.match(jsx, /value=\{usernameBox\}/, "the field survived the port in a recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setUsernameBox\(event\.target\.value\)\}/);
    assert.match(jsx, /onChange=\{\(event\) => setPasswordBox\(event\.target\.value\)\}/);
    assert.match(jsx, /checked=\{rememberBox\}/);
    assert.match(jsx, /<option value="admin">/);
    assert.match(jsx, /onClick=\{\(\) => onLogin\(\)\}/);
    // templateOrigin says the file it came from, in prose ("a GWT UiBinder view"); that is provenance, not syntax.
    assert.doesNotMatch(jsx, /ui:field=|xmlns:|<g:|@UiHandler|@UiField/, "no UiBinder syntax survived into the port");
    assert.doesNotMatch(jsx, /getText|do-not-print-me/, "the handler's own body never reaches the port");

    const notes = run.ctx.report.unverified.join("\n");
    assert.doesNotMatch(notes, /getText|do-not-print-me/, "the handler body is never quoted in the notes either");
    assert.match(notes, /no @UiHandler\("soloButton"\) was found/, "the unresolved handler on Solo is named");
    assert.match(notes, /no paired Solo\.java beside it/, "the missing paired file is named");

    const gwtMd = await readFile(join(run.out, "GWT.md"), "utf8");
    assert.match(gwtMd, /Login\.ui\.xml/);
    assert.match(gwtMd, /Solo\.ui\.xml/);
    assert.doesNotMatch(gwtMd, /getText|do-not-print-me/);
  } finally {
    await run.cleanup();
  }
});
