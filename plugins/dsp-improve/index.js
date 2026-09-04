import { findIssues } from "./findings.js";

/**
 * The part that makes the rebuild better than the original rather than a
 * faithful copy of its defects. Everything here was measured while the app ran,
 * and every finding says what the port does instead.
 */
export default {
  name: "dsp-improve",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      if (!ctx.model || !ctx.sources.exploration) return log.debug("nothing was explored");

      const findings = findIssues(ctx.sources.exploration, ctx.model);
      ctx.improvements = findings;

      const high = findings.filter((f) => f.severity === "high").length;
      log.info(`${findings.length} improvement(s) over the original, ${high} of them serious`);
      for (const finding of findings.filter((f) => f.severity === "high")) {
        ctx.note(`${finding.kind}: ${finding.evidence}`);
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.improvements?.length) return;
      await ctx.write("IMPROVEMENTS.md", render(ctx.improvements));
    });
  },
};

function render(findings) {
  const lines = [
    "# Improvements over the original",
    "",
    "Measured while the legacy app ran. Each one names the element it came from",
    "and what the port does instead. A port that reproduces a defect faithfully",
    "is not a good port.",
    "",
  ];

  const byKind = new Map();
  for (const f of findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }

  const TITLE = {
    "accessible-name": "Controls with no accessible name",
    "unlabelled-field": "Fields with no label",
    contrast: "Text below the contrast threshold",
    "tap-target": "Targets under 44px",
    "focus-order": "Tab order that fights the reading order",
    "missing-state": "States the original never showed",
  };

  for (const [kind, group] of byKind) {
    lines.push(`## ${TITLE[kind] ?? kind}  (${group.length})`, "");
    for (const f of group) {
      lines.push(`- **\`${f.element}\`** on \`${f.screen}\`, ${f.severity}.`);
      lines.push(`  - Observed: ${f.evidence}`);
      lines.push(`  - Instead: ${f.instead}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
