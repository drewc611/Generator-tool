import { planFor } from "./decisions.js";

/**
 * Turns the reading of the old app into a plan for the new one.
 *
 * The decisions are not preferences. Each names the thing in the legacy app
 * that makes it necessary, so somebody can disagree with the premise rather
 * than with the taste, and drop the ones whose premise does not hold.
 *
 * It proposes and does not perform. Rewriting how an application fetches, routes
 * and holds state is a decision about the product, and a tool that made it
 * quietly would be worse than one that did not make it at all.
 */
export default {
  name: "dsp-modernize",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      // dsp-archetype sorts before this one, so the reading is already there.
      if (!ctx.archetype) return log.debug("no reading of the app to plan from");

      const plan = planFor(ctx.archetype);
      if (!plan.decisions.length) return log.debug("nothing to propose");

      ctx.modernization = plan;
      log.info(`${plan.decisions.length} decision(s) proposed for a ${ctx.archetype.best.id}`);
      ctx.unverified(
        `MODERNIZATION.md proposes ${plan.decisions.length} change(s) to how the rebuilt app fetches, routes and ` +
        `holds state. They follow from what the old app was read to be, which is a reading and not a fact. ` +
        `Nothing in the emitted code implements any of them.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.modernization) return;
      await ctx.write("MODERNIZATION.md", render(ctx.archetype, ctx.modernization));
    });
  },
};

function render(archetype, { decisions, alternative }) {
  const body = decisions.map((d, i) => `### ${i + 1}. ${d.title}

**Because** ${d.because}

**Instead** ${d.instead}

<sub>from: ${d.source}</sub>`).join("\n\n");

  const other = alternative
    ? `\n## If the other reading is the right one

The shape was contested. If this is really a \`${alternative.id}\`, these are the
decisions that would apply instead. They are here because a twenty point margin
is not enough to throw them away.

${alternative.decisions.map((d) => `- **${d.title}** — ${d.because}`).join("\n")}
`
    : "";

  return `# What to build instead

The old app reads as **${archetype.best.name}** (\`${archetype.best.id}\`), on
${archetype.best.matched} of ${archetype.best.of} signals. See ARCHITECTURE.md
for the evidence.

Everything below follows from that reading. Each decision names the thing in the
legacy app that makes it necessary, so if a premise is wrong the decision that
rests on it can go with it.

portamp has not implemented any of this. How an application fetches, routes and
holds state is a decision about the product, and a tool that made it quietly
would be worse than one that did not make it at all.

${body}
${other}
---

Ordered by what the reading supports, not by effort. If you only do one, do the
first: it is the one the rest lean on.
`;
}
