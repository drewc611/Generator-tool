import { lineAt } from "../dsp-ir/emit.js";

/**
 * A structural scanner over Sencha ExtJS source, the classic `Ext.define`/
 * `Ext.create` API. It knows nothing about ExtJS itself: it finds the two
 * calls by name, reads the object literal each one is handed as a tree of
 * key and value pairs, and hands that tree to index.js, which knows what an
 * xtype means. A function found as a value is never executed and never read
 * past its own boundaries; only where it starts, where it ends, and roughly
 * how long it is are kept, because a handler's behaviour is exactly the kind
 * of thing this tool must never guess at.
 *
 * Every position below is a character offset into the original file, carried
 * through rather than re-found, so a note can say the line a value came from
 * even after the value itself is several splits deep in a config tree.
 */

const OPEN = "([{";
const CLOSE = ")]}";
const CLOSER = { "(": ")", "[": "]", "{": "}" };

/** The index just past the string, template literal or comment opening at `i`, or `i` itself when none opens there. */
function spanEnd(text, i) {
  const c = text[i];
  if (c === "'" || c === '"' || c === "`") {
    let j = i + 1;
    while (j < text.length && text[j] !== c) { if (text[j] === "\\") j += 1; j += 1; }
    return j + 1;
  }
  if (c === "/" && text[i + 1] === "/") {
    const nl = text.indexOf("\n", i);
    return nl < 0 ? text.length : nl;
  }
  if (c === "/" && text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i;
}

/** The index of the bracket that closes the one at `open`, spans skipped whole, or -1 when it never closes. */
function closeOf(text, open) {
  const close = CLOSER[text[open]];
  if (!close) return -1;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const spanned = spanEnd(text, i);
    if (spanned > i) { i = spanned - 1; continue; }
    const c = text[i];
    if (c === text[open]) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * `[start, end)` trimmed to its real content: the whitespace at either edge
 * is dropped, and so is a `//` or `/*` comment sitting at either edge, since
 * `Ext.define` config trees are commented as densely as any other config and
 * a comment ahead of a key must never become part of the key's own name. A
 * string or template literal counts as real content and stops the trim, even
 * though it opens the same way a comment's delimiter does.
 */
function trim(text, start, end) {
  let s = start;
  while (s < end) {
    if (/\s/.test(text[s])) { s += 1; continue; }
    if (text[s] === "/") {
      const spanned = spanEnd(text, s);
      if (spanned > s) { s = spanned; continue; }
    }
    break;
  }
  let lastReal = s;
  let i = s;
  while (i < end) {
    if (/\s/.test(text[i])) { i += 1; continue; }
    if (text[i] === "/") {
      const spanned = spanEnd(text, i);
      if (spanned > i) { i = spanned; continue; }
    }
    const spanned = spanEnd(text, i);
    if (spanned > i) { i = spanned; lastReal = i; continue; }
    i += 1;
    lastReal = i;
  }
  return [s, lastReal];
}

/** Every top level split of `text[start, end)` at a bare `sep` character, brackets balanced and every span skipped whole. */
function splitTopLevel(text, start, end, sep) {
  const out = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < end; i += 1) {
    const spanned = spanEnd(text, i);
    if (spanned > i) { i = Math.min(spanned, end) - 1; continue; }
    const c = text[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) depth -= 1;
    else if (depth === 0 && c === sep) { out.push([from, i]); from = i + 1; }
  }
  out.push([from, end]);
  return out;
}

/** The index of the first top level `:` in `text[start, end)`, or -1. A colon inside a nested object or a string is not this entry's own. */
function findTopLevelColon(text, start, end) {
  let depth = 0;
  for (let i = start; i < end; i += 1) {
    const spanned = spanEnd(text, i);
    if (spanned > i) { i = Math.min(spanned, end) - 1; continue; }
    const c = text[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) depth -= 1;
    else if (depth === 0 && c === ":") return i;
  }
  return -1;
}

/** The index of a top level `=>`, or -1. An arrow past a default value's own `>=`/`<=` is never mistaken for it, since those read `>` or `<` first, not `=`. */
function findTopLevelArrow(text, start, end) {
  let depth = 0;
  for (let i = start; i < end; i += 1) {
    const spanned = spanEnd(text, i);
    if (spanned > i) { i = Math.min(spanned, end) - 1; continue; }
    const c = text[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) depth -= 1;
    else if (depth === 0 && c === "=" && text[i + 1] === ">") return i;
  }
  return -1;
}

/** The characters a single or double quoted literal spells; a template literal is kept as written, since no interpolation is resolved. */
function decodeEscapes(raw) {
  return raw.replace(/\\(n|t|r|\\|'|"|`)/g, (_, c) => ({ n: "\n", t: "\t", r: "\r" }[c] ?? c));
}

const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * One value, wherever it sits in a config tree: a string, a number, a
 * boolean, `null`, an array, a nested object, or a function or an
 * identifier, kept opaque. Nothing here decides what a value means; that is
 * for whoever asked for it, one xtype at a time.
 */
export function parseValue(text, start, end) {
  [start, end] = trim(text, start, end);
  if (start >= end) return { kind: "empty" };
  const line = lineAt(text, start);
  const c = text[start];

  if (c === "'" || c === '"' || c === "`") {
    const close = spanEnd(text, start);
    if (close === end) {
      const inner = text.slice(start + 1, end - 1);
      return { kind: "string", value: c === "`" ? inner : decodeEscapes(inner), line };
    }
  }

  const word = text.slice(start, end);
  if (NUMBER.test(word)) return { kind: "number", value: Number(word), line };
  if (word === "true" || word === "false") return { kind: "boolean", value: word === "true", line };
  if (word === "null" || word === "undefined") return { kind: "null", line };

  if (c === "[" && closeOf(text, start) === end - 1) {
    const items = [];
    for (const [s, e] of splitTopLevel(text, start + 1, end - 1, ",")) {
      const v = parseValue(text, s, e);
      if (v.kind !== "empty") items.push(v);
    }
    return { kind: "array", items, line };
  }
  if (c === "{" && closeOf(text, start) === end - 1) {
    return { kind: "object", entries: parseEntries(text, start + 1, end - 1), line };
  }

  // A function's body is never read, only where it sits and how long it runs.
  // `handler: save` (a bare reference) is kept the same way, as an expression,
  // because what the name resolves to is exactly as unread as what a closure
  // does; both are named, never followed.
  if (/^function\b/.test(word) || findTopLevelArrow(text, start, end) >= 0) {
    return { kind: "function", start, end, line, lines: lineAt(text, end) - line + 1 };
  }
  return { kind: "expr", text: word, line };
}

/** The `{ key: value, ... }` entries between `start` and `end`, the braces already excluded. */
function parseEntries(text, start, end) {
  const entries = [];
  for (const [s, e] of splitTopLevel(text, start, end, ",")) {
    const [ts, te] = trim(text, s, e);
    if (ts >= te) continue;
    const colon = findTopLevelColon(text, ts, te);
    if (colon < 0) {
      // `{ foo }` names a shorthand property; the key and the read are the same name.
      const name = text.slice(ts, te);
      entries.push({ key: name, value: { kind: "expr", text: name, line: lineAt(text, ts) }, line: lineAt(text, ts) });
      continue;
    }
    const [ks, ke] = trim(text, ts, colon);
    let key = text.slice(ks, ke);
    if ((key[0] === "'" || key[0] === '"') && key[key.length - 1] === key[0]) key = key.slice(1, -1);
    entries.push({ key, value: parseValue(text, colon + 1, te), line: lineAt(text, ts) });
  }
  return entries;
}

/** The value bound to `key` at an object's own top level, or null when the key is absent. */
export function entryValue(node, key) {
  if (node?.kind !== "object") return null;
  return node.entries.find((e) => e.key === key)?.value ?? null;
}

const CALL = /\bExt\s*\.\s*(define|create)\s*\(/g;

/**
 * Every `Ext.define(...)` and `Ext.create(...)` call in a file, each with the
 * class name it names, if any, and the config object it was handed, if any.
 * `Ext.define(name, { ... })` always carries both; `Ext.create({ ... })`
 * carries a config with no name; `Ext.create('a.b.C')` alone carries a name
 * and no config, and is a plain instantiation with nothing here to lower.
 */
export function findCalls(source) {
  const calls = [];
  const problems = [];
  CALL.lastIndex = 0;
  let m;
  while ((m = CALL.exec(source))) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(source, open);
    if (close < 0) { problems.push(`line ${lineAt(source, m.index)}: Ext.${m[1]}(...) never closes; nothing was read from it`); continue; }
    const args = splitTopLevel(source, open + 1, close, ",");
    const first = args[0] ? parseValue(source, args[0][0], args[0][1]) : { kind: "empty" };
    let className = null;
    let config = null;
    if (first.kind === "string") {
      className = first.value;
      if (args[1]) config = parseValue(source, args[1][0], args[1][1]);
    } else if (first.kind === "object") {
      config = first;
    }
    calls.push({ kind: m[1], className, config, line: lineAt(source, m.index) });
  }
  return { calls, problems };
}
