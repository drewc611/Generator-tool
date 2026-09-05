import { jsString } from "../dsp-ir/emit.js";
import { toHtml } from "../output-html/print.js";
import { flattenRedirects } from "../output-site/index.js";

/**
 * The Eleventy target for the site engine: the same site model as an
 * Eleventy project, the most common destination for a folder of old static
 * pages because it needs no client framework at all. The lifted chrome
 * becomes `_includes/layout.njk`, one template per route carries that
 * screen's markup printed to static HTML with its title and description in
 * front matter, and the redirect map lands as a data file plus a template
 * that writes `_redirects` at the site root, which is how an Eleventy site
 * carries redirects natively.
 *
 * Eleventy renders static HTML and runs nothing on the client, so a screen
 * that carries handlers, two way bindings or events is arranged here as its
 * static markup and named in the notes: that behaviour does not run on an
 * Eleventy page, and the port owner decides whether that page stays static
 * or lives as an Astro island or in the React app instead. Nothing is
 * translated twice; the markup is printed by the same static printer
 * output-html proves.
 *
 * The ported markup is wrapped in Nunjucks raw blocks, because Eleventy's
 * default engine would otherwise read the page's own interpolations as its
 * variables and render them empty.
 *
 *   eleventy: true
 */

/** /about -> eleventy/pages/about.njk, / -> eleventy/pages/index.njk */
function pageFile(route) {
  if (route === "/") return "eleventy/pages/index.njk";
  return `eleventy/pages/${route.replace(/^\//, "").replace(/\/$/, "")}.njk`;
}

const permalink = (route) => (route === "/" ? "/" : `${route.replace(/\/$/, "")}/`);
const raw = (markup) => (markup ? `{% raw %}${markup}{% endraw %}` : "");

export default {
  name: "output-eleventy",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.eleventy) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--eleventy was asked for and there is no site model to arrange; the Eleventy target needs --site true and a folder of pages.");
        return;
      }
      const { pages, chrome, redirects: redirectMap } = ctx.site;

      const before = [];
      const after = [];
      for (const piece of chrome) {
        const printed = toHtml(piece.html);
        (piece.tag === "footer" ? after : before).push(printed.markup);
      }
      const css = [...new Set(pages.flatMap((p) => p.cssLinks ?? []))];
      await ctx.write("eleventy/_includes/layout.njk", LAYOUT({ before, after, css }));

      const behaved = [];
      for (const p of pages) {
        const screen = ctx.screens.find((s) => s.selector === p.selector);
        const printed = screen?.template ? toHtml(screen.template) : { markup: "", handlers: [] };
        const dynamic = printed.handlers.length > 0 || Boolean(screen?.usesTwoWay) || (screen?.outputs?.length ?? 0) > 0;
        if (dynamic) behaved.push(p.route);
        await ctx.write(pageFile(p.route), PAGE({ page: p, markup: printed.markup, dynamic }));
      }

      const redirects = flattenRedirects(redirectMap).flat.filter((r) => r.to.startsWith("/"));
      await ctx.write("eleventy/_data/redirects.json", JSON.stringify(redirects.map(({ from, to, kind }) => ({ from, to, kind })), null, 2) + "\n");
      await ctx.write("eleventy/pages/_redirects.njk", REDIRECTS_TEMPLATE);
      await ctx.write("eleventy/eleventy.config.js", CONFIG);
      await ctx.write("eleventy/README.md", README({ pages: pages.length, redirects: redirects.length, behaved }));

      if (behaved.length) {
        ctx.unverified(
          `Eleventy renders static HTML and runs nothing on the client; ${behaved.length} page(s) (${behaved.join(", ")}) carry client ` +
          "behaviour (handlers, two way bindings or events) the Eleventy page does not run. Keep those as Astro islands or in the React app, or accept them as static."
        );
      }
      log.info(`${pages.length} eleventy page(s), ${redirects.length} redirect(s) as _redirects${behaved.length ? `, ${behaved.length} static of a dynamic screen` : ""}`);
    });
  },
};

const LAYOUT = ({ before, after, css }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title }}</title>
  {% if description %}<meta name="description" content="{{ description }}">{% endif %}
${css.map((href) => `  <link rel="stylesheet" href="${href}">`).join("\n")}
</head>
<body>
${raw(before.join("\n"))}
<main id="main">
{{ content | safe }}
</main>
${raw(after.join("\n"))}
</body>
</html>
`;

const PAGE = ({ page, markup, dynamic }) => [
  "---",
  "layout: layout.njk",
  `title: ${JSON.stringify(page.title ?? page.route)}`,
  ...(page.description ? [`description: ${JSON.stringify(page.description)}`] : []),
  `permalink: ${JSON.stringify(permalink(page.route))}`,
  "---",
  `{# Ported from ${page.rel ?? page.route} by portamp. Eleventy static target.${dynamic ? " This screen carries client behaviour that does not run on a static page; see README.md." : ""} #}`,
  raw(markup),
  "",
].join("\n");

// A template with a permalink at the site root writes the redirect file the
// static hosts read; the data file beside it is the same flattened map every
// other host target carries.
const REDIRECTS_TEMPLATE = `---
permalink: /_redirects
eleventyExcludeFromCollections: true
---
{%- for r in redirects %}
{{ r.from }} {{ r.to }} 301
{%- endfor %}
`;

const CONFIG = `// Eleventy over the ported pages. Nothing here is a build of the components;
// the pages are the screens printed to static HTML, and the layout is the
// chrome the old site shared.
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "../public": "/" });
  return {
    dir: { input: "pages", includes: "../_includes", data: "../_data", output: "_site" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
`;

const README = ({ pages, redirects, behaved }) => `# The Eleventy arrangement

The same site, arranged as an Eleventy project: no client framework, just the
pages the old site had, printed to static HTML, under the layout lifted from
its shared chrome.

- \`_includes/layout.njk\` is the chrome, with the page's title and
  description in the head.
- \`pages/<route>.njk\` is one template per route, its markup printed by the
  same static printer output-html proves, wrapped in raw blocks so Eleventy
  does not read the page's own interpolations as its variables.
- \`_data/redirects.json\` is the flattened redirect map the run produced, and
  \`pages/_redirects.njk\` writes it to \`_site/_redirects\`, the file Netlify
  and Cloudflare Pages read; the same map every other host target carries.

To build: \`npm i @11ty/eleventy\` beside \`eleventy/\` and \`npx @11ty/eleventy\`;
the site lands in \`_site/\`.

Pages: ${pages}. Redirects: ${redirects}.
${behaved.length ? `
## What a static page does not run

${behaved.length} page(s) carry client behaviour, handlers, two way bindings
or events, that an Eleventy page does not run: ${behaved.join(", ")}. They are
arranged here as their static markup so the site is whole; keep them as Astro
islands (\`--astro true\`) or in the React app where that behaviour matters.
` : ""}`;
