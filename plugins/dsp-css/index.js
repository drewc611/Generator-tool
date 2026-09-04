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

  // Float scaffolding: a rule that floats and also sizes is laying out a
  // page, not wrapping text around an image. Named the way layout tables
  // are; performing the flex conversion stays a person's call.
  const floats = [];
  for (const m of bare.matchAll(/(^|\})\s*([^{}@]+)\{([^{}]*)\}/g)) {
    if (/float\s*:\s*(left|right)/.test(m[3]) && /(^|;)\s*width\s*:/.test(m[3])) {
      floats.push(m[2].trim().replace(/\s+/g, " "));
    }
  }

  return { file: rel, important, selectors: selectors.length, selectorList: selectors, ids, deep, repeated, floats };
}

/**
 * Selectors whose classes and ids appear in no template this run read.
 * Candidates and never verdicts, exactly as dsp-deadcode treats code: a class
 * assembled at runtime, or used by markup outside the run, looks unmatched
 * and is not. The report says what was searched.
 */
export function unmatchedSelectors(audits, templates) {
  const classes = new Set();
  const ids = new Set();
  for (const template of templates) {
    for (const m of template.matchAll(/class\s*=\s*["']([^"']*)["']/gi)) {
      for (const c of m[1].split(/\s+/)) if (c && !/[{$]/.test(c)) classes.add(c);
    }
    // Conditional classes live as keys of an object literal in a binding.
    for (const m of template.matchAll(/(?:ng-class|ko-css|:class)\s*=\s*["']\{([^"']*)\}["']/gi)) {
      for (const k of m[1].matchAll(/['"]?([\w-]+)['"]?\s*:/g)) classes.add(k[1]);
    }
    for (const m of template.matchAll(/\bid\s*=\s*["']([\w-]+)["']/gi)) ids.add(m[1]);
  }
  const out = [];
  for (const audit of audits) {
    for (const selector of audit.selectorList ?? []) {
      const cls = [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
      const idTokens = [...selector.matchAll(/#([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
      if (!cls.length && !idTokens.length) continue;
      if (cls.every((c) => !classes.has(c)) && idTokens.every((i) => !ids.has(i))) {
        out.push({ file: audit.file, selector });
      }
    }
  }
  return out;
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

      const floated = audits.flatMap((a) => a.floats.map((s) => ({ file: a.file, selector: s })));
      if (floated.length) {
        ctx.unverified(
          `${floated.length} rule(s) float and size at once, which is layout done with float scaffolding ` +
          `(${floated.slice(0, 4).map((f) => f.selector).join(", ")}${floated.length > 4 ? ", …" : ""}). ` +
          `Flex is the port's shape; performing that rewrite is a person's call, and CSS_STATS.md lists every rule.`
        );
      }

      const templates = ctx.screens.map((s) => s.template).filter(Boolean);
      if (templates.length) {
        ctx.cssUnmatched = unmatchedSelectors(audits, templates);
        if (ctx.cssUnmatched.length) {
          ctx.unverified(
            `${ctx.cssUnmatched.length} selector(s) match no class or id in any template this run read. ` +
            `Candidates, not verdicts: a class assembled at runtime, or markup outside the run, would look ` +
            `exactly like this. CSS_STATS.md lists them with what was searched.`
          );
        }
      }
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
        if (a.floats.length) {
          lines.push(`- Float scaffolding, proposed for flex and left in place:`);
          for (const s of a.floats.slice(0, 10)) lines.push(`  - \`${s}\` floats and sizes at once`);
        }
        lines.push("");
      }
      if (ctx.cssUnmatched?.length) {
        lines.push("## Selectors matching nothing this run read", "");
        lines.push("Candidates, never verdicts. The search covered the class and id attributes");
        lines.push("and the conditional class bindings of every template in the run; a class");
        lines.push("assembled at runtime, or markup outside the run, is invisible to it.", "");
        for (const u of ctx.cssUnmatched.slice(0, 40)) lines.push(`- \`${u.selector}\` (${u.file})`);
        if (ctx.cssUnmatched.length > 40) lines.push(`- … and ${ctx.cssUnmatched.length - 40} more.`);
        lines.push("");
      }
      await ctx.write("CSS_STATS.md", lines.join("\n"));
    });
  },
};
