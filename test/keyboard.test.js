import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readKeyboard } from "../plugins/dsp-keyboard/index.js";
import { collect } from "../plugins/vis-a11y/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A click handler on an element the keyboard cannot reach, named with what it
 * lacks, in every dialect the readers know, and never the handler itself.
 */

test("a click on a non interactive element is named with what it lacks; a native control and a complete one are not", () => {
  const found = readKeyboard(
    `<div onclick="a(secret)">x</div>\n<span ng-click="b()" tabindex="0">y</span>\n<div role="button" tabindex="0" onclick="c()">z</div>\n` +
    `<div role="button" tabindex="0" onclick="d()" onkeydown="k()">ok</div>\n<button onclick="e()">b</button>\n<a href="/x" onclick="f()">l</a>\n<a onclick="g()">m</a>\n<li @click="h()">v</li>\n<td (click)="i()">ng</td>`,
    "a.html"
  );
  assert.deepEqual(found.map((f) => [f.tag, f.lacks.join("+"), f.line]), [
    ["div", "tabindex+role+key handler", 1],
    ["span", "role+key handler", 2],
    ["div", "key handler", 3],
    ["a (no href)", "tabindex+role+key handler", 7],
    ["li", "tabindex+role+key handler", 8],
    ["td", "tabindex+role+key handler", 9],
  ]);
  assert.ok(!JSON.stringify(found).includes("secret"), "the handler expression is never captured");
});

test("the a11y scorecard gains a keyboard axis, not measured until the plugin ran", () => {
  assert.equal(collect({}).find((r) => r.axis === "Keyboard").present, false);
  const row = collect({ keyboard: { findings: [{}, {}], byTag: {} } }).find((r) => r.axis === "Keyboard");
  assert.equal(row.count, 2);
});

test("a run writes KEYBOARD.md naming each unreachable click target and counts it on the scorecard", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/keyboard-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("KEYBOARD.md"));
    assert.equal(run.ctx.keyboard.findings.length, 4, "the card, the span, the save div and the hrefless anchor");
    const md = await readFile(join(run.out, "KEYBOARD.md"), "utf8");
    assert.match(md, /line 5: <div> with a click handler lacks tabindex, role, key handler/);
    assert.match(md, /<a \(no href\)>/);
    assert.ok(!md.includes("open(1)"), "no handler code in the report");
    const card = await readFile(join(run.out, "ACCESSIBILITY.md"), "utf8");
    assert.match(card, /\| Keyboard \| [^|]*\b4\b/);
  } finally {
    await run.cleanup();
  }
});

test("an anchor routed by a bound routerLink is a link, not an unreachable click target", () => {
  const found = readKeyboard(`<a [routerLink]="['/x']" (click)="go()">x</a><a routerLink="/y" (click)="go()">y</a><a (click)="go()">z</a>`, "a.html");
  assert.deepEqual(found.map((f) => f.line), [1]);
  assert.equal(found.length, 1, "only the anchor with no route at all is a finding");
});
