import { readFile } from "node:fs/promises";

/**
 * Which form controls a legacy page left without an accessible name. A screen
 * reader announces an input with no label as nothing more than "edit text", so
 * a person relying on it cannot know what the field wants. A port that rebuilds
 * the markup and carries this gap forward hides a barrier the original already
 * had, and the barrier never shows in a screenshot.
 *
 * This reads the controls and reports the ones with no name a reader could
 * announce. It measures; it does not invent a label a page never wrote.
 */

// A placeholder is deliberately not counted as a label: it disappears the
// moment the field has focus, and assistive technology treats it as a hint,
// not a name. A control whose only text is a placeholder is still unlabelled.

const CONTROL = /<(input|select|textarea)\b([^>]*)>/gi;
const attr = (tag, name) => {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");
  return re.exec(tag)?.[1] ?? null;
};

const lineOf = (html, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (html[i] === "\n") line += 1;
  return line;
};

export function readLabels(html, rel) {
  const lines = html.split("\n");
  // Every id a <label for="X"> points at, so a control can look itself up.
  const labelledIds = new Set();
  for (const m of html.matchAll(/<label[^>]*\bfor\s*=\s*["']([^"']+)["']/gi)) {
    labelledIds.add(m[1]);
  }

  const findings = [];
  for (const m of html.matchAll(CONTROL)) {
    const control = m[1].toLowerCase();
    const attrs = m[2];
    if (control === "input") {
      const type = (attr(attrs, "type") ?? "text").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    }

    const id = attr(attrs, "id");
    const ariaLabel = attr(attrs, "aria-label");
    const ariaLabelledby = attr(attrs, "aria-labelledby");
    const title = attr(attrs, "title");
    const line = lineOf(html, m.index);

    // Wrapping label is hard to prove with a scanner: a reasonable
    // approximation is a <label without a for= on the same line or the line
    // immediately above the control. This is deliberately loose and may miss a
    // label two lines up or count one that wraps a different field.
    const wrapping = [line - 1, line - 2]
      .filter((i) => i >= 0 && i < lines.length)
      .some((i) => /<label\b(?![^>]*\bfor\s*=)/i.test(lines[i]));

    const labelled =
      (id && labelledIds.has(id)) ||
      (ariaLabel && ariaLabel.trim().length > 0) ||
      (ariaLabelledby && ariaLabelledby.trim().length > 0) ||
      (title !== null) ||
      wrapping;

    if (labelled) continue;

    findings.push({
      kind: "unlabelled",
      control,
      name: attr(attrs, "name") ?? id ?? null,
      line,
      file: rel,
    });
  }
  return findings;
}

export default {
  name: "dsp-labels",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) =>
        /\.(html?|shtml|php|jsp|vue|hbs|handlebars)$/i.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/<input|<select|<textarea/i.test(text)) continue;
        findings.push(...readLabels(text, file.rel));
      }
      ctx.labels = { findings };
      log.info(`${findings.length} form control(s) with no accessible name`);
      if (findings.length) {
        ctx.unverified(
          `LABELS.md names ${findings.length} form control(s) a screen reader would announce ` +
          `without a name. The port should give each one a label; none was invented here.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.labels?.findings?.length) return;
      await ctx.write("LABELS.md", render(ctx.labels.findings));
    });
  },
};

function render(findings) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const sections = [...byFile.entries()].map(([file, list]) => {
    const rows = list
      .map((f) => `- line ${f.line}: \`<${f.control}>\`${f.name ? ` (${f.name})` : ""}`)
      .join("\n");
    return `### \`${file}\`\n\n${rows}`;
  });

  return `# Form controls with no accessible name

A screen reader announces an input with no label as "edit text" and nothing
more, so a person relying on it cannot tell what the field wants. A
placeholder does not close this gap: it disappears the moment the field has
focus, and assistive technology treats it as a hint, not a name.

Each control below needs one of a \`<label for>\` pointing at its id, an
\`aria-label\`, or a wrapping \`<label>\` so a reader can announce it. Nothing
here was invented; these are the controls the source left unnamed.

${sections.join("\n\n")}
`;
}
