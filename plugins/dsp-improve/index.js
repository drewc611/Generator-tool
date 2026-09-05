import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

    // The report lands at verify, after the emitters, so each finding can be
    // ranked by the size of the emitted code its fix would touch. A rank is
    // a measurement of the component on disk, never a guess about effort.
    on("verify", async (ctx) => {
      if (!ctx.improvements?.length) return;
      const bySelector = new Map(ctx.screens.map((s) => [s.selector, s]));
      for (const f of ctx.improvements) {
        const screen = bySelector.get(f.screen) ?? bySelector.get(String(f.screen).toLowerCase());
        const cls = screen?.className;
        const rel = cls ? `src/features/${cls}/${cls}.jsx` : null;
        f.cost = null;
        if (rel && ctx.written.includes(rel)) {
          const text = await readFile(join(ctx.config.out, rel), "utf8").catch(() => "");
          if (text) {
            f.cost = text.split("\n").length;
            f.costOf = rel;
          }
        }
      }
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
    "Within each kind the findings are ordered by the size of the emitted",
    "component the fix would touch, smallest first, because the cheapest fix",
    "is measured from the code on disk and not guessed. A finding whose",
    "screen was not emitted is listed last, unranked.",
    "",
  ];

  const byKind = new Map();
  for (const f of findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  for (const group of byKind.values()) {
    group.sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
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
      lines.push(f.cost ? `  - Fix lands in \`${f.costOf}\`, ${f.cost} emitted line(s).` : "  - Unranked: the screen was not emitted in this run.");
    }
    lines.push("");
  }
  return lines.join("\n");
}
