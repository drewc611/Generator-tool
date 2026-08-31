import assert from "node:assert/strict";
import test from "node:test";

import { Kernel, CLASSES, STAGES } from "../src/core/kernel.js";
import { BUILTIN, quietLogger } from "./helpers.js";

const kernel = () => new Kernel({ log: quietLogger(), policy: {} });
const plugin = (over = {}) => ({ name: "dsp-x", version: "1.0.0", class: "dsp", setup() {}, ...over });

test("the five classes and five stages are the whole vocabulary", () => {
  assert.deepEqual(CLASSES, ["input", "dsp", "output", "vis", "general"]);
  assert.deepEqual(STAGES, ["scan", "extract", "plan", "emit", "verify"]);
});

test("a plugin registers and reports itself", () => {
  const k = kernel();
  k.register(plugin());
  assert.deepEqual(k.plugins, [{ name: "dsp-x", version: "1.0.0", class: "dsp" }]);
});

test("a plugin with no version still registers", () => {
  const k = kernel();
  k.register(plugin({ version: undefined }));
  assert.equal(k.plugins[0].version, "0.0.0");
});

test("malformed plugins are refused, each for its own reason", () => {
  assert.throws(() => kernel().register(plugin({ name: undefined })), /missing a name/);
  assert.throws(() => kernel().register(plugin({ class: "codec" })), /unknown class/);
  assert.throws(() => kernel().register(plugin({ setup: undefined })), /no setup function/);
});

test("a duplicate name is refused rather than silently replacing the first", () => {
  const k = kernel();
  k.register(plugin());
  assert.throws(() => k.register(plugin()), /Duplicate plugin name/);
  assert.equal(k.plugins.length, 1);
});

test("subscribing to a stage that does not exist is an error, not a no op", () => {
  const k = kernel();
  assert.throws(() => k.register(plugin({ setup: ({ on }) => on("compile", () => {}) })), /Unknown stage/);
});

test("stages run in order, and every subscriber in a stage runs before the next", async () => {
  const seen = [];
  const k = kernel();
  k.register(plugin({
    name: "input-a", class: "input",
    setup: ({ on }) => STAGES.forEach((s) => on(s, () => seen.push(`a:${s}`))),
  }));
  k.register(plugin({
    name: "dsp-b",
    setup: ({ on }) => on("plan", () => seen.push("b:plan")),
  }));
  await k.run({});
  assert.deepEqual(seen, ["a:scan", "a:extract", "a:plan", "b:plan", "a:emit", "a:verify"]);
});

test("a plugin that throws stops the run where it stood", async () => {
  const reached = [];
  const k = kernel();
  k.register(plugin({
    name: "input-boom", class: "input",
    setup: ({ on }) => on("scan", () => { throw new Error("boom"); }),
  }));
  k.register(plugin({ setup: ({ on }) => on("scan", () => reached.push("after")) }));
  await assert.rejects(() => k.run({}), /boom/);
  assert.deepEqual(reached, [], "a half ported screen is worse than no ported screen");
});

test("setup receives a logger scoped to the plugin and the policy object", () => {
  const policy = { marker: true };
  const k = new Kernel({ log: quietLogger(), policy });
  let seen;
  k.register(plugin({ setup: (api) => { seen = api; } }));
  assert.equal(seen.policy, policy);
  assert.equal(typeof seen.log.info, "function");
  assert.equal(typeof seen.on, "function");
});

test("discovery loads every plugin that ships", async () => {
  const k = kernel();
  await k.discover({ builtinDir: BUILTIN });
  const names = k.plugins.map((p) => p.name).sort();
  assert.deepEqual(names, [
    "dsp-a11y", "dsp-apimap", "dsp-archetype", "dsp-behavior", "dsp-boundaries", "dsp-deadcode", "dsp-i18n", "dsp-improve",
    "dsp-ir", "dsp-modernize", "dsp-routes", "dsp-tokens", "dsp-uplift",
    "general-authorization", "general-license", "general-policy",
    "input-angular", "input-blackbox", "input-explore", "input-jquery", "input-record", "input-shots", "input-vue",
    "output-html", "output-msw", "output-openapi", "output-react", "output-storybook", "output-svelte",
    "output-tests", "output-vue", "vis-parity", "vis-ui",
  ]);
  for (const p of k.plugins) assert.ok(CLASSES.includes(p.class), `${p.name} has a real class`);
});

test("discovering the same directory twice does not double register", async () => {
  const k = kernel();
  await k.discover({ builtinDir: BUILTIN });
  const first = k.plugins.length;
  await k.discover({ builtinDir: BUILTIN });
  assert.equal(k.plugins.length, first);
});

test("a directory that is not there is not an error", async () => {
  const k = kernel();
  await k.discover({ builtinDir: "/nope/not/here" });
  assert.deepEqual(k.plugins, []);
});
