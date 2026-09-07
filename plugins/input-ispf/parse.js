/**
 * IBM ISPF Dialog Manager panel definitions, the format that has laid out
 * every full screen TSO/ISPF dialog on IBM mainframes since the 1980s. A
 * panel is plain text divided into sections, each introduced by a `)KEYWORD`
 * on its own line in column 1: `)ATTR`, `)BODY`, `)INIT`, `)PROC`, `)END`,
 * always in that relative order when present. There is no XML or JSON shape
 * here, so, like input-cics's BMS and input-informix's `.per`, this is a
 * small hand-written scanner rather than a wrapper over the shared markup
 * reader.
 *
 * `)BODY` is the one section this reader actually renders: a literal
 * ASCII-art rectangle where position comes from where each run of text sits
 * in the row, the same "position is the text itself" approach input-informix
 * already established, not a coordinate attribute the way BMS's `POS=(row,
 * col)` is. `)ATTR` says what a single character in that text means; `)INIT`
 * and `)PROC` hold real Dialog Manager statements (variable defaults, `VER`
 * validation, `.ZVARS`, `&` references) this reader never executes or reads
 * for meaning, only names as present.
 */

const HEADER_RE = /^\)(ATTR|BODY|INIT|PROC|END)\b/;

const KNOWN_TYPES = new Set(["TEXT", "INPUT", "OUTPUT"]);

// ISPF's own three real built-in attribute characters, usable in a panel's )BODY whether or not )ATTR ever mentions
// them: % and + are both protected captions (high and low intensity), and a lone _ is an enterable field. These are
// the only defaults this reader hard-codes; anything else with no )ATTR entry is never guessed at.
const BUILTIN_DEFAULTS = new Map([
  ["%", "TEXT"],
  ["+", "TEXT"],
  ["_", "INPUT"],
]);

/** The file split into its `)ATTR`/`)BODY`/`)INIT`/`)PROC`/`)END` sections, each as `{ keyword, lines }` in file
 * order; the header line itself (which may carry its own keywords, `)ATTR DEFAULT(%+_)`, `)BODY EXPAND(!!)`) is
 * consumed and never appears in `lines`. */
export function splitSections(source) {
  const lines = String(source ?? "").split(/\r\n|\r|\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      current = { keyword: m[1], lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections;
}

/**
 * Sections grouped into panels, one per `)BODY` encountered. A file
 * conventionally holds exactly one `)BODY`; when it holds more, each becomes
 * its own panel, carrying only the `)ATTR` that preceded it and the
 * `)INIT`/`)PROC` that followed before the next `)BODY`, the same "each
 * structural unit is its own screen" precedent input-storyboard's scenes and
 * input-cics's `DFHMDI` maps already keep — not assumed to be the common
 * case, just handled honestly when it happens.
 */
export function groupPanels(sections) {
  const panels = [];
  let pendingAttrLines = null;
  let current = null;
  for (const s of sections) {
    if (s.keyword === "ATTR") { pendingAttrLines = s.lines; continue; }
    if (s.keyword === "BODY") {
      current = { attrLines: pendingAttrLines, bodyLines: s.lines, initLines: null, procLines: null, endSeen: false };
      pendingAttrLines = null;
      panels.push(current);
      continue;
    }
    if (s.keyword === "INIT" && current) { current.initLines = s.lines; continue; }
    if (s.keyword === "PROC" && current) { current.procLines = s.lines; continue; }
    if (s.keyword === "END" && current) { current.endSeen = true; continue; }
  }
  return panels;
}

/**
 * `)ATTR`'s own per-character lines resolved to a Map from character to its
 * kind: `TYPE(TEXT)`, `TYPE(INPUT)` or `TYPE(OUTPUT)`. Every other keyword a
 * line may carry (INTENS, CAP, JUST, COLOR, HILITE, PAD and the rest) is
 * real ISPF formatting and behavior this reader intentionally never reads;
 * that restraint is stated once, here, rather than as a note per occurrence.
 * A line with no `TYPE(...)` at all, or one naming a type this reader does
 * not know, gets `null` and a note: a character portamp cannot place is a
 * gap to report, never a guess to make.
 */
export function parseAttrSection(lines) {
  const map = new Map();
  const notes = [];
  for (const raw of lines ?? []) {
    const trimmed = raw.replace(/^\s+/, "");
    if (!trimmed) continue;
    const ch = trimmed[0];
    const typeMatch = /TYPE\(\s*([A-Za-z]+)\s*\)/i.exec(trimmed.slice(1));
    if (!typeMatch) {
      notes.push(`the attribute character \`${ch}\` names no type at all; this reader does not know what kind of field it is, so nothing is rendered for it.`);
      map.set(ch, null);
      continue;
    }
    const type = typeMatch[1].toUpperCase();
    if (!KNOWN_TYPES.has(type)) {
      notes.push(`the attribute character \`${ch}\` names a kind (${typeMatch[1]}) this reader does not translate; nothing is rendered for it.`);
      map.set(ch, null);
      continue;
    }
    map.set(ch, type);
  }
  return { map, notes };
}

/** The map actually used to read `)BODY`: what `)ATTR` declared, with ISPF's own three real built-in defaults
 * filling in any of %, +, _ this panel's own `)ATTR` left unmentioned (or the whole section left out entirely). A
 * panel's own declaration always wins; the defaults only ever fill a gap it left. */
export function effectiveAttrMap(declared) {
  const map = new Map(declared);
  for (const [ch, type] of BUILTIN_DEFAULTS) if (!map.has(ch)) map.set(ch, type);
  return map;
}

/**
 * One `)BODY` row split into its attribute-delimited runs, in reading order.
 * A key of `attrMap` switches the current run; everything up to the next
 * one, or end of line, is that run's own content. A character not in
 * `attrMap` is never an attribute switch at all, only ordinary text, so a
 * separator row of dashes or an EXPAND fill character with no `)ATTR` entry
 * of its own reads as plain content with nothing special-cased. Text before
 * a row's first attribute character (rare) comes back as its own run with
 * `char: null`, since an attribute character never declared is never
 * invented for it.
 */
export function tokenizeRow(row, attrMap) {
  const runs = [];
  let ch = null;
  let start = 0;
  for (let i = 0; i < row.length; i += 1) {
    if (attrMap.has(row[i])) {
      runs.push({ char: ch, type: ch === null ? null : attrMap.get(ch), content: row.slice(start, i) });
      ch = row[i];
      start = i + 1;
    }
  }
  runs.push({ char: ch, type: ch === null ? null : attrMap.get(ch), content: row.slice(start) });
  return runs.filter((r) => r.char !== null || r.content.trim() !== "");
}

/**
 * The whole file, parsed into one or more panels. Each panel carries its
 * own effective attribute map (declared entries merged over the three real
 * built-in defaults), the notes `)ATTR` itself raised, its raw `)BODY` rows
 * still untranslated, and whether it carries an `)INIT` and/or `)PROC`
 * section with dialog logic this reader does not read.
 */
export function parseIspf(source) {
  const sections = splitSections(source);
  return groupPanels(sections).map((p) => {
    const { map: declared, notes: attrNotes } = parseAttrSection(p.attrLines ?? []);
    return {
      attrMap: effectiveAttrMap(declared),
      attrNotes,
      hadAttrSection: p.attrLines !== null,
      bodyLines: p.bodyLines,
      initPresent: (p.initLines ?? []).some((l) => l.trim() !== ""),
      procPresent: (p.procLines ?? []).some((l) => l.trim() !== ""),
    };
  });
}
