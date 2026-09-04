import { readFile } from "node:fs/promises";

/**
 * The debug output a legacy front end left in its scripts. A console call or a
 * debugger statement is a note the author wrote to themselves and forgot to
 * take out, and a port that copies it forward ships it to production, where it
 * runs for anyone who opens the browser console. What it prints is often an
 * internal name, a payload, a token or a shape of the data the page never
 * meant to show a stranger, and a debugger left in pauses the page whenever a
 * developer tool is open.
 *
 * This reads the calls and locates them; it never captures what they print,
 * because the arguments can hold exactly the values a report must not repeat.
 * It measures; it removes nothing. Stripping the noise or gating it behind a
 * debug flag is a decision the port owner makes, and this names where.
 */

// Anchored on a word boundary and the literal method name, so the match is a
// single linear scan with nothing to backtrack over.
const CONSOLE_CALL = /\bconsole\s*\.\s*([A-Za-z]+)\s*\(/g;
const DEBUGGER = /\bdebugger\b\s*;?/g;

const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

export function readConsole(text, rel) {
  const findings = [];
  for (const m of text.matchAll(CONSOLE_CALL)) {
    findings.push({ kind: "console", method: m[1], line: lineAt(text, m.index), file: rel });
  }
  for (const m of text.matchAll(DEBUGGER)) {
    findings.push({ kind: "debugger", method: null, line: lineAt(text, m.index), file: rel });
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-console",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|mjs)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      const byMethod = {};
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        for (const finding of readConsole(text, file.rel)) {
          findings.push(finding);
          const key = finding.kind === "debugger" ? "debugger" : finding.method;
          byMethod[key] = (byMethod[key] ?? 0) + 1;
        }
      }
      ctx.consoleDebt = { findings, byMethod };
      if (!findings.length) return log.debug("no console or debugger left in the scripts");

      log.info(`${findings.length} debug statement(s) left in ${new Set(findings.map((f) => f.file)).size} file(s)`);
      ctx.unverified(
        `CONSOLE.md names ${findings.length} debug statement(s) the old front end left in its scripts (console calls and ` +
        `debugger stops). Shipped to production they leak internal detail to anyone with a console open; strip them or gate ` +
        `them behind a debug flag on purpose. None was removed here.`
      );
    });

    on("emit", async (ctx) => {
      // A run whose scripts carried no debug output writes no report: an empty
      // CONSOLE.md in every port is noise, and the clean scripts are the point.
      if (!ctx.consoleDebt?.findings?.length) return;
      await ctx.write("CONSOLE.md", render(ctx.consoleDebt));
    });
  },
};

function render({ findings, byMethod }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) =>
        f.kind === "debugger" ? `- line ${f.line}: debugger` : `- line ${f.line}: console.${f.method}`);
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  const summary = Object.entries(byMethod)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k === "debugger" ? "debugger" : `console.${k}`}: ${n}`)
    .join(", ");

  return `# The debug output the old front end left in

Each entry is a console call or a debugger statement found in the source. The
port carried them forward unchanged so nothing was lost silently, but debug
output shipped to production runs for anyone who opens the browser console: it
leaks internal names, payloads and the shape of the data to a stranger, and a
debugger left in pauses the page whenever a developer tool is open. Strip these
before shipping, or gate them behind a debug flag on purpose.

The arguments each call prints are not shown here. They can hold exactly the
values a report must not repeat, so this names the method and the line and
stops there.

Counted: ${summary}.

${groups.join("\n\n")}

---

Nothing was removed. Deciding which of these is a diagnostic worth keeping
behind a flag and which is a forgotten note to strip is the port owner's call.
`;
}
