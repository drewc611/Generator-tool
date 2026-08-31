import { readFile } from "node:fs/promises";

/**
 * The stylesheet, weighed. Nothing here rewrites CSS; it measures the habits
 * that make a stylesheet hard to carry: !important, id selectors, deep
 * descendant chains, and declarations repeated verbatim in many places. Each
 * number is evidence for how much of the old cascade the port should keep,
 * which is usually none, and the report says where the pressure is.
 */

export function auditCss(text, rel) {
  // Comments and strings out first, so a selector inside either is not counted.
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');

  const important = [];
  for (const m of bare.matchAll(/!\s*important/g)) {
    important.push(bare.slice(0, m.index).split("\n").length);
  }

  const selectors = [];
  for (const m of bare.matchAll(/(^|\})\s*([^{}@]+)\{/g)) {
    for (const one of m[2].split(",")) {
      const s = one.trim();
      if (s) selectors.push(s);
    }
  }

  const ids = selectors.filter((s) => /#[\w-]/.test(s));
  const deep = selectors.filter((s) => s.split(/\s+|>/).filter(Boolean).length >= 4);

  const declarations = new Map();
  for (const m of bare.matchAll(/([\w-]+)\s*:\s*([^;{}]+);/g)) {
    const key = `${m[1].trim()}: ${m[2].trim().replace(/\s+/g, " ")}`;
    declarations.set(key, (declarations.get(key) ?? 0) + 1);
  }
  const repeated = [...declarations.entries()].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]);

  return { file: rel, important, selectors: selectors.length, ids, deep, repeated };
}

export default {
  name: "dsp-css",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const sheets = ctx.sources.files.filter((f) => /\.(css|scss|less)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      if (!sheets.length) return log.debug("no stylesheets");

      const audits = [];
      for (const file of sheets) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) audits.push(auditCss(text, file.rel));
      }
      ctx.cssStats = audits;
      const importantCount = audits.reduce((n, a) => n + a.important.length, 0);
      log.info(`${sheets.length} sheet(s), ${importantCount} !important`);
    });

    on("emit", async (ctx) => {
      if (!ctx.cssStats?.length) return;
      const lines = [
        "# The stylesheet, weighed",
        "",
        "Measured, not judged. High numbers here are the reason the port writes",
        "styles from tokens instead of carrying the cascade across.",
        "",
      ];
      for (const a of ctx.cssStats) {
        lines.push(`## \`${a.file}\``, "");
        lines.push(`- ${a.selectors} selector(s); ${a.ids.length} use an id; ${a.deep.length} are four levels deep or more.`);
        lines.push(
          a.important.length
            ? `- \`!important\` appears ${a.important.length} time(s), at line(s) ${a.important.slice(0, 12).join(", ")}${a.important.length > 12 ? ", …" : ""}. Every one is a fight the cascade already lost once.`
            : "- No `!important`. The cascade was winnable here."
        );
        if (a.repeated.length) {
          lines.push(`- Declarations repeated four times or more, which is what a token exists for:`);
          for (const [decl, n] of a.repeated.slice(0, 10)) lines.push(`  - \`${decl}\` × ${n}`);
        }
        lines.push("");
      }
      await ctx.write("CSS_STATS.md", lines.join("\n"));
    });
  },
};
