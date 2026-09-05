import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * The meta-frameworks for Vue and Svelte, mirroring Next and Remix for React:
 * they arrange the site model and import the components the run already
 * emitted, porting nothing twice and carrying the redirect map in each host's
 * own spelling.
 */

test("output-nuxt arranges the site as a Nuxt app importing the emitted Vue", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, vue: true, nuxt: true });
  try {
    assert.equal(run.error, null);
    const page = await readFile(join(run.out, "nuxt/pages/about.vue"), "utf8");
    assert.match(page, /import About from ".*src\/features\/About\/About\.vue"/, "the page imports the emitted Vue component");
    assert.match(page, /<About \/>/);
    assert.match(page, /useHead\(/, "the head data rides useHead");

    const config = await readFile(join(run.out, "nuxt/nuxt.config.ts"), "utf8");
    assert.match(config, /routeRules/);
    assert.match(config, /statusCode: 301/, "the redirect map is carried in Nuxt's spelling");
    assert.ok(run.ctx.written.includes("nuxt/app.vue"), "the chrome became app.vue");
  } finally {
    await run.cleanup();
  }
});

test("output-sveltekit arranges the site as a SvelteKit app importing the emitted Svelte", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, svelte: true, sveltekit: true });
  try {
    assert.equal(run.error, null);
    const page = await readFile(join(run.out, "sveltekit/src/routes/about/+page.svelte"), "utf8");
    assert.match(page, /import About from ".*src\/features\/About\/About\.svelte"/, "the route imports the emitted Svelte component");
    assert.match(page, /<svelte:head>/);

    const hooks = await readFile(join(run.out, "sveltekit/src/hooks.server.js"), "utf8");
    assert.match(hooks, /import \{ redirect \} from "@sveltejs\/kit"/);
    assert.match(hooks, /throw redirect\(301/, "the old address answers from the server hook");
    assert.ok(run.ctx.written.includes("sveltekit/src/routes/+layout.svelte"), "the chrome became the layout");
  } finally {
    await run.cleanup();
  }
});

test("neither meta-framework runs without its flag, nor without a site model", async () => {
  const off = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true });
  try {
    assert.ok(!off.ctx.written.some((f) => /^nuxt\//.test(f)), "no nuxt without the flag");
    assert.ok(!off.ctx.written.some((f) => /^sveltekit\//.test(f)), "no sveltekit without the flag");
  } finally {
    await off.cleanup();
  }

  const noSite = await runPipeline({ src: join(ROOT, "example/legacy"), nuxt: true, sveltekit: true });
  try {
    assert.equal(noSite.error, null);
    assert.ok(!noSite.ctx.written.some((f) => /^nuxt\/|^sveltekit\//.test(f)), "no arrangement without a site model");
    assert.ok(noSite.ctx.report.unverified.some((n) => /Nuxt target needs --site/.test(n)));
  } finally {
    await noSite.cleanup();
  }
});
