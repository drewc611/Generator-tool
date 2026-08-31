import { fitContrast, ratio, toHex, toHsl } from "./color.js";

/**
 * Turns the palette the old app rendered into one worth shipping.
 *
 * The temptation with a redesign is to replace what was there. This does not.
 * A brand colour is the one value in a legacy palette somebody genuinely chose,
 * and the type sizes encode a density the people who use the thing all day are
 * fast in. Both are kept.
 *
 * What actually changes is the part nobody chose: sizes that drifted to
 * whatever the browser did, spacing that landed on odd numbers, colour pairs
 * that were never checked against a contrast ratio, and the absence of any
 * radius, elevation or motion at all, because the app predates them being easy.
 *
 * Every change below reports what it was, what it became, and the number that
 * made it necessary. A change with no number attached is not made.
 */

const STEPS = ["xs", "sm", "md", "lg", "xl", "2xl"];

// A minor third, used only when the old app's own sizes do not imply a ratio.
// Bigger ratios look better on a marketing page and cost rows on a screen
// somebody works in all day, which is what most of these apps are.
const DEFAULT_RATIO = 1.2;

/**
 * The ratio the old app was already using, recovered from its own sizes.
 *
 * Imposing a ratio regularises the scale and throws away the app's typographic
 * voice with it: a display size of 28 next to a body of 13 is a deliberate
 * choice, and replacing it with 19 because a minor third says so is a redesign
 * nobody asked for. Fitting a line through log(size) against step index gives
 * back the app's own ratio, and the scale then only regularises what drifted.
 */
function fitRatio(size = {}) {
  const points = STEPS
    .map((step, i) => ({ i, value: Number(size[step]) }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0);

  if (points.length < 3) return { ratio: DEFAULT_RATIO, measured: false, from: points.length };

  // Least squares on the logarithms: a geometric scale is a straight line there.
  const n = points.length;
  const meanI = points.reduce((a, p) => a + p.i, 0) / n;
  const meanY = points.reduce((a, p) => a + Math.log(p.value), 0) / n;
  const denominator = points.reduce((a, p) => a + (p.i - meanI) ** 2, 0);
  if (!denominator) return { ratio: DEFAULT_RATIO, measured: false, from: n };

  const slope = points.reduce((a, p) => a + (p.i - meanI) * (Math.log(p.value) - meanY), 0) / denominator;
  const fitted = Math.exp(slope);

  // Outside this range it is not a scale, it is two unrelated decisions.
  const clamped = Math.min(1.5, Math.max(1.125, fitted));
  return { ratio: clamped, measured: true, from: n, fitted: Math.round(fitted * 1000) / 1000, clamped: clamped !== fitted };
}

/** Sizes on a scale, anchored where the old app already sat. */
function typeScale(size = {}, ratio = DEFAULT_RATIO) {
  const base = Number(size.md) || 15;
  const anchor = STEPS.indexOf("md");
  const scale = {};
  for (let i = 0; i < STEPS.length; i++) {
    scale[STEPS[i]] = Math.round(base * ratio ** (i - anchor));
  }
  return scale;
}

/** A spacing scale on a 4px rhythm, which is what everything else assumes. */
const SPACE = [2, 4, 8, 12, 16, 24, 32, 48, 64];

const PAIRS = [
  ["ink", "surface", 4.5, "body text on a card"],
  ["ink", "bg", 4.5, "body text on the page"],
  ["inkMuted", "surface", 4.5, "secondary text on a card"],
  ["inkFaint", "surface", 3, "hint text, treated as large"],
  ["accent", "surface", 4.5, "a link or a primary control"],
  ["danger", "surface", 4.5, "an error message"],
  ["warn", "surface", 4.5, "a warning"],
  ["ok", "surface", 4.5, "a success message"],
];

export function upliftColor(color = {}) {
  const next = { ...color };
  const changes = [];

  for (const [role, ground, target, where] of PAIRS) {
    if (!color[role] || !color[ground]) continue;
    const before = ratio(color[role], color[ground]);
    if (before === null) continue;

    if (before >= target) {
      changes.push({ role, ground, where, before: round(before), after: round(before), from: color[role], to: color[role], kept: true });
      continue;
    }

    const fitted = fitContrast(color[role], color[ground], target);
    if (!fitted) continue;
    next[role] = fitted.hex;
    changes.push({
      role, ground, where, target,
      before: round(before), after: fitted.ratio,
      from: color[role], to: fitted.hex,
      moved: fitted.moved, exhausted: Boolean(fitted.exhausted),
    });
  }

  return { color: next, changes };
}

/**
 * Shadows tinted with the palette's own ink rather than black.
 *
 * A pure black shadow over a warm surface reads as dirt. Taking the hue from
 * the ink is the difference between a card that looks placed and one that looks
 * pasted, and it costs nothing.
 */
function elevation(ink = "#1C1B19") {
  const hsl = toHsl(ink) ?? { h: 0, s: 0, l: 0.1 };
  const tint = (alpha) => {
    const rgb = toHex({ ...hsl, l: Math.min(hsl.l, 0.15) });
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(rgb.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  return {
    raised: `0 1px 2px ${tint(0.06)}`,
    card: `0 1px 2px ${tint(0.04)}, 0 4px 16px ${tint(0.06)}`,
    overlay: `0 8px 24px ${tint(0.12)}, 0 2px 8px ${tint(0.08)}`,
  };
}

const round = (n) => Math.round(n * 100) / 100;

export function uplift(tokens = {}) {
  const scale = fitRatio(tokens.size);
  const size = typeScale(tokens.size, scale.ratio);
  const { color, changes } = upliftColor(tokens.color);

  return {
    tokens: {
      density: tokens.density ?? "comfortable",
      size,
      // 1.5 for body, tightening as the size grows, which is how type behaves.
      leading: { tight: 1.2, normal: 1.5, loose: 1.7 },
      weight: { regular: 400, medium: 500, bold: 600 },
      space: SPACE,
      radius: {
        control: tokens.radius?.control ?? 6,
        card: tokens.radius?.card ?? 10,
        pill: 999,
      },
      color,
      elevation: elevation(color.ink),
      // Old apps have no motion at all, so there is nothing here to preserve.
      // These are short enough not to be in the way and long enough to be seen.
      motion: {
        instant: "80ms",
        quick: "140ms",
        settled: "240ms",
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      },
      focus: `0 0 0 2px ${color.surface ?? "#FFFFFF"}, 0 0 0 4px ${color.accent ?? "#004B87"}`,
    },
    changes,
    scale,
    typeBefore: tokens.size ?? {},
    spaceBefore: tokens.space ?? [],
  };
}

export default {
  name: "dsp-uplift",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      if (!ctx.tokens) return log.debug("no tokens to work from");

      const result = uplift(ctx.tokens);
      ctx.uplift = result;

      const fixed = result.changes.filter((c) => !c.kept);
      const exhausted = result.changes.filter((c) => c.exhausted);
      log.info(`${fixed.length} colour pair(s) brought to contrast, ${result.changes.length - fixed.length} already passing`);

      if (fixed.length) {
        ctx.unverified(
          `${fixed.length} colour(s) in the legacy palette did not meet WCAG AA and were darkened or lightened ` +
          `to reach it, keeping their hue. The originals and the ratios are in DESIGN_UPLIFT.md. ` +
          `They are proposed in src/tokens.modern.js and are not what the emitted components use.`
        );
      }
      if (exhausted.length) {
        ctx.unverified(
          `${exhausted.length} colour pair(s) cannot reach their contrast target by lightness alone: ` +
          `${exhausted.map((c) => `${c.role} on ${c.ground}`).join(", ")}. These need a different colour, ` +
          `which is a decision about the brand and not one portamp will make.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.uplift) return;
      const { tokens } = ctx.uplift;
      await ctx.write("src/tokens.modern.js", MODULE(tokens, ctx.tokens?.provenance ?? []));
      await ctx.write("src/tokens.modern.css", CSS(tokens));
      await ctx.write("DESIGN_UPLIFT.md", render(ctx.uplift, ctx.tokens));
    });
  },
};

const MODULE = (tokens, provenance) => `// A proposed design system, derived from what the legacy app rendered.
//
// The hue of every colour is the old app's. What changed is lightness, and only
// where a pair failed a contrast ratio. Type sizes sit on a scale anchored at
// the size the old app already used for body text, so the density people are
// used to survives.
//
// This is not what the emitted components import. src/tokens.js is. Switch when
// you have looked at DESIGN_UPLIFT.md and agreed with it.
${provenance.length ? `//\n// Measured from the legacy app:\n${provenance.map((e) => `//   ${e}`).join("\n")}\n` : ""}
export const tokens = ${JSON.stringify(tokens, null, 2)};
`;

const CSS = (tokens) => {
  const lines = [];
  const push = (name, value) => lines.push(`  --${name}: ${value};`);

  for (const [k, v] of Object.entries(tokens.size)) push(`text-${k}`, `${v}px`);
  for (const [k, v] of Object.entries(tokens.leading)) push(`leading-${k}`, v);
  for (const [k, v] of Object.entries(tokens.weight)) push(`weight-${k}`, v);
  tokens.space.forEach((v, i) => push(`space-${i}`, `${v}px`));
  for (const [k, v] of Object.entries(tokens.radius)) push(`radius-${k}`, `${v}px`);
  for (const [k, v] of Object.entries(tokens.color)) push(`color-${k}`, v);
  for (const [k, v] of Object.entries(tokens.elevation)) push(`elevation-${k}`, v);
  for (const [k, v] of Object.entries(tokens.motion)) push(k === "easing" ? "easing" : `duration-${k}`, v);
  push("focus-ring", tokens.focus);

  return `/* Proposed by portamp. See DESIGN_UPLIFT.md for what changed and why. */
:root {
${lines.join("\n")}
}

/* Motion is an enhancement, and somebody who has asked for less of it has
   asked for a reason. */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-instant: 0ms;
    --duration-quick: 0ms;
    --duration-settled: 0ms;
  }
}
`;
};

function render({ tokens, changes, scale, typeBefore, spaceBefore }, before) {
  const fixed = changes.filter((c) => !c.kept);
  const kept = changes.filter((c) => c.kept);

  const colourRows = changes.map((c) =>
    `| ${c.role} on ${c.ground} | ${c.where} | \`${c.from}\` | \`${c.to}\` | ${c.before}:1 | ${c.after}:1 | ${c.kept ? "kept" : c.exhausted ? "**cannot reach it by lightness**" : `moved ${c.moved > 0 ? "+" : ""}${c.moved}% lightness`} |`
  ).join("\n");

  const typeRows = Object.entries(tokens.size).map(([k, v]) => {
    const old = typeBefore[k];
    return `| ${k} | ${old ? `${old}px` : "—"} | ${v}px | ${old ? (old === v ? "unchanged" : `${v > old ? "+" : ""}${v - old}px`) : "new step"} |`;
  }).join("\n");

  return `# What the design becomes

portamp measured the old app's design and proposes this. Nothing here is
applied: the emitted components still import \`src/tokens.js\`. The proposal is
\`src/tokens.modern.js\` and \`src/tokens.modern.css\`.

The rule followed throughout is that a legacy palette contains one thing
somebody genuinely chose, the brand colour, and a lot of things nobody did.
The first is kept. The second is what changes.

## Colour: hue kept, contrast fixed

${fixed.length
    ? `${fixed.length} pair(s) did not meet their target and were moved along lightness only. ${kept.length} already passed and were left exactly as they were.`
    : `Every pair already met its target. Nothing was changed.`}

| pair | where it appears | was | becomes | before | after | what happened |
| --- | --- | --- | --- | --- | --- | --- |
${colourRows}

The target is 4.5:1, the WCAG AA threshold for body text, except hint text which
is treated as large and held to 3:1.

## Type: the same density, on a scale

${scale.measured
    ? `The ratio is the old app's own, recovered by fitting a line through its ${scale.from} sizes: **${scale.fitted}**${scale.clamped ? `, clamped to ${round(scale.ratio)} because outside that range it is not one scale but two unrelated decisions` : ""}. Imposing a ratio would have regularised the scale and thrown away the app's typographic voice with it.`
    : `The old app had only ${scale.from} distinct size(s), too few to imply a ratio, so this uses a minor third (${DEFAULT_RATIO}). That is an assumption and it is the only one on this page.`}
Every step is anchored at the body size the app already used, so a screen holds
the same amount and the sizes now relate to each other.

| step | was | becomes | |
| --- | --- | --- | --- |
${typeRows}

## Spacing: a 4px rhythm

Was \`[${spaceBefore.join(", ")}]\`. Becomes \`[${tokens.space.join(", ")}]\`.

Every step is a multiple of four, which is what every other part of a modern
stack assumes. Odd spacing values are the reason things look almost aligned.

## What the old app had none of

These are additions, not corrections. An application written before they were
easy has nothing here to preserve.

- **Elevation.** Three levels, tinted with the palette's own ink rather than
  black. A pure black shadow over a warm surface reads as dirt.
- **Motion.** ${tokens.motion.quick} for a state change, ${tokens.motion.settled} for something
  entering, on \`${tokens.motion.easing}\`. The CSS honours \`prefers-reduced-motion\`.
- **A focus ring.** Two rings, so it is visible on any background. Keyboard
  users are the ones most likely to be using this all day.
- **A pill radius**, for the one control that always wants it.

---

Look at the colour table before adopting this. A brand colour that fails
contrast is a real problem and darkening it is one answer, but it is not the
only one, and which answer is right is not a decision a tool should make on its
own.
`;
}
