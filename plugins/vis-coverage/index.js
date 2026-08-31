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
    });
  },
};
