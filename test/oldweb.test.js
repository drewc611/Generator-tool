import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { lowerPolymer, propertyNames, readModule } from "../plugins/input-polymer/index.js";
import { lowerRiot, readTag } from "../plugins/input-riot/index.js";
import { detectDialect } from "../plugins/dsp-ir/ir.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Two more of the old web read into the one screen shape. A Polymer element
 * and a Riot tag lower onto the AngularJS dialect the rest of the tool already
 * reads, so nothing downstream learns either framework's name.
 */

test("Polymer bindings lower onto the dialect the tool already reads", () => {
  const lowered = lowerPolymer(
    `<h3>[[user.name]]</h3>
     <img src="[[user.avatar]]">
     <template is="dom-if" if="[[admin]]"><b>admin</b></template>
     <template is="dom-repeat" items="[[roles]]" as="role"><li>[[role]]</li></template>
     <button on-tap="save">go</button>
     <input value="{{q}}">`
  );
  assert.match(lowered, /\{\{ user\.name \}\}/, "one way text becomes interpolation");
  assert.match(lowered, /ng-src="user\.avatar"/);
  assert.match(lowered, /ng-if="admin"/, "dom-if is a conditional");
  assert.match(lowered, /ng-repeat="role in roles"/, "dom-repeat is a loop");
  assert.match(lowered, /ng-click="save\(\)"/, "on-tap is a click that calls the method");
  assert.match(lowered, /ng-model="q"/, "a two way value binding is a model");
  assert.equal(detectDialect(lowered).name, "angularjs", "the lowering is read as the dialect it targets");
});

test("a Polymer module yields a screen with its properties as inputs and its events as outputs", () => {
  const src = `<dom-module id="user-card"><template><h3>[[name]]</h3></template>
    <script>Polymer({ is: "user-card", properties: { name: String, count: { type: Number } },
      go() { this.fire("saved"); fetch("/api/x"); } });</script></dom-module>`;
  const { screens, calls } = readModule(src, "user-card.html");
  assert.equal(screens.length, 1);
  assert.equal(screens[0].selector, "user-card");
  assert.deepEqual(screens[0].inputs.sort(), ["count", "name"]);
  assert.deepEqual(screens[0].outputs, ["saved"]);
  assert.equal(calls[0].path, "/api/x");
  assert.equal(propertyNames(`properties: { a: String, b: { type: Number, notify: true } }`).join(","), "a,b");
});

test("Riot bindings lower onto the dialect too", () => {
  const lowered = lowerRiot(
    `<h2>{ title }</h2>
     <li each={ user in users }>{ user.name }</li>
     <p if={ loading }>x</p>
     <button onclick={ remove }>x</button>
     <img src={ logo }>
     <span class="tag { active }">t</span>`
  );
  assert.match(lowered, /\{\{ title \}\}/);
  assert.match(lowered, /ng-repeat="user in users"/);
  assert.match(lowered, /ng-if="loading"/);
  assert.match(lowered, /ng-click="remove\(\)"/);
  assert.match(lowered, /ng-src="logo"/);
  assert.match(lowered, /class="tag \{\{ active \}\}"/, "a mixed attribute interpolates without doubling");
  assert.doesNotMatch(lowered, /\{\{\{/, "no brace is converted twice");
});

test("a Riot tag yields a screen; its opts are inputs and its triggers are outputs", () => {
  const src = `<user-list><h2>{ title }</h2><script>export default { get title(){ return opts.heading }, go(){ this.trigger("removed"); fetch("/api/u"); } }</script></user-list>`;
  const { screens, calls } = readTag(src, "user-list.riot");
  assert.equal(screens[0].selector, "user-list");
  assert.deepEqual(screens[0].inputs, ["heading"]);
  assert.deepEqual(screens[0].outputs, ["removed"]);
  assert.equal(calls[0].path, "/api/u");
});

test("a Polymer element ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/polymer") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.screens.some((s) => s.readBy === "polymer"), "the element was read");
    const jsx = await readFile(join(run.out, "src/features/UserCard/UserCard.jsx"), "utf8");
    assert.match(jsx, /user\.roles\.map\(/, "the dom-repeat became a real loop in React");
    assert.doesNotMatch(jsx, /\[\[|dom-repeat/, "no Polymer syntax survived into the port");
  } finally {
    await run.cleanup();
  }
});

test("a Riot tag ports to React through the unchanged pipeline", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/riot") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.screens.some((s) => s.readBy === "riot"), "the tag was read");
    const jsx = await readFile(join(run.out, "src/features/UserList/UserList.jsx"), "utf8");
    assert.match(jsx, /users\.map\(/, "the each became a real loop in React");
    assert.doesNotMatch(jsx, /each=|onclick=/, "no Riot syntax survived into the port");
  } finally {
    await run.cleanup();
  }
});
