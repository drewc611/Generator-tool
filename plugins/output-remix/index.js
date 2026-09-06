import { jsString } from "../dsp-ir/emit.js";
import { translate } from "../output-react/template.js";
import { flattenRedirects } from "../output-site/index.js";

/**
 * The Remix target for the site engine: routes as route modules, and the
 * redirect map as loaders that answer the real 301. The components under
 * src/features stay the single source; these files only arrange them the
 * way Remix expects, and a retired address gets a route module whose whole
 * job is the redirect it always promised.
 *
 *   remix: true
 */

/** Flat route file names, Remix v2 convention: "/" -> _index, "/a/b" -> a.b,
 * and a literal dot in an old address is escaped as [.] so about[.]html
 * answers for /about.html. */
export function remixRouteFile(route) {
  if (route === "/") return "_index";
  return route
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/\./g, "[.]"))
    .join(".");
}

export default {
  name: "output-remix",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.remix) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--remix was asked for and there is no site model to arrange; the Remix target needs --site true and a folder of pages.");
        return;
      }
      const site = ctx.site;
      const pages = site.pages;

      const before = [];
      const after = [];
      for (const piece of site.chrome) {
        const result = translate(piece.html, { indent: 4 });
        for (const note of result.notes) ctx.unverified(`the remix root: ${note}`);
        (piece.tag === "footer" ? after : before).push(result.jsx);
      }
      const css = [...new Set(pages.flatMap((p) => (p.cssLinks ?? [])))];
      await ctx.write("remix/app/root.jsx", ROOT({ before, after, css }));

      for (const p of pages) {
        await ctx.write(`remix/app/routes/${remixRouteFile(p.route)}.jsx`, [
          `import ${p.className} from ${jsString(`../../../src/features/${p.className}/${p.className}.jsx`)};`,
          "",
          `export const meta = () => [{ title: ${jsString(p.title ?? p.route)} }${p.description ? `, { name: "description", content: ${jsString(p.description)} }` : ""}];`,
          "",
          `export default function Route() {`,
          `  return <${p.className} />;`,
          `}`,
          "",
        ].join("\n"));
      }

      // A retired address is a route module whose loader is the 301 it
      // always promised; the browser and the crawler both hear the truth.
      // This emitter can run before output-site lints the map, so the
      // chains flatten here too; flattening twice is a no-op and a cycle is
      // output-site's to fail loudly.
      const redirects = flattenRedirects(site.redirects).flat.filter((r) => r.to.startsWith("/"));
      const taken = new Set(pages.map((p) => remixRouteFile(p.route)));
      let landed = 0;
      for (const r of redirects) {
        const file = remixRouteFile(r.from);
        if (taken.has(file)) {
          ctx.unverified(`the remix target: ${r.from} both renders and redirects in the map; the page wins and the redirect is left to the map's other spellings.`);
          continue;
        }
        taken.add(file);
        await ctx.write(`remix/app/routes/${file}.jsx`, [
          `import { redirect } from "@remix-run/node";`,
          "",
          `/** ${r.kind}: the address this file answers for retired into ${r.to}. */`,
          `export const loader = () => redirect(${jsString(r.to)}, 301);`,
          "",
        ].join("\n"));
        landed += 1;
      }

      await ctx.write("remix/README.md", [
        "# The Remix arrangement",
        "",
        "The same site as route modules. The components under `src/features/`",
        "are the single source; these files only import them. Every retired",
        "address is a route module whose loader answers the real 301, so the",
        "redirect map is live server side, not an annotation.",
        "",
        "To run it, this directory needs Remix itself, which the port does",
        "not bring: scaffold a Remix app beside it, point it at `app/`, and",
        "copy `public/` in.",
        "",
        `Routes arranged: ${pages.length}. Redirect modules: ${landed}.`,
        "",
      ].join("\n"));

      log.info(`remix: ${pages.length} route module(s), ${landed} redirect loader(s)`);
    });
  },
};

const ROOT = ({ before, after, css }) => `/**
 * The lifted chrome, arranged once around every route the way the layout
 * always was. Styles are the site's own, served from public/.
 */
import { Links, Meta, Outlet, Scripts } from "@remix-run/react";

export const links = () => [
${css.map((c) => `  { rel: "stylesheet", href: ${jsString("/" + c)} },`).join("\n")}${css.length ? "\n" : ""}];

export default function Root() {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
${before.join("\n")}${before.length ? "\n" : ""}        <main id="main"><Outlet /></main>
${after.join("\n")}${after.length ? "\n" : ""}        <Scripts />
      </body>
    </html>
  );
}
`;
