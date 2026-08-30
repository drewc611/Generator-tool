/**
 * Writes the record of what was ported, what deviates, and what nobody could
 * verify. The last list is the point: the next person inherits the uncertainty
 * either way, so it may as well be written down.
 */
export default {
  name: "vis-parity",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      const shots = ctx.sources.screenshots;
      const rows = ctx.screens.map((s) => {
        const match = shots.find((x) => x.name.toLowerCase().includes(s.selector.replace(/^app-/, "")));
        return `| ${s.selector} | ${s.file} | ${match ? match.name : "no screenshot"} | ${match ? "compare" : "unmatched"} |`;
      });

      const md = [
        "# Port notes",
        "",
        `Generated ${new Date().toISOString().slice(0, 10)}. ${ctx.screens.length} component(s), ${ctx.api.calls.length} endpoint(s).`,
        "",
        "## Screens",
        "",
        "| Component | Source | Screenshot | Status |",
        "| --- | --- | --- | --- |",
        ...(rows.length ? rows : ["| none found | | | |"]),
        "",
        "## Endpoints",
        "",
        "| Name | Method | Path | From |",
        "| --- | --- | --- | --- |",
        ...(ctx.api.calls.length
          ? ctx.api.calls.map((c) => `| ${c.name} | ${c.method} | ${c.path} | ${c.file} |`)
          : ["| none found | | | |"]),
        "",
        "## Not verified",
        "",
        ...(ctx.report.unverified.length
          ? ctx.report.unverified.map((u) => `- ${u}`)
          : ["- Nothing outstanding."]),
        "",
        "## Deviations",
        "",
        ...(ctx.plan.notes.length ? ctx.plan.notes.map((n) => `- ${n}`) : ["- None recorded."]),
        "",
      ].join("\n");

      await ctx.write("PORT_NOTES.md", md);
      log.info(`parity report written, ${ctx.report.unverified.length} item(s) unverified`);
    });
  },
};
