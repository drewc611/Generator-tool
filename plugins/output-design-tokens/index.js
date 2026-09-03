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

export function buildDocument(tokens, description, evidence = []) {
  // $extensions is the format's sanctioned pocket for tool facts, so the
  // measurement trail rides inside the document instead of beside it: a
  // design tool importing this keeps the evidence for where each scale came
  // from, which is the difference between a measurement and a taste.
  const doc = {
    $description: description,
    ...(evidence.length ? { $extensions: { "dev.portamp.evidence": evidence } } : {}),
  };

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
        buildDocument(measured, "Measured from the legacy app by portamp. These are what it rendered, not a recommendation.", provenance ?? []), null, 2) + "\n");
      if (ctx.uplift?.tokens) {
        await ctx.write("design/tokens.modern.json", JSON.stringify(
          buildDocument(ctx.uplift.tokens, "Proposed by portamp's uplift. Hues kept, contrast fixed; see DESIGN_UPLIFT.md before adopting."), null, 2) + "\n");
      }
      await ctx.write("design/tokens.css", cssProperties(measured));
      log.info("design tokens written, W3C format and CSS custom properties");
    });
  },
};

/**
 * The same measurements as CSS custom properties, for a consumer with no
 * build step. Names flatten with dashes; space gets an index because it is
 * an array; sizes carry px because they were measured in px.
 */
function cssProperties(tokens) {
  const lines = [
    "/* Measured from the legacy app by portamp. What it rendered, not a recommendation. */",
    ":root {",
  ];
  const walk = (value, path) => {
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i]));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
    else if (typeof value === "number" || typeof value === "string") {
      const name = path.join("-").replace(/[^\w-]/g, "-").toLowerCase();
      const px = typeof value === "number" && /^(size|space)\b/.test(path[0]) ? `${value}px` : String(value);
      lines.push(`  --${name}: ${px};`);
    }
  };
  walk(tokens, []);
  lines.push("}", "");
  return lines.join("\n");
}
