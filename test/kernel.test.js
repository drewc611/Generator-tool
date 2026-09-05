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
    "dsp-a11y", "dsp-analytics", "dsp-apimap", "dsp-apistyle", "dsp-archetype", "dsp-assets", "dsp-async", "dsp-auth", "dsp-behavior",
    "dsp-boundaries", "dsp-cognitive", "dsp-complexity", "dsp-components", "dsp-console", "dsp-cookies", "dsp-css", "dsp-dates",
    "dsp-deadcode", "dsp-diff", "dsp-duplication", "dsp-entities", "dsp-entropy", "dsp-era", "dsp-events", "dsp-flags", "dsp-focus", "dsp-fonts", "dsp-forms", "dsp-globals",
    "dsp-i18n", "dsp-iframes", "dsp-images", "dsp-imports", "dsp-improve", "dsp-inline",
    "dsp-ir", "dsp-labels", "dsp-landmarks", "dsp-learn", "dsp-magic", "dsp-media", "dsp-modernize", "dsp-motion", "dsp-observers", "dsp-perf", "dsp-permissions", "dsp-print", "dsp-props", "dsp-render-blocking", "dsp-routes", "dsp-security", "dsp-seo", "dsp-state", "dsp-storage", "dsp-supplychain", "dsp-tables", "dsp-timers", "dsp-tokens",
    "dsp-uplift", "dsp-weight",
    "general-agents", "general-architect", "general-authorization", "general-doctor", "general-history", "general-license", "general-policy", "general-publish", "general-scaffold", "general-size", "general-watch",
    "input-alpine", "input-angular", "input-angularjs", "input-aspnet", "input-backbone", "input-blackbox", "input-explore",
    "input-handlebars", "input-jinja", "input-jquery", "input-jsf", "input-knockout",
    "input-lit", "input-openapi", "input-pdf", "input-polymer", "input-react", "input-record", "input-riot", "input-shots", "input-static", "input-stencil", "input-svelte", "input-underscore", "input-vue", "input-webcomponents",
    "output-adr", "output-alpine", "output-angular", "output-astro", "output-aws", "output-azure", "output-caddy", "output-cem", "output-ci", "output-cloudflare", "output-codemod", "output-curl", "output-cypress",
    "output-design-tokens", "output-dockerfile", "output-fixtures", "output-forms", "output-gcp", "output-html", "output-i18n", "output-lit",
    "output-migration", "output-msw", "output-netlify", "output-next", "output-nginx", "output-nuxt",
    "output-openapi", "output-postman", "output-preact", "output-qwik", "output-react", "output-readme", "output-remix", "output-site", "output-solid",
    "output-storybook", "output-svelte", "output-sveltekit", "output-tailwind",
    "output-tests", "output-types", "output-vercel", "output-vue", "vis-a11y", "vis-coverage", "vis-equivalence", "vis-graph", "vis-lifecycle", "vis-parity", "vis-perf", "vis-roundtrip", "vis-security", "vis-timeline", "vis-transformer", "vis-ui",
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
