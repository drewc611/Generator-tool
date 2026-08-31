/**
 * The tokens in the W3C design tokens format, so the design can leave the
 * codebase and enter a design tool.
 *
 * Two documents where there are two truths: what was measured off the legacy
 * app, and what dsp-uplift proposes instead. Merging them would launder a
 * proposal into a measurement, which is exactly the confusion the format's
 * $description field exists to prevent.
 *
 *   designTokens: true   (or --design-tokens true)
 */
const token = ($type, $value, $description) => ({ $type, $value, ...($description ? { $description } : {}) });

export function buildDocument(tokens, description) {
  const doc = { $description: description };

  if (tokens.color) {
    doc.color = Object.fromEntries(Object.entries(tokens.color).map(([k, v]) => [k, token("color", v)]));
  }
  if (tokens.size) {
    doc.font = { size: Object.fromEntries(Object.entries(tokens.size).map(([k, v]) => [k, token("dimension", `${v}px`)])) };
  }
  if (tokens.weight) {
    doc.font = { ...doc.font, weight: Object.fromEntries(Object.entries(tokens.weight).map(([k, v]) => [k, token("fontWeight", v)])) };
  }
  if (tokens.space) {
    doc.space = Object.fromEntries(tokens.space.map((v, i) => [String(i), token("dimension", `${v}px`)]));
  }
  if (tokens.radius) {
    doc.radius = Object.fromEntries(Object.entries(tokens.radius).map(([k, v]) => [k, token("dimension", `${v}px`)]));
  }
  if (tokens.motion) {
    doc.duration = Object.fromEntries(
      Object.entries(tokens.motion).filter(([k]) => k !== "easing").map(([k, v]) => [k, token("duration", v)])
    );
    doc.easing = { standard: token("cubicBezier", tokens.motion.easing) };
  }
  return doc;
}

export default {
  name: "output-design-tokens",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.designTokens && !ctx.config["design-tokens"]) return log.debug("not requested");
      if (!ctx.tokens) return log.info("no tokens to write");

      const { provenance, ...measured } = ctx.tokens;
      await ctx.write("design/tokens.json", JSON.stringify(
        buildDocument(measured, "Measured from the legacy app by portamp. These are what it rendered, not a recommendation."), null, 2) + "\n");
      if (ctx.uplift?.tokens) {
        await ctx.write("design/tokens.modern.json", JSON.stringify(
          buildDocument(ctx.uplift.tokens, "Proposed by portamp's uplift. Hues kept, contrast fixed; see DESIGN_UPLIFT.md before adopting."), null, 2) + "\n");
      }
      log.info("design tokens written, W3C format");
    });
  },
};
