import assert from "node:assert/strict";
import test from "node:test";

import { readDefines, readObserved, readEvents, readTemplateLiteral, lowerTemplate, readComponent } from "../plugins/input-webcomponents/index.js";
import plugin from "../plugins/input-webcomponents/index.js";

/**
 * input-webcomponents reads a vanilla custom element onto the shared dialect: its
 * observedAttributes are inputs, its CustomEvent names outputs, and its innerHTML
 * template's ${x} interpolations become {{ x }}. What has no honest lowering is
 * named through the note, not guessed.
 */

const SRC = `
class UserBadge extends HTMLElement {
  static get observedAttributes() { return ['label', 'count']; }
  connectedCallback() {
    this.innerHTML = \`<div class="badge"><span>\${this.label}</span><b>\${this.count}</b></div>\`;
  }
  pick() { this.dispatchEvent(new CustomEvent('picked', { detail: this.count })); }
}
customElements.define('user-badge', UserBadge);
`;

test("it maps the tag to its class and reads the members", () => {
  const defines = readDefines(SRC);
  assert.deepEqual(defines, [{ tag: "user-badge", cls: "UserBadge" }]);
  const body = SRC;
  assert.deepEqual(readObserved(body), ["label", "count"]);
  assert.deepEqual(readEvents(body), ["picked"]);
});

test("the innerHTML template literal is found and its ${x} lowers to interpolation", () => {
  const tpl = readTemplateLiteral(SRC);
  assert.ok(tpl.includes("badge"));
  const lowered = lowerTemplate(tpl);
  assert.match(lowered, /\{\{ label \}\}/, "this.label becomes {{ label }}");
  assert.match(lowered, /\{\{ count \}\}/);
  assert.doesNotMatch(lowered, /this\./, "this. is stripped");
});

test("a dynamic expression with no plain interpolation is noted, not guessed", () => {
  const notes = [];
  const lowered = lowerTemplate("<ul>${this.items.map(i => `<li>${i}</li>`).join('')}</ul>", (n) => notes.push(n));
  assert.ok(notes.some((n) => /no plain interpolation/.test(n)), "the map expression is named");
  assert.doesNotMatch(lowered, /\.map/, "the unlowerable expression is left out rather than emitted wrong");
});

test("readComponent builds a screen the emitters can consume", () => {
  const screen = readComponent(SRC, "UserBadge", "user-badge", "badge.js");
  assert.equal(screen.selector, "user-badge");
  assert.equal(screen.className, "UserBadge");
  assert.deepEqual(screen.inputs, ["label", "count"]);
  assert.deepEqual(screen.outputs, ["picked"]);
  assert.equal(screen.readBy, "webcomponents");
  assert.match(screen.template, /\{\{ label \}\}/);
});

test("the plugin reads a custom element in a run and pushes it as a screen", async () => {
  const handlers = {};
  plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "wc-"));
  try {
    await writeFile(join(dir, "badge.js"), SRC);
    const ctx = {
      sources: { files: [{ path: join(dir, "badge.js"), rel: "badge.js" }] },
      screens: [],
      api: { calls: [] },
      unverified: () => {},
    };
    await handlers.extract(ctx);
    assert.equal(ctx.screens.length, 1);
    assert.equal(ctx.screens[0].selector, "user-badge");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/input-webcomponents/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "(node:|\.\.\/)/, `${line.trim()} is not a node builtin or a local module`);
  }
  assert.doesNotMatch(source, /\bfetch\(\s*['"`]https?:/, "the reader does not reach the network");
});
