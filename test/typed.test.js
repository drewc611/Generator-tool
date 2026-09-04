import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * The typed and tested port: a TypeScript prop surface built from what each
 * screen reads and emits, and an end to end suite that walks the routes and
 * asserts the redirects land, both from the run's own facts.
 */

test("output-types writes a prop interface per screen and an endpoint union", async () => {
  const run = await runPipeline({ src: join(ROOT, "example/legacy"), types: true });
  try {
    assert.equal(run.error, null);
    const props = await readFile(join(run.out, "src/types/props.d.ts"), "utf8");
    assert.match(props, /interface AppOrdersProps/);
    assert.match(props, /loading\?: boolean/);
    assert.match(props, /: unknown/, "a prop the reader could not type is unknown, not any");
    assert.doesNotMatch(props, /:\s*any\b/, "any is never used");

    const api = await readFile(join(run.out, "src/types/api.d.ts"), "utf8");
    assert.match(api, /type ApiPath =/);
    assert.match(api, /\/api\/v1\/orders/);
    assert.match(api, /type ApiMethod =/);
  } finally {
    await run.cleanup();
  }
});

test("output-cypress walks the routes and asserts the redirects land", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, cypress: true });
  try {
    assert.equal(run.error, null);
    const routes = await readFile(join(run.out, "cypress/e2e/routes.cy.js"), "utf8");
    assert.match(routes, /cy\.visit\(/);
    assert.match(routes, /#main/, "it asserts the page mounted");

    const redirects = await readFile(join(run.out, "cypress/e2e/redirects.cy.js"), "utf8");
    assert.match(redirects, /cy\.location\('pathname'\)/, "it asserts the browser lands on the new path");

    const config = await readFile(join(run.out, "cypress.config.js"), "utf8");
    assert.match(config, /baseUrl/);
    assert.match(config, /4173/, "it targets the port's own serve.js");
  } finally {
    await run.cleanup();
  }
});

test("neither runs without its flag; cypress needs a site model", async () => {
  const off = await runPipeline({ src: join(ROOT, "example/legacy") });
  try {
    assert.ok(!off.ctx.written.some((f) => /^src\/types\//.test(f)), "no types without the flag");
    assert.ok(!off.ctx.written.some((f) => /^cypress/.test(f)), "no cypress without the flag");
  } finally {
    await off.cleanup();
  }
});
