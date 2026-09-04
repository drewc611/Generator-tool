import { readFile } from "node:fs/promises";

/**
 * What the app points at besides code: images, fonts, media, icons. Two
 * questions, both answerable statically: what does the tree hold, and what do
 * the templates and stylesheets reference that the tree does not hold. A
 * reference into nothing ships as a broken image, and it is cheaper to read
 * the list now than to find them one by one in the port.
 *
 * A URL built at runtime cannot be resolved here and is counted, not judged.
 */

const ASSET = /\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav|pdf)$/i;

export function findReferences(text, rel) {
  const refs = [];
  const push = (target, kind) => refs.push({ target: target.trim(), kind, file: rel });
  for (const m of text.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) push(m[1], "markup");
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) push(m[1], "css");
  return refs.filter(
    (r) =>
      ASSET.test(r.target.split(/[?#]/)[0]) &&
      !/^[a-z][\w+.-]*:|^\/\//i.test(r.target) &&
      !/[{$<%]/.test(r.target)
  );
}

export default {
  name: "dsp-assets",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const held = ctx.sources.files.filter((f) => ASSET.test(f.rel));
      const referencing = ctx.sources.files.filter((f) => /\.(html?|css|scss|less|vue|js|ts|jsx|tsx)$/i.test(f.rel) && !/\.min\./.test(f.rel));

      const references = [];
      for (const file of referencing) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) references.push(...findReferences(text, file.rel));
      }
      if (!held.length && !references.length) return log.debug("no assets");

      const paths = new Set(held.map((f) => f.rel.replace(/^\.\//, "")));
      const resolve = (from, target) => {
        const clean = target.split(/[?#]/)[0].replace(/^\.\//, "").replace(/^\//, "");
        if (paths.has(clean)) return clean;
        const joined = [from.split("/").slice(0, -1).join("/"), clean].filter(Boolean).join("/").replace(/\/+/g, "/");
        if (paths.has(joined)) return joined;
        // A build may serve from a folder the repo nests differently, so a
        // basename match counts as found rather than crying wolf.
        const base = clean.split("/").pop();
        return [...paths].find((p) => p.endsWith(`/${base}`) || p === base) ?? null;
      };

      const referenced = new Set();
      const dead = [];
      for (const ref of references) {
        const hit = resolve(ref.file, ref.target);
        if (hit) referenced.add(hit);
        else dead.push(ref);
      }
      const unreferenced = held.filter((f) => !referenced.has(f.rel.replace(/^\.\//, "")));

      ctx.assets = { held, references, dead, unreferenced };
      log.info(`${held.length} asset(s), ${dead.length} dead reference(s)`);
      if (dead.length) {
        ctx.unverified(
          `${dead.length} asset reference(s) point at files not in this tree. They may live on a server or a CDN path the build maps; ASSETS.md lists each one.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.assets) return;
      const { held, dead, unreferenced } = ctx.assets;
      const lines = [
        "# Assets",
        "",
        "What the tree holds and what the code points at. A dead reference here",
        "may be served by the legacy server from a path the repo does not mirror;",
        "each one needs an answer before the port ships.",
        "",
        `## Held in the tree  (${held.length})`,
        "",
        ...held.map((f) => `- \`${f.rel}\``),
        "",
      ];
      if (dead.length) {
        lines.push(`## Referenced and not found  (${dead.length})`, "");
        for (const ref of dead) lines.push(`- \`${ref.target}\` from \`${ref.file}\` (${ref.kind})`);
        lines.push("");
      }
      if (unreferenced.length) {
        lines.push(
          `## Held and never referenced  (${unreferenced.length})`,
          "",
          "Candidates, not verdicts: a path assembled at runtime does not appear in this scan.",
          "",
          ...unreferenced.map((f) => `- \`${f.rel}\``),
          ""
        );
      }
      await ctx.write("ASSETS.md", lines.join("\n"));
    });
  },
};
