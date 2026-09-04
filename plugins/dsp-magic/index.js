import { readFile } from "node:fs/promises";

/**
 * The magic numbers and hardcoded status strings a legacy front end buried in
 * its logic. A threshold typed straight into an `if`, a rate multiplied inline,
 * a status compared as a bare literal: each is a value with no name, and a value
 * with no name is one nobody can find to change. When the business raises a free
 * shipping floor or renames a workflow state, the person doing it greps the app
 * and misses the copy that read `4999` or `"PENDING_REVIEW"` in the middle of an
 * expression. A port is the moment to lift these into a named constant or a
 * configuration key, so the value has one home.
 *
 * This locates them and reports them; it lifts nothing. Which threshold is a
 * genuine business rule worth a name and which is an incidental constant is a
 * judgment the port owner makes, and this names where each one sits.
 */

// A numeric literal: an optional leading dot handled by the alternation, no
// nested quantifiers, so the scan is linear with nothing to backtrack over.
const NUMBER = /(?<![.\w$])(\d+\.\d+|\.\d+|\d+)/g;
// A double or single quoted string with no escape handling, which keeps the
// class simple and the match linear; a screaming snake token is checked after.
const STRING = /"([^"\n]*)"|'([^'\n]*)'/g;
// The comparison operators that turn a bare string into a flag rather than copy.
const COMPARE_BEFORE = /(===|!==|==|!=)\s*$/;

const TRIVIAL = new Set(["0", "1", "-1", "2", "100", "1000"]);
const SCREAMING = /^[A-Z][A-Z0-9_]{2,}$/;
const SHORT_WORD = /^[A-Za-z]{2,15}$/;
// A run of twelve or more characters mixing case and digits reads like a
// credential, which is the secret gate's territory; this never captures one.
const CREDENTIAL = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{12,}$/;

const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

const lineBounds = (text, index) => {
  let start = index;
  while (start > 0 && text.charCodeAt(start - 1) !== 10) start -= 1;
  let end = index;
  while (end < text.length && text.charCodeAt(end) !== 10) end += 1;
  return { start, end };
};

export function readMagic(text, rel) {
  const findings = [];

  for (const m of text.matchAll(NUMBER)) {
    const value = m[1];
    // Only three or more digits or a decimal reads as a threshold or a rate; a
    // one or two digit integer is usually a loop bound or an offset with no
    // business meaning worth naming.
    const isDecimal = value.includes(".");
    const digits = value.replace(".", "").length;
    if (!isDecimal && digits < 3) continue;
    if (TRIVIAL.has(value)) continue;

    const { start, end } = lineBounds(text, m.index);
    const lineText = text.slice(start, end);
    // A number assigned to a named binding is already named, so skip a line that
    // declares one; the value has a home the moment it follows `const X =`.
    if (/^\s*(const|let|var)\s/.test(lineText)) continue;
    // An index into an array by a literal position is structural, not magic.
    const before = text[m.index - 1];
    const after = text[m.index + value.length];
    if (before === "[" && after === "]") continue;

    findings.push({ kind: "magic-number", value, line: lineAt(text, m.index), file: rel });
  }

  for (const m of text.matchAll(STRING)) {
    const value = m[1] ?? m[2];
    if (!value) continue;
    if (CREDENTIAL.test(value)) continue;

    const screaming = SCREAMING.test(value);
    const { start } = lineBounds(text, m.index);
    const preceding = text.slice(start, m.index);
    // A short word on the right of an equality operator is a flag being tested,
    // not display copy: `region === "EU"` is a rule, `"Welcome back"` is text.
    const compared = SHORT_WORD.test(value) && COMPARE_BEFORE.test(preceding);

    if (!screaming && !compared) continue;
    findings.push({ kind: "magic-string", value, line: lineAt(text, m.index), file: rel });
  }

  return findings.sort((a, b) => a.line - b.line);
}

const PER_FILE_CAP = 50;

export default {
  name: "dsp-magic",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter(
        (f) => /\.(js|jsx|ts|tsx|mjs)$/i.test(f.rel) && !/\.min\.|\.spec\.|\.test\./.test(f.rel)
      );
      const findings = [];
      const byKind = {};
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        let hits = readMagic(text, file.rel);
        // A single file dense with literals would drown the report; keep the
        // first fifty and record that the file carried more so the count stays
        // honest without listing every one.
        if (hits.length > PER_FILE_CAP) {
          const total = hits.length;
          hits = hits.slice(0, PER_FILE_CAP);
          hits.push({ kind: "more", value: String(total - PER_FILE_CAP), line: 0, file: file.rel });
        }
        for (const finding of hits) {
          findings.push(finding);
          if (finding.kind === "more") continue;
          byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
        }
      }
      ctx.magic = { findings, byKind };
      const real = findings.filter((f) => f.kind !== "more");
      if (!real.length) return log.debug("no magic numbers or hardcoded status strings found");

      log.info(`${real.length} magic value(s) in ${new Set(real.map((f) => f.file)).size} file(s)`);
      ctx.unverified(
        `MAGIC.md names ${real.length} magic value(s) the old front end buried in its logic (numeric thresholds and ` +
        `rates, and status strings compared as bare literals). A value with no name is one nobody can find to change; the ` +
        `port should lift each into a named constant or a config key. None was lifted here.`
      );
    });

    on("emit", async (ctx) => {
      // A run whose logic named its values writes no report: an empty MAGIC.md
      // in every port is noise, and the absence of buried literals is the point.
      const real = ctx.magic?.findings?.filter((f) => f.kind !== "more");
      if (!real?.length) return;
      await ctx.write("MAGIC.md", render(ctx.magic));
    });
  },
};

function render({ findings, byKind }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) =>
        f.kind === "more"
          ? `- ...and ${f.value} more in this file, not listed`
          : `- line ${f.line}: ${f.kind} ${f.value}`);
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  const summary = Object.entries(byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
    .join(", ");

  return `# The magic values the old front end buried in its logic

Each entry is a numeric literal used as a threshold or a rate, or a status
string compared as a bare literal, found in the source. A value with no name is
one nobody can find to change: when a floor moves or a workflow state is
renamed, the person doing it greps the app and misses the copy that read the
number or the string in the middle of an expression.

A magic number should become a named constant, so the rule reads in words and
one edit changes it everywhere. A status string should become an enum value or a
config key, so the set of states is written down and a typo fails loudly instead
of comparing false forever. Either way the value gains one home.

Counted: ${summary}.

${groups.join("\n\n")}

---

Nothing here was lifted. Which threshold is a genuine business rule worth a name
and which is an incidental constant is the port owner's call; this names where
each one sits.
`;
}
