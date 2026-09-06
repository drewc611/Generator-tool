import { matchBracket } from "../dsp-ir/text.js";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The inline mx:Script or fx:Script CDATA block, read narrowly. ActionScript
 * shares its comment and string syntax with the C family, the same
 * assumption input-rc's stripComments and input-vb6's uncomment already make
 * of their own languages, so a `//` inside a string is text and a quote
 * inside a comment is not. Two things come out of the scan: which functions
 * exist, so a click attribute naming one can be matched rather than guessed
 * at, and which properties are marked [Bindable]. Neither a function's body
 * nor a property's initializer is ever read.
 */

/** The index just past the string or comment opening at `i`, or `i` itself when none opens there. */
function spanEnd(text, i) {
  const c = text[i];
  if (c === "'" || c === '"') {
    let j = i + 1;
    while (j < text.length && text[j] !== c) { if (text[j] === "\\") j += 1; j += 1; }
    return j + 1;
  }
  if (c === "/" && text[i + 1] === "/") { const nl = text.indexOf("\n", i); return nl < 0 ? text.length : nl; }
  if (c === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); return end < 0 ? text.length : end + 2; }
  return i;
}

/** The script with every comment and string body blanked to spaces, newlines kept, so a match cannot fire inside either and every offset still lines up with the source. */
function blank(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const end = spanEnd(text, i);
    if (end > i) { out += text.slice(i, end).replace(/[^\n]/g, " "); i = end; continue; }
    out += text[i];
    i += 1;
  }
  return out;
}

const FUNCTION = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
const BINDABLE = /\[Bindable(?:\([^)]*\))?\]\s*(?:(?:public|private|protected|internal|static)\s+)*var\s+([A-Za-z_$][\w$]*)/g;

export function readScript(source) {
  const text = String(source ?? "");
  const scanned = blank(text);
  const functions = new Map();
  for (const m of scanned.matchAll(FUNCTION)) {
    const open = text.indexOf("(", m.index);
    const argsClose = open >= 0 ? matchBracket(text, open) : -1;
    const bodyOpen = argsClose >= 0 ? text.indexOf("{", argsClose) : -1;
    const bodyClose = bodyOpen >= 0 ? matchBracket(text, bodyOpen) : -1;
    const lines = bodyClose >= 0 ? lineAt(text, bodyClose) - lineAt(text, m.index) + 1 : 1;
    functions.set(m[1], { lines });
  }
  const bindable = new Set();
  for (const m of scanned.matchAll(BINDABLE)) bindable.add(m[1]);
  return { functions, bindable };
}

/** The function name a handler attribute names, its call arguments dropped; null when it is not a bare call to a name. */
export function handlerName(value) {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*(?:\([\s\S]*\))?\s*;?\s*$/.exec(String(value ?? ""));
  return m ? m[1] : null;
}
