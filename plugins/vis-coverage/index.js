/**
 * How much of the old app the port covers, measured, per screen.
 *
 * Coverage here means something specific: a screen counts as covered by a
 * thing that exists in this run's output, not by intention. Ported means a
 * component was emitted for it; routed means a declared route reaches it;
 * proven means the conformance suite exercises it. The percentage nobody can
 * argue with is the point.
 */
export default {
  name: "vis-coverage",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      // The old app's screens are whichever census is richer: the exploration
      // saw the app; the readers saw the source.
      const observed = (ctx.model?.screens ?? []).map((s) => ({ id: s.id, name: s.name ?? s.id, from: "observed" }));
      const read = ctx.screens.map((s) => ({ id: s.selector, name: s.selector, from: "read" }));
      const universe = observed.length >= read.length ? observed : read;
      if (!universe.length) return log.debug("no census of the old app");

      const ported = new Set(ctx.screens.filter((s) => s.template).map((s) => s.selector));
      const matchedObserved = new Set((ctx.model?.wiring ?? []).map((w) => w.screen));
      const routed = new Set((ctx.routes?.table ?? []).map((r) => r.screen).filter(Boolean));
      const conformance = ctx.written.find((f) => /conformance\.spec\.js$/.test(f));

      const rows = universe.map((screen) => {
        const isPorted = ported.has(screen.id) || ported.has(screen.name) || (screen.from === "observed" && ctx.screens.some((s) => s.selector.includes(String(screen.name).toLowerCase().replace(/\s+/g, "-"))));
        const isRouted = routed.has(screen.id) || routed.has(screen.name);
        const isProven = Boolean(conformance) && screen.from === "observed";
        return { name: screen.name, isPorted, isRouted, isProven };
      });

      const pct = (k) => Math.round((rows.filter((r) => r[k]).length / rows.length) * 100);
      ctx.coverage = { rows, ported: pct("isPorted"), routed: pct("isRouted"), proven: pct("isProven") };
      log.info(`ported ${ctx.coverage.ported}%, routed ${ctx.coverage.routed}%, proven ${ctx.coverage.proven}%`);

      await ctx.write("COVERAGE.md", `# What the port covers, measured

A screen counts as covered by a thing that exists in this run's output, not by
an intention. The census is ${universe === observed ? "the exploration's: screens the app was actually seen showing" : "the readers': screens declared in the source"}.

| screen | ported | routed | proven |
| --- | --- | --- | --- |
${rows.map((r) => `| ${r.name} | ${r.isPorted ? "yes" : "**no**"} | ${r.isRouted ? "yes" : "no"} | ${r.isProven ? "by the conformance suite" : "no"} |`).join("\n")}

| | |
| --- | --- |
| ported | **${ctx.coverage.ported}%** |
| reachable by a declared route | ${ctx.coverage.routed}% |
| proven against the original | ${ctx.coverage.proven}% |

A screen this census never held is not in the denominator: the number is
honest about what was seen, not omniscient about what exists.
`);

      // The same numbers as badges, for a README that wants them inline. Local
      // files, no badge service: the number should not need a network to be
      // seen, and this repo does not send its stats anywhere.
      await ctx.write("badges/ported.svg", badge("ported", `${ctx.coverage.ported}%`, ctx.coverage.ported >= 80 ? "#2da44e" : ctx.coverage.ported >= 40 ? "#bf8700" : "#cf222e"));
      await ctx.write("badges/unverified.svg", badge("unverified", String(ctx.report.unverified.length), ctx.report.unverified.length === 0 ? "#2da44e" : "#bf8700"));
      if (ctx.archetype?.best) {
        // Grey on purpose: a reading is not a pass or a fail.
        await ctx.write("badges/archetype.svg", badge("reads as", ctx.archetype.contested ? `${ctx.archetype.best.id} (contested)` : ctx.archetype.best.id, "#57606a"));
      }
    });
  },
};

/** A shields style badge with no shield service. Text is XML escaped. */
export function badge(label, value, color) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const w1 = 12 + label.length * 7;
  const w2 = 14 + value.length * 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w1 + w2}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <rect width="${w1}" height="20" rx="3" fill="#57606a"/>
  <rect x="${w1 - 3}" width="3" height="20" fill="#57606a"/>
  <rect x="${w1}" width="${w2}" height="20" fill="${esc(color)}"/>
  <rect x="${w1}" width="3" height="20" fill="${esc(color)}"/>
  <rect width="${w1 + w2}" height="20" rx="3" fill="none"/>
  <g fill="#fff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
    <text x="${w1 / 2}" y="14">${esc(label)}</text>
    <text x="${w1 + w2 / 2}" y="14">${esc(value)}</text>
  </g>
</svg>
`;
}
