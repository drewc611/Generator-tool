import { splitCommas } from "../dsp-ir/text.js";

/**
 * PowerBASIC for Windows (PB/Win): a still-used Windows BASIC compiler whose
 * dialogs are built entirely by its own DDT (Dynamic Dialog Tools) statements
 * run at execution time, no separate resource or designer file at all, the
 * same "screen built one executable statement at a time" pattern input-xbase,
 * input-tk and input-autoit already establish for their own languages.
 * `DIALOG NEW ... TO handle` opens one dialog and is this reader's own screen
 * boundary, so a whole `.bas` file with more than one `DIALOG NEW` call
 * produces more than one screen, the same "each structural top-level unit is
 * its own screen" rule input-cics and input-storyboard already keep. Unlike
 * a function call, PB/Win's own DDT statements are keyword led and space
 * separated rather than parenthesized, so there is no bracket to match here.
 *
 * `CONTROL ADD type, dialoghandle, id, "text", x, y, w, h [, style] [, CALL
 * proc]` adds one control to the dialog its own `dialoghandle` argument
 * names. PowerBASIC identifies a DDT control by a plain numeric id, not by a
 * variable the way every other statement-built reader's own control does,
 * so this reader's control record carries that id raw and leaves naming a
 * field from it to lower.js. A trailing `CALL procname` is a clean, direct
 * reference to a button's own wiring, the strongest kind, resolved here on
 * the same statement rather than matched against a separate event loop the
 * way input-autoit has to.
 */

/** A physical line with everything from an unquoted `'` onward, or from an unquoted, whole-word `REM` onward,
 * removed: PowerBASIC's own two real comment spellings. A doubled double quote (`""`) inside a string literal is
 * PowerBASIC's own escaped quote, so it must not be read as the string closing early. PowerBASIC has no
 * single-quoted string literal; `'` is only ever the comment character. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '"') {
        if (line[i + 1] === '"') { i += 1; continue; } // a doubled quote: the escaped quote, string stays open
        quote = null;
      }
      continue;
    }
    if (c === '"') { quote = c; continue; }
    if (c === "'") return line.slice(0, i);
    if (/rem/i.test(line[i] + (line[i + 1] || "") + (line[i + 2] || "")) && (i === 0 || /[^A-Za-z0-9_]/.test(line[i - 1])) && (line[i + 3] === undefined || /[^A-Za-z0-9_]/.test(line[i + 3]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Every physical line joined into the logical statement lines a trailing `_` spells: PowerBASIC's own real line
 * continuation character, the same "join before parsing" step input-cics, input-cobolscreen, input-xbase and
 * input-tk each already implement for their own format. The marker is a whitespace character followed by `_` at
 * the true end of the line, dropped as the join point. */
function joinContinuations(lines) {
  const logical = [];
  let buffer = null;
  for (const raw of lines) {
    const line = stripComment(raw);
    if (buffer === null && !line.trim()) continue;
    const trimmedEnd = line.replace(/\s+$/, "");
    const continues = /\s_$/.test(trimmedEnd);
    const content = continues ? trimmedEnd.replace(/\s_$/, "") : trimmedEnd;
    buffer = buffer === null ? content : `${buffer} ${content.trim()}`;
    if (continues) continue;
    logical.push(buffer);
    buffer = null;
  }
  if (buffer !== null && buffer.trim()) logical.push(buffer);
  return logical;
}

/** A `"..."` double quoted literal with PowerBASIC's own doubled-quote escape decoded, or null when the text is not
 * one whole literal (a variable, an expression, an empty positional slot), which the caller names as a gap rather
 * than assumes anything from. */
export function parsePbwinString(raw) {
  const s = String(raw ?? "").trim();
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return null;
  let i = 1;
  let closedAt = -1;
  while (i < s.length) {
    if (s[i] === '"') {
      if (s[i + 1] === '"') { i += 2; continue; }
      closedAt = i;
      break;
    }
    i += 1;
  }
  if (closedAt !== s.length - 1) return null;
  return s.slice(1, -1).split('""').join('"');
}

/**
 * One `DIALOG NEW`'s own argument list, split at the top level: the
 * positional arguments before its `TO handle` clause (empty slots kept, not
 * collapsed, since two consecutive commas are a real, tolerated gap in the
 * source), and the handle variable named after `TO`. Returns null when no
 * `TO` clause is found at all, since a dialog with no handle has no name any
 * later `CONTROL ADD` could ever reference, so it cannot become a screen.
 */
function parseDialogNew(argsText, problems) {
  const items = splitCommas(argsText, { ticks: false });
  const toIndex = items.findIndex((it) => /^to\s+\w+/i.test(it.trim()));
  if (toIndex === -1) {
    problems.push("a `DIALOG NEW` call carries no `TO` handle clause; its dialog has no name a later `CONTROL ADD` could reference, so it is skipped.");
    return null;
  }
  const positional = items.slice(0, toIndex);
  const handle = /^to\s+(\w+)/i.exec(items[toIndex].trim())[1];
  const titleRaw = positional.length > 1 ? positional[1] : null;
  return { handle, titleRaw, title: titleRaw !== null ? parsePbwinString(titleRaw) : null };
}

/**
 * One `CONTROL ADD`'s own argument list, split at the top level: its
 * control type keyword, the dialog handle variable it names, its own raw id
 * text, its own `"text"` argument decoded (or null when it is not a plain
 * literal), and the procedure name off a trailing `CALL procname` clause
 * when one is present among the arguments after the caption. `x, y, w, h`
 * and an optional style constant sit between the caption and any `CALL`
 * clause; this reader has no use for their values, the same restraint
 * input-autoit keeps over a control's own position and size arguments.
 */
function parseControlAdd(argsText, problems) {
  const items = splitCommas(argsText, { ticks: false });
  if (items.length < 3) {
    problems.push("a `CONTROL ADD` call has too few arguments to identify its own type, dialog and id; it is skipped.");
    return null;
  }
  const type = items[0].trim();
  const dialogVar = items[1].trim();
  const idRaw = items[2].trim();
  const textRaw = items.length > 3 ? items[3] : null;
  const text = textRaw !== null ? parsePbwinString(textRaw) : null;
  let callName = null;
  for (const it of items.slice(4)) {
    const m = /^call\s+(\w+)/i.exec(it.trim());
    if (m) { callName = m[1]; break; }
  }
  return { type, dialogVar, idRaw, text, hasText: textRaw !== null, callName };
}

/**
 * A whole `.bas` file read into its own dialogs, each with its controls in
 * declaration order: `DIALOG NEW ... TO handle` opens a dialog, every later
 * `CONTROL ADD` naming that same handle (matched case-insensitively, the
 * same case folding PowerBASIC itself applies to every identifier) belongs
 * to it. A `CONTROL ADD` naming a handle no `DIALOG NEW` in this file ever
 * opened is collected separately as `orphanControls`, a real gap rather
 * than a screen this reader could invent one for. Any other `DIALOG ...`
 * statement (`DIALOG SHOW MODAL`, `DIALOG SHOW MODELESS`, and the rest)
 * carries no field or screen content this reader needs and is skipped
 * silently, the same restraint given to Tk's own `pack`/`grid` layout calls.
 * `problems` names a statement this reader could not parse at all.
 */
export function parsePbwin(source) {
  const lines = joinContinuations(String(source ?? "").replace(/\r\n/g, "\n").split("\n"));

  const dialogs = [];
  const byKey = new Map();
  const orphanControls = [];
  const problems = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let m = /^dialog\s+new\b([\s\S]*)$/i.exec(trimmed);
    if (m) {
      const parsed = parseDialogNew(m[1], problems);
      if (!parsed) continue;
      const dialog = { handle: parsed.handle, title: parsed.title, titleRaw: parsed.titleRaw, controls: [] };
      dialogs.push(dialog);
      byKey.set(parsed.handle.toLowerCase(), dialog);
      continue;
    }

    if (/^dialog\b/i.test(trimmed)) continue; // DIALOG SHOW MODAL/MODELESS and the rest: no content this reader needs

    m = /^control\s+add\b([\s\S]*)$/i.exec(trimmed);
    if (m) {
      const parsed = parseControlAdd(m[1], problems);
      if (!parsed) continue;
      const dialog = byKey.get(parsed.dialogVar.toLowerCase());
      if (!dialog) { orphanControls.push(parsed); continue; }
      dialog.controls.push(parsed);
      continue;
    }

    // ordinary PowerBASIC source: not this reader's vocabulary, passed over the same way input-xbase and
    // input-tk pass over the control flow and code around their own statements.
  }

  return { dialogs, orphanControls, problems };
}
