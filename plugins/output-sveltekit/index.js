import { jsString } from "../dsp-ir/emit.js";
import { toSvelte } from "../output-svelte/print.js";
import { flattenRedirects } from "../output-site/index.js";

/**
 * The SvelteKit target for the site engine: the same site model as a SvelteKit
 * app. `+layout.svelte` carries the lifted chrome, one `+page.svelte` per route
 * imports the Svelte component the run already emitted, and the redirect map
 * lands in `hooks.server.js`, which is where SvelteKit answers an old address.
 * It ports nothing twice: the components under src/features are the single
 * source. It needs the Svelte components, so it asks for --svelte when they
 * are not there.
 *
 *   sveltekit: true
 */

/** /about -> sveltekit/src/routes/about/+page.svelte, / -> .../routes/+page.svelte */
function pageFile(route) {
  const segs = route === "/" ? [] : route.split("/").filter(Boolean);
  return `sveltekit/src/routes/${segs.length ? segs.join("/") + "/" : ""}+page.svelte`;
}

/** The `../` walk from a +page.svelte back to the output root, then into src. */
function importUp(route) {
  const segs = route === "/" ? [] : route.split("/").filter(Boolean);
  // src/routes/<segs...>/+page.svelte sits 3 + segs dirs under the output root.
  return "../".repeat(3 + segs.length);
}

export default {
  name: "output-sveltekit",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.sveltekit) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--sveltekit was asked for and there is no site model to arrange; it needs --site true and a folder of pages.");
        return;
      }
      if (!ctx.config.svelte) {
        ctx.unverified("--sveltekit arranges Svelte components; run with --svelte true so the components it imports are emitted.");
      }
      const { pages, chrome, redirects: redirectMap } = ctx.site;

      const before = [];
      const after = [];
      for (const piece of chrome) {
        const result = toSvelte(piece.html);
        (piece.tag === "footer" ? after : before).push(result.markup);
      }
      const css = [...new Set(pages.flatMap((p) => (p.cssLinks ?? [])))];
      await ctx.write("sveltekit/src/routes/+layout.svelte", LAYOUT({ before, after, css }));

      for (const p of pages) {
        const path = `${importUp(p.route)}src/features/${p.className}/${p.className}.svelte`;
        await ctx.write(pageFile(p.route), [
          "<script>",
          `  import ${p.className} from ${jsString(path)};`,
          "</script>",
          "",
          "<svelte:head>",
          `  <title>${(p.title ?? p.route).replace(/</g, "&lt;")}</title>`,
          p.description ? `  <meta name="description" content=${jsString(p.description)} />` : "",
          "</svelte:head>",
          "",
          `<${p.className} />`,
          "",
        ].filter((l) => l !== "").join("\n"));
      }

      const redirects = flattenRedirects(redirectMap).flat.filter((r) => r.to.startsWith("/"));
      await ctx.write("sveltekit/src/hooks.server.js", [
        "// The redirect map, in this host's spelling: SvelteKit answers an old",
        "// address from the server hook. The same map ships as redirects.json",
        "// beside it; neither is the master, the run is.",
        'import { redirect } from "@sveltejs/kit";',
        "",
        "const REDIRECTS = {",
        ...redirects.map((r) => `  ${jsString(r.from)}: ${jsString(r.to)}, // ${r.kind}`),
        "};",
        "",
        "export function handle({ event, resolve }) {",
        "  const to = REDIRECTS[event.url.pathname];",
        "  if (to) throw redirect(301, to);",
        "  return resolve(event);",
        "}",
        "",
      ].join("\n"));

      await ctx.write("sveltekit/README.md", [
        "# The SvelteKit arrangement",
        "",
        "The same site, arranged as a SvelteKit app. The Svelte components under",
        "`src/features/` are the single source; these files only import them.",
        "",
        "To run it: `npm i @sveltejs/kit svelte` beside `sveltekit/`, emit the",
        "Svelte components with `--svelte true`, copy `public/` in, and",
        "`npx vite dev`. The redirect map is live in `src/hooks.server.js`; the",
        "head data rides each page's `<svelte:head>`.",
        "",
        `Routes arranged: ${pages.length}. Redirects carried: ${redirects.length}.`,
        "",
      ].join("\n"));

      log.info(`sveltekit: ${pages.length} route(s) arranged, ${redirects.length} redirect(s) in hooks.server.js`);
    });
  },
};

const LAYOUT = ({ before, after, css }) => `<script>
  import { page } from "$app/stores";
</script>

<svelte:head>
${css.map((c) => `  <link rel="stylesheet" href=${jsString("/" + c)} />`).join("\n")}${css.length ? "\n" : ""}</svelte:head>

${before.join("\n")}${before.length ? "\n" : ""}<main id="main"><slot /></main>
${after.join("\n")}${after.length ? "\n" : ""}`;
