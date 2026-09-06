import { readFile } from "node:fs/promises";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The global event listeners a legacy front end attached.
 *
 * A window or document addEventListener is a subscription that outlives the
 * function that made it. In a component world each has to be removed when the
 * component unmounts, or the port leaks a listener that keeps firing, keeps
 * holding the closure it captured, and stacks a second copy every time the
 * component mounts again. The old app often removed them and often did not.
 *
 * This finds where each listener was attached, on which target where the target
 * is a plain global, and whether a matching removeEventListener for the same
 * event appears in the same file. It counts and names; it changes nothing. Where
 * a listener belongs in an effect with a cleanup, and which was a leak, is the
 * port owner's call.
 */

const ADD = /\b(window|document|globalThis|self|[\w$.]+)\s*\.\s*addEventListener\s*\(\s*(['"`])([\w:-]+)\2/g;
const REMOVE = /\.\s*removeEventListener\s*\(\s*(['"`])([\w:-]+)\1/g;

const GLOBAL = new Set(["window", "document", "globalThis", "self"]);

export function readEvents(text, rel) {
  const removedEvents = new Set();
  for (const m of text.matchAll(REMOVE)) removedEvents.add(m[2]);
  const findings = [];
  for (const m of text.matchAll(ADD)) {
    const target = GLOBAL.has(m[1]) ? m[1] : "an element";
    findings.push({ target, event: m[3], removed: removedEvents.has(m[3]), line: lineAt(text, m.index), file: rel });
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-events",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|svelte|mjs|html?)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readEvents(text, file.rel));
      }
      const byEvent = {};
      for (const f of findings) byEvent[f.event] = (byEvent[f.event] ?? 0) + 1;
      const unremoved = findings.filter((f) => !f.removed);
      ctx.events = { findings, byEvent, unremoved: unremoved.length };
      if (!findings.length) return log.debug("no global event listeners attached");

      log.info(`${findings.length} event listener(s) across ${new Set(findings.map((f) => f.file)).size} file(s), ${unremoved.length} with no matching remove in file`);
      ctx.unverified(
        `EVENTS.md names ${findings.length} global event listener(s) the old front end attached; ${unremoved.length} have no ` +
        "matching removeEventListener in the same file. In a component each has to be removed on unmount, or the port leaks a " +
        "listener that keeps firing and stacks another copy on every remount. None was changed here."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.events?.findings?.length) return;
      await ctx.write("EVENTS.md", render(ctx.events));
    });
  },
};

function render({ findings, byEvent, unremoved }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const summary = Object.entries(byEvent).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(", ");

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) => `- line ${f.line}: \`${f.event}\` on ${f.target}${f.removed ? "" : " — no matching `removeEventListener` in this file"}`);
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  return `# The global event listeners the old front end attached

Each entry is an \`addEventListener\` found in the source. A listener on
\`window\` or \`document\` is a subscription that outlives the function that made
it. In a component world each has to be removed when the component unmounts, or
the port leaks a listener that keeps firing, keeps holding the closure it
captured, and stacks a second copy every time the component mounts again.

Where a matching \`removeEventListener\` for the same event does not appear in
the same file, it is called out: that is a listener the port most likely
inherits without a cleanup. **${unremoved}** of ${findings.length} attached here
have no remove beside them. A remove in the file is not proof the listener is
torn down on every path, only that a teardown exists to wire into the
component's unmount.

Counted: ${summary}.

${groups.join("\n\n")}

---

Nothing was changed. Which listener belongs in an effect with a cleanup, which
should be delegated, and which was a leak to drop is the port owner's call.
`;
}
