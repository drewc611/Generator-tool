/**
 * dBase/Clipper/FoxPro (the "xBase" family): ordinary procedural source, not
 * markup or assembler operands, with `@ row, col SAY ... GET ...` full-screen
 * statements interspersed anywhere in it, one call at a time, from the 1980s
 * through the 1990s. There is no separate declarative designer file at all,
 * so this is a small hand written line/statement scanner in the shape of
 * input-cics's `.bms` reader and input-cobolscreen's `SCREEN SECTION` reader
 * rather than a markup parse.
 *
 * xBase allows a trailing `;` at end of line to continue a statement onto the
 * next physical line, so the whole file's physical lines are joined into
 * logical lines first, the same "join before parsing" step input-cics takes
 * over its own trailing-comma continuation. Unlike BMS's `DFHMSD`/`DFHMDI`
 * region macros, an `@ SAY/GET` statement here opens no block of its own: it
 * is just one call among ordinary control flow, so the whole file is scanned
 * top to bottom for `@` and bare `READ` lines rather than for any wrapping
 * marker. `READ` is the one real, load-bearing boundary this format gives: it
 * is the actual signal that every `@ SAY/GET` statement since the start of
 * the file or the previous `READ` belongs to one full-screen unit, the same
 * role a storyboard's `<scene>` or a BMS `DFHMDI` plays elsewhere in this
 * tool. xBase gives a screen no name of its own, so screens are numbered
 * `Screen1`, `Screen2`, ... in the order their closing `READ` (or end of
 * file, for a screen with no `READ` at all) is reached.
 */

const KEYWORDS = ["SAY", "GET", "PICTURE", "VALID", "WHEN", "RANGE", "DEFAULT"];

/** A physical line with a full line comment (its first non blank character an asterisk, xBase's own traditional
 * comment convention) reduced to nothing, so it neither starts nor continues a logical line. */
function stripFullLineComment(line) {
  return /^\s*\*/.test(line) ? "" : line;
}

/** Every physical line joined into the logical statement lines a trailing `;` spells: a line ending in `;` (once its
 * own trailing whitespace is gone) continues on the next, the semicolon itself dropped as the join point. */
function joinContinuations(lines) {
  const logical = [];
  let buffer = null;
  for (const raw of lines) {
    const line = stripFullLineComment(raw);
    if (buffer === null && !line.trim()) continue;
    const trimmedEnd = line.replace(/\s+$/, "");
    const continues = trimmedEnd.endsWith(";");
    const content = continues ? trimmedEnd.slice(0, -1) : trimmedEnd;
    buffer = buffer === null ? content : `${buffer} ${content.trim()}`;
    if (continues) continue;
    logical.push(buffer);
    buffer = null;
  }
  if (buffer !== null && buffer.trim()) logical.push(buffer);
  return logical;
}

/** `"..."`, `'...'` or xBase/Clipper's own `[...]` bracket string, read as a plain literal; null when the text is not
 * one whole literal in any of the three spellings (a variable, a function call, an expression), which the caller
 * names as a gap rather than assumes anything from. */
function parseLiteral(raw) {
  const s = String(raw ?? "").trim();
  let m = /^"([^"]*)"$/.exec(s);
  if (m) return m[1];
  m = /^'([^']*)'$/.exec(s);
  if (m) return m[1];
  m = /^\[([^\]]*)\]$/.exec(s);
  if (m) return m[1];
  return null;
}

/** A bare xBase identifier (alphanumeric plus underscore, no hyphens the way a COBOL data-name needs unpicking), or
 * null when the text is anything else: an expression, a dotted alias, a function call. */
function parseIdentifier(raw) {
  const s = String(raw ?? "").trim();
  return /^[A-Za-z_]\w*$/.test(s) ? s : null;
}

/** The clause text after `@ row, col` split at each of this reader's own keywords, wherever one starts a bare word
 * outside a quoted string: a `SAY "GET Started"` literal's own inner text is never mistaken for a real `GET` clause,
 * the same masking a quoted literal gets throughout this tool. A keyword met a second time (this reader only ever
 * expects one `SAY` and one `GET` per statement) keeps its first occurrence in the returned map; the text after a
 * repeat is still consumed as that keyword's own argument span so it cannot bleed into whatever clause follows it. */
function splitClauses(text) {
  const hits = [];
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "[") { quote = c === "[" ? "]" : c; continue; }
    if (!/[A-Za-z]/.test(c) || (i > 0 && /[A-Za-z0-9_]/.test(text[i - 1]))) continue;
    for (const kw of KEYWORDS) {
      const end = i + kw.length;
      if (text.slice(i, end).toUpperCase() === kw && !/[A-Za-z0-9_]/.test(text[end] || "")) {
        hits.push({ kw, start: i, argStart: end });
        break;
      }
    }
  }
  const byKw = {};
  for (let j = 0; j < hits.length; j += 1) {
    const stop = j + 1 < hits.length ? hits[j + 1].start : text.length;
    const arg = text.slice(hits[j].argStart, stop).trim();
    if (!(hits[j].kw in byKw)) byKw[hits[j].kw] = arg;
  }
  return byKw;
}

/** One `@` statement's `row, col` pair, or null when the text before the first keyword is not one clean two-item
 * comma split (an expression this reader does not resolve, or a statement missing the pair outright). */
function parsePosition(text) {
  const parts = text.split(",");
  if (parts.length !== 2) return null;
  const row = Number(parts[0].trim());
  const col = Number(parts[1].trim());
  return { row: Number.isFinite(row) ? row : null, col: Number.isFinite(col) ? col : null, clean: parts.every((p) => /^\s*\d+\s*$/.test(p)) };
}

/** One logical `@ row, col ...` line parsed into its position and whichever of `SAY`, `GET`, `PICTURE`, `VALID`,
 * `WHEN`, `RANGE` and `DEFAULT` it carries; null when the line does not open with `@` at all, or carries neither a
 * `SAY` nor a `GET` (an unrelated `@ row, col ... TO ...` box or `CLEAR` statement, out of this reader's vocabulary,
 * since it declares no caption and no field). */
function parseAtStatement(line, problems) {
  const m = /^@\s*([\s\S]*)$/.exec(line.trim());
  if (!m) return null;
  const rest = m[1];
  const kwIndex = (() => {
    let quote = null;
    for (let i = 0; i < rest.length; i += 1) {
      const c = rest[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (/^(SAY|GET)\b/i.test(rest.slice(i)) && (i === 0 || !/[A-Za-z0-9_]/.test(rest[i - 1]))) return i;
    }
    return -1;
  })();
  if (kwIndex === -1) return null; // no SAY and no GET: a box-drawing or CLEAR @ statement, not a screen element

  const posText = rest.slice(0, kwIndex);
  const pos = parsePosition(posText);
  if (!pos) {
    problems.push(`an @ statement was found with no clear row, col pair (\`${posText.trim().slice(0, 40)}\`); it is skipped.`);
    return null;
  }

  const byKw = splitClauses(rest.slice(kwIndex));

  const sayRaw = byKw.SAY ?? null;
  const getRaw = byKw.GET ?? null;

  return {
    row: pos.row,
    col: pos.col,
    positionClean: pos.clean,
    say: sayRaw !== null ? parseLiteral(sayRaw) : null,
    sayRaw,
    get: getRaw !== null ? parseIdentifier(getRaw) : null,
    getRaw,
    picture: "PICTURE" in byKw,
    valid: "VALID" in byKw,
    when: "WHEN" in byKw,
    range: "RANGE" in byKw,
    hasDefault: "DEFAULT" in byKw,
  };
}

/**
 * A whole `.prg` file read into the screens its own `@ row, col SAY/GET`
 * statements declare, one screen per `READ` (case insensitive, on its own
 * logical line) plus a final trailing screen for any statements left over at
 * end of file with no closing `READ` at all, a display only screen being the
 * ordinary case for that. Every other line, comments, `PRIVATE`, `IF`/`ENDIF`,
 * assignments, ordinary function calls, is not matched by either pattern and
 * is silently passed over: this reader reads `@` and `READ` and nothing else.
 * `problems` names an `@` statement this reader could not place at all.
 */
export function parseXbase(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const logical = joinContinuations(lines);

  const screens = [];
  const problems = [];
  let current = [];

  for (const line of logical) {
    if (/^READ$/i.test(line.trim())) {
      if (current.length) screens.push(current);
      current = [];
      continue;
    }
    if (!line.trim().startsWith("@")) continue; // ordinary source: not this reader's vocabulary
    const stmt = parseAtStatement(line, problems);
    if (stmt) current.push(stmt);
  }
  if (current.length) screens.push(current);

  return { screens, problems };
}
