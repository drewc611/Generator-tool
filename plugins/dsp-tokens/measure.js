/**
 * Measurement, kept apart from the plugin so it can be tested without a
 * browser or a pipeline. Everything here returns a value and the evidence it
 * came from, or nothing at all. Nothing here invents a number.
 */

export function toHex(color) {
  if (!color) return null;
  const text = String(color).trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return ("#" + text.slice(1).split("").map((c) => c + c).join("")).toUpperCase();
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i);
  if (!rgb) return null;
  // Fully transparent is not a color, it is the absence of one.
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
  const hex = [rgb[1], rgb[2], rgb[3]]
    .map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0"))
    .join("");
  return ("#" + hex).toUpperCase();
}

function tally(values) {
  const counts = new Map();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function median(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function flattenSamples(observedStyles = []) {
  const samples = [];
  const rowHeights = [];
  let font = null;
  let pageBackground = null;
  for (const observation of observedStyles) {
    if (Array.isArray(observation.sample)) samples.push(...observation.sample);
    if (Array.isArray(observation.rowHeights)) rowHeights.push(...observation.rowHeights);
    font ??= observation.font ?? null;
    pageBackground ??= observation.pageBackground ?? null;
  }
  return { samples, rowHeights, font, pageBackground };
}

/**
 * Body copy is the size that appears most often. The middle of the range is a
 * different number and it is usually a heading. Sizes seen once are the tail of
 * accidents every mature stylesheet carries, so they are dropped once there is
 * enough data to tell a tail from a step.
 */
export function measureTypeScale(samples) {
  const sizes = samples.map((s) => Number(s.fontSize)).filter((n) => Number.isFinite(n) && n > 0);
  if (sizes.length < 2) return null;

  const counts = tally(sizes);
  const body = Number(counts[0][0]);
  const steps = (sizes.length >= 10 ? counts.filter(([, n]) => n > 1) : counts)
    .map(([size]) => Number(size))
    .sort((a, b) => a - b);
  if (steps.length < 2) return null;

  const below = steps.filter((n) => n < body);
  const above = steps.filter((n) => n > body);
  const scale = { md: body };
  if (below.length) {
    scale.sm = below[below.length - 1];
    scale.xs = below[0] === scale.sm ? undefined : below[0];
  }
  if (above.length) {
    scale.lg = above[0];
    scale.xl = above[above.length - 1] === scale.lg ? undefined : above[above.length - 1];
  }
  for (const key of Object.keys(scale)) if (scale[key] === undefined) delete scale[key];
  return { scale, evidence: `${sizes.length} measured font sizes, ${steps.length} distinct steps` };
}

export function measureDensity(rowHeights) {
  const heights = rowHeights.filter((n) => Number.isFinite(n) && n > 0);
  if (!heights.length) return null;
  const middle = median(heights);
  const density = middle < 36 ? "compact" : middle < 52 ? "comfortable" : "roomy";
  return { density, rowHeight: middle, evidence: `${heights.length} measured row heights, median ${middle}px` };
}

/**
 * Roles by frequency weighted by where they appear, not every hex in the file.
 * A mature product has two hundred colors and most of them are one offs.
 */
// A control paints itself. Its background is the button, not the page behind
// it, and its text colour is chosen to sit on that button. Letting either vote
// makes the brand colour the surface of every panel in the port.
const CONTROL_TAGS = new Set(["button", "input", "select", "textarea", "a", "option", "summary"]);

export function measureColors(samples, pageBackground) {
  const prose = samples.filter((s) => !CONTROL_TAGS.has(String(s.tag).toLowerCase()));
  const inks = tally(prose.map((s) => toHex(s.color)));
  const surfaces = tally(prose.map((s) => toHex(s.background)));
  const color = {};
  const evidence = [];

  const page = toHex(pageBackground);
  if (page) {
    color.bg = page;
    evidence.push(`bg from the page background`);
  }
  if (inks.length) {
    color.ink = inks[0][0];
    evidence.push(`ink from ${inks[0][1]} of ${prose.length} text elements`);
    if (inks.length > 1) {
      color.inkMuted = inks[1][0];
      evidence.push(`inkMuted from ${inks[1][1]} text elements`);
    }
  }
  if (surfaces.length) {
    color.surface = surfaces[0][0];
    evidence.push(`surface from ${surfaces[0][1]} elements that are not controls`);
  }
  return Object.keys(color).length ? { color, evidence } : null;
}

export function measureRadius(samples) {
  const radii = samples.map((s) => Number(s.radius)).filter((n) => Number.isFinite(n) && n > 0);
  if (!radii.length) return null;
  const control = tally(radii)[0][0];
  return { control: Number(control), evidence: `${radii.length} rounded elements` };
}

/** Declared custom properties and Sass variables, which are the most honest
 * statement of intent a stylesheet makes. */
export function readStyleVariables(text) {
  const found = {};
  for (const m of text.matchAll(/(?:--|\$)([\w-]+)\s*:\s*([^;\n}]+)[;\n}]/g)) {
    found[m[1].trim()] = m[2].trim();
  }
  return found;
}

const ROLE_HINTS = [
  ["accent", /accent|primary|brand|link/i],
  ["danger", /danger|error|destructive|critical/i],
  ["warn", /warn|caution|attention/i],
  ["ok", /ok|success|positive|valid/i],
  ["ink", /^(ink|text|foreground|fg)\b|(?<!\w)text-color/i],
  ["surface", /surface|panel|card/i],
  ["bg", /background|^bg\b|canvas/i],
  ["line", /border|divider|line|rule/i],
];

export function rolesFromVariables(variables) {
  const color = {};
  const evidence = [];
  const claimed = new Set();
  for (const [name, raw] of Object.entries(variables)) {
    const hex = toHex(raw);
    if (!hex) continue;
    const hit = ROLE_HINTS.find(([role, re]) => re.test(name) && !claimed.has(role));
    if (!hit) continue;
    claimed.add(hit[0]);
    color[hit[0]] = hex;
    evidence.push(`${hit[0]} from ${name.startsWith("-") ? name : "$" + name}`);
  }
  return Object.keys(color).length ? { color, evidence } : null;
}

/**
 * The spacing scale, measured at last. Gaps between recorded element boxes,
 * vertical to the next thing below and horizontal to the next thing beside,
 * clustered within two pixels. Spacing was the one token that stayed a
 * default because nothing measured said what the scale was meant to be; a
 * recording that carries positions finally says what it rendered as.
 *
 * The emitted components index seven rungs, so a measurement with fewer
 * fills the top of the ladder from the defaults and the evidence says how
 * many rungs are real.
 */
export function measureSpacing(exploration, defaults) {
  const gaps = [];
  for (const screen of exploration?.screens ?? []) {
    const boxes = (screen.elements ?? [])
      .map((e) => e.box)
      .filter((b) => b && typeof b.x === "number" && typeof b.y === "number" && b.w > 0 && b.h > 0);

    const byY = [...boxes].sort((a, b) => a.y - b.y);
    for (let i = 0; i < byY.length; i += 1) {
      for (let j = i + 1; j < byY.length; j += 1) {
        const a = byY[i];
        const c = byY[j];
        const overlapX = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
        const gap = c.y - (a.y + a.h);
        if (overlapX > 0 && gap > 0 && gap <= 64) { gaps.push(Math.round(gap)); break; }
      }
    }
    const byX = [...boxes].sort((a, b) => a.x - b.x);
    for (let i = 0; i < byX.length; i += 1) {
      for (let j = i + 1; j < byX.length; j += 1) {
        const a = byX[i];
        const c = byX[j];
        const overlapY = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
        const gap = c.x - (a.x + a.w);
        if (overlapY > 0 && gap > 0 && gap <= 64) { gaps.push(Math.round(gap)); break; }
      }
    }
  }
  if (gaps.length < 4) return null;

  const buckets = new Map();
  for (const gap of gaps) {
    const near = [...buckets.keys()].find((k) => Math.abs(k - gap) <= 2);
    if (near !== undefined) {
      const bucket = buckets.get(near);
      bucket.n += 1;
      bucket.sum += gap;
    } else buckets.set(gap, { n: 1, sum: gap });
  }
  // A rung needs two observations to count as rhythm rather than accident;
  // two rungs of real rhythm already beat seven of default.
  const measured = [...buckets.values()]
    .filter((b) => b.n >= 2)
    .map((b) => Math.round(b.sum / b.n))
    .sort((a, b) => a - b)
    .slice(0, 7);
  if (measured.length < 2) return null;

  const scale = [...measured];
  for (const rung of defaults) {
    if (scale.length >= 7) break;
    if (rung > scale[scale.length - 1]) scale.push(rung);
  }
  while (scale.length < 7) scale.push(scale[scale.length - 1] * 2);

  return {
    scale,
    evidence: `spacing from ${gaps.length} gap(s) between recorded elements, ${measured.length} rung(s) measured` +
      (measured.length < 7 ? ", the rest defaulted above them" : ""),
  };
}
