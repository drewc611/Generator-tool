import { splitCommas } from "../dsp-ir/text.js";

/**
 * Informix 4GL/ESQL's `.per` screen form files, read structurally. There is
 * no XML or JSON shape here to hand to a shared markup reader: a `.per` file
 * is five possible sections, each introduced by an uppercase keyword on its
 * own line (DATABASE, SCREEN, TABLES, ATTRIBUTES, INSTRUCTIONS, not every one
 * always present), and the SCREEN section is a literal ASCII-art rectangle
 * between a `{` and a `}` on their own lines. Row and column position inside
 * that rectangle is the layout; there is no container tree to build, only a
 * grid of characters to read left to right, top to bottom, the way the
 * terminal itself painted it. That is a genuinely different structural
 * approach from every other reader in this tool, so this file is a small
 * hand-written scanner rather than a wrapper over the shared one.
 *
 * DATABASE, TABLES and INSTRUCTIONS are recognised as present and otherwise
 * left alone: their content is never read for meaning, only named as seen.
 * Everything this reader actually interprets lives in SCREEN and ATTRIBUTES.
 */

const HEADER_RE = /^(DATABASE|SCREEN|TABLES|ATTRIBUTES|INSTRUCTIONS)\b(.*)$/;
const KNOWN_MODIFIERS = new Set(["REQUIRED", "NOENTRY", "REVERSE", "BOLD", "HIGH"]);

/**
 * The file split into its top level sections, each `{ keyword, header, lines }`
 * in file order. Once a SCREEN section's own `{` line is seen, every line up
 * to and including its closing `}` line is taken as that section's content
 * without being tested against the header pattern: the screen block is raw
 * character art, and a row that happens to start with a word like TABLES
 * must never be mistaken for the next section starting.
 */
export function splitSections(source) {
  const lines = String(source ?? "").split(/\r\n|\r|\n/);
  const sections = [];
  let current = null;
  let inScreenBody = false;
  for (const line of lines) {
    if (current?.keyword === "SCREEN" && inScreenBody) {
      current.lines.push(line);
      if (line.trim() === "}") inScreenBody = false;
      continue;
    }
    const m = HEADER_RE.exec(line);
    if (m) {
      current = { keyword: m[1], header: line, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line);
      if (current.keyword === "SCREEN" && line.trim() === "{") inScreenBody = true;
    }
  }
  return sections;
}

/**
 * The SCREEN section's own `{ ... }` block, as raw rows with the delimiter
 * lines themselves removed. `present` says whether a SCREEN section exists at
 * all; `unreadable` says it exists but this reader could not find a matching
 * `{`/`}` pair in it, which is named rather than guessed at, never thrown.
 * A `.per` file never nests braces inside the screen block in practice, so a
 * single open/close line pair is all this reader looks for.
 */
export function findScreenBlock(sections) {
  const section = sections.find((s) => s.keyword === "SCREEN");
  if (!section) return { present: false, rows: null, unreadable: false };
  const openIdx = section.lines.findIndex((l) => l.trim() === "{");
  if (openIdx === -1) return { present: true, rows: null, unreadable: true };
  const closeIdx = section.lines.findIndex((l, i) => i > openIdx && l.trim() === "}");
  if (closeIdx === -1) return { present: true, rows: null, unreadable: true };
  return { present: true, rows: section.lines.slice(openIdx + 1, closeIdx), unreadable: false };
}

/**
 * One screen row's own literal text runs and `[...]` field placeholders, in
 * left to right order. A placeholder's tag is everything between the
 * brackets, trimmed of the trailing spaces that only pad it to its declared
 * on-screen width; an empty pair (no tag at all) is named by the caller
 * rather than rendered as a field with nothing to bind. Brackets never nest
 * inside a row, so a plain indexOf pair is enough and the shared
 * matchBracket (built for nested, quote-aware code) is not reached for here.
 */
export function tokenizeRow(row) {
  const tokens = [];
  let i = 0;
  while (i < row.length) {
    if (row[i] === "[") {
      const close = row.indexOf("]", i + 1);
      if (close === -1) {
        const text = row.slice(i).trim();
        if (text) tokens.push({ kind: "text", value: text });
        break;
      }
      const tag = row.slice(i + 1, close).trim();
      tokens.push({ kind: "field", tag });
      i = close + 1;
    } else {
      const next = row.indexOf("[", i);
      const end = next === -1 ? row.length : next;
      const text = row.slice(i, end).trim();
      if (text) tokens.push({ kind: "text", value: text });
      i = end;
    }
  }
  return tokens;
}

/**
 * The ATTRIBUTES section's own statements, `tag = table.column, MOD, MOD,
 * COMMENTS = "...";`, each terminated by its own semicolon. Returned as a Map
 * keyed by field tag; a statement this reader cannot make sense of (no `=`,
 * no table/column named) is named through `note` and left out of the map
 * rather than guessed at. `splitCommas` (dsp-ir/text.js) already splits an
 * argument list at its top level commas with quotes respected, exactly what
 * a COMMENTS string carrying its own comma needs, so it is reused rather
 * than reimplemented here.
 */
export function parseAttributes(lines, note = () => {}) {
  const text = (lines ?? []).join("\n");
  const statements = text.split(";").map((s) => s.trim()).filter(Boolean);
  const attrs = new Map();
  for (const stmt of statements) {
    const eq = stmt.indexOf("=");
    if (eq === -1) { note(`a field declaration has no \`=\`: \`${stmt}\`; ignored.`); continue; }
    const tag = stmt.slice(0, eq).trim();
    const rest = stmt.slice(eq + 1).trim();
    const parts = splitCommas(rest);
    if (!parts.length || !parts[0]) { note(`the field declaration for \`${tag}\` names no table or column; ignored.`); continue; }
    const columnRef = parts[0].trim();
    const dot = columnRef.indexOf(".");
    const table = dot === -1 ? null : columnRef.slice(0, dot);
    const column = dot === -1 ? columnRef : columnRef.slice(dot + 1);

    const modifiers = new Set();
    let comments = null;
    for (const part of parts.slice(1)) {
      const trimmed = part.trim();
      const cm = /^COMMENTS\s*=\s*"([^"]*)"/i.exec(trimmed);
      if (cm) { comments = cm[1]; continue; }
      const mod = trimmed.toUpperCase();
      if (!mod) continue;
      if (KNOWN_MODIFIERS.has(mod)) modifiers.add(mod);
      else note(`the modifier \`${trimmed}\` on \`${tag}\` is not one this reader recognises; ignored.`);
    }
    attrs.set(tag, { tag, table, column, modifiers, comments, raw: columnRef });
  }
  return attrs;
}

/** The whole file, parsed into its sections and its SCREEN block, with nothing yet interpreted. */
export function parseInformix(source) {
  const sections = splitSections(source);
  return {
    present: new Set(sections.map((s) => s.keyword)),
    screen: findScreenBlock(sections),
    attributesLines: sections.find((s) => s.keyword === "ATTRIBUTES")?.lines ?? null,
  };
}
