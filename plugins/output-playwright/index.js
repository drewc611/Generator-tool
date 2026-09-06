import { flattenRedirects } from "../output-site/index.js";

/**
 * A Playwright end to end suite for the ported site, the same walk the
 * Cypress suite makes for teams that run Playwright. The port ships a zero
 * dependency serve.js on port 4173 behind `npm run serve`, and the config's
 * webServer starts it, so `npx playwright test` is the whole invocation:
 * every route is visited and asserted to have mounted with a title, and every
 * retired address is visited and asserted to land on the new path. Routes
 * and redirects come from the site model; nothing here is invented, and
 * nothing asserts a pixel.
 *
 *   playwright: true
 */

/** A JS single quoted string with the quote and backslash escaped. */
function q(value) {
  return "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

export default {
  name: "output-playwright",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.playwright) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--playwright was asked for and there is no site model to walk; the Playwright suite needs --site true and a folder of pages.");
        return;
      }
      const pages = ctx.site.pages;

      const routeSpec = [
        "// Generated from the site model. One test per route: visit it, assert the",
        "// layout mounted, and assert the document carries a title. These prove the",
        "// routes mount and are reachable, not that any pixel matches.",
        "import { test, expect } from '@playwright/test';",
        "",
        "test.describe('the ported routes', () => {",
        ...pages.flatMap((p) => [
          `  test(${q(`${p.route} mounts`)}, async ({ page }) => {`,
          `    await page.goto(${q(p.route)});`,
          "    await expect(page.locator('#main')).toBeAttached();",
          "    await expect(page).not.toHaveTitle('');",
          `    // route: ${p.route} — ${p.title ?? p.route}`,
          "  });",
        ]),
        "});",
        "",
      ].join("\n");
      await ctx.write("tests/e2e/routes.spec.js", routeSpec);

      const redirects = flattenRedirects(ctx.site.redirects ?? []).flat.filter((r) => r.to.startsWith("/"));
      if (redirects.length) {
        await ctx.write("tests/e2e/redirects.spec.js", [
          "// Generated from the site model's redirect map. Each old address is visited",
          "// and the browser is asserted to have landed on the new path the map promised.",
          "import { test, expect } from '@playwright/test';",
          "",
          "test.describe('the retired addresses land', () => {",
          ...redirects.flatMap((r) => [
            `  test(${q(`${r.from} lands on ${r.to}`)}, async ({ page }) => {`,
            `    await page.goto(${q(r.from)});`,
            `    await expect(page).toHaveURL(new RegExp('^' + ${q(`https?://[^/]+${r.to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[?#].*)?$`)}));`,
            "  });",
          ]),
          "});",
          "",
        ].join("\n"));
      }

      await ctx.write("playwright.config.js", [
        "// The suite drives the served port. webServer starts serve.js (port 4173,",
        "// `npm run serve`) and baseURL matches it, so `npx playwright test` is the",
        "// whole invocation. @playwright/test is the one dev dependency it needs.",
        "export default {",
        "  testDir: './tests/e2e',",
        "  use: { baseURL: 'http://localhost:4173' },",
        "  webServer: {",
        "    command: 'npm run serve',",
        "    url: 'http://localhost:4173/healthz',",
        "    reuseExistingServer: true,",
        "  },",
        "};",
        "",
      ].join("\n"));

      await ctx.write("tests/e2e/README.md", [
        "# The Playwright suite",
        "",
        "End to end specs that walk the ported site over its own server. Install",
        "`@playwright/test` and its browsers, then `npx playwright test`; the config's",
        "webServer starts serve.js on port 4173 and waits for /healthz.",
        "",
        "`routes.spec.js` visits every route and asserts the page mounted (the layout",
        "wraps each page in `<main id=\"main\">`) and that the document has a title.",
        "`redirects.spec.js`, when the site retired any address, visits each old",
        "address and asserts the browser landed on the new path.",
        "",
        "These assert that the routes mount and the redirects land, not pixels.",
        "The routes and redirects both come from the site model.",
        "",
        `Routes walked: ${pages.length}. Redirect assertions: ${redirects.length}.`,
        "",
      ].join("\n"));

      log.info(`playwright: ${pages.length} route spec(s), ${redirects.length} redirect assertion(s)`);
    });
  },
};
