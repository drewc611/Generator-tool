import { solveEquation } from "./solve.js";

/**
 * A homework helper that never claims more than it can prove: arithmetic and
 * one-variable linear equations, each answer with the real steps that
 * produced it (solve.js), and a document's plain text pulled through the
 * same zero dependency PDF reader input-pdf already ships (pdftext.js).
 * Nothing here calls a network or a model; every number is arithmetic this
 * file itself performed and every line of text is what a PDF's own bytes
 * said, both checkable by hand the same way vis-transformer's own math is.
 * The console's Study tab calls solve.js and pdftext.js directly, live,
 * without a pipeline run; this hook only demonstrates the solver on one
 * fixed equation so the claim is provable in CI, the same role
 * vis-transformer's own fixed sentence plays for its attention heatmaps.
 */
export default {
  name: "general-study",
  version: "0.1.0",
  class: "general",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (!ctx.config.study) return log.debug("--study not set; no demonstration written");
      const demo = solveEquation("2x + 3 = 11");
      const lines = [
        "# The study helper",
        "",
        "A demonstration, not a claim about anyone's own work: the console's",
        "Study tab runs this same solver live, arithmetic and one-variable",
        "linear equations only. Anything past that, a second variable, a",
        "squared term, an equation with no variable at all, is refused by",
        "name rather than guessed at.",
        "",
        `**${demo.input}**`,
        "",
        ...demo.steps.map((s) => `- ${s}`),
        "",
        `Answer: \`${demo.variable} = ${demo.value}\``,
        "",
        "A PDF dropped on the console's intake can have its plain text read",
        "the same way input-pdf already reads one to port a document page;",
        "an encrypted file or one this reader cannot decompress is named,",
        "never returned as empty text.",
      ];
      await ctx.write("STUDY.md", lines.join("\n") + "\n");
      ctx.unverified("STUDY.md demonstrates the solver on one fixed equation; it proves the solver works, not that any document dropped on the console was read correctly.");
      log.info("STUDY.md written");
    });
  },
};
