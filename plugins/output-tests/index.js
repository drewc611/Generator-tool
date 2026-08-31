import { buildSpec, renderSpec } from "./spec.js";

/**
 * Emits the conformance suite. Runs whenever there is an exploration to write
 * one from, because a port with no way to check it against the original is the
 * thing this tool exists to stop shipping.
 */
export default {
  name: "output-tests",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      const exploration = ctx.sources.exploration;
      if (!exploration || !ctx.model) return log.debug("nothing was explored, so there is nothing to assert");

      const spec = buildSpec(ctx.model, exploration, { portUrl: ctx.config.portUrl });
      await ctx.write("tests/conformance.spec.js", renderSpec(spec));

      log.info(`${spec.cases.length} conformance test(s) written from what the original did`);
      const performed = exploration.budget?.performed ?? 0;
      const budget = exploration.budget?.maxSteps ?? performed;
      if (performed >= budget) {
        ctx.unverified(
          `The exploration used its whole budget of ${budget} steps, so the conformance suite covers what it reached and no more. ` +
            "Raise explore.maxSteps for a wider suite."
        );
      }
    });
  },
};
