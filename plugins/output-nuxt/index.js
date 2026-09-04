import { jsString } from "../dsp-ir/emit.js";
import { toVue } from "../output-vue/print.js";
import { flattenRedirects } from "../output-site/index.js";

/**
 * The Nuxt target for the site engine: the same site model as a Nuxt app.
 * `app.vue` carries the lifted chrome, one file per route under `pages/`
 * imports the Vue component the run already emitted, and the redirect map
 * lands in `nuxt.config.ts` as routeRules. Like output-next, it ports nothing
 * twice: the components under src/features are the single source and these
 * files only arrange them the way Nuxt expects. It needs the Vue components,
 * so it asks for --vue when they are not there.
 *
 *   nuxt: true
 */

/** /about -> nuxt/pages/about.vue, / -> nuxt/pages/index.vue, /a/b -> nuxt/pages/a/b.vue */
function pageFile(route) {
  if (route === "/") return "nuxt/pages/index.vue";
  return `nuxt/pages/${route.replace(/^\//, "").replace(/\/$/, "")}.vue`;
}

/** The `../` walk from a page file back to the output root, then into src. */
function importUp(route) {
  const segs = route === "/" ? [] : route.split("/").filter(Boolean);
  // pages/<segs...>.vue sits 1 + (segs-1) dirs under nuxt/, plus nuxt itself.
  return "../".repeat(2 + Math.max(0, segs.length - 1));
}

export default {
  name: "output-nuxt",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.nuxt) return log.debug("not requested");
      if (!ctx.site?.pages?.length) {
        ctx.unverified("--nuxt was asked for and there is no site model to arrange; the Nuxt target needs --site true and a folder of pages.");
        return;
      }
      if (!ctx.config.vue) {
        ctx.unverified("--nuxt arranges Vue components; run with --vue true so the components it imports are emitted.");
      }
      const { pages, chrome, redirects: redirectMap } = ctx.site;

      const before = [];
      const after = [];
      for (const piece of chrome) {
        const result = toVue(piece.html);
        (piece.tag === "footer" ? after : before).push(result.markup);
      }
      const css = [...new Set(pages.flatMap((p) => (p.cssLinks ?? [])))];
      await ctx.write("nuxt/app.vue", APP({ before, after, css }));

      for (const p of pages) {
        const path = `${importUp(p.route)}src/features/${p.className}/${p.className}.vue`;
        await ctx.write(pageFile(p.route), [
          "<script setup>",
          `import ${p.className} from ${jsString(path)};`,
          `useHead({ title: ${jsString(p.title ?? p.route)}${p.description ? `, meta: [{ name: "description", content: ${jsString(p.description)} }]` : ""} });`,
          "</script>",
          "",
          "<template>",
          `  <${p.className} />`,
          "</template>",
          "",
        ].join("\n"));
      }

      const redirects = flattenRedirects(redirectMap).flat.filter((r) => r.to.startsWith("/"));
      await ctx.write("nuxt/nuxt.config.ts", [
        "// The redirect map, in this host's spelling. The same map ships as",
        "// redirects.json beside it; neither is the master, the run is.",
        "export default defineNuxtConfig({",
        "  routeRules: {",
        ...redirects.map((r) => `    ${jsString(r.from)}: { redirect: { to: ${jsString(r.to)}, statusCode: 301 } }, // ${r.kind}`),
        "  },",
        "});",
        "",
      ].join("\n"));

      await ctx.write("nuxt/README.md", [
        "# The Nuxt arrangement",
        "",
        "The same site, arranged as a Nuxt app. The Vue components under",
        "`src/features/` are the single source; these files only import them,",
        "so a fix lands once and every target carries it.",
        "",
        "To run it: `npm i nuxt vue` beside `nuxt/`, emit the Vue components",
        "with `--vue true`, copy `public/` in, and `npx nuxi dev`. The redirect",
        "map is live in `nuxt.config.ts`; the head data rides each page's",
        "`useHead`.",
        "",
        `Routes arranged: ${pages.length}. Redirects carried: ${redirects.length}.`,
        "",
      ].join("\n"));

      log.info(`nuxt: ${pages.length} page(s) arranged, ${redirects.length} redirect(s) in nuxt.config.ts`);
    });
  },
};

const APP = ({ before, after, css }) => `<script setup>
${css.map((c) => `useHead({ link: [{ rel: "stylesheet", href: ${jsString("/" + c)} }] });`).join("\n")}${css.length ? "\n" : ""}</script>

<template>
  <div>
${before.map((b) => "    " + b.replace(/\n/g, "\n    ")).join("\n")}${before.length ? "\n" : ""}    <main id="main"><NuxtPage /></main>
${after.map((a) => "    " + a.replace(/\n/g, "\n    ")).join("\n")}${after.length ? "\n" : ""}  </div>
</template>
`;
