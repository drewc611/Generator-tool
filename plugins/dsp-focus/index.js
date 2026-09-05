import { readFile } from "node:fs/promises";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The focus management a legacy front end carried in its markup and scripts.
 *
 * Where a landmark says what a screen reader can navigate to and a label says
 * what a control announces, focus is the third axis a screenshot never shows:
 * where the keyboard is, and where it goes next. A legacy page carries a few
 * habits that break it, and a port inherits each silently:
 *
 *   - a positive tabindex, which pulls an element out of source order and
 *     ahead of everything with tabindex 0, so tab order stops matching what
 *     the eye sees; tabindex 0 and -1 are fine and are not flagged.
 *   - more than one autofocus in a file, since only one element can hold focus
 *     on load and the browser's choice among them is not the author's.
 *   - an accesskey, which collides with the shortcuts a browser and a screen
 *     reader already own and is almost never what was meant.
 *   - a programmatic .focus() call, which the port must preserve on the paths
 *     that used it (a modal opening, a route changing, an error landing) or a
 *     keyboard user is dropped somewhere they did not ask to be.
 *
 * This finds each and names the file and line. It counts and changes nothing;
 * which focus move is load-bearing and which tabindex was a mistake is the port
 * owner's call.
 */

const POSITIVE_TABINDEX = /\btabindex\s*=\s*(['"])\s*([1-9]\d*)\s*\1/gi;
const AUTOFOCUS = /\bautofocus\b/gi;
const ACCESSKEY = /\baccesskey\s*=\s*['"]/gi;
const FOCUS_CALL = /\.\s*focus\s*\(\s*\)/g;

export function readFocus(text, rel) {
  const findings = [];
  for (const m of text.matchAll(POSITIVE_TABINDEX)) {
    findings.push({ kind: "positive-tabindex", detail: `tabindex ${m[2]}`, line: lineAt(text, m.index), file: rel });
  }
  for (const m of text.matchAll(AUTOFOCUS)) {
    findings.push({ kind: "autofocus", detail: "autofocus", line: lineAt(text, m.index), file: rel });
  }
  for (const m of text.matchAll(ACCESSKEY)) {
    findings.push({ kind: "accesskey", detail: "accesskey", line: lineAt(text, m.index), file: rel });
  }
  for (const m of text.matchAll(FOCUS_CALL)) {
    findings.push({ kind: "programmatic-focus", detail: ".focus()", line: lineAt(text, m.index), file: rel });
  }
  return findings.sort((a, b) => a.line - b.line);
}

const KIND_LABEL = {
  "positive-tabindex": "a positive tabindex pulls this out of source order",
  autofocus: "autofocus takes the keyboard on load",
  accesskey: "an accesskey collides with browser and screen-reader shortcuts",
  "programmatic-focus": "focus is moved from script; the port must preserve it",
};

export default {
  name: "dsp-focus",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|svelte|mjs|html?)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readFocus(text, file.rel));
      }
      const byKind = {};
      for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      const multiAutofocus = countMultiAutofocus(findings);
      ctx.focus = { findings, byKind, multiAutofocus };
      if (!findings.length) return log.debug("no focus management signals");

      log.info(`${findings.length} focus signal(s) across ${new Set(findings.map((f) => f.file)).size} file(s)`);
      ctx.unverified(
        `FOCUS.md names ${findings.length} focus-management signal(s) the old front end carried: ` +
        `${byKind["positive-tabindex"] ?? 0} positive tabindex, ${byKind.autofocus ?? 0} autofocus, ` +
        `${byKind.accesskey ?? 0} accesskey, ${byKind["programmatic-focus"] ?? 0} programmatic focus call(s). ` +
        "Each is a keyboard behaviour the port either preserves on purpose or drops silently. None was changed here."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.focus?.findings?.length) return;
      await ctx.write("FOCUS.md", render(ctx.focus));
    });
  },
};

function countMultiAutofocus(findings) {
  const perFile = {};
  for (const f of findings) if (f.kind === "autofocus") perFile[f.file] = (perFile[f.file] ?? 0) + 1;
  return Object.values(perFile).filter((n) => n > 1).length;
}

function render({ findings, byKind, multiAutofocus }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const summary = Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(", ");

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) => `- line ${f.line}: \`${f.detail}\` — ${KIND_LABEL[f.kind]}`);
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  const multiNote = multiAutofocus
    ? `\n**${multiAutofocus}** file(s) declare more than one \`autofocus\`; only one element can hold focus on load, so the browser, not the author, picks the winner.\n`
    : "";

  return `# The focus management the old front end carried

Focus is where the keyboard is and where it goes next, the axis a screenshot
never shows. Each entry below is a habit that shapes it, and a port inherits
each one silently unless someone looks:

- a **positive tabindex** pulls an element ahead of everything in the natural
  order, so tab order stops matching the page; \`0\` and \`-1\` are fine and are
  not listed.
- **autofocus** takes the keyboard on load, which is right for a search box and
  wrong for a page a user meant to read.
- an **accesskey** collides with the shortcuts a browser and a screen reader
  already own.
- a **programmatic \`.focus()\`** is a focus move the port must reproduce on the
  path that used it, or a keyboard user is dropped somewhere they did not ask
  to be.
${multiNote}
Counted: ${summary}.

${groups.join("\n\n")}

---

Nothing was changed. Which focus move is load-bearing and which tabindex was a
mistake is the port owner's call.
`;
}
