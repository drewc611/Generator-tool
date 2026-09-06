import { readFile } from "node:fs/promises";
import { contrastHex } from "../input-shots/png.js";
import {
  flattenSamples, measureColors, measureDensity, measureRadius, mergeSpacing, measureTypeScale,
  readStyleVariables, rolesFromVariables,
} from "./measure.js";

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
 * The page background from the palettes input-shots measured, where the screenshots agree. Only that: the ink and a
 * brand bar are both dark and both read against it, and a pixel share cannot tell text from a header, so nothing else
 * is named from pixels.
 */
export function colorsFromScreenshots(screenshots) {
  const shots = (screenshots ?? []).filter((s) => Array.isArray(s.palette) && s.palette.length);
  if (!shots.length) return null;
  const color = {};
  const evidence = {};
  // The background is the dominant colour of a screenshot when it covers at least four tenths of it; when several
  // screenshots disagree the commonest wins and the disagreement is written into the evidence.
  const dominant = shots.map((s) => ({ s, top: s.palette[0] })).filter(({ top }) => top.share >= 0.4);
  if (dominant.length) {
    const tally = new Map();
    for (const d of dominant) tally.set(d.top.hex, (tally.get(d.top.hex) ?? 0) + 1);
    const [hex, n] = [...tally].sort((a, b) => b[1] - a[1])[0];
    const first = dominant.find((d) => d.top.hex === hex);
    color.bg = hex;
    evidence.bg = `bg from the pixels of ${first.s.name}${IMG_EXT(first.s)} (${(first.top.share * 100).toFixed(0)}% of it)${dominant.length > n ? `, ${dominant.length - n} screenshot(s) disagree` : ""}`;
    // How many of the other colours would read as text against it is reported, never which one is the ink.
    const legible = first.s.palette.slice(1).filter((p) => contrastHex(p.hex, hex) >= 4.5).length;
    evidence.bg += `; ${legible} other colour(s) read against it at 4.5:1 or better`;
  }
  return Object.keys(color).length ? { color, evidence } : null;
}
const IMG_EXT = (s) => (/\.[a-z]+$/i.exec(s.path ?? "")?.[0] ?? "");

/**
 * Produces the token set the emitters build from. Values are measured from the
 * running app when input-record observed it, recovered from the stylesheets
 * when it did not, and defaulted only as a last resort. Which of the three
 * happened is recorded for every value, because a defaulted token that looks
 * measured is how a port ends up subtly wrong everywhere at once.
 */
export default {
  name: "dsp-tokens",
  version: "0.2.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const recovered = { color: {} };
      const evidence = [];

      const styleFiles = ctx.sources.files.filter((f) => /\.(css|scss)$/.test(f.rel));
      let variables = {};
      for (const file of styleFiles) {
        Object.assign(variables, readStyleVariables(await readFile(file.path, "utf8").catch(() => "")));
      }
      const declared = rolesFromVariables(variables);
      if (declared) {
        Object.assign(recovered.color, declared.color);
        evidence.push(...declared.evidence);
      }
      if (!styleFiles.length) {
        ctx.unverified("No stylesheet found. Color and spacing come from defaults, not from the old app.");
      }

      const { samples, rowHeights, font, pageBackground } = flattenSamples(ctx.sources.observedStyles);

      if (samples.length) {
        const type = measureTypeScale(samples);
        if (type) {
          recovered.size = { ...DEFAULTS.size, ...type.scale };
          evidence.push(`type scale from ${type.evidence}`);
        }
        // Declared roles win over observed ones: a name states intent, a
        // computed value only states what happened to render.
        const observedColor = measureColors(samples, pageBackground);
        if (observedColor) {
          recovered.color = { ...observedColor.color, ...recovered.color };
          evidence.push(...observedColor.evidence);
        }
        const radius = measureRadius(samples);
        if (radius) {
          recovered.radius = { ...DEFAULTS.radius, control: radius.control };
          evidence.push(`radius from ${radius.evidence}`);
        }
        if (font) {
          recovered.font = font;
          evidence.push("font family from the running app");
        }
      }

      // Spacing needs positions, which only an exploration records. Without
      // one the scale stays a default and the note below still says so.
      // Several recordings merge with the disagreement kept: agreement is
      // measured, a disputed rung is reported with its count, and nothing
      // averages two sessions into a number neither measured.
      const sessions = ctx.sources.explorations?.length
        ? ctx.sources.explorations
        : ctx.sources.exploration ? [ctx.sources.exploration] : [];
      const spacing = mergeSpacing(sessions, DEFAULTS.space);
      if (spacing) {
        recovered.space = spacing.scale;
        evidence.push(spacing.evidence);
        if (spacing.disputed?.length) {
          ctx.unverified(
            `spacing: ${spacing.disputed.length} rung(s) the recordings disagree on (${spacing.disputed.map((d) => `${d.rung}px in ${d.agreedBy} of ${d.of}`).join(", ")}). ` +
            "The disputed rungs stayed out of the ladder; record the disagreeing session again or accept the agreed rungs."
          );
        }
      }

      // A screenshot's pixels are the last honest evidence before a default: the colour most of a screenshot is,
      // is the page background. Only that is taken, only where nothing declared or observed already answered, and
      // it names its screenshot.
      const pixels = colorsFromScreenshots(ctx.sources.screenshots);
      if (pixels?.color.bg && !recovered.color.bg) { recovered.color.bg = pixels.color.bg; evidence.push(pixels.evidence.bg); }

      const density = measureDensity(rowHeights);
      if (density) {
        recovered.density = density.density;
        recovered.rowHeight = density.rowHeight;
        evidence.push(`density from ${density.evidence}`);
      } else if (!ctx.sources.screenshots.length) {
        ctx.unverified("No screenshots to measure. The type scale and density are assumed.");
      } else if (!samples.length) {
        ctx.unverified(
          "Screenshots exist but no computed styles were recorded, so the type scale and density are still assumed. " +
            "Run with --allow-live and input-record to measure them."
        );
      }

      ctx.tokens = {
        ...DEFAULTS,
        ...recovered,
        ...ctx.config.tokens,
        size: { ...DEFAULTS.size, ...(recovered.size || {}), ...(ctx.config.tokens.size || {}) },
        radius: { ...DEFAULTS.radius, ...(recovered.radius || {}), ...(ctx.config.tokens.radius || {}) },
        color: { ...DEFAULTS.color, ...recovered.color, ...(ctx.config.tokens.color || {}) },
      };

      const measured = evidence.length;
      ctx.tokens.provenance = evidence;
      log.info(
        `tokens ready (density ${ctx.tokens.density}, accent ${ctx.tokens.color.accent})` +
          (measured ? `, ${measured} value(s) measured` : ", all defaulted")
      );
      if (!measured) {
        ctx.unverified("Every token is a default. Nothing about the old app's design was recovered.");
      }
    });

    on("emit", async (ctx) => {
      const { provenance, ...tokens } = ctx.tokens;
      const header = provenance?.length
        ? `// Measured from the legacy app:\n${provenance.map((e) => `//   ${e}`).join("\n")}\n` +
          `// Everything else is a portamp default. See PORT_NOTES.md.\n`
        : `// Every value here is a portamp default. Nothing was measured. See PORT_NOTES.md.\n`;
      await ctx.write("src/tokens.js", `${header}export const tokens = ${JSON.stringify(tokens, null, 2)};\n`);
    });
  },
};
