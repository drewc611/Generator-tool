import { readFile } from "node:fs/promises";

/**
 * The tables a legacy front end drew, and whether a screen reader can read them.
 *
 * A data table is a grid of relationships: this number belongs to that row and
 * that column. A sighted user sees the relationship in the layout; a screen
 * reader recovers it only from the markup, from a <caption> that names the
 * table, a <th> that marks a header cell, and a scope that says which cells a
 * header governs. Strip those and the table becomes a flat wall of numbers with
 * no way back to what each one means. The old web also built layout out of
 * tables, which a screen reader announces as data tables unless they say
 * role="presentation".
 *
 * This finds each <table>, records whether it has a caption, header cells and
 * scope, and names the gap: a data table with no caption, headers with no scope,
 * or a table with no headers and no presentational role (a layout table, or an
 * unlabelled data one). It reads structure only, never a cell's content. It
 * counts and changes nothing. Whether a table was layout or data, and what its
 * caption should say, is the port owner's call. A table nesting another is
 * measured on its own content up to the caption; deep nesting is noted, not
 * resolved.
 */

const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

const OPEN = /<table\b([^>]*)>/gi;

// The content of the table starting at `from` (just after its opening tag),
// balanced across nested tables, plus the index where it closes.
function sliceTable(text, from) {
  const tag = /<table\b|<\/table\s*>/gi;
  tag.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = tag.exec(text))) {
    if (m[0][1] === "/") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(from, m.index), end: tag.lastIndex };
    } else {
      depth += 1;
    }
  }
  return { inner: text.slice(from), end: text.length };
}

export function readTables(text, rel) {
  const findings = [];
  let m;
  OPEN.lastIndex = 0;
  while ((m = OPEN.exec(text))) {
    const attrs = m[1] ?? "";
    const start = OPEN.lastIndex;
    const { inner } = sliceTable(text, start);

    const presentational = /\brole\s*=\s*(['"])(presentation|none)\1/i.test(attrs);
    const beforeNested = inner.split(/<table\b/i)[0];
    const caption = /<caption\b/i.test(beforeNested);
    const th = /<th\b/i.test(inner);
    const scope = /<th\b[^>]*\bscope\s*=/i.test(inner);

    const issues = [];
    if (th && !caption) issues.push("no caption: the table has no accessible name");
    if (th && !scope) issues.push("headers carry no scope: a reader cannot tie a cell to its header");
    if (!th && !presentational) issues.push("no header cells and not role=presentation: a layout table or an unlabelled data one");

    findings.push({ caption, th, scope, presentational, issues, line: lineAt(text, m.index), file: rel });
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-tables",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|vue|svelte|jsx|tsx)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readTables(text, file.rel));
      }
      const dataTables = findings.filter((f) => f.th).length;
      const noCaption = findings.filter((f) => f.th && !f.caption).length;
      const noScope = findings.filter((f) => f.th && !f.scope).length;
      const withIssues = findings.filter((f) => f.issues.length).length;
      ctx.tables = { findings, dataTables, noCaption, noScope, withIssues };
      if (!findings.length) return log.debug("no tables");

      log.info(`${findings.length} table(s), ${dataTables} with headers, ${withIssues} with a named gap`);
      ctx.unverified(
        `TABLES.md names ${findings.length} table(s) the old front end drew; ${noCaption} data table(s) carry no caption and ` +
        `${noScope} have headers with no scope. A screen reader recovers a table's meaning only from its markup, so a stripped ` +
        "table is a flat wall of numbers. None was changed here."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.tables?.findings?.length) return;
      await ctx.write("TABLES.md", render(ctx.tables));
    });
  },
};

function render({ findings, dataTables, noCaption, noScope, withIssues }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) => {
        const state = [f.caption && "caption", f.th && "headers", f.scope && "scope", f.presentational && "presentational"].filter(Boolean).join(", ") || "no semantics";
        const tail = f.issues.length ? ` — ${f.issues.join("; ")}` : "";
        return `- line ${f.line}: \`<table>\` (${state})${tail}`;
      });
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  return `# The tables the old front end drew

A data table is a grid of relationships a sighted user reads from the layout and
a screen reader recovers only from the markup: a \`<caption>\` that names it, a
\`<th>\` that marks a header, and a \`scope\` that ties a cell to its header. Strip
those and the table is a flat wall of numbers. A table built for layout is
announced as data unless it says \`role="presentation"\`.

**${dataTables}** of ${findings.length} table(s) carry header cells;
**${noCaption}** of those have no caption; **${noScope}** have headers with no
scope; **${withIssues}** table(s) have at least one gap named below. Only
structure is read; no cell content is recorded.

${groups.join("\n\n")}

---

Nothing was changed. Whether a table was layout or data, and what its caption
should say, is the port owner's call.
`;
}
