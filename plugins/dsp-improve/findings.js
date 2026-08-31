/**
 * What the original got wrong, from watching it run.
 *
 * Every finding names the element it came from and what the rebuild does
 * instead. A port that faithfully reproduces a defect is not a good port, and a
 * list of defects with no evidence is not a review, so each of these carries
 * both.
 */

const AA_NORMAL = 4.5;
const AA_LARGE = 3;
const MIN_TARGET = 44;

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function parseColor(text) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(String(text ?? "").trim());
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}

export function luminance(color) {
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/** WCAG 2.1 contrast ratio, rounded to two places. */
export function contrastRatio(foreground, background) {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
}

const opaque = (value) => {
  const c = parseColor(value);
  return c && c.a > 0;
};

export function findIssues(exploration, model) {
  const findings = [];
  const add = (f) => {
    if (!findings.some((existing) => existing.id === f.id)) findings.push(f);
  };

  for (const screen of exploration.screens ?? []) {
    const pageBackground = screen.pageBackground;

    for (const element of screen.elements ?? []) {
      const where = element.selector;

      // A glyph is not a name. "↻" reads as nothing at all out loud, and it is
      // the most common way an icon button ends up unusable without sight.
      const named = /[\p{L}\p{N}]{2,}/u.test(element.name ?? "");
      if (["button", "a"].includes(element.tag) && !named) {
        add({
          id: `name:${where}`,
          severity: "high",
          kind: "accessible-name",
          screen: screen.id,
          element: where,
          evidence: element.name
            ? `Its only content is ${JSON.stringify(element.name)}, which carries no name for a screen reader.`
            : `A ${element.tag} with no text, aria-label or title.`,
          instead: "The rebuild gives it an aria-label. A control a screen reader cannot name is a control it cannot offer.",
        });
      }

      if (["input", "select", "textarea"].includes(element.tag) && !element.labelled) {
        add({
          id: `label:${where}`,
          severity: "high",
          kind: "unlabelled-field",
          screen: screen.id,
          element: where,
          evidence: element.placeholder
            ? `Labelled only by the placeholder "${element.placeholder}", which disappears as soon as anybody types.`
            : "No label, aria-label or wrapping label element.",
          instead: "The rebuild pairs it with a real <label htmlFor>, keeping the placeholder as a hint rather than as the name.",
        });
      }

      const isControl = ["button", "a", "input", "select"].includes(element.tag);
      if (isControl && element.box.w && element.box.h && Math.min(element.box.w, element.box.h) < MIN_TARGET) {
        add({
          id: `target:${where}`,
          severity: "medium",
          kind: "tap-target",
          screen: screen.id,
          element: where,
          evidence: `${element.box.w}x${element.box.h}px, under the ${MIN_TARGET}px minimum.`,
          instead: `The rebuild pads it to at least ${MIN_TARGET}px without changing how it looks at rest.`,
        });
      }
    }

    for (const sample of screen.sample ?? []) {
      const background = opaque(sample.background) ? sample.background : pageBackground;
      const ratio = contrastRatio(sample.color, background);
      if (ratio === null) continue;
      const large = sample.fontSize >= 24 || (sample.fontSize >= 18.66 && Number(sample.fontWeight) >= 700);
      const required = large ? AA_LARGE : AA_NORMAL;
      if (ratio < required) {
        add({
          id: `contrast:${sample.tag}:${sample.color}:${background}`,
          severity: ratio < 3 ? "high" : "medium",
          kind: "contrast",
          screen: screen.id,
          element: sample.tag,
          evidence: `${sample.color} on ${background} is ${ratio}:1 at ${sample.fontSize}px, under the ${required}:1 this size needs.`,
          instead: "The rebuild takes the nearest token that clears the threshold, so muted text stays muted and stays readable.",
        });
      }
    }
  }

  // A screen that loads data has three states besides the happy one. A state
  // that was never observed is not proof it is missing, so this says which it
  // is: never seen, on a screen that definitely fetches.
  for (const screen of model.screens ?? []) {
    const fetches = (model.wiring ?? []).some((w) => w.screen === screen.id);
    const shows = screen.kind === "list" || Boolean(screen.collection);
    // Empty is a question about a collection. Loading and error are questions
    // about anything that waits on the network. A form needs neither an empty
    // state nor an apology for having no rows.
    const wanted = [...(fetches ? ["loading", "error"] : []), ...(shows ? ["empty"] : [])];
    for (const state of wanted) {
      if (screen.states?.[state]) continue;
      add({
        id: `state:${screen.id}:${state}`,
        severity: state === "error" ? "high" : "medium",
        kind: "missing-state",
        screen: screen.id,
        element: screen.name,
        evidence: `No ${state} state was seen on this screen across the whole exploration, and it loads data.`,
        instead: `The rebuild renders a real ${state} state. ${EXPLAIN[state]}`,
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.kind.localeCompare(b.kind));
}

const EXPLAIN = {
  loading: "Without one the screen looks broken while it waits.",
  empty: "An empty state that renders nothing is the most common defect in a ported screen.",
  error: "Without one a failed request leaves the last good screen up, which reads as success.",
};
