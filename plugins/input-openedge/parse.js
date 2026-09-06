/**
 * Progress OpenEdge ABL (4GL): a business application language still running
 * ERP, banking and logistics back offices today, whose screens are declared
 * directly in ordinary procedure source with no separate designer file at
 * all, the same "the screen is just more of the language" shape input-xbase's
 * `@ row, col SAY/GET` and input-cobolscreen's `SCREEN SECTION` already read.
 * So this is a small hand written statement scanner, not a markup parse.
 *
 * Every statement in this vocabulary ends with a period that closes it, the
 * same real terminator input-cobolscreen's own SCREEN SECTION entries use,
 * and a statement can span many physical lines before that period arrives.
 * The whole file is split into raw, period-terminated statements first (a
 * quoted string's own literal period never closes one, the same masking
 * every quoted literal in this tool already gets), and the three passes read
 * that flat list rather than the file's own lines.
 *
 * ABL's own keywords (`DEFINE`, `AS`, `LABEL`, `FORM`, `WITH FRAME`,
 * `ON CHOOSE OF`, `DO`, `END`) are matched case-insensitively throughout,
 * the same case-insensitivity input-cobolscreen and input-xbase already
 * keep for their own legacy keywords; a variable, button or frame name
 * keeps whatever case the source actually wrote.
 */

const IDENT = "[A-Za-z][A-Za-z0-9_-]*";

/** The file's statements, each the text between one period and the next, outside a single or double quoted literal
 * (a doubled quote stays inside the literal it doubles), the same rule input-cobolscreen's own splitStatements
 * keeps. Whitespace, newlines included, is left exactly as written; callers collapse it themselves where a single
 * line regex is easier to write against. */
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

/** A statement's own whitespace (newlines included) collapsed to single spaces, so a clause that spans several
 * physical lines still matches a plain single line regex. Case and every other character are left untouched. */
const flatten = (stmt) => stmt.replace(/\s+/g, " ").trim();

/** `KEYWORD "..."` or `KEYWORD '...'`, either quote style, a doubled embedded quote decoded to one literal quote
 * character; null when the keyword is not present at all. Mirrors input-cobolscreen's own parseValue, keyed to
 * whichever keyword (FORMAT, LABEL) the caller is after. */
function extractQuoted(text, keyword) {
  const dq = new RegExp(`\\b${keyword}\\s+"((?:[^"]|"")*)"`, "i").exec(text);
  if (dq) return dq[1].replace(/""/g, '"');
  const sq = new RegExp(`\\b${keyword}\\s+'((?:[^']|'')*)'`, "i").exec(text);
  if (sq) return sq[1].replace(/''/g, "'");
  return null;
}

/** `DEFINE VARIABLE name AS type ...`, or null when the statement is not one. FORMAT and LABEL are read wherever
 * they fall in the clause tail, in whatever order the source wrote them. */
function parseDefineVariable(flat) {
  const m = new RegExp(`^DEFINE\\s+VARIABLE\\s+(${IDENT})\\s+AS\\s+(${IDENT})\\b([\\s\\S]*)$`, "i").exec(flat);
  if (!m) return null;
  return {
    name: m[1],
    kind: "variable",
    type: m[2],
    format: extractQuoted(m[3], "FORMAT"),
    label: extractQuoted(m[3], "LABEL"),
  };
}

/** `DEFINE BUTTON name ...`, or null when the statement is not one. */
function parseDefineButton(flat) {
  const m = new RegExp(`^DEFINE\\s+BUTTON\\s+(${IDENT})\\b([\\s\\S]*)$`, "i").exec(flat);
  if (!m) return null;
  return { name: m[1], kind: "button", label: extractQuoted(m[2], "LABEL") };
}

/** `FORM name name ... WITH FRAME framename`, or null when the statement carries no FORM at all. A FORM statement
 * with no WITH FRAME clause is named through `problems` rather than guessed at, since a frame is this format's one
 * real screen boundary and there is nothing to hang a screen from without it. */
function parseForm(flat, problems) {
  if (!/^FORM\b/i.test(flat)) return null;
  const m = new RegExp(`^FORM\\b([\\s\\S]*?)\\bWITH\\s+FRAME\\s+(${IDENT})`, "i").exec(flat);
  if (!m) { problems.push(`a FORM block was found with no frame named for it (\`${flat.slice(0, 40)}\`); it is skipped.`); return null; }
  const names = m[1].trim().length ? m[1].trim().split(/\s+/) : [];
  return { frame: m[2], names };
}

/**
 * One `ON CHOOSE OF buttonname [IN FRAME framename] DO: ... END` block,
 * classified as it is read rather than after the fact: a body of exactly one
 * clean `RUN procedurename.` statement resolves to that procedure; anything
 * else (no statements, more than one, or one that is not a bare RUN) is
 * "complex", the same restraint input-autoit already keeps over a Case/If
 * block carrying more than one statement.
 *
 * `statements` is the whole file's flat statement list and `i` the index of
 * the statement that opened the block; returns the parsed block together
 * with the index of the last statement it consumed (the block's own `END`),
 * so the caller can resume scanning right after it.
 */
function parseOnChoose(statements, i, problems) {
  const flat = flatten(statements[i]);
  const m = new RegExp(`^ON\\s+CHOOSE\\s+OF\\s+(${IDENT})(?:\\s+IN\\s+FRAME\\s+(${IDENT}))?\\s+DO\\s*:\\s*([\\s\\S]*)$`, "i").exec(flat);
  if (!m) return null;

  const button = m[1];
  const frame = m[2] ?? null;
  const body = [];
  let j = i;

  const firstBody = m[3].trim();
  let closed = false;
  if (firstBody) {
    if (/^END$/i.test(firstBody)) closed = true;
    else body.push(firstBody);
  }

  while (!closed) {
    j += 1;
    if (j >= statements.length) {
      problems.push(`an ON CHOOSE handler for \`${button}\` was never closed with END before end of file; it is skipped.`);
      return { button, frame, body: [], clean: false, runName: null, endIndex: j - 1 };
    }
    const next = flatten(statements[j]);
    if (/^END$/i.test(next)) { closed = true; break; }
    body.push(next);
  }

  const runMatch = body.length === 1 ? new RegExp(`^RUN\\s+(${IDENT})\\s*$`, "i").exec(body[0]) : null;
  return {
    button,
    frame,
    body,
    clean: !!runMatch,
    runName: runMatch ? runMatch[1] : null,
    endIndex: j,
  };
}

/**
 * A whole `.p` file read into its declarations, its `FORM ... WITH FRAME`
 * screens (one per frame, in the order the source names appear within each)
 * and its buttons' `ON CHOOSE OF` wiring. `declarations` is keyed by name in
 * declaration order; `onChoose` is keyed by button name, holding only the
 * buttons that actually carry a block, since a button with none is simply
 * absent from it and lower.js reports that as unwired.
 */
export function parseOpenEdge(source) {
  const statements = splitStatements(String(source ?? "").replace(/\r\n/g, "\n"));
  const declarations = {};
  const frames = [];
  const onChoose = {};
  const problems = [];

  for (let i = 0; i < statements.length; i += 1) {
    const flat = flatten(statements[i]);

    const asVariable = parseDefineVariable(flat);
    if (asVariable) { declarations[asVariable.name] = asVariable; continue; }

    const asButton = parseDefineButton(flat);
    if (asButton) { declarations[asButton.name] = asButton; continue; }

    const asForm = parseForm(flat, problems);
    if (asForm) { frames.push(asForm); continue; }

    if (/^ON\s+CHOOSE\s+OF\b/i.test(flat)) {
      const block = parseOnChoose(statements, i, problems);
      if (block) { onChoose[block.button] = block; i = block.endIndex; continue; }
    }
    // Anything else is ordinary procedure code outside this reader's vocabulary and is silently passed over, the
    // same restraint input-xbase keeps over a file's own IF/assignment/function-call lines.
  }

  return { declarations, frames, onChoose, problems };
}
