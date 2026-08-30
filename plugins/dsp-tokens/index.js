const DEFAULTS = {
  density: "compact",
  size: { xs: 12, sm: 13, md: 15, lg: 20, xl: 30 },
  weight: { regular: 400, bold: 600 },
  space: [4, 8, 12, 16, 24, 32, 48],
  color: {
    bg: "#FBFAF8", surface: "#FFFFFF", sunken: "#F4F2EE",
    line: "#E3DFD8", lineStrong: "#CFC9BF",
    ink: "#1C1B19", inkMuted: "#6B675F", inkFaint: "#969187",
    accent: "#004B87", danger: "#A3231F", warn: "#8A5A0B", ok: "#1F6B4A",
  },
  radius: { control: 6, card: 10 },
  shadow: "0 1px 2px rgba(28,27,25,0.04), 0 4px 16px rgba(28,27,25,0.05)",
};

/**
 * Produces the token set the emitters build from. Values inferred from the
 * legacy stylesheets, overridden by anything in portamp.config.js, and
 * anything still unresolved is recorded rather than quietly defaulted.
 */
export default {
  name: "dsp-tokens",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const recovered = {};
      const styles = ctx.sources.files.filter((f) => /\.(css|scss)$/.test(f.rel));
      if (!styles.length)
        ctx.unverified("No stylesheet found. Color and spacing come from defaults, not from the old app.");
      if (!ctx.sources.screenshots.length)
        ctx.unverified("No screenshots to measure. The type scale and density are assumed.");

      ctx.tokens = {
        ...DEFAULTS,
        ...recovered,
        ...ctx.config.tokens,
        color: { ...DEFAULTS.color, ...(ctx.config.tokens.color || {}) },
      };
      log.info(`tokens ready (density ${ctx.tokens.density}, accent ${ctx.tokens.accent || ctx.tokens.color.accent})`);
    });

    on("emit", async (ctx) => {
      await ctx.write("src/tokens.js", `export const tokens = ${JSON.stringify(ctx.tokens, null, 2)};\n`);
    });
  },
};
