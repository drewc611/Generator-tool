import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * The Playwright suite walks the same routes and redirects the Cypress suite
 * walks, from the same site model, for teams that run Playwright.
 */

test("output-playwright walks the routes, asserts the redirects land, and starts the port's own server", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, playwright: true });
  try {
    assert.equal(run.error, null);
    const routes = await readFile(join(run.out, "tests/e2e/routes.spec.js"), "utf8");
    assert.match(routes, /import \{ test, expect \} from '@playwright\/test';/);
    assert.ok((routes.match(/await page\.goto\(/g) ?? []).length >= 2, "every route is visited");
    assert.match(routes, /toBeAttached\(\)/);
    const redirects = await readFile(join(run.out, "tests/e2e/redirects.spec.js"), "utf8");
    assert.match(redirects, /toHaveURL\(new RegExp\(/, "a retired address is asserted to land on its new path");
    const config = await readFile(join(run.out, "playwright.config.js"), "utf8");
    assert.match(config, /baseURL: 'http:\/\/localhost:4173'/);
    assert.match(config, /command: 'npm run serve'/, "the config starts the port's own server");
    assert.match(config, /\/healthz/);
    for (const f of ["tests/e2e/routes.spec.js", "tests/e2e/redirects.spec.js", "playwright.config.js"]) {
      const { execFileSync } = await import("node:child_process");
      execFileSync(process.execPath, ["--check", join(run.out, f)], { stdio: "pipe" });
    }
    const readme = await readFile(join(run.out, "tests/e2e/README.md"), "utf8");
    assert.match(readme, /not pixels/);
  } finally {
    await run.cleanup();
  }
});

test("it does nothing without its flag, and names the missing site model with it", async () => {
  const off = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true });
  try {
    assert.ok(!off.ctx.written.some((f) => /playwright|tests\/e2e/.test(f)), "no suite without the flag");
  } finally {
    await off.cleanup();
  }
  const noSite = await runPipeline({ src: join(ROOT, "example/legacy"), playwright: true });
  try {
    assert.ok(!noSite.ctx.written.some((f) => /tests\/e2e/.test(f)));
    assert.ok(noSite.ctx.report.unverified.some((n) => /--playwright/.test(n)), "the missing site model is named");
  } finally {
    await noSite.cleanup();
  }
});
