import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { lowerMarko, lowerText, readMarko, scanAttrs } from "../plugins/input-marko/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Marko writes control flow as tags and bindings as bare attributes; every
 * one has an exact spelling in the dialect, and what does not is named.
 */

test("bare, quoted, expression, call and spread attributes are scanned apart", () => {
  const attrs = scanAttrs(`hidden class="a ${"$"}{b}" disabled=!x on-click("pick", row) items=[1, 2] key=id ...rest`);
  assert.deepEqual(attrs.map((a) => a.name), ["hidden", "class", "disabled", "on-click", "items", "key", "..."]);
  assert.equal(attrs[2].expr, "!x");
  assert.equal(attrs[3].args, `"pick", row`);
  assert.equal(attrs[4].expr, "[1, 2]");
});

test("interpolations and unescaped output lower onto the dialect", () => {
  assert.equal(lowerText("Hi ${user.name}, ${a ? b : c}!"), "Hi {{ user.name }}, {{ a ? b : c }}!");
  assert.equal(lowerText("$!{html}"), `<span ng-bind-html="html"></span>`);
});

test("if, else-if, else and for become the dialect's blocks, with the chain negated and the index renamed", () => {
  const notes = [];
  const { template } = lowerMarko(
    `<if(a)><p>1</p></if><else-if(b)><p>2</p></else-if><else><p>3</p></else><ul><for|row, i| of=rows><li on-click("pick", row)>${"$"}{i}: ${"$"}{row.name}</li></for></ul>`,
    (n) => notes.push(n)
  );
  assert.equal(template,
    `<ng-container ng-if="a"><p>1</p></ng-container><ng-container ng-if="!(a) && (b)"><p>2</p></ng-container><ng-container ng-if="!(a) && !(b)"><p>3</p></ng-container>` +
    `<ul><ng-container ng-repeat="row in rows track by $index"><li ng-click="pick(row)">{{ $index }}: {{ row.name }}</li></ng-container></ul>`);
  assert.deepEqual(notes, []);
});

test("bare attribute values lower by name, and what has no equivalent is named", () => {
  const notes = [];
  const { template } = lowerMarko(
    `<a href=url class=cls disabled=!ok data-id=row.id on-click(go)>x</a><input value=q/><user-badge user=u on-clear("done")/><${"$"}{tag}>y</${"$"}{tag}><div ...rest></div>`,
    (n) => notes.push(n)
  );
  assert.match(template, /<a ng-href="\{\{ url \}\}" ng-class="cls" ng-disabled="!ok" ng-attr-data-id="\{\{ row\.id \}\}" ng-click="go\(\$event\)">x<\/a>/);
  assert.match(template, /<input ng-attr-value="\{\{ q \}\}">/);
  assert.match(template, /<user-badge ng-attr-user="\{\{ u \}\}" ng-clear="done\(\$event\)"><\/user-badge>/);
  assert.ok(notes.some((n) => /dynamic tag/.test(n)) && notes.some((n) => /spread/.test(n)));
});

test("the concise syntax and inline statements are named, not guessed", () => {
  const notes = [];
  const concise = lowerMarko(`div.card\n  h1 -- Hello\n`, (n) => notes.push(n));
  assert.equal(concise.template, null);
  assert.ok(notes.some((n) => /concise/.test(n)));
  const stmt = lowerMarko(`$ const total = rows.length;\n<p>${"$"}{total}</p>`, (n) => notes.push(n));
  assert.equal(stmt.template, `<p>{{ total }}</p>`);
  assert.ok(notes.some((n) => /inline `\$` statement/.test(n)));
});

test("a component's inputs are what it reads from input, its outputs what it emits, from the file or component.js", () => {
  const { screen, calls } = readMarko(
    `class {\n  onCreate(input) { fetch("/api/a"); }\n  go() { this.emit("pick", 1); }\n}\n<div class=input.cls>${"$"}{input.title}</div>`,
    "src/components/user-card/index.marko", () => {}, `export default class { done() { this.emit("close"); } }`
  );
  assert.equal(screen.selector, "user-card"); assert.equal(screen.className, "UserCard");
  assert.deepEqual(screen.inputs, ["cls", "title"]);
  assert.deepEqual(screen.outputs, ["close", "pick"]);
  assert.equal(screen.template, `<div ng-class="cls">{{ title }}</div>`, "input.x is the input itself");
  assert.deepEqual(calls, [{ method: "GET", path: "/api/a", file: "src/components/user-card/index.marko", headers: null, body: null }]);
});

test("a run reads the Marko components once each and ports them, with the child's event wired", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/marko") });
  try {
    assert.equal(run.error, null);
    const card = run.ctx.screens.filter((s) => s.selector === "user-card");
    assert.equal(card.length, 1);
    assert.equal(card[0].readBy, "marko");
    assert.deepEqual(card[0].inputs, ["title", "users"]);
    assert.deepEqual(card[0].outputs, ["pick", "save"]);
    assert.ok(card[0].usesNgIf && card[0].usesNgFor);
    assert.match(card[0].template, /ng-repeat="user in users track by \$index"/);
    assert.match(card[0].template, /<ng-container ng-if="!\(users\.length\) && \(state\.busy\)">/);
    assert.doesNotMatch(card[0].template, /\.card \{/, "the style block is not markup");
    assert.match(card[0].template, /^<section class="card">/, "the tag shorthand is the class");
    const badge = run.ctx.screens.find((s) => s.selector === "user-badge");
    assert.deepEqual(badge.outputs, ["clear"], "component.js beside the template supplies the emit");
    assert.ok(run.ctx.api.calls.some((c) => c.path === "/api/users"));
    const { readFile } = await import("node:fs/promises");
    const jsx = await readFile(join(run.out, "src/features/UserCard/UserCard.jsx"), "utf8");
    assert.match(jsx, /<UserBadge user=\{`\$\{user\}`\} onClear=\{\(event\) => save\(event\)\} \/>/, "the child's event lands as a callback prop");
    assert.doesNotMatch(jsx, /ng-/);
  } finally {
    await run.cleanup();
  }
});
