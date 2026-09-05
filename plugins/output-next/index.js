import { jsString } from "../dsp-ir/emit.js";
import { translate } from "../output-react/template.js";
import { flattenRedirects } from "../output-site/index.js";

/**
 * The Next.js target for the site engine: the same site model as an app
 * directory. The layout comes from the lifted chrome, one page per route
 * imports the component the run already emitted, and the redirect map lands
 * in next.config.mjs as the permanent redirects it always was. Nothing is
 * ported twice: the components under src/features are the single source and
 * these files only arrange them the way Next expects.
 *
 *   next: true
 */

/** /about -> app/about/page.jsx, / -> app/page.jsx, /a/b -> app/a/b/page.jsx */
const pageFile = (route) => (route === "/" ? "next/app/page.jsx" : `next/app${route}/page.jsx`);

/** How many directories deep the page sits under next/app, for the import walk. */
const depthOf = (route) => (route === "/" ? 0 : route.split("/").filter(Boolean).length);

export default {
  name: "output-next",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.next) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--next was asked for and there is no site model to arrange; the Next target needs --site true and a folder of pages.");
        return;
      }
      const site = ctx.site;
      const pages = site.pages;

      // The chrome, translated once by the same printer the layout used, and
      // arranged the way an app directory arranges it: around every page.
      const before = [];
      const after = [];
      for (const piece of site.chrome) {
        const result = translate(piece.html, { indent: 4 });
        for (const note of result.notes) ctx.unverified(`the next layout: ${note}`);
        (piece.tag === "footer" ? after : before).push(result.jsx);
      }
      const css = [...new Set(pages.flatMap((p) => (p.cssLinks ?? [])))];
      await ctx.write("next/app/layout.jsx", LAYOUT({
        before, after, css,
        title: pages.find((p) => p.route === "/")?.title ?? "ported site",
      }));

      for (const p of pages) {
        const up = "../".repeat(depthOf(p.route) + 2);
        await ctx.write(pageFile(p.route), [
          `import ${p.className} from ${jsString(`${up}src/features/${p.className}/${p.className}.jsx`)};`,
          "",
          `export const metadata = { title: ${jsString(p.title ?? p.route)}${p.description ? `, description: ${jsString(p.description)}` : ""} };`,
          "",
          `export default function Page() {`,
          `  return <${p.className} />;`,
          `}`,
          "",
        ].join("\n"));
      }

      // The old addresses answer in Next's own spelling: permanent redirects
      // in the config, exactly the map every other target carries.
      // This emitter can run before output-site lints the map, so the
      // chains flatten here too; flattening twice is a no-op and a cycle is
      // output-site's to fail loudly.
      const redirects = flattenRedirects(site.redirects).flat.filter((r) => r.to.startsWith("/"));
      await ctx.write("next/next.config.mjs", [
        "/** The redirect map, in this host's spelling. The same map ships as",
        " * redirects.json beside it; neither is the master, the run is. */",
        "const nextConfig = {",
        "  async redirects() {",
        "    return [",
        ...redirects.map((r) => `      { source: ${jsString(r.from)}, destination: ${jsString(r.to)}, permanent: true }, // ${r.kind}`),
        "    ];",
        "  },",
        "};",
        "export default nextConfig;",
        "",
      ].join("\n"));

      await ctx.write("next/README.md", [
        "# The Next.js arrangement",
        "",
        "The same site, arranged as an app directory. The components under",
        "`src/features/` are the single source; these files only import them,",
        "so a fix lands once and every target carries it.",
        "",
        "To run it, this directory needs Next itself, which the port does not",
        "bring: `npm i next react react-dom` beside `next/`, copy `public/`",
        "in, and `npx next dev`. The redirect map is live in",
        "`next.config.mjs`; the head data rides each page's `metadata`.",
        "",
        `Routes arranged: ${pages.length}. Redirects carried: ${redirects.length}.`,
        "",
      ].join("\n"));

      log.info(`next: ${pages.length} page(s) arranged, ${redirects.length} redirect(s) in next.config.mjs`);
    });
  },
};

const LAYOUT = ({ before, after, css, title }) => `/**
 * The lifted chrome, arranged once around every page the way the layout
 * always was. Styles are the site's own, served from public/.
 */
export const metadata = { title: ${jsString(title)} };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
${css.map((c) => `        <link rel="stylesheet" href=${jsString("/" + c)} />`).join("\n")}${css.length ? "\n" : ""}      </head>
      <body>
${before.join("\n")}${before.length ? "\n" : ""}        <main id="main">{children}</main>
${after.join("\n")}${after.length ? "\n" : ""}      </body>
    </html>
  );
}
`;
