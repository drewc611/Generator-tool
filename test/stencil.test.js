import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readComponent, readTag, readMembers } from "../plugins/input-stencil/index.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";

/**
 * input-stencil reads a Stencil component onto the same dialect every other
 * reader targets, reusing the React reader's JSX lowering once `this.` is
 * stripped. These hold its edges: the tag is the selector, @Prop are inputs,
 * @Event are outputs, @State is not an input, the render JSX lowers, and the
 * result parses into the IR.
 */

const SRC = [
  'import { Component, Prop, Event, State, EventEmitter, h } from "@stencil/core";',
  '@Component({ tag: "order-list", shadow: true })',
  "export class OrderList {",
  "  @Prop() orders: any[] = [];",
  "  @Prop() loading: boolean;",
  "  @State() query: string;",
  "  @Event() orderRemoved: EventEmitter;",
  "  remove(o) { this.orderRemoved.emit(o); }",
  "  render() {",
  "    return (",
  '      <div class="list">',
  "        {this.loading && (<p>Loading</p>)}",
  "        <ul>{this.orders.map((o) => (<li onClick={() => this.remove(o)}>{o.name}</li>))}</ul>",
  "      </div>",
  "    );",
  "  }",
  "}",
].join("\n");

test("the tag is the selector, @Prop are inputs, @Event are outputs, @State is not an input", () => {
  assert.equal(readTag(SRC), "order-list");
  const { inputs, outputs } = readMembers(SRC);
  assert.deepEqual(inputs, ["orders", "loading"]);
  assert.deepEqual(outputs, ["orderRemoved"]);
  assert.ok(!inputs.includes("query"), "@State is local, not an input");
});

test("an @Event with an explicit eventName uses that name", () => {
  const { outputs } = readMembers('@Event({ eventName: "did-change" }) changed: EventEmitter;');
  assert.deepEqual(outputs, ["did-change"]);
});

test("the render JSX lowers onto the dialect and parses into the IR", () => {
  const s = readComponent(SRC, "order-list.tsx");
  assert.equal(s.selector, "order-list");
  assert.equal(s.className, "OrderList");
  assert.equal(s.readBy, "stencil");
  assert.match(s.template, /<p ng-if="loading">/, "a && is a conditional, this stripped");
  assert.match(s.template, /ng-repeat="o in orders"/, "a map is a loop");
  assert.match(s.template, /ng-click="remove\(o\)"/, "an onClick is an event, this stripped");
  assert.match(s.template, /\{\{ o\.name \}\}/, "interpolation comes across");
  const ir = buildIr(s.template);
  const kinds = [];
  const walk = (n) => { if (!n) return; kinds.push(n.kind); (n.children ?? []).forEach(walk); };
  walk(ir.root);
  assert.ok(kinds.includes("each") && kinds.includes("when"), "the loop and conditional reached the IR");
});

test("the plugin reads Stencil files and skips scripts that are not Stencil", async () => {
  assert.equal(plugin.class, "input");
  const dir = await mkdtemp(join(tmpdir(), "stencil-"));
  try {
    await writeFile(join(dir, "Widget.tsx"), SRC.replace("OrderList", "Widget").replace("order-list", "my-widget"));
    await writeFile(join(dir, "util.ts"), "export const add = (a: number, b: number) => a + b;");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "Widget.tsx"), rel: "Widget.tsx" },
        { path: join(dir, "util.ts"), rel: "util.ts" },
      ] },
      screens: [],
      api: { calls: [] },
      unverified: () => {},
    };
    await handlers.extract(ctx);
    assert.equal(ctx.screens.length, 1, "only the Stencil component became a screen");
    assert.equal(ctx.screens[0].selector, "my-widget");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/input-stencil/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:|from "\.\.\//, `${line.trim()} is not a builtin or a local import`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:/, "the reader does not reach the network");
});
