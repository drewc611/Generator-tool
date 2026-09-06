import { readFile } from "node:fs/promises";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The timers and animation loops a legacy front end scheduled.
 *
 * A setInterval that polls, a setTimeout that retries, a requestAnimationFrame
 * that drives a loop: each is work the page kept doing after the line that
 * started it ran. In a component world every one of them has to be cleaned up
 * when the component goes away, or the port leaks a loop that keeps running,
 * keeps fetching, and keeps holding the closure it captured. The old app often
 * cleared them and often did not; either way the port has to decide on purpose.
 *
 * This finds where each was scheduled and whether a matching clear appears in
 * the same file, so the port can see which loops it inherits and which already
 * leaked. It counts; it changes nothing. Where and how a timer is cleaned up in
 * the new component is the port owner's call.
 */

const SCHEDULERS = {
  setInterval: "clearInterval",
  setTimeout: "clearTimeout",
  requestAnimationFrame: "cancelAnimationFrame",
  requestIdleCallback: "cancelIdleCallback",
};

export function readTimers(text, rel) {
  const findings = [];
  const clears = {};
  for (const [, clear] of Object.entries(SCHEDULERS)) {
    clears[clear] = new RegExp(`\\b${clear}\\s*\\(`).test(text);
  }
  for (const [scheduler, clear] of Object.entries(SCHEDULERS)) {
    const re = new RegExp(`\\b${scheduler}\\s*\\(`, "g");
    for (const m of text.matchAll(re)) {
      findings.push({ scheduler, clear, cleared: clears[clear], line: lineAt(text, m.index), file: rel });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-timers",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|svelte|mjs|html?)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readTimers(text, file.rel));
      }
      const byKind = {};
      for (const f of findings) byKind[f.scheduler] = (byKind[f.scheduler] ?? 0) + 1;
      const uncleared = findings.filter((f) => !f.cleared);
      ctx.timers = { findings, byKind, uncleared: uncleared.length };
      if (!findings.length) return log.debug("no timers or animation loops scheduled");

      log.info(`${findings.length} timer(s) across ${new Set(findings.map((f) => f.file)).size} file(s), ${uncleared.length} with no matching clear in file`);
      ctx.unverified(
        `TIMERS.md names ${findings.length} timer(s) or animation loop(s) the old front end scheduled; ${uncleared.length} ` +
        "have no matching clear in the same file. In a component each has to be cleaned up when the component goes away, or " +
        "the port leaks a loop that keeps running and holding its closure. None was changed here."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.timers?.findings?.length) return;
      await ctx.write("TIMERS.md", render(ctx.timers));
    });
  },
};

function render({ findings, byKind, uncleared }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const summary = Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`).join(", ");

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) => `- line ${f.line}: \`${f.scheduler}\`${f.cleared ? "" : ` — no \`${f.clear}\` in this file`}`);
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  return `# The timers and animation loops the old front end scheduled

Each entry is a \`setTimeout\`, \`setInterval\`, \`requestAnimationFrame\` or
\`requestIdleCallback\` found in the source. Each is work the page kept doing
after the line that started it ran. In a component world every one has to be
cleaned up when the component unmounts, or the port leaks a loop that keeps
running, keeps fetching, and keeps holding the closure it captured.

Where a matching clear (\`clearInterval\`, \`clearTimeout\`,
\`cancelAnimationFrame\`, \`cancelIdleCallback\`) does not appear in the same
file, it is called out: that is a loop the port most likely inherits without a
stop. **${uncleared}** of ${findings.length} scheduled here have no clear beside
them. A clear in the file is not proof the timer is handled on every path, only
that a stop exists to wire into the component's teardown.

Counted: ${summary}.

${groups.join("\n\n")}

---

Nothing was changed. Which timer belongs in an effect with a cleanup, which
should move to the server, and which was a leak to drop is the port owner's call.
`;
}
