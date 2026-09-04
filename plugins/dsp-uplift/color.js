import { parse, ratio } from "../dsp-a11y/index.js";

/**
 * Colour maths, for changing a palette without losing the app.
 *
 * The rule throughout: keep the hue. A brand colour is the one thing in a
 * legacy palette that somebody genuinely chose, and the usual way a redesign
 * goes wrong is by replacing it with something merely nicer. What gets changed
 * here is lightness, and only as far as a contrast target requires.
 */

export function toHsl(color) {
  const rgb = parse(color);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  return { h, s, l };
}

export function toHex({ h, s, l }) {
  const hue = (p, q, t) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const rgb = s === 0 ? [l, l, l] : [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  return "#" + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Move a colour along lightness only, until it clears `target` against `on`.
 *
 * It searches in the direction that is already working: a dark colour on a
 * light ground gets darker, never inverted. A palette that flips a colour to
 * meet a number has stopped being the same palette.
 */
export function fitContrast(color, on, target = 4.5) {
  const start = toHsl(color);
  const ground = toHsl(on);
  if (!start || !ground) return null;

  const current = ratio(color, on);
  if (current === null || current >= target) return { hex: toHex(start), ratio: current, moved: 0 };

  const darken = ground.l > 0.5;
  let best = null;

  // A hundredth of a step is finer than anybody can see and coarse enough to
  // finish immediately.
  for (let i = 1; i <= 100; i++) {
    const l = darken ? start.l - i / 100 : start.l + i / 100;
    if (l < 0 || l > 1) break;
    const candidate = toHex({ ...start, l });
    const got = ratio(candidate, on);
    if (got !== null && got >= target) {
      best = { hex: candidate, ratio: Math.round(got * 100) / 100, moved: Math.round((l - start.l) * 100) };
      break;
    }
  }

  return best ?? { hex: toHex({ ...start, l: darken ? 0 : 1 }), ratio: ratio(darken ? "#000000" : "#FFFFFF", on), moved: darken ? -100 : 100, exhausted: true };
}

export { ratio };
