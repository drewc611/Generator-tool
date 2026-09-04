/**
 * How much port each screen is. The score is a stated formula over counted
 * things, not a judgment: constructs in the template, calls wired to the
 * screen's file, and the unverified items that mention it. Its use is
 * ordering the work and sizing the review, and the formula is printed so
 * disagreeing with it is easy.
 */

import { translate } from "../output-react/template.js";

export function weigh(screen, calls, unverified) {
  const counts = { whens: 0, eaches: 0, models: 0, events: 0, elements: 0, notes: 0 };
  if (screen.template) {
    try {
      const { ir, notes } = translate(screen.template, { indent: 0 });
      counts.notes = notes.length;
      const walk = (node) => {
        if (!node) return;
        if (node.kind === "when") counts.whens += 1;
        if (node.kind === "each") counts.eaches += 1;
        if (node.kind === "element") {
          counts.elements += 1;
          counts.events += node.events.length;
          if (node.model) counts.models += 1;
        }
        for (const child of node.children ?? []) walk(child);
      };
      walk(ir.root);
    } catch {
      counts.unreadable = true;
    }
  }
  const ownCalls = calls.filter((c) => c.file === screen.file).length;
  const mentions = unverified.filter((u) => u.includes(screen.selector) || u.includes(screen.file)).length;
  const score =
    counts.elements + 3 * counts.whens + 4 * counts.eaches + 3 * counts.models +
    2 * counts.events + 5 * ownCalls + 5 * (counts.notes + mentions);
  return { ...counts, calls: ownCalls, mentions, score };
}

export default {
  name: "dsp-weight",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", (ctx) => {
      if (!ctx.screens.length) return log.debug("no screens to weigh");
      ctx.weights = ctx.screens
        .map((s) => ({ screen: s, ...weigh(s, ctx.api.calls, ctx.report.unverified) }))
        .sort((a, b) => b.score - a.score);
      log.info(`heaviest: ${ctx.weights[0].screen.selector} at ${ctx.weights[0].score}`);
    });

    on("emit", async (ctx) => {
      if (!ctx.weights) return;
      const lines = [
        "# Port weight, per screen",
        "",
        "score = elements + 3·conditions + 4·loops + 3·models + 2·handlers",
        "      + 5·calls from the screen's file + 5·(translator notes + unverified mentions)",
        "",
        "Counted, then weighted by how often each construct produces rework.",
        "Disagree with the weights, not the counts; the counts are just true.",
        "",
        "| screen | score | elements | conditions | loops | models | handlers | calls | open items |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ];
      for (const w of ctx.weights) {
        lines.push(
          `| \`${w.screen.selector}\` | **${w.score}** | ${w.elements} | ${w.whens} | ${w.eaches} | ${w.models} | ${w.events} | ${w.calls} | ${w.notes + w.mentions} |`
        );
      }
      lines.push("", "Port from the top: the heavy screens surface the surprises while there is still schedule to absorb them.", "");
      await ctx.write("WEIGHT.md", lines.join("\n"));
    });
  },
};
