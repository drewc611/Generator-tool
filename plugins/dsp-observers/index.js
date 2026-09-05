import { readFile } from "node:fs/promises";

/**
 * The observers a legacy front end constructed.
 *
 * IntersectionObserver, ResizeObserver, MutationObserver and PerformanceObserver
 * are long-lived subscriptions the same way a global addEventListener is: each
 * keeps a callback alive, holds whatever that callback closed over, and keeps
 * watching until something calls disconnect(). In a component world an observer
 * made on mount has to be torn down on unmount, or the port leaks it and stacks
 * another on every remount, each still firing against detached nodes.
 *
 * This finds where each observer was constructed and whether a disconnect()
 * appears in the same file. It cannot match a specific observer to a specific
 * teardown without tracking the variable, so, like dsp-events, it reports
 * presence in the file, not proof of teardown on every path. It counts and
 * names; it changes nothing. Which observer belonged in an effect with a
 * cleanup and which was a leak is the port owner's call.
 */

const CONSTRUCT = /\bnew\s+(IntersectionObserver|ResizeObserver|MutationObserver|PerformanceObserver)\b/g;
const DISCONNECT = /\.\s*disconnect\s*\(/;

const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

export function readObservers(text, rel) {
  const cleaned = DISCONNECT.test(text);
  const findings = [];
  for (const m of text.matchAll(CONSTRUCT)) {
    findings.push({ kind: m[1], cleaned, line: lineAt(text, m.index), file: rel });
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-observers",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|svelte|mjs|html?)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readObservers(text, file.rel));
      }
      const byKind = {};
      for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      const unclosed = findings.filter((f) => !f.cleaned);
      ctx.observers = { findings, byKind, unclosed: unclosed.length };
      if (!findings.length) return log.debug("no observers constructed");

      log.info(`${findings.length} observer(s) across ${new Set(findings.map((f) => f.file)).size} file(s), ${unclosed.length} with no disconnect in file`);
      ctx.unverified(
        `OBSERVERS.md names ${findings.length} observer(s) the old front end constructed; ${unclosed.length} have no ` +
        "disconnect() in the same file. In a component each has to be torn down on unmount, or the port leaks an observer that " +
        "keeps firing against detached nodes and stacks another on every remount. None was changed here."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.observers?.findings?.length) return;
      await ctx.write("OBSERVERS.md", render(ctx.observers));
    });
  },
};

function render({ findings, byKind, unclosed }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const summary = Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(", ");

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) => `- line ${f.line}: \`${f.kind}\`${f.cleaned ? "" : " — no `disconnect()` in this file"}`);
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  return `# The observers the old front end constructed

Each entry is a \`new IntersectionObserver\`, \`ResizeObserver\`,
\`MutationObserver\` or \`PerformanceObserver\` found in the source. An observer is
a long-lived subscription: it keeps its callback alive, holds whatever that
callback closed over, and keeps watching until \`disconnect()\` is called. In a
component world one made on mount has to be torn down on unmount, or the port
leaks it and stacks another on every remount, each still firing against nodes
that are gone.

Where no \`disconnect()\` for it appears in the same file, it is called out: that
is an observer the port most likely inherits without a cleanup. **${unclosed}**
of ${findings.length} constructed here have no disconnect beside them. A
disconnect in the file is not proof the observer is torn down on every path,
only that a teardown exists to wire into the component's unmount.

Counted: ${summary}.

${groups.join("\n\n")}

---

Nothing was changed. Which observer belonged in an effect with a cleanup and
which was a leak to drop is the port owner's call.
`;
}
