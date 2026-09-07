/**
 * A standard ANSI/ISO COBOL program's `SCREEN SECTION`: character-cell
 * terminal screens declared directly in the DATA DIVISION with COBOL's
 * ordinary level-number group syntax, part of the language since COBOL-85
 * and still written today in mainframe and Micro Focus/GnuCOBOL shops. Not
 * XML, not assembler operands, so this is a small hand written scanner in
 * the shape of input-cics's `.bms` reader rather than a markup parse.
 *
 * Only the `SCREEN SECTION.` portion is read at all: it is located by its
 * own header line and read up to the next top-level `DIVISION.`/`SECTION.`
 * header or end of file, so a program's WORKING-STORAGE and PROCEDURE
 * DIVISION never reach this reader. COBOL's reserved words are
 * case-insensitive, so the header is matched in any case.
 *
 * Inside the section, a clause list can span several physical lines before
 * its terminating period (COBOL allows clauses in almost any order, space or
 * newline separated), so the section's lines are joined into one string and
 * split back into entries at each period that falls outside a quoted
 * literal, the same "quotes shield the character that would otherwise end
 * the statement" rule input-cics's own literal decoder already keeps.
 */

const SCREEN_SECTION_HEADER = /^SCREEN\s+SECTION\s*\.$/i;
const DIVISION_OR_SECTION_HEADER = /^[A-Za-z0-9-]+\s+(DIVISION|SECTION)\s*\.$/i;

// Keywords that open a clause: met immediately after a level number, they mean the entry carries no data-name of its
// own (a caption entry, most often), the same distinction a COBOL compiler itself has to make.
const CLAUSE_KEYWORDS = new Set([
  "LINE", "COLUMN", "COL", "VALUE", "PIC", "PICTURE", "BLANK", "REQUIRED",
  "HIGHLIGHT", "REVERSE-VIDEO", "BLINK", "FOREGROUND-COLOR", "BACKGROUND-COLOR",
  "UNDERLINE", "BELL", "AUTO", "USING", "FROM", "TO", "PLUS", "MINUS", "SCREEN",
]);

/** The `SCREEN SECTION.` body's own lines, a full-line comment (its first non-blank character an asterisk, the
 * loosest reading of COBOL's column-7 comment convention this free-format tolerant scanner keeps) dropped before
 * anything else touches them. Returns null when no `SCREEN SECTION.` header is found at all, which is normal: most
 * COBOL files have none. */
function extractSection(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (SCREEN_SECTION_HEADER.test(lines[i].trim())) { start = i; break; }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t || t.startsWith("*")) continue;
    if (DIVISION_OR_SECTION_HEADER.test(t)) { end = i; break; }
  }

  return lines.slice(start + 1, end).filter((l) => !l.trim().startsWith("*"));
}

/** The joined body text split into raw entry statements, one per level-number entry, at each period that sits
 * outside a single or double quoted literal. A doubled quote (`""`, `''`) stays inside the literal it doubles, the
 * same rule every quoted literal in this tool already keeps. */
function splitStatements(text) {
  const out = [];
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        if (text[i + 1] === quote) { i += 1; continue; } // a doubled quote: still inside the literal
        quote = null;
      }
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ".") {
      const piece = text.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** One statement split into its level number, its optional data-name (absent when the next token is one of this
 * reader's own clause keywords, a caption entry with nothing to bind), and the raw clause text that follows. Returns
 * null when the statement does not open with a two digit level number at all. */
function splitEntry(stmt) {
  const m = /^(\d{2})\s+([\s\S]*)$/.exec(stmt);
  if (!m) return null;
  const level = m[1];
  let rest = m[2].trim();
  let name = null;
  const word = /^([A-Za-z0-9][A-Za-z0-9-]*)/.exec(rest);
  if (word && !CLAUSE_KEYWORDS.has(word[1].toUpperCase())) {
    name = word[1];
    rest = rest.slice(word[0].length).trim();
  }
  return { level, name, clauseText: rest };
}

/** `LINE n` / `COLUMN n` (`COL` a valid abbreviation), each with the `PLUS`/`MINUS` relative form recognised but not
 * resolved to an actual position: this reader states that fact rather than computing it. */
function parsePosition(text, keyword) {
  const re = new RegExp(`\\b${keyword}\\s+(PLUS|MINUS)?\\s*(\\d+)`, "i");
  const m = re.exec(text);
  return m ? { value: Number(m[2]), relative: !!m[1] } : null;
}

/** `VALUE "..."` or `VALUE '...'`, a doubled embedded quote decoded to one literal quote character. `raw: true` with
 * `literal: null` means a `VALUE` clause exists but is not a plain quoted literal (a figurative constant, a data-name,
 * a numeric value); the caller names that rather than assuming a value from it. */
function parseValue(text) {
  const dq = /\bVALUE\s+"((?:[^"]|"")*)"/i.exec(text);
  if (dq) return { raw: true, literal: dq[1].replace(/""/g, '"') };
  const sq = /\bVALUE\s+'((?:[^']|'')*)'/i.exec(text);
  if (sq) return { raw: true, literal: sq[1].replace(/''/g, "'") };
  if (/\bVALUE\b/i.test(text)) return { raw: true, literal: null };
  return { raw: false, literal: null };
}

/** `PIC`/`PICTURE` (an optional `IS` tolerated) together with whichever of `USING`, `FROM` or `TO` names the data
 * item it binds; `mode` is null when the clause carries none of the three, a case this reader names rather than
 * guessing at. */
function parsePicture(text) {
  const picM = /\b(?:PIC|PICTURE)(?:\s+IS)?\s+(\S+)/i.exec(text);
  if (!picM) return null;
  const usingM = /\bUSING\s+([A-Za-z0-9-]+)/i.exec(text);
  const fromM = /\bFROM\s+([A-Za-z0-9-]+)/i.exec(text);
  const toM = /\bTO\s+([A-Za-z0-9-]+)/i.exec(text);
  const pic = picM[1];
  if (usingM) return { pic, mode: "USING", target: usingM[1] };
  if (fromM) return { pic, mode: "FROM", target: fromM[1] };
  if (toM) return { pic, mode: "TO", target: toM[1] };
  return { pic, mode: null, target: null };
}

/**
 * One level-number entry, its clauses read regardless of the order they
 * were written in. `HIGHLIGHT`, `REVERSE-VIDEO`, `BLINK`, `FOREGROUND-COLOR`,
 * `BACKGROUND-COLOR`, `UNDERLINE` and `BELL` are read only far enough to
 * settle whether one is present at all (`hasFormatting`); none is
 * translated, and none is named per occurrence, the same restraint
 * input-cics keeps over an ATTRB value beyond PROT/UNPROT/NUM. `AUTO`
 * carries no rendering meaning this reader reproduces and is not read at
 * all, the same silence BMS's own `IC` is given.
 */
function parseClauses(text) {
  const value = parseValue(text);
  const picture = parsePicture(text);
  return {
    blankScreen: /\bBLANK\s+SCREEN\b/i.test(text),
    line: parsePosition(text, "LINE"),
    column: parsePosition(text, "COLUMN|COL"),
    valueRaw: value.raw,
    valueLiteral: value.literal,
    pic: picture ? picture.pic : null,
    picMode: picture ? picture.mode : null,
    picTarget: picture ? picture.target : null,
    required: /\bREQUIRED\b/i.test(text),
    hasFormatting: /\b(HIGHLIGHT|REVERSE-VIDEO|BLINK|FOREGROUND-COLOR|BACKGROUND-COLOR|UNDERLINE|BELL)\b/i.test(text),
  };
}

/**
 * A whole COBOL source file read into the screens its own `SCREEN SECTION`
 * declares, one screen per `01`-level entry, each screen's `entries` holding
 * every clause-bearing entry beneath it (the `01` entry itself included, so
 * a rare caption or PIC clause written straight on the group level still
 * renders) in the declaration order the source wrote them in. `found` is
 * false when the file carries no `SCREEN SECTION.` at all, which is not a
 * gap: most COBOL files have none. `problems` names an entry met before any
 * `01` level opened a screen for it to join.
 */
export function parseCobolScreen(source) {
  const body = extractSection(source);
  if (body === null) return { found: false, screens: [], problems: [] };

  const statements = splitStatements(body.join(" "));
  const screens = [];
  const problems = [];
  let current = null;

  for (const stmt of statements) {
    const split = splitEntry(stmt);
    if (!split) { problems.push(`an entry with no leading level number was found and skipped: \`${stmt.slice(0, 40)}\``); continue; }
    const entry = { level: split.level, name: split.name, ...parseClauses(split.clauseText) };
    if (split.level === "01") {
      current = { name: split.name, entries: [entry] };
      screens.push(current);
      continue;
    }
    if (!current) { problems.push(`a level ${split.level} entry was found with no 01 level screen open to hold it; it is skipped.`); continue; }
    current.entries.push(entry);
  }

  return { found: true, screens, problems };
}
