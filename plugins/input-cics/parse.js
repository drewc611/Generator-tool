import { splitCommas } from "../dsp-ir/text.js";

/**
 * IBM CICS BMS (Basic Mapping Support) map definitions: assembler macro
 * source, not markup, that has laid out 3270 "green screen" terminal
 * screens since the 1970s and still ships behind mainframe transactions
 * today. A `DFHMSD` macro opens a mapset and a second `DFHMSD TYPE=FINAL`
 * closes it; a `DFHMDI` macro inside it opens one map, one physical screen;
 * a `DFHMDF` macro on that map declares one field. None of the three is XML
 * or anything delimited, so this is a small hand written line scanner in the
 * shape of input-powerbuilder's `.srw` reader rather than a markup parse.
 *
 * Real BMS source is column bound (a label in columns 1-8, a trailing `X`
 * continuation marker in column 72), but this scanner tolerates free format
 * too: any line ending in a comma continues on the next, an `X` marker at
 * the end of a physically continued line is stripped, and whether a label
 * is present is read from whether the line's own first character is
 * whitespace, the same convention the source itself uses.
 */

/** A line with its trailing whitespace gone and, when the line is a continuation (it ends in a comma, an optional
 * trailing `X` marker allowed between the comma and the line's end), that marker stripped so the comma it follows is
 * left as the join point the next physical line's operands attach to. */
function continuationInfo(rawLine) {
  const trimmed = rawLine.replace(/\s+$/, "");
  if (/X$/.test(trimmed)) {
    const withoutMarker = trimmed.slice(0, -1).replace(/\s+$/, "");
    if (withoutMarker.endsWith(",")) return { content: withoutMarker, continues: true };
  }
  if (trimmed.endsWith(",")) return { content: trimmed, continues: true };
  return { content: trimmed, continues: false };
}

/** Every physical line joined into the logical macro lines they spell, a continuation's own leading indentation
 * dropped (it is column alignment, not content) while the first line of each logical line keeps its own leading
 * whitespace, since that is the one signal this format gives for whether a label was written. */
function joinContinuations(lines) {
  const logical = [];
  let buffer = null;
  for (const raw of lines) {
    if (/^\s*\*/.test(raw)) continue; // an assembler comment line, column 1 asterisk; never part of a macro
    if (buffer === null && !raw.trim()) continue;
    const { content, continues } = continuationInfo(raw);
    buffer = buffer === null ? content : buffer + content.replace(/^\s+/, "");
    if (continues) continue;
    logical.push(buffer);
    buffer = null;
  }
  if (buffer !== null && buffer.trim()) logical.push(buffer);
  return logical;
}

const MACRO = /^(DFHMSD|DFHMDI|DFHMDF)\b\s*([\s\S]*)$/i;

/** One logical macro line split into its optional label, its macro name, and its raw operand text; null when the
 * line names none of the three macros this reader reads (a stray line, or a BMS macro outside this vocabulary). */
function splitMacroLine(line) {
  const hasLabel = line.length > 0 && !/^\s/.test(line);
  const trimmed = line.trim();
  let rest = trimmed;
  let label = null;
  if (hasLabel) {
    const sp = trimmed.search(/\s/);
    if (sp === -1) return null; // a bare label with no macro at all
    label = trimmed.slice(0, sp);
    rest = trimmed.slice(sp).trim();
  }
  const m = MACRO.exec(rest);
  if (!m) return null;
  return { label, macro: m[1].toUpperCase(), operandText: (m[2] || "").trim() };
}

/** An operand list (`KEY=value,KEY=(a,b),...`) split at its own top level commas, so a parenthesized value's inner
 * commas (POS's row and column, ATTRB's own list) never get mistaken for a boundary between operands. */
function parseOperands(text) {
  const ops = {};
  if (!text) return ops;
  for (const piece of splitCommas(text, { ticks: false })) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue; // a bare keyword with no value; nothing this reader's own vocabulary needs
    const key = piece.slice(0, eq).trim().toUpperCase();
    ops[key] = piece.slice(eq + 1).trim();
  }
  return ops;
}

/** `(a,b)` read as two numbers, or null when the text is not one whole parenthesized pair: `POS=(row,col)` and
 * `SIZE=(rows,cols)` are the same shape, read once here for both. */
function parsePair(raw) {
  if (!raw) return null;
  const m = /^\(([^()]*)\)$/.exec(raw.trim());
  if (!m) return null;
  const parts = splitCommas(m[1], { ticks: false }).map(Number);
  return parts.length === 2 && parts.every(Number.isFinite) ? parts : null;
}

/** `ATTRB=(PROT,BRT)` or the single-value `ATTRB=PROT` shape, both read into the same uppercased list. */
function parseAttrb(raw) {
  if (!raw) return [];
  const s = raw.trim();
  const m = /^\(([\s\S]*)\)$/.exec(s);
  const text = m ? m[1] : s;
  return splitCommas(text, { ticks: false }).map((v) => v.trim().toUpperCase()).filter(Boolean);
}

/** A single quoted `INITIAL='...'` literal decoded, a doubled `''` standing for one literal quote the way every
 * assembler string literal spells one; null when the text is not one whole quoted literal (a symbolic value like
 * `&SOMEVAR`, or a value missing its quotes), which the caller names as a gap rather than assumes anything from. */
function parseLiteral(raw) {
  if (raw === undefined) return null;
  const m = /^'((?:[^']|'')*)'$/.exec(String(raw).trim());
  return m ? m[1].replace(/''/g, "'") : null;
}

/**
 * A whole `.bms` file read into its mapsets, each holding the maps its own
 * `DFHMDI` macros opened, each map holding the fields its own `DFHMDF`
 * macros declared in declaration order (a caller sorts by position; this
 * reader keeps the order the source wrote them in). `problems` names a
 * structural surprise this reader still recovers from: a `DFHMDI` or
 * `DFHMDF` found with no mapset or map open to hold it.
 */
export function parseCics(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const logical = joinContinuations(lines);

  const mapsets = [];
  const problems = [];
  let mapset = null;
  let map = null;

  for (const line of logical) {
    const parsed = splitMacroLine(line);
    if (!parsed) continue;
    const { label, macro, operandText } = parsed;
    const ops = parseOperands(operandText);

    if (macro === "DFHMSD") {
      if (/^FINAL$/i.test(ops.TYPE ?? "")) { mapset = null; map = null; continue; }
      mapset = { label: label || null, maps: [] };
      mapsets.push(mapset);
      map = null;
      continue;
    }

    if (macro === "DFHMDI") {
      if (!mapset) { problems.push("a DFHMDI map was found with no DFHMSD mapset open; it is skipped."); continue; }
      const size = parsePair(ops.SIZE);
      map = { label: label || null, size: size ? { rows: size[0], cols: size[1] } : null, fields: [] };
      mapset.maps.push(map);
      continue;
    }

    if (macro === "DFHMDF") {
      if (!map) { problems.push("a DFHMDF field was found with no DFHMDI map open; it is skipped."); continue; }
      const pos = parsePair(ops.POS);
      map.fields.push({
        label: label || null,
        pos: pos ? { row: pos[0], col: pos[1] } : null,
        length: ops.LENGTH !== undefined ? Number(ops.LENGTH) : null,
        attrb: parseAttrb(ops.ATTRB),
        initial: parseLiteral(ops.INITIAL),
        initialRaw: ops.INITIAL ?? null,
        grpname: ops.GRPNAME || null,
      });
    }
  }

  return { mapsets, problems };
}
