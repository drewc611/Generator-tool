import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { findCalls } from "../plugins/input-extjs/parse.js";
import { lowerClass } from "../plugins/input-extjs/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Sencha ExtJS, the classic Ext.define/Ext.create API. An xtype tree is a
 * real component boundary, so this reader lowers it onto the AngularJS
 * attribute dialect the rest of the tool already reads, the same target
 * every other reader lowers onto, rather than the inventory input-jquery is
 * left with when a library declares no boundaries at all.
 */

test("a login form lowers onto the dialect the tool already reads", () => {
  const src = `
    Ext.define("MyApp.view.Login", {
      extend: "Ext.form.Panel",
      title: "Sign in",
      items: [
        { xtype: "textfield", name: "username", fieldLabel: "Username" },
        { xtype: "textfield", name: "password", fieldLabel: "Password" },
        { xtype: "checkboxfield", fieldLabel: "Remember me", name: "remember" },
        { xtype: "combobox", fieldLabel: "Role", name: "role",
          store: { fields: ["value", "text"], data: [["admin", "Administrator"], ["user", "User"]] } },
        { xtype: "button", text: "Login", handler: function (btn) { doStuffThatIsNeverRead(btn); } }
      ]
    });
  `;
  const { calls } = findCalls(src);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].className, "MyApp.view.Login");

  const lowered = lowerClass(calls[0].config, "Login");
  assert.match(lowered.template, /ng-model="username"/);
  assert.match(lowered.template, /ng-model="password"/);
  assert.match(lowered.template, /type="checkbox" ng-model="remember"/);
  assert.match(lowered.template, /<option value="admin">Administrator<\/option>/);
  assert.match(lowered.template, /<option value="user">User<\/option>/);
  assert.match(lowered.template, /ng-submit="onSubmit\(\)"/);
  assert.match(lowered.template, /<button type="submit">Login<\/button>/);
  assert.deepEqual(lowered.outputs, ["submit"]);
  assert.deepEqual(lowered.fields.sort(), ["password", "remember", "role", "username"]);
  assert.equal(detectDialect(lowered.template).name, "angularjs", "the lowering is read as the dialect it targets");

  // The handler exists on the record, and never as its own source.
  assert.ok(lowered.notes.some((n) => /handler.*line\(s\) of code/.test(n)));
  assert.ok(!lowered.notes.some((n) => n.includes("doStuffThatIsNeverRead")), "the handler body is never quoted");
  assert.ok(!lowered.template.includes("doStuffThatIsNeverRead"), "the handler body never reaches the template");
});

test("a store named elsewhere is never guessed at", () => {
  const src = `
    Ext.define("MyApp.view.Team", {
      extend: "Ext.form.Panel",
      items: [
        { xtype: "combobox", fieldLabel: "Team", name: "team", store: "TeamStore" }
      ]
    });
  `;
  const { calls } = findCalls(src);
  const lowered = lowerClass(calls[0].config, "Team");
  assert.match(lowered.template, /ng-repeat="option in teamOptions"/);
  assert.ok(lowered.notes.some((n) => /TeamStore.*defined elsewhere/.test(n)));
});

test("an xtype this reader does not lower is named, not approximated", () => {
  const src = `
    Ext.define("MyApp.view.Shell", {
      extend: "Ext.panel.Panel",
      title: "Shell",
      items: [
        { xtype: "toolbar", items: [] }
      ]
    });
  `;
  const { calls } = findCalls(src);
  const lowered = lowerClass(calls[0].config, "Shell");
  assert.doesNotMatch(lowered.template, /toolbar/);
  assert.ok(lowered.notes.some((n) => /xtype `toolbar` is not lowered/.test(n)));
});

test("an Ext.define extending an unrecognised custom base class is named rather than guessed", () => {
  const src = `
    Ext.define("MyApp.view.Odd", {
      extend: "MyApp.view.BaseThing",
      items: [{ xtype: "textfield", name: "x" }]
    });
  `;
  const { calls } = findCalls(src);
  const lowered = lowerClass(calls[0].config, "Odd");
  assert.equal(lowered.template, null);
  assert.ok(lowered.notes.some((n) => /extends `MyApp.view.BaseThing`, a base class this reader does not recognise/.test(n)));
});

test("Ext.data.Store and Ext.data.Model definitions are not read as screens", () => {
  const src = `
    Ext.define("MyApp.store.Users", { extend: "Ext.data.Store", model: "MyApp.model.User" });
    Ext.create("Ext.data.Store", { fields: ["id"] });
  `;
  const { calls } = findCalls(src);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].className, "MyApp.store.Users");
  assert.equal(calls[1].className, "Ext.data.Store");
});

test("an ExtJS login form ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/extjs") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "extjs");
    assert.ok(screen, "the ExtJS form was read");
    assert.deepEqual(screen.outputs, ["submit"]);

    const jsx = await readFile(join(run.out, "src/features/Login/Login.jsx"), "utf8");
    assert.match(jsx, /ng-model|value=\{username\}/, "the field survived the port in some recognisable form");
    assert.match(jsx, /onChange=\{\(event\) => setUsername\(event\.target\.value\)\}/);
    assert.match(jsx, /<option value="admin">/);
    // templateOrigin says the call it came from, in prose; that is provenance, not syntax.
    assert.doesNotMatch(jsx, /xtype|extend\s*:|Ext\.form\.Panel|fieldLabel/, "no ExtJS syntax survived into the port");
    assert.doesNotMatch(jsx, /getValues|Ext\.Ajax/, "the handler's own body never reaches the port");

    const notes = run.ctx.report.unverified.join("\n");
    assert.doesNotMatch(notes, /getValues|Ext\.Ajax\.request/, "the handler body is never quoted in the notes either");

    const extjsMd = await readFile(join(run.out, "EXTJS.md"), "utf8");
    assert.match(extjsMd, /MyApp\.view\.Login/);
    assert.doesNotMatch(extjsMd, /getValues|Ext\.Ajax\.request/);
  } finally {
    await run.cleanup();
  }
});
