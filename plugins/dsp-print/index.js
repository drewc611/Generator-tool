import { readFile } from "node:fs/promises";

/**
 * The print styles the port should not lose.
 *
 * Plenty of legacy sites were built when printing a page still mattered, and
 * they carry a print stylesheet that hides the nav, drops the background ink
 * and lays the content out for paper. A port that rebuilds the markup and
 * forgets the print rules quietly regresses a feature nobody will notice until
 * they print an invoice. This finds the print styles and reports them as
 * identity to carry, not a thing to invent.
 */

export function readPrint(css, rel) {
  const blocks = [];
  const re = /@media\s+([^{]*\bprint\b[^{]*)\{/gi;
  let m;
  while ((m = re.exec(css))) {
    // Take the balanced body so a nested rule does not end the block early.
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
    }
    const body = css.slice(start, i - 1);
    const selectors = (body.match(/([^{}]+)\{/g) ?? []).length;
    blocks.push({ query: m[1].trim(), selectors, hidesNav: /nav|header|footer|\.(no-print|noprint)/i.test(body), file: rel });
  }
  const linked = [...css.matchAll(/<link[^>]+media\s*=\s*["'][^"']*\bprint\b[^"']*["'][^>]*>/gi)].length;
  return { blocks, linked };
}

export default {
  name: "dsp-print",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(css|scss|less|html?)$/i.test(f.rel));
      const blocks = [];
      let linked = 0;
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/@media[^{]*print|media\s*=\s*["'][^"']*print/i.test(text)) continue;
        const read = readPrint(text, file.rel);
        blocks.push(...read.blocks);
        linked += read.linked;
      }
      ctx.print = { blocks, linked };
      if (!blocks.length && !linked) return log.debug("no print styles");

      log.info(`${blocks.length} @media print block(s), ${linked} print stylesheet link(s)`);
      ctx.unverified(
        `PRINT.md finds ${blocks.length} print stylesheet block(s). They are identity the port earned, not a feature to ` +
        `reinvent: carry the print rules across, or an invoice that printed cleanly for a decade stops.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.print || (!ctx.print.blocks.length && !ctx.print.linked)) return;
      await ctx.write("PRINT.md", render(ctx.print));
    });
  },
};

function render({ blocks, linked }) {
  const rows = blocks.map((b) =>
    `| \`${b.file}\` | \`${b.query}\` | ${b.selectors} | ${b.hidesNav ? "yes" : "—"} |`);

  return `# The print styles the port should not lose

A print stylesheet is a feature nobody notices until it is gone, when an
invoice or an article that printed cleanly for years suddenly prints the nav,
the sidebar and a wall of background ink. This is what was there, to carry
across as identity rather than invent.

${linked ? `${linked} stylesheet(s) linked with \`media="print"\`.\n\n` : ""}| file | media query | rules | hides chrome |
| --- | --- | --- | --- |
${rows.length ? rows.join("\n") : "| — | (no @media print block) | — | — |"}

---

Carry these into the port's own stylesheet under the same \`@media print\`.
The rules that hide the chrome and drop the background are the ones that make
a page printable; losing them is the regression this report exists to catch.
`;
}
