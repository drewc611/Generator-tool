import { pixelDiff } from "./pixels.js";
import { pascal } from "../dsp-ir/emit.js";


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
    // Opt in with --pixels true. It needs playwright, an emitted element and
    // a real recording, and it degrades to a named skip when any is missing.
    on("verify", async (ctx) => {
      if (!ctx.config.pixels) return;
      const rows = [];
      for (const screen of ctx.screens) {
        const elementRel = `src/elements/${pascal(screen.selector) || "Screen"}.js`;
        if (!ctx.written.includes(elementRel)) {
          rows.push({ screen: screen.selector, skipped: "no element target was emitted (--html true adds one)" });
          continue;
        }
        const shot = ctx.sources.screenshots.find((x) => x.name.toLowerCase().includes(screen.selector.replace(/^app-/, "")));
        if (!shot) {
          rows.push({ screen: screen.selector, skipped: "no recording matches the screen" });
          continue;
        }
        const result = await pixelDiff({ outDir: ctx.config.out, elementRel, shotPath: shot.path });
        rows.push({ screen: screen.selector, shot: shot.name, ...result });
      }
      const measured = rows.filter((r) => r.pct !== undefined);
      log.info(measured.length ? `${measured.length} pixel diff(s) measured` : "pixel diff requested, nothing measurable");
      await ctx.write("PARITY_PIXELS.md", renderPixels(rows));
      for (const row of rows.filter((r) => r.skipped)) {
        ctx.unverified(`Pixel diff for ${row.screen} was skipped: ${row.skipped}.`);
      }
    });

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

function renderPixels(rows) {
  return [
    "# Pixel difference, coarse on purpose",
    "",
    "The element target rendered live against the recording, both at the same",
    "width. Framing and data differences dominate this number, so it measures",
    "drift between runs, not fidelity; judge fidelity in the compare pane.",
    "",
    "| screen | recording | differing pixels |",
    "| --- | --- | --- |",
    ...rows.map((r) =>
      r.pct !== undefined
        ? `| \`${r.screen}\` | \`${r.shot}\` | ${r.pct}% of ${r.width}×${r.height} |`
        : `| \`${r.screen}\` | ${r.shot ? `\`${r.shot}\`` : "—"} | skipped: ${r.skipped} |`
    ),
    "",
  ].join("\n");
}
