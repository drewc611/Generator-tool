import { flattenRedirects } from "../output-site/index.js";

/**
 * A Cypress end to end suite for the ported site. The port ships a zero
 * dependency serve.js that serves the app on port 4173 with `npm run serve`,
 * so these specs drive a real browser over the real server: every route is
 * visited and asserted to have mounted, and every retired address is visited
 * and asserted to land on the new path. The routes and redirects come from
 * the site model; nothing here is invented.
 *
 *   cypress: true
 */

/** A JS single quoted string with the quote and backslash escaped, so a route
 * or title carrying either cannot break out of the literal. */
function q(value) {
  return "'" + String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

export default {
  name: "output-cypress",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.cypress) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--cypress was asked for and there is no site model to walk; the Cypress suite needs --site true and a folder of pages.");
        return;
      }
      const pages = ctx.site.pages;

      const routeSpec = [
        "// Generated from the site model. One test per route: visit it, assert the",
        "// layout mounted, and assert the document carries a title. These prove the",
        "// routes mount and are reachable, not that any pixel matches.",
        "describe('the ported routes', () => {",
        ...pages.flatMap((p) => {
          const label = p.title ?? p.route;
          return [
            `  it(${q(`${p.route} mounts`)}, () => {`,
            `    cy.visit(${q(p.route)});`,
            "    cy.get('#main').should('exist');",
            "    cy.title().should('not.be.empty');",
            `    // route: ${p.route} — ${label}`,
            "  });",
          ];
        }),
        "});",
        "",
      ].join("\n");
      await ctx.write("cypress/e2e/routes.cy.js", routeSpec);

      // A retired address is asserted to land where the map says it lands. The
      // chains flatten here the same way output-site flattens them; a cycle is
      // output-site's to fail, not this suite's.
      const redirects = flattenRedirects(ctx.site.redirects ?? [])
        .flat.filter((r) => r.to.startsWith("/"));
      let landed = 0;
      if (redirects.length) {
        const redirectSpec = [
          "// Generated from the site model's redirect map. Each old address is visited",
          "// and the browser is asserted to have landed on the new path the map promised.",
          "describe('the retired addresses land', () => {",
          ...redirects.flatMap((r) => {
            landed += 1;
            return [
              `  it(${q(`${r.from} lands on ${r.to}`)}, () => {`,
              `    cy.visit(${q(r.from)});`,
              `    cy.location('pathname').should('eq', ${q(r.to)});`,
              "  });",
            ];
          }),
          "});",
          "",
        ].join("\n");
        await ctx.write("cypress/e2e/redirects.cy.js", redirectSpec);
      }

      await ctx.write("cypress.config.js", [
        "// The suite drives the served port. baseUrl matches serve.js, which the",
        "// port runs on 4173 with `npm run serve`.",
        "export default {",
        "  e2e: {",
        "    baseUrl: 'http://localhost:4173',",
        "    specPattern: 'cypress/e2e/**/*.cy.js',",
        "    supportFile: false,",
        "  },",
        "};",
        "",
      ].join("\n"));

      await ctx.write("cypress/README.md", [
        "# The Cypress suite",
        "",
        "End to end specs that walk the ported site over its own server. Start the",
        "port with `npm run serve` (serve.js on port 4173), then in another shell",
        "run `npx cypress run`.",
        "",
        "`e2e/routes.cy.js` visits every route and asserts the page mounted (the",
        "layout wraps each page in `<main id=\"main\">`) and that the document has a",
        "title. `e2e/redirects.cy.js`, when the site retired any address, visits",
        "each old address and asserts the browser landed on the new path.",
        "",
        "These assert that the routes mount and the redirects land, not pixels.",
        "The routes and redirects both come from the site model.",
        "",
        `Routes walked: ${pages.length}. Redirect assertions: ${landed}.`,
        "",
      ].join("\n"));

      log.info(`cypress: ${pages.length} route spec(s), ${landed} redirect assertion(s)`);
    });
  },
};
