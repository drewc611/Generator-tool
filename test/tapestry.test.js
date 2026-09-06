import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { lowerTapestry } from "../plugins/input-tapestry/lower.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Apache Tapestry's `.tml` templates lower onto the same AngularJS attribute
 * dialect every other reader in this tool targets, so nothing downstream
 * ever learns Tapestry's name: plain HTML passes through untouched, its
 * `t:type` vocabulary becomes real inputs with `ng-model`, `<t:if>` and
 * `<t:loop>` become the dialect's own conditional and repeat the same way
 * input-jinja and input-twig already spell `{% if %}` and `{% for %}`, and a
 * bare `${property}` becomes `{{ property }}`.
 */

test("a login form's vocabulary lowers correctly, and a gap is named for each of its two honest unknowns", () => {
  const notes = [];
  const note = (t) => notes.push(t);
  const lowered = lowerTapestry(
    '<h1>Sign in</h1>' +
    '<form t:type="form" t:id="loginForm">' +
    '<label>Username</label>' +
    '<input t:type="textfield" t:id="username" t:value="username"/>' +
    '<label>Password</label>' +
    '<input t:type="passwordfield" t:id="password" t:value="password"/>' +
    '<t:checkbox t:id="rememberMe" t:value="rememberMe"/> Remember me' +
    '<select t:type="select" t:id="role" t:model="roleModel" t:value="selectedRole"/>' +
    '<input t:type="submit" t:id="loginButton" t:value="literal:Login"/>' +
    '</form>',
    note
  );

  assert.match(lowered, /<h1>Sign in<\/h1>/, "plain HTML with no t: attribute carries no Tapestry meaning and is untouched");
  assert.match(lowered, /<label>Username<\/label>/);
  assert.match(lowered, /<input id="username" type="text" ng-model="username" \/>/, "t:type=\"textfield\" becomes a real text input with ng-model");
  assert.match(lowered, /<input id="password" type="password" ng-model="password" \/>/, "t:type=\"passwordfield\" becomes a real password input with ng-model");
  assert.match(lowered, /<input id="rememberMe" type="checkbox" ng-model="rememberMe" \/>/, "the <t:checkbox> element form becomes a real checkbox with ng-model");
  assert.match(lowered, /<select id="role" ng-model="selectedRole"><option ng-repeat="option in selectedRoleOptions">\{\{ option \}\}<\/option><\/select>/, "an unresolved t:model becomes a real select with a repeat placeholder for its options");
  assert.match(lowered, /<input id="loginButton" type="submit" value="Login" \/>/, "t:value=\"literal:Login\" reads its literal caption with the prefix stripped");
  assert.doesNotMatch(lowered, /t:[a-zA-Z]/, "no t: namespaced attribute or tag survives the lowering");
  assert.equal(detectDialect(lowered).name, "angularjs", "the lowering is read as the dialect it targets");

  assert.ok(notes.some((n) => /t:type="form"/.test(n) && /no vocabulary entry/.test(n)), "a t:type this reader does not recognise is named, never approximated");
  assert.ok(notes.some((n) => /SelectModel/.test(n) && /selectedRoleOptions/.test(n)), "an unresolved t:model is named as a gap the port must be handed, the way input-qt and input-glade name a combo box");
  assert.ok(notes.some((n) => /loginButton/.test(n) && /onActionFromLoginButton/.test(n) && /no `ng-click` was invented/.test(n)), "a submit button's convention bound handler is named once, never invented as ng-click");
});

test("<t:if> lowers onto the dialect's own conditional, the same ng-if wrapper input-jinja and input-twig already use for {% if %}", () => {
  const lowered = lowerTapestry('<t:if test="loginFailed"><p class="error">Invalid credentials</p></t:if>');
  assert.equal(lowered, '<ng-container ng-if="loginFailed"><p class="error">Invalid credentials</p></ng-container>');
});

test("<t:loop> lowers onto the dialect's own repeat, the same ng-repeat wrapper used for {% for %}, and a ${item.prop} interpolation inside it survives", () => {
  const lowered = lowerTapestry('<t:loop source="recentLogins" value="loginEntry"><p>${loginEntry.username}</p></t:loop>');
  assert.equal(lowered, '<ng-container ng-repeat="loginEntry in recentLogins"><p>{{ loginEntry.username }}</p></ng-container>');
});

test("a ${...} computed expression is named as a gap and rendered as an empty placeholder, never partly evaluated", () => {
  const notes = [];
  const lowered = lowerTapestry('<p>${formatDate(entry.date)}</p>', (t) => notes.push(t));
  assert.equal(lowered, "<p></p>");
  assert.ok(notes.some((n) => /formatDate\(entry\.date\)/.test(n) && /computed expression/.test(n)), "a call inside ${} is named rather than guessed at");
});

test("an unrecognised t:type and an unrecognised t: namespaced element are each named, never approximated", () => {
  const notes = [];
  const lowered = lowerTapestry('<div t:type="grid" t:id="resultsGrid">stuff</div>', (t) => notes.push(t));
  assert.equal(lowered, "<div>stuff</div>", "the plain div and its content stand; only the unrecognised t: attributes were removed");
  assert.ok(notes.some((n) => /t:type="grid"/.test(n) && /no vocabulary entry/.test(n)));

  const notes2 = [];
  const lowered2 = lowerTapestry('<t:zone t:id="results"><p>hi</p></t:zone>', (t) => notes2.push(t));
  assert.equal(lowered2, "<p>hi</p>", "an unrecognised t: element's wrapper is dropped, its content kept, nothing invented in its place");
  assert.ok(notes2.some((n) => /t:zone/.test(n) && /no vocabulary entry/.test(n)));
});

test("a Tapestry login screen ports to React through the unchanged pipeline, with zero raw Tapestry syntax and ordinary HTML intact", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/tapestry") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.screens.some((s) => s.readBy === "tapestry"), "the .tml template was read");
    const jsx = await readFile(join(run.out, "src/features/Login/Login.jsx"), "utf8");
    assert.match(jsx, /Sign in/, "ordinary HTML content around the Tapestry markup survives normally");
    assert.match(jsx, /type="checkbox"/, "the checkbox lowered into a real input");
    assert.match(jsx, /loginEntry\.username/, "the loop's own interpolation reached the port");
    assert.match(jsx, /Login/, "the submit button's literal caption reached the port");
    assert.doesNotMatch(jsx, /<t:|t:type|t:value|t:id|t:model|t:test/, "no raw Tapestry t: namespace syntax survived into the port");
    assert.doesNotMatch(jsx, /\$\{/, "no raw Tapestry ${...} expression syntax survived into the port");
  } finally {
    await run.cleanup();
  }
});
