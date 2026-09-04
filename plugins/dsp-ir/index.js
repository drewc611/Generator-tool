import { buildIr, detectDialect } from "./ir.js";

/**
 * Puts the IR on the context so any emitter can read it, and reports which
 * dialect each template turned out to be written in. Nothing downstream has to
 * ask again, and nothing downstream has to know the answer.
 */
export default {
  name: "dsp-ir",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const withTemplates = ctx.screens.filter((s) => s.template);
      if (!withTemplates.length) return log.debug("no templates to normalise");

      ctx.ir = withTemplates.map((screen) => {
        const ir = buildIr(screen.template);
        screen.ir = ir;
        return { selector: screen.selector, ...ir };
      });

      const dialects = [...new Set(ctx.ir.map((i) => i.dialect))];
      log.info(`${ctx.ir.length} template(s) normalised, from ${dialects.join(" and ")}`);

      for (const entry of ctx.ir) {
        for (const note of entry.notes) ctx.unverified(`<${entry.selector}>: ${note}`);
      }
    });
  },
};

export { buildIr, detectDialect };
