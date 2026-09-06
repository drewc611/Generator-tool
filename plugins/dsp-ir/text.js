/**
 * The three things every template reader does to a string of source: find the
 * bracket that closes an open one, split an argument list at its top level,
 * and make an expression safe inside a double quoted attribute. Eight readers
 * each wrote their own before this file; a defect in one of them (a quote
 * opened by an apostrophe in prose, an unbalanced bracket that never returned)
 * had to be found eight times. It is found once here, and the hygiene suite
 * holds each helper to this one definition.
 */

const CLOSERS = { "(": ")", "[": "]", "{": "}" };
const isOpen = (c) => c === "(" || c === "[" || c === "{";
const isClose = (c) => c === ")" || c === "]" || c === "}";

/**
 * The index just past the bracket that closes the one at `open`, or -1 when
 * it never closes. `strings` says whether quotes open a string the scan skips
 * (false inside markup, where an apostrophe is prose); `ticks` whether a
 * backtick does (true for JS, false for C# and the Java template languages).
 */
/** A name spelled literally inside a RegExp source, every meta character escaped. */
export const regexEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function matchBracket(text, open, { strings = true, ticks = true } = {}) {
  const close = CLOSERS[text[open]];
  if (!close) return -1;
  let depth = 0; let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (strings && (c === '"' || c === "'" || (ticks && c === "`"))) quote = c;
    else if (isOpen(c)) depth += 1;
    else if (isClose(c)) { depth -= 1; if (depth === 0 && c === close) return i + 1; }
  }
  return -1;
}

/** An argument list split at its top level commas, each item trimmed, a trailing empty item dropped. */
export function splitCommas(text, { ticks = true } = {}) {
  const out = []; let depth = 0; let start = 0; let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || (ticks && c === "`")) quote = c;
    else if (isOpen(c)) depth += 1;
    else if (isClose(c)) depth -= 1;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** An argument list split at its top level whitespace, brackets and strings kept whole. */
export function splitWords(text) {
  const out = []; let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (isOpen(c)) depth += 1;
    else if (isClose(c)) depth -= 1;
    else if (/\s/.test(c) && depth === 0) { if (i > start) out.push(text.slice(start, i)); start = i + 1; }
  }
  if (text.length > start) out.push(text.slice(start));
  return out;
}

/** An expression inside a double quoted dialect attribute: its double quotes become single. */
export const attrSafe = (s) => String(s).replace(/"/g, "'");

/**
 * The template a name refers to, among the run's own files: by its bared path
 * or a suffix of it, never by its basename alone, which would be a guess at
 * which nav.html was meant. `bare` strips a dialect's prefixes and extension.
 */
export function resolveTemplate(keys, name, bare) {
  const b = bare(name);
  return keys.find((k) => bare(k) === b) ?? keys.find((k) => bare(k).endsWith(`/${b}`)) ?? null;
}

/**
 * A lowered attribute value where JavaScript is wanted: an expression as
 * itself, a literal quoted, text around interpolations as a concatenation.
 */
export function valueJs(r) {
  if (r.kind === "expr") return r.text;
  if (r.kind === "literal") return quoteJs(r.text);
  const pieces = [];
  let last = 0;
  for (const m of r.text.matchAll(/\{\{\s*([\s\S]*?)\s*\}\}/g)) {
    if (m.index > last) pieces.push(quoteJs(r.text.slice(last, m.index)));
    pieces.push(`(${m[1]})`);
    last = m.index + m[0].length;
  }
  if (last < r.text.length) pieces.push(quoteJs(r.text.slice(last)));
  return pieces.join(" + ");
}

/** A literal as a JS string, its backslashes escaped before its quotes. */
export const quoteJs = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/**
 * The names a lowered template reads, from its expressions only: every
 * interpolation and every dialect attribute, with string literals removed,
 * loop variables and the dialect's own $index left out, and any names the
 * caller knows are globals skipped. Markup is not an expression: type="search"
 * is an attribute, {{ search.terms }} is a read.
 */
export function readInputs(template, { skip = [] } = {}) {
  const skipped = new Set(skip);
  const names = new Set();
  const expressions = [
    ...[...template.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]),
    ...[...template.matchAll(/\sng-[\w-]+="([^"]*)"/g)].map((m) => m[1].replace(/^\(?[\w$]+(?:,\s*[\w$]+)?\)?\s+in\s+/, "").replace(/\s+track by [\s\S]*$/, ""))
      // ng-href="/cart/{{ id }}" is an address around an expression; only the expression reads.
      .map((v) => (v.includes("{{") ? [...v.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]).join(";\n") : v)),
    // Joined as statements: an expression that opens with ( must not make the name before it look like a call.
  ].join(";\n");
  const locals = new Set([...template.matchAll(/ng-repeat="\(?(\w+)(?:,\s*(\w+))?\)?\s+in/g)].flatMap((m) => [m[1], m[2]].filter(Boolean)));
  // {{ body | limitTo:count }} names a filter after its pipe, not a local, but its argument reads; || is JS and stays.
  const bare = expressions.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`[^`]*`/g, "").replace(/(?<!\|)\|(?!\|)\s*\w+/g, " ");
  for (const m of bare.matchAll(/(?<![\w.$])([A-Za-z_]\w*)\b(?!\s*\()/g)) {
    // { id: x } names a key, not a read; a ? b : c names a read.
    if (/^\s*:/.test(bare.slice(m.index + m[0].length)) && /[{,]\s*$/.test(bare.slice(0, m.index))) continue;
    // A language global read as Object.keys(x) or Math.round(y) is not an input the port is handed.
    if (!/^(true|false|null|undefined|new|typeof|Object|Math|JSON|Array|Number|String|Date|Boolean)$/.test(m[1]) && !locals.has(m[1]) && !skipped.has(m[1])) names.add(m[1]);
  }
  return [...names].sort();
}

/** Each `receiver.method` match rewritten with its receiver, the receiver being the balanced path just before the dot. */
export function rewriteReceivers(s, re, rewrite) {
  let out = s;
  for (;;) {
    const m = re.exec(out);
    re.lastIndex = 0;
    if (!m) return out;
    let i = m.index - 1; let depth = 0;
    for (; i >= 0; i -= 1) {
      const c = out[i];
      if (c === ")" || c === "]") depth += 1;
      else if (c === "(" || c === "[") { if (depth === 0) break; depth -= 1; }
      else if (depth === 0 && !/[\w$.@\u0001\u0002]/.test(c)) break;
    }
    const start = i + 1;
    const recv = out.slice(start, m.index);
    const whole = start === 0 && m.index + m[0].length === out.length;
    out = out.slice(0, start) + rewrite(recv, m[1], whole) + out.slice(m.index + m[0].length);
  }
}
