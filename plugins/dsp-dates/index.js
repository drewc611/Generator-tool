import { readFile } from "node:fs/promises";

/**
 * Every way the app handles a date, found before each becomes a bug twice.
 *
 * Date handling is where a port silently diverges: the old app assembled
 * dates by hand in one timezone assumption and one digit order, and a rebuilt
 * app that uses a library gets different answers on exactly the inputs nobody
 * tests. The findings are the places, not fixes; the fix is one decision made
 * once, and this list is what it has to cover.
 */

const PATTERNS = [
  {
    kind: "ambiguous-format",
    re: /['"`](?:DD|MM)[\/\-.](?:DD|MM)[\/\-.](?:YYYY|YY)['"`]/g,
    why: "a day month order that reads differently on each side of an ocean. 03/04 is March or April depending on who is looking.",
    severity: "high",
  },
  {
    kind: "hand-assembled",
    re: /getMonth\(\)\s*\+\s*1|getDate\(\)\s*\+\s*['"`\/\-]|getFullYear\(\)\s*\+\s*['"`]/g,
    why: "a date assembled by string concatenation carries every assumption of whoever wrote it: padding, order, and timezone.",
    severity: "medium",
  },
  {
    kind: "string-parsed",
    re: /new Date\(\s*['"`]\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}['"`]/g,
    why: "new Date on a slash string is implementation defined; two browsers can disagree about which month this is.",
    severity: "high",
  },
  {
    kind: "manual-offset",
    re: /getTimezoneOffset|[+-]\s*(?:5|6|7|8)\s*\*\s*60\s*\*\s*60|['"`]GMT[+-]\d/g,
    why: "a timezone corrected by arithmetic is correct twice a year at best; the correction lives on after the office moves.",
    severity: "high",
  },
  {
    kind: "moment-format",
    re: /moment\([^)]*\)\s*\.\s*format\s*\(/g,
    why: "moment formatting sites, each a place the port's formatting decision has to reach.",
    severity: "low",
  },
  {
    kind: "locale-hardcoded",
    re: /toLocale(?:Date|Time)?String\s*\(\s*['"`][a-z]{2}(?:-[A-Z]{2})?['"`]/g,
    why: "a locale fixed in code, so the app renders one country's dates to every country.",
    severity: "medium",
  },
];

export function auditDates(text, rel) {
  const findings = [];
  for (const { kind, re, why, severity } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\n").length;
      findings.push({ kind, severity, where: `${rel}:${line}`, sample: m[0].slice(0, 50), why });
    }
  }
  return findings;
}

export default {
  name: "dsp-dates",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const findings = [];
      for (const file of ctx.sources.files.filter((f) => /\.(js|ts|html?|vue)$/.test(f.rel) && !/\.min\./.test(f.rel))) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) findings.push(...auditDates(text, file.rel));
      }
      if (!findings.length) return log.debug("no date handling found");
      ctx.dates = findings;
      log.info(`${findings.length} date handling site(s), ${findings.filter((f) => f.severity === "high").length} that can change answers`);
    });

    on("emit", async (ctx) => {
      if (!ctx.dates) return;
      const rows = ctx.dates.map((f) => `| ${f.severity} | ${f.kind} | \`${f.where}\` | \`${f.sample}\` |`);
      const kinds = [...new Set(ctx.dates.map((f) => f.kind))];
      await ctx.write("DATES.md", `# Every place the app touches a date

Date handling is where a port silently diverges: the old app carries one set
of assumptions about digit order, padding and timezone, and a rebuild that
formats "properly" gets different answers on exactly the inputs nobody tests.

Make the formatting decision once, then walk this table and point every site
at it.

| severity | kind | where | sample |
| --- | --- | --- | --- |
${rows.join("\n")}

${kinds.map((k) => `- **${k}**: ${PATTERNS.find((p) => p.kind === k).why}`).join("\n")}
`);
    });
  },
};
