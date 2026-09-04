import { readFile } from "node:fs/promises";

/**
 * Carbon dating for a front end. Markup carries its era the way tree rings
 * carry weather: a frameset says the nineties, a viewport meta says phones
 * existed, a grid declaration says this decade. Each signal below names the
 * years it argues for; the verdict is a range with its evidence, and a
 * spread of signals is reported as a site built across eras, because most
 * of them were.
 */

const SIGNALS = [
  { id: "frameset", from: 1994, to: 2000, test: (t) => /<frameset\b/i.test(t), says: "a frameset" },
  { id: "font-tag", from: 1995, to: 2001, test: (t) => /<font\b/i.test(t), says: "the <font> element" },
  { id: "marquee", from: 1995, to: 2000, test: (t) => /<(marquee|blink)\b/i.test(t), says: "text that moves for effect" },
  { id: "layout-table", from: 1996, to: 2005, test: (t) => /<table\b[^>]*\bborder\s*=\s*["']?0/i.test(t), says: "a borderless layout table" },
  { id: "ssi", from: 1995, to: 2004, test: (t) => /<!--#include\s/i.test(t), says: "a server side include" },
  { id: "html4-doctype", from: 1997, to: 2008, test: (t) => /<!DOCTYPE HTML PUBLIC/i.test(t), says: "an HTML 4 or transitional doctype" },
  { id: "latin1", from: 1995, to: 2008, test: (t) => /charset\s*=\s*["']?(iso-8859-1|windows-1252)/i.test(t), says: "a latin1 charset declaration" },
  { id: "spacer-gif", from: 1996, to: 2004, test: (t) => /spacer\.gif|1x1\.gif|clear\.gif/i.test(t), says: "a spacer gif" },
  { id: "inline-events", from: 1996, to: 2008, test: (t) => /\bonclick\s*=\s*["']/i.test(t), says: "inline event handlers" },
  { id: "php-classic", from: 1998, to: 2012, test: (t, rel) => /\.(php|asp)$/i.test(rel), says: "a server page extension" },
  { id: "jquery", from: 2006, to: 2016, test: (t) => /jquery(\.min)?(-[\d.]+)?\.js/i.test(t), says: "a jQuery script tag" },
  { id: "html5-doctype", from: 2009, to: 2026, test: (t) => /<!DOCTYPE html>/i.test(t), says: "the HTML5 doctype" },
  { id: "semantic-tags", from: 2010, to: 2026, test: (t) => /<(nav|article|section|footer|header)\b/i.test(t), says: "semantic HTML5 elements" },
  { id: "viewport", from: 2010, to: 2026, test: (t) => /name\s*=\s*["']viewport["']/i.test(t), says: "a viewport meta, so phones existed" },
  { id: "flexbox", from: 2013, to: 2026, test: (t) => /display\s*:\s*flex/i.test(t), says: "flexbox" },
  { id: "grid", from: 2017, to: 2026, test: (t) => /display\s*:\s*grid/i.test(t), says: "CSS grid" },
  { id: "og-tags", from: 2010, to: 2026, test: (t) => /property\s*=\s*["']og:/i.test(t), says: "Open Graph tags" },
];

export function readEra(files) {
  const found = [];
  for (const signal of SIGNALS) {
    const where = files.filter((f) => signal.test(f.text, f.rel)).map((f) => f.rel);
    if (where.length) found.push({ ...signal, on: where.slice(0, 3), count: where.length });
  }
  if (!found.length) return { verdict: null, signals: [] };
  // The verdict is where the signals overlap most: count, per year, how
  // many signals include it, and take the best stretch.
  const votes = new Map();
  for (const s of found) for (let y = s.from; y <= s.to; y += 1) votes.set(y, (votes.get(y) ?? 0) + 1);
  const best = Math.max(...votes.values());
  const years = [...votes.entries()].filter(([, v]) => v === best).map(([y]) => y).sort((a, b) => a - b);
  const spread = found.some((s) => s.from >= 2009) && found.some((s) => s.to <= 2008);
  return {
    verdict: { from: years[0], to: years[years.length - 1], agreeing: best, of: found.length },
    spread,
    signals: found,
  };
}

export default {
  name: "dsp-era",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = [];
      for (const f of ctx.sources.files.filter((f) => /\.(html?|shtml|php|asp|jsp|css)$/i.test(f.rel))) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        if (text) files.push({ rel: f.rel, text });
      }
      if (!files.length) return log.debug("nothing dated");
      ctx.era = readEra(files);
      if (ctx.era.verdict) {
        log.info(`reads as ${ctx.era.verdict.from}–${ctx.era.verdict.to}${ctx.era.spread ? ", built across eras" : ""}, ${ctx.era.signals.length} signal(s)`);
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.era?.verdict) return;
      const { verdict, spread, signals } = ctx.era;
      await ctx.write("ERA.md", `# When this site was built

The markup argues for **${verdict.from}–${verdict.to}**, where ${verdict.agreeing} of its
${verdict.of} signal(s) overlap.${spread ? ` The signals span eras: parts of this site
were written in different decades, which is itself a finding.` : ""} A signal is a
fact about the files, never a guess about the people; the years beside each
one are when that technique was the ordinary thing to write.

| signal | argues for | evidence |
| --- | --- | --- |
${signals.map((s) => `| ${s.says} | ${s.from}–${s.to} | ${s.on.join(", ")}${s.count > 3 ? ` and ${s.count - 3} more` : ""} |`).join("\n")}

Dating a site tells you which porting notes to expect: a ${verdict.from}s site
brings framesets and font tags; a later one brings scripts some reader here
already inventoried.
`);
    });
  },
};
