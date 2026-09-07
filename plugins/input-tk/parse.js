/**
 * Tcl/Tk scripts: a GUI built by ordinary executable Tcl statements, no
 * separate declarative designer file at all, the same "screen built one
 * executable statement at a time" pattern input-xbase already reads for
 * dBase/Clipper's `@ SAY/GET`. A widget-creation command has one shape,
 * `widgetType .path.name -option value -option value ...`, and Tk's own
 * dotted hierarchical widget path is this reader's best identity for a
 * widget, there being no other name a Tk widget carries. This reader keeps
 * a flat, declaration-ordered list rather than reconstructing the real
 * parent/child tree a path implies, the same "position/order over a real
 * tree" choice input-cics and input-xbase already make where a format's own
 * nesting does not change what is rendered.
 *
 * Tcl's own backslash-newline continuation joins a widget command split
 * across physical lines, the same "join a legacy language's own
 * continuation convention" step input-cics, input-cobolscreen and
 * input-xbase each already take for their own format. `pack`, `grid` and
 * `place` calls, and every other ordinary Tcl statement (`proc`, `if`,
 * `set`, loops), are not in this reader's vocabulary at all: the whole file
 * is scanned for the widget-creation commands wherever they fall, the same
 * "no wrapping section, scan everywhere" approach input-xbase already
 * takes for `@`/`READ`.
 */

// Longer names that share a prefix with a shorter one in this same set come first, so the word boundary check below
// only ever has to reject a too-short match once before the real one is tried.
const COMMANDS = [
  "labelframe", "label", "checkbutton", "radiobutton", "button", "entry",
  "menubutton", "menu", "scale", "scrollbar", "canvas", "text", "listbox", "frame",
];
const COMMAND_RE = new RegExp(`^(?:ttk::)?(${COMMANDS.join("|")})\\b([\\s\\S]*)$`);

/** Every physical line joined into the logical command lines a trailing `\` spells: a line ending in a backslash
 * (once its own trailing whitespace is gone) continues on the next, the way Tcl's own reader treats the pair as one
 * space, the same "join before parsing" step input-xbase takes over its own trailing-semicolon continuation. */
function joinContinuations(lines) {
  const logical = [];
  let buffer = null;
  for (const raw of lines) {
    const trimmedEnd = raw.replace(/\s+$/, "");
    const continues = trimmedEnd.endsWith("\\");
    const content = continues ? trimmedEnd.slice(0, -1) : trimmedEnd;
    buffer = buffer === null ? content : `${buffer} ${content.trim()}`;
    if (continues) continue;
    logical.push(buffer ?? "");
    buffer = null;
  }
  if (buffer !== null) logical.push(buffer);
  return logical;
}

const isWs = (c) => c === " " || c === "\t";

function skipWs(text, i) {
  while (i < text.length && isWs(text[i])) i += 1;
  return i;
}

/**
 * The `{...}` group opening at `i`, brace matched with a backslash escape
 * kept literal (Tcl's own quoting), or null when it never closes. The
 * same technique input-fluid's own brace-value reader already solved for
 * its own Tcl-like format, not shared code (Tcl's quoting is close but not
 * identical), so a private copy lives here.
 */
function readBraceWord(text, i) {
  if (text[i] !== "{") return null;
  let depth = 0;
  const start = i;
  for (; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") { i += 1; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return { raw: text.slice(start + 1, i), kind: "brace", next: i + 1 }; }
  }
  return null;
}

/** A `"..."` word, a backslash escaping the quote character kept as part of the literal text rather than evaluated,
 * the same restraint this reader keeps over a `[...]`/`$...` substitution inside it: the text is kept exactly as
 * written, only the terminating quote is found correctly. Null when it never closes. */
function readQuotedWord(text, i) {
  if (text[i] !== '"') return null;
  const start = i + 1;
  let j = start;
  for (; j < text.length; j += 1) {
    if (text[j] === "\\") { j += 1; continue; }
    if (text[j] === '"') return { raw: text.slice(start, j), kind: "dq", next: j + 1 };
  }
  return null;
}

/** A bare word: everything up to the next whitespace. Tk never needs a widget path, an option name or most option
 * values quoted, so this is the ordinary case. */
function readBareWord(text, i) {
  const start = i;
  while (i < text.length && !isWs(text[i])) i += 1;
  return { raw: text.slice(start, i), kind: "bare", next: i };
}

/** One whitespace-separated word starting at `i` in any of Tcl's three real quoting shapes, or null past the end of
 * the text. */
function readWord(text, i) {
  const start = skipWs(text, i);
  if (start >= text.length) return null;
  return readBraceWord(text, start) ?? readQuotedWord(text, start) ?? readBareWord(text, start);
}

/** Every word in a command's argument text, in order. A word that never closes (an unterminated brace or quote) ends
 * the read early with whatever parsed before it, rather than losing the whole line. */
function readWords(text) {
  const words = [];
  let i = 0;
  for (;;) {
    const w = readWord(text, i);
    if (!w) break;
    words.push(w);
    i = w.next;
  }
  return words;
}

/**
 * One widget-creation command's `-option value` pairs, keyed by option name
 * with the value's raw text and which of the three quoting shapes it came
 * in, so a caller can tell a clean bare proc name from a brace-quoted
 * script without re-reading the source. An option word with no value word
 * after it (a truncated command) is dropped: there is nothing to bind it
 * to.
 */
function parseOptions(words) {
  const options = new Map();
  for (let i = 0; i < words.length; i += 2) {
    const key = words[i];
    if (key.kind !== "bare" || !key.raw.startsWith("-")) continue; // not an option token at all
    const value = words[i + 1];
    if (!value) break;
    options.set(key.raw.slice(1), value);
  }
  return options;
}

/**
 * A whole `.tcl` file read into the widget-creation commands it declares,
 * in the order they were written, `ttk::` prefixed or not (the same widget
 * type either way, only the namespace differs). `pack`, `grid`, `place` and
 * every other Tcl statement are not matched by `COMMAND_RE` at all and are
 * silently passed over, whether they sit beside a widget command or inside
 * a `proc` or `if` body around one.
 */
export function parseTk(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const logical = joinContinuations(lines);

  const widgets = [];
  for (const line of logical) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue; // blank, or a full line comment once continuations are joined

    const m = COMMAND_RE.exec(trimmed);
    if (!m) continue; // ordinary Tcl source: not this reader's vocabulary

    const command = m[1];
    const pathWord = readWord(m[2], 0);
    if (!pathWord || !pathWord.raw.startsWith(".")) continue; // no widget path right after the command name at all

    const rest = m[2].slice(pathWord.next);
    const options = parseOptions(readWords(rest));

    widgets.push({ command, path: pathWord.raw, options });
  }

  return { widgets };
}
