import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { dataRoots, readState, lowerAlpine, readComponent } from "../plugins/input-alpine/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";

/**
 * input-alpine reads each x-data island onto the same dialect every other reader
 * targets, the inverse of output-alpine. These hold its edges: an island is
 * found and matched to its close, the x-data object gives the state names, the
 * directives lower (x-for, x-if, x-model, @event, :attr, x-text), a bound
 * boolean is a directive not a string, the island takes a distinct name so it
 * never collides with the static reading of the same page, and the result
 * parses into the IR.
 */

const PAGE = [
  "<div x-data=\"{ count: 0, items: ['a','b'], open: false }\" id=\"counter\">",
  '  <button @click.prevent="count++" :disabled="open">Increment</button>',
  '  <span x-text="count"></span>',
  '  <input x-model="query">',
  '  <template x-for="item in items"><li x-text="item" @click="$dispatch(\'picked\', item)"></li></template>',
  '  <template x-if="count > 0"><p>Positive</p></template>',
  '  <img :src="avatar">',
  "</div>",
].join("\n");

test("an x-data island is found and its state names are read", () => {
  const roots = dataRoots(PAGE);
  assert.equal(roots.length, 1);
  assert.deepEqual(readState(roots[0].attrs), ["count", "items", "open"]);
});

test("the directives lower onto the dialect", () => {
  const out = lowerAlpine(dataRoots(PAGE)[0].body);
  assert.match(out, /<template ng-repeat="item in items">/, "x-for is a repeat");
  assert.match(out, /<template ng-if="count > 0">/, "x-if is a conditional");
  assert.match(out, /ng-model="query"/, "x-model is a model");
  assert.match(out, /ng-click="count\+\+"/, "@click is an event, its modifier noted");
  assert.match(out, /ng-disabled="open"/, "a bound boolean is a directive, not a string");
  assert.match(out, /ng-bind="count"/, "x-text is ng-bind");
  assert.match(out, /ng-src="avatar"/, ":src is a bound src");
});

test("modifiers and unknown directives are noted, not guessed", () => {
  const notes = [];
  lowerAlpine('<button @click.prevent="go" x-init="setup()" x-transition>Go</button>', (t) => notes.push(t));
  assert.ok(notes.some((n) => /modifier/i.test(n)), "the .prevent modifier is named");
  assert.ok(notes.some((n) => /x-init/.test(n)), "x-init is named as dropped");
});

test("a whole island reads with a distinct name and parses into the IR", () => {
  const notes = [];
  const comps = readComponent(PAGE, "counter.html", (t) => notes.push(t));
  assert.equal(comps.length, 1);
  const { screen, calls } = comps[0];
  // The island takes its id with an -app suffix, distinct from the static page screen.
  assert.equal(screen.selector, "counter-app");
  assert.equal(screen.readBy, "alpine");
  assert.deepEqual(screen.inputs, ["count", "items", "open"]);
  assert.deepEqual(screen.outputs, ["picked"]);
  assert.ok(screen.usesNgFor && screen.usesNgIf && screen.usesTwoWay);
  const ir = buildIr(screen.template);
  const kinds = [];
  const walk = (n) => { if (!n) return; kinds.push(n.kind); (n.children ?? []).forEach(walk); };
  walk(ir.root);
  assert.ok(kinds.includes("each") && kinds.includes("when"), "the loop and the conditional reached the IR");
});

test("without an id the island takes an -app suffix so it never collides with the page", () => {
  const comps = readComponent('<section x-data="{ a: 1 }"><span x-text="a"></span></section>', "widget.html");
  assert.equal(comps[0].screen.selector, "widget-app");
});

test("two islands on one page get distinct names", () => {
  const two = '<div x-data="{ a: 1 }"><span x-text="a"></span></div><div x-data="{ b: 2 }"><span x-text="b"></span></div>';
  const comps = readComponent(two, "page.html");
  assert.equal(comps.length, 2);
  assert.notEqual(comps[0].screen.selector, comps[1].screen.selector);
});

test("the plugin reads x-data pages and skips pages without Alpine", async () => {
  assert.equal(plugin.class, "input");
  const dir = await mkdtemp(join(tmpdir(), "alpine-"));
  try {
    await writeFile(join(dir, "app.html"), PAGE);
    await writeFile(join(dir, "plain.html"), "<html><body><h1>Static</h1></body></html>");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "app.html"), rel: "app.html" },
        { path: join(dir, "plain.html"), rel: "plain.html" },
      ] },
      screens: [],
      api: { calls: [] },
      unverified: () => {},
    };
    await handlers.extract(ctx);
    assert.equal(ctx.screens.length, 1, "only the x-data page became a screen");
    assert.equal(ctx.screens[0].readBy, "alpine");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/input-alpine/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:|from "\.\.\//, `${line.trim()} is not a builtin or a local import`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the reader does not reach the network");
});
