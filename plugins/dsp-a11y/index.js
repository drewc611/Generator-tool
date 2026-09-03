/**
 * Checks the tokens the port will actually be built from, which is a different
 * question to the one dsp-improve answers. That plugin measures what the old
 * app rendered. This one asks whether the palette about to be written into
 * src/tokens.js can be combined legibly, because a defaulted or recovered
 * colour pair that fails here fails on every screen at once.
 *
 * It reports by default. It fails the run only when asked:
 *   a11y: { gate: true }
 */

import { parse as parseMarkup } from "../dsp-ir/parse.js";

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

/**
 * The structure of each screen's markup, checked where structure is checkable
 * statically: a heading ladder that skips rungs, and an aria reference whose
 * id is nowhere in the same screen. Both are candidates, not verdicts; an id
 * can live in another screen's markup, and the finding says so.
 */
export function checkStructure(screens) {
  const findings = [];
  for (const screen of screens) {
    if (!screen.template) continue;
    const headings = [];
    const ids = new Set();
    const refs = [];
    const walk = (node) => {
      if (node.type !== "element") return;
      const level = /^h([1-6])$/i.exec(node.tag ?? "")?.[1];
      if (level) headings.push(Number(level));
      for (const attr of node.attrs ?? []) {
        if (attr.name === "id" && attr.value && !/\{\{/.test(attr.value)) ids.add(attr.value.trim());
        if (/^aria-(labelledby|describedby)$/i.test(attr.name) && attr.value && !/\{\{/.test(attr.value)) {
          refs.push({ attr: attr.name, value: attr.value, tag: node.tag });
        }
      }
      (node.children ?? []).forEach(walk);
    };
    parseMarkup(screen.template).forEach(walk);

    for (let i = 1; i < headings.length; i += 1) {
      if (headings[i] > headings[i - 1] + 1) {
        findings.push({
          screen: screen.selector,
          kind: "heading-skip",
          evidence: `${screen.selector}: an h${headings[i - 1]} is followed by an h${headings[i]}, skipping h${headings[i - 1] + 1}. A screen reader's outline jumps the same way.`,
        });
      }
    }
    for (const ref of refs) {
      const missing = ref.value.split(/\s+/).filter((id) => id && !ids.has(id));
      if (missing.length) {
        findings.push({
          screen: screen.selector,
          kind: "dangling-aria",
          evidence: `${screen.selector}: <${ref.tag} ${ref.attr}="${ref.value}"> points at ${missing.map((m) => `\`#${m}\``).join(", ")}, which is not in this screen's markup. If the id lives in another screen, the reference breaks when they are split.`,
        });
      }
    }
  }
  return findings;
}

export function parse(color) {
  const text = String(color ?? "").trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  return rgb ? { r: +rgb[1], g: +rgb[2], b: +rgb[3] } : null;
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function ratio(foreground, background) {
  const fg = parse(foreground);
  const bg = parse(background);
  if (!fg || !bg) return null;
  const a = 0.2126 * channel(fg.r) + 0.7152 * channel(fg.g) + 0.0722 * channel(fg.b) + 0.05;
  const b = 0.2126 * channel(bg.r) + 0.7152 * channel(bg.g) + 0.0722 * channel(bg.b) + 0.05;
  return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
};

// The pairs a port will actually put on screen, and the size each is used at.
const PAIRS = [
  ["ink", "bg", "body text on the page", AA_NORMAL],
  ["ink", "surface", "body text on a panel", AA_NORMAL],
  ["inkMuted", "bg", "muted text on the page", AA_NORMAL],
  ["inkMuted", "surface", "muted text on a panel", AA_NORMAL],
  ["inkFaint", "surface", "the faintest text on a panel", AA_NORMAL],
  ["accent", "surface", "a link or a primary label", AA_NORMAL],
  ["danger", "surface", "an error message", AA_NORMAL],
  ["ok", "surface", "a success message", AA_NORMAL],
  ["warn", "surface", "a warning", AA_NORMAL],
];

export function checkTokens(tokens) {
  const colour = tokens?.color ?? {};
  const findings = [];
  for (const [fg, bg, what, required] of PAIRS) {
    if (!colour[fg] || !colour[bg]) continue;
    const measured = ratio(colour[fg], colour[bg]);
    if (measured === null || measured >= required) continue;
    findings.push({
      pair: `${fg} on ${bg}`,
      what,
      ratio: measured,
      required,
      severity: measured < 3 ? "high" : "medium",
      evidence: `${colour[fg]} on ${colour[bg]} is ${measured}:1, under the ${required}:1 that ${what} needs.`,
    });
  }
  return findings.sort((a, b) => a.ratio - b.ratio);
}

/** A control smaller than this is hard to hit and hard to see focus on. */
export function checkDensity(tokens) {
  const height = Number.parseFloat(tokens?.density?.rowHeight ?? tokens?.rowHeight ?? "");
  if (!Number.isFinite(height) || height >= 44) return null;
  return {
    pair: "density.rowHeight",
    what: "a row as a tap target",
    ratio: height,
    required: 44,
    severity: "medium",
    evidence: `Rows are ${height}px, under the 44px a tap target wants. This was measured from the old app, so it is a decision to carry forward or not.`,
  };
}

export default {
  name: "dsp-a11y",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    // After dsp-tokens, which is where the palette comes from.
    on("emit", async (ctx) => {
      const structure = checkStructure(ctx.screens ?? []);
      ctx.a11yStructure = structure;
      for (const finding of structure) ctx.unverified(`Structure: ${finding.evidence}`);
      if (structure.length) log.info(`${structure.length} structural finding(s) across the screens`);

      if (!ctx.tokens) return log.debug("no tokens to check");

      const findings = checkTokens(ctx.tokens);
      const density = checkDensity(ctx.tokens);
      if (density) findings.push(density);
      ctx.a11y = findings;

      const serious = findings.filter((f) => f.severity === "high");
      log.info(
        findings.length
          ? `${findings.length} token pair(s) under AA, ${serious.length} of them badly`
          : "every token pair clears AA"
      );
      for (const finding of findings) {
        ctx.unverified(`Contrast: ${finding.evidence}`);
      }

      // Written every run, including a clean one. A report that only appears
      // when something is wrong is a report nobody knows to look for.
      await ctx.write(
        "A11Y.md",
        [
          "# Accessibility of the recovered palette",
          "",
          "Every pair below is one the port will put on screen. These are the tokens",
          "in `src/tokens.js`, not the old app: a pair that fails here fails on every",
          "screen at once.",
          "",
          ...(findings.length
            ? [
                "| pair | used for | ratio | needs |",
                "| --- | --- | --- | --- |",
                ...findings.map((f) => `| \`${f.pair}\` | ${f.what} | ${f.ratio}:1 | ${f.required}:1 |`),
                "",
                "Raising a token here changes every screen. That is the point of having them.",
              ]
            : ["Every pair checked clears AA at the size it is used.", "", "Checked: " + PAIRS.map((p) => `\`${p[0]} on ${p[1]}\``).join(", ") + "."]),
          "",
          ...(structure.length
            ? [
                "## Structure, per screen",
                "",
                "Candidates, not verdicts: an id can live in markup this screen does not own.",
                "",
                ...structure.map((f) => `- ${f.evidence}`),
                "",
              ]
            : []),
        ].join("\n")
      );

      if (ctx.config.a11y?.gate && serious.length) {
        throw new Error(
          `${serious.length} token pair(s) are under 3:1, which is unreadable rather than merely poor.\n` +
            serious.map((f) => `  ${f.pair}  ${f.evidence}`).join("\n") +
            "\nRaise them in portamp.config.js under tokens.color, or drop a11y.gate."
        );
      }
    });
  },
};
