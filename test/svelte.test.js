import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { splitComponent, readScript, lowerSvelte, readComponent } from "../plugins/input-svelte/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";

/**
 * input-svelte lowers a Svelte component onto the same dialect every other
 * reader targets, so it reaches the IR, the endpoint map and the emitters like
 * any other component. These hold that lowering: props and dispatched events
 * are read, blocks become transparent containers the IR sees through, the two
 * way bind and the event handler come across, what has no honest equivalent is
 * noted rather than guessed, and the result parses into the IR.
 */

test("the script's exports are inputs and its dispatched events are outputs", () => {
  const { inputs, outputs, calls } = readScript(
    `export let orders = [];\nexport let loading;\nconst dispatch = createEventDispatcher();\nfunction go(){ dispatch("removed"); fetch("/api/x"); }`
  );
  assert.deepEqual(inputs, ["orders", "loading"]);
  assert.deepEqual(outputs, ["removed"]);
  assert.deepEqual(calls, [{ method: "GET", path: "/api/x", headers: null, body: null }]);
});

test("splitComponent keeps the markup and drops the style", () => {
  const { script, markup } = splitComponent(`<script>export let x;</script>\n<p>{x}</p>\n<style>p{color:red}</style>`);
  assert.match(script, /export let x/);
  assert.match(markup, /<p>\{x\}<\/p>/);
  assert.doesNotMatch(markup, /color:red/, "the style is gone");
});

test("an each block becomes a transparent ng-repeat container, key dropped", () => {
  const out = lowerSvelte(`{#each items as it (it.id)}<li>{it.name}</li>{/each}`);
  assert.match(out, /<ng-container ng-repeat="it in items">/);
  assert.match(out, /<li>\{\{ it\.name \}\}<\/li>/);
  assert.doesNotMatch(out, /it\.id/, "the key is dropped, the dialect does not carry it");
});

test("an if/else becomes sibling conditionals with the else negated", () => {
  const out = lowerSvelte(`{#if open}<a>x</a>{:else}<b>y</b>{/if}`);
  assert.match(out, /<ng-container ng-if="open"><a>x<\/a><\/ng-container>/);
  assert.match(out, /<ng-container ng-if="!\(open\)"><b>y<\/b><\/ng-container>/);
});

test("events and two way binds lower, arrows reduce to their call", () => {
  const out = lowerSvelte(`<input bind:value={q}><button on:click={() => save(q)}>Go</button>`);
  assert.match(out, /<input ng-model="q">/);
  assert.match(out, /ng-click="save\(q\)"/);
});

test("an event modifier and a class directive are noted, not silently dropped", () => {
  const notes = [];
  const out = lowerSvelte(`<form on:submit|preventDefault={send}><i class:active={on}>x</i></form>`, (t) => notes.push(t));
  assert.match(out, /ng-submit="send\(\)"/);
  assert.match(out, /ng-class="\{'active': on\}"/);
  assert.ok(notes.some((n) => /modifier/i.test(n)), "the preventDefault modifier is named as lost");
});

test("interpolation lowers and @html is flagged for review", () => {
  const notes = [];
  const out = lowerSvelte(`<p>{greeting}</p><div>{@html body}</div>`, (t) => notes.push(t));
  assert.match(out, /<p>\{\{ greeting \}\}<\/p>/);
  assert.match(out, /\{\{ body \}\}/);
  assert.ok(notes.some((n) => /@html/.test(n) && /safety|review/i.test(n)), "@html is flagged as needing review");
});

test("a whole component reads and its lowered template parses into the IR", () => {
  const svelte = `<script>export let rows = [];\nconst dispatch = createEventDispatcher();\nfunction pick(r){ dispatch("chose", r); }</script>
<ul>{#each rows as r}<li on:click={() => pick(r)}>{r.label}</li>{/each}</ul>
{#if rows.length === 0}<p>Empty</p>{/if}`;
  const notes = [];
  const { screen } = readComponent(svelte, "Picker.svelte", (t) => notes.push(t));
  assert.equal(screen.selector, "picker");
  assert.equal(screen.className, "Picker");
  assert.deepEqual(screen.inputs, ["rows"]);
  assert.deepEqual(screen.outputs, ["chose"]);
  assert.equal(screen.readBy, "svelte");
  assert.ok(screen.usesNgFor && screen.usesNgIf);
  const ir = buildIr(screen.template);
  assert.ok(ir.root, "the lowered template parses");
  const kinds = [];
  const walk = (n) => { if (!n) return; kinds.push(n.kind); (n.children ?? []).forEach(walk); };
  walk(ir.root);
  assert.ok(kinds.includes("each"), "the each survived to the IR");
  assert.ok(kinds.includes("when"), "the if survived to the IR");
});

test("the plugin reads .svelte files off the source and pushes screens", async () => {
  assert.equal(plugin.class, "input");
  const dir = await mkdtemp(join(tmpdir(), "svelte-"));
  try {
    await writeFile(join(dir, "Card.svelte"), `<script>export let title;</script><h2>{title}</h2>`);
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      config: { src: dir },
      sources: { files: [{ path: join(dir, "Card.svelte"), rel: "Card.svelte" }] },
      screens: [],
      api: { calls: [] },
      unverified: () => {},
    };
    await handlers.extract(ctx);
    assert.equal(ctx.screens.length, 1);
    assert.equal(ctx.screens[0].className, "Card");
    assert.deepEqual(ctx.screens[0].inputs, ["title"]);
    assert.match(ctx.screens[0].template, /\{\{ title \}\}/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/input-svelte/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:|from "\.\.\//, `${line.trim()} is not a builtin or a local import`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the reader does not reach the network");
});
