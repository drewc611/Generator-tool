import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseGlade } from "../plugins/input-glade/parse.js";
import { lowerGlade } from "../plugins/input-glade/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * GTK Builder's `.glade` files, the declarative XML UI format the Glade
 * Interface Designer has written for GTK2 and GTK3 apps in Python, C, C++
 * and Vala for roughly two decades. An `<object class="...">` tree is a real
 * component boundary somebody drew with the Designer, so this reader lowers
 * it onto the AngularJS attribute dialect the rest of the tool already
 * reads, the same target every desktop form reader lowers onto.
 */

test("a login form lowers onto the dialect the tool already reads", () => {
  const src = `<?xml version="1.0" encoding="UTF-8"?>
  <interface>
   <requires lib="gtk+" version="3.0"/>
   <object class="GtkDialog" id="login_dialog">
    <property name="title">Sign in</property>
    <child internal-child="vbox">
     <object class="GtkBox" id="login_box">
      <child>
       <object class="GtkLabel" id="username_label">
        <property name="label" translatable="yes">Username</property>
        <property name="mnemonic_widget">username_entry</property>
       </object>
      </child>
      <child>
       <object class="GtkEntry" id="username_entry"/>
      </child>
      <child>
       <object class="GtkEntry" id="password_entry">
        <property name="visibility">False</property>
       </object>
      </child>
      <child>
       <object class="GtkCheckButton" id="remember_check">
        <property name="label" translatable="yes">Remember me</property>
       </object>
      </child>
      <child>
       <object class="GtkComboBoxText" id="role_combo">
        <items>
         <item translatable="yes">Administrator</item>
         <item translatable="yes">User</item>
        </items>
       </object>
      </child>
      <child>
       <object class="GtkButton" id="login_button">
        <property name="label" translatable="yes">Login</property>
        <signal name="clicked" handler="on_login_button_clicked" swapped="no"/>
       </object>
      </child>
     </object>
    </child>
   </object>
  </interface>`;

  const iface = parseGlade(src);
  assert.ok(iface, "the <interface> root element was read");
  const lowered = lowerGlade(iface, "login_dialog.glade");
  assert.match(lowered.template, /<h2>Sign in<\/h2>/);
  assert.match(lowered.template, /<label for="f-username_entry">Username<\/label>/);
  assert.match(lowered.template, /<input id="f-username_entry" type="text" ng-model="username_entry">/);
  assert.match(lowered.template, /<input id="f-password_entry" type="password" ng-model="password_entry">/);
  assert.match(lowered.template, /<label><input type="checkbox" ng-model="remember_check"> Remember me<\/label>/);
  assert.match(lowered.template, /<option>Administrator<\/option>/);
  assert.match(lowered.template, /<option>User<\/option>/);
  assert.match(lowered.template, /<button type="button" ng-click="onLoginButtonClicked\(\)">Login<\/button>/);
  assert.deepEqual(lowered.outputs, ["loginButtonClicked"]);
  assert.deepEqual(lowered.fields.sort(), ["password_entry", "remember_check", "role_combo", "username_entry"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a property whose value is a nested object is named, not guessed", () => {
  const src = `<interface>
  <object class="GtkDialog" id="prefs">
   <child><object class="GtkEntry" id="name_entry">
    <property name="pixbuf"><object class="GdkPixbuf"><property name="width">16</property></object></property>
   </object></child>
  </object>
  </interface>`;
  const lowered = lowerGlade(parseGlade(src), "prefs.glade");
  assert.ok(lowered.notes.some((n) => /name_entry.*pixbuf \(GdkPixbuf\)/.test(n)), "the property is named by name and type");
  assert.ok(!lowered.notes.some((n) => /width|16/.test(n)), "the property's own raw value never reaches a note");
  assert.doesNotMatch(lowered.template, /GdkPixbuf|pixbuf/i, "no property value reaches the template either");
});

test("a combo box with no inline items is named as a gap the port must be handed", () => {
  const src = `<interface>
  <object class="GtkDialog" id="prefs">
   <child><object class="GtkComboBox" id="role_combo"/></child>
  </object>
  </interface>`;
  const lowered = lowerGlade(parseGlade(src), "prefs.glade");
  assert.equal(lowered.usesNgFor, true);
  assert.match(lowered.template, /ng-repeat="option in role_comboOptions"/);
  assert.ok(lowered.notes.some((n) => /role_combo.*no inline items/.test(n)));
});

test("a button with no signal child is emitted with the gap named", () => {
  const src = `<interface>
  <object class="GtkDialog" id="prefs">
   <child><object class="GtkButton" id="cancel_button">
    <property name="label">Cancel</property>
   </object></child>
  </object>
  </interface>`;
  const lowered = lowerGlade(parseGlade(src), "prefs.glade");
  assert.deepEqual(lowered.outputs, []);
  assert.match(lowered.template, /<button type="button">Cancel<\/button>/);
  assert.doesNotMatch(lowered.template, /ng-click/);
  assert.ok(lowered.notes.some((n) => /cancel_button.*no `<signal name="clicked">` child wired/.test(n)));
});

test("radio buttons group the way GTK actually groups them, one naming another's id, transitively", () => {
  const src = `<interface>
  <object class="GtkDialog" id="prefs">
   <child><object class="GtkBox" id="box">
    <child><object class="GtkRadioButton" id="role_admin">
     <property name="label">Administrator</property>
    </object></child>
    <child><object class="GtkRadioButton" id="role_user">
     <property name="label">User</property>
     <property name="group">role_admin</property>
    </object></child>
    <child><object class="GtkRadioButton" id="role_guest">
     <property name="label">Guest</property>
     <property name="group">role_user</property>
    </object></child>
   </object></child>
  </object>
  </interface>`;
  const lowered = lowerGlade(parseGlade(src), "prefs.glade");
  const models = [...lowered.template.matchAll(/ng-model="(\w+)"/g)].map((m) => m[1]);
  assert.equal(new Set(models).size, 1, "all three radios, chained through group, share one field");
  assert.equal(lowered.fields.filter((f) => models.includes(f)).length, 1, "one field represents the whole group");
  assert.match(lowered.template, /value="administrator"/);
  assert.match(lowered.template, /value="guest"/);
});

test("an unrecognised widget class is named rather than approximated", () => {
  const src = `<interface>
  <object class="GtkDialog" id="prefs">
   <child><object class="GtkBox" id="box">
    <child><object class="GtkCalendar" id="date_picker"/></child>
   </object></child>
  </object>
  </interface>`;
  const lowered = lowerGlade(parseGlade(src), "prefs.glade");
  assert.ok(lowered.notes.some((n) => /widget class `GtkCalendar`.*date_picker.*not lowered/.test(n)));
  assert.doesNotMatch(lowered.template, /GtkCalendar/);
});

test("a <requires> for a library other than gtk+ is named, never assumed lowerable", () => {
  const src = `<interface>
  <requires lib="gtk+" version="3.0"/>
  <requires lib="webkit2gtk" version="4.0"/>
  <object class="GtkDialog" id="prefs"/>
  </interface>`;
  const lowered = lowerGlade(parseGlade(src), "prefs.glade");
  assert.ok(lowered.notes.some((n) => /requires `webkit2gtk`/.test(n)));
  assert.ok(!lowered.notes.some((n) => /requires `gtk\+`/.test(n)), "the ordinary gtk+ requirement is not itself a gap");
});

test("a placeholder child is named rather than silently skipped", () => {
  const src = `<interface>
  <object class="GtkDialog" id="prefs">
   <child><object class="GtkBox" id="box">
    <child><placeholder/></child>
    <child><object class="GtkLabel" id="only_label"><property name="label">Hi</property></object></child>
   </object></child>
  </object>
  </interface>`;
  const lowered = lowerGlade(parseGlade(src), "prefs.glade");
  assert.ok(lowered.notes.some((n) => /has a <placeholder\/> child/.test(n)));
  assert.match(lowered.template, /<p>Hi<\/p>/);
});

test("a GtkNotebook is read as a container without guessing which page shows", () => {
  const src = `<interface>
  <object class="GtkDialog" id="prefs">
   <child><object class="GtkNotebook" id="tabs">
    <child><object class="GtkLabel" id="page_one"><property name="label">One</property></object></child>
    <child type="tab"><object class="GtkLabel" id="tab_one"><property name="label">Page One</property></object></child>
    <child><object class="GtkLabel" id="page_two"><property name="label">Two</property></object></child>
    <child type="tab"><object class="GtkLabel" id="tab_two"><property name="label">Page Two</property></object></child>
   </object></child>
  </object>
  </interface>`;
  const lowered = lowerGlade(parseGlade(src), "prefs.glade");
  assert.ok(lowered.notes.some((n) => /tabs.*switches between 2 page\(s\)/.test(n)));
  assert.match(lowered.template, /<p>One<\/p>/);
  assert.match(lowered.template, /<p>Two<\/p>/);
  assert.doesNotMatch(lowered.template, /Page One|Page Two/, "the tab labels themselves are not page content");
});

test("only .glade is claimed, never Qt Designer's .ui files sharing the format's shape", async () => {
  assert.match("login_dialog.glade", /\.glade$/i);
  assert.doesNotMatch("LoginDialog.ui", /\.glade$/i);

  const run = await runPipeline({ src: join(ROOT, "test/fixtures/qt") });
  try {
    assert.equal(run.error, null);
    assert.ok(!run.ctx.glade, "input-glade read nothing from a directory holding only a Qt Designer .ui file");
    const screen = run.ctx.screens.find((s) => s.file === "LoginDialog.ui");
    assert.ok(screen, "the .ui file was still read, by input-qt");
    assert.equal(screen.readBy, "qt", "a .ui file is entirely input-qt's to read");
  } finally {
    await run.cleanup();
  }
});

test("a GTK Builder login form ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/glade") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "glade");
    assert.ok(screen, "the GTK Builder form was read");
    assert.deepEqual(screen.outputs, ["loginButtonClicked"]);

    const jsx = await readFile(join(run.out, "src/features/LoginDialog/LoginDialog.jsx"), "utf8");
    assert.match(jsx, /ng-model|value=\{username_entry\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setUsername_entry\(event\.target\.value\)\}/i);
    assert.match(jsx, /type="password"/);
    assert.match(jsx, /<option>\s*Administrator\s*<\/option>/);
    // templateOrigin says the file it came from, in prose; that is provenance, not syntax.
    assert.doesNotMatch(jsx, /<object|<property|<child|GtkEntry|GtkDialog|on_login_button_clicked/, "no GTK Builder XML or handler name survived into the port");

    const gladeMd = await readFile(join(run.out, "GLADE.md"), "utf8");
    assert.match(gladeMd, /login_dialog\.glade/);
    assert.match(gladeMd, /geometry \(GdkGeometry\)/, "the opaque geometry property is named by type");
    assert.doesNotMatch(gladeMd, /320|min_width/, "the geometry's own value is never printed");
    assert.doesNotMatch(gladeMd, /<object|<property|on_login_button_clicked/, "no raw XML or handler name reaches the report");
  } finally {
    await run.cleanup();
  }
});
