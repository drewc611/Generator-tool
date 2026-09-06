import { lineAt } from "../dsp-ir/emit.js";

/**
 * A structural scanner over a Java source file carrying a NetBeans style
 * initComponents method. A GUI builder never hand writes this method: it
 * regenerates the whole thing from the form it holds, in the same shapes
 * every time, field declarations at the class level, one instantiation and
 * one property setter per statement, event wiring through an anonymous
 * inner class. The scanner knows only Java's strings, characters and
 * comments; what a statement means is for lower.js, the way parse.js and
 * lower.js split the same job in input-extjs.
 *
 * A handler method's body is never read, only where it starts, where it
 * ends, and how many lines that spans, the same restraint every other
 * reader in this repo already keeps over code a GUI builder did not write.
 */

const OPEN = "([{";
const CLOSE = ")]}";

/** Where the Java string, character or comment opening at `i` ends, or `i` when none opens there. */
function skipJava(t, i) {
  const c = t[i];
  if (c === "/" && t[i + 1] === "/") { const nl = t.indexOf("\n", i); return nl < 0 ? t.length : nl; }
  if (c === "/" && t[i + 1] === "*") { const e = t.indexOf("*/", i + 2); return e < 0 ? t.length : e + 2; }
  if (c !== '"' && c !== "'") return i;
  let j = i + 1;
  while (j < t.length && t[j] !== c) { if (t[j] === "\\") j += 1; j += 1; }
  return j + 1;
}

/** The Java statements between `from` and the brace that closes the body opened just before it, each with its line, comments dropped. */
function statements(source, from) {
  const out = [];
  let depth = 0;
  let text = "";
  let line = 0;
  let i = from;
  while (i < source.length) {
    const j = skipJava(source, i);
    if (j > i) {
      // A comment between two statements belongs to neither; a string or a character literal belongs to its statement whole.
      if (source[i] !== "/") { if (!text.trim()) line = lineAt(source, i); text += source.slice(i, j); }
      i = j;
      continue;
    }
    const c = source[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) {
      if (depth === 0) return { statements: out, end: i };
      depth -= 1;
    } else if (c === ";" && depth === 0) {
      if (text.trim()) out.push({ text: text.trim(), line });
      text = "";
      i += 1;
      continue;
    }
    if (!text.trim() && !/\s/.test(c)) line = lineAt(source, i);
    text += c;
    i += 1;
  }
  return { statements: out, end: -1 };
}

/**
 * The initComponents method's body, statements cut at top level semicolons.
 * NetBeans brackets the method with a GEN-BEGIN/GEN-END comment pair or an
 * `<editor-fold>` region, and either is used to find the body reliably
 * rather than guessed at; a file with neither marker still yields a body by
 * matching braces from the declaration itself, since a hand edited or an
 * older builder's output is still real generated code.
 */
export function initComponentsBody(source) {
  const decl = /\bprivate\s+void\s+initComponents\s*\(\s*\)\s*\{/.exec(source);
  if (!decl) return null;
  const declEnd = decl.index + decl[0].length;

  // The region a marker brackets runs from the declaration to the marker's
  // own close, which sits after the method's closing brace; the statements
  // still stop at that brace, the marker only proves where to look.
  const foldOpen = source.lastIndexOf("<editor-fold", decl.index);
  const genBegin = source.lastIndexOf("GEN-BEGIN:initComponents", decl.index);
  const marked = (foldOpen >= 0 && source.slice(foldOpen, decl.index).includes("Generated Code")) || genBegin >= 0;

  const { statements: stmts, end } = statements(source, declEnd);
  return { statements: stmts, line: lineAt(source, decl.index), closed: end >= 0, marked };
}

/** True when a file carries the GEN markers a GUI builder writes around a generated method, this reader's claim on the file. */
export function isGenerated(source) {
  return /GEN-BEGIN:initComponents|<editor-fold[^>]*desc="Generated Code"/.test(source);
}

/** The class level field declarations of a javax.swing widget: `private javax.swing.JLabel name;`, the package prefix optional. */
export function fieldTypes(source) {
  const types = new Map();
  const re = /\b(?:private|protected|public)\s+(?:javax\.swing\.)?(J[A-Za-z]\w*)\s+(\w+)\s*;/g;
  let m;
  while ((m = re.exec(source))) types.set(m[2], m[1]);
  return types;
}

/**
 * Every `<name>ActionPerformed(...ActionEvent evt)` handler method, kept as
 * existing and how long it runs; the body between its braces is walked only
 * to find where it ends, brace and string aware, and never kept.
 */
export function handlerMethods(source) {
  const handlers = new Map();
  const re = /\b(?:private|protected|public)\s+void\s+(\w+ActionPerformed)\s*\(\s*(?:java\.awt\.event\.)?ActionEvent\s+\w+\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(source))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      const j = skipJava(source, i);
      if (j > i) { i = j - 1; continue; }
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    const startLine = lineAt(source, m.index);
    const endLine = end >= 0 ? lineAt(source, end) : startLine;
    handlers.set(m[1], { line: startLine, endLine, lines: endLine - startLine + 1, closed: end >= 0 });
  }
  return handlers;
}

/** A Java string literal decoded, or null when the text is not one whole literal. */
export function literalString(raw) {
  const t = raw.trim();
  if (!/^"(?:[^"\\]|\\.)*"$/.test(t)) return null;
  return t.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e) => {
    if (e[0] === "u") return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "0": "\0" }[e] ?? e;
  });
}

/** The `new String[] { "a", "b" }` a DefaultTableModel column array spells, or null when it is not that shape. */
export function stringArray(raw) {
  const m = /new\s+String\s*\[\s*\]\s*\{([\s\S]*)\}/.exec(raw);
  if (!m) return null;
  const items = splitTop(m[1]);
  const values = items.map((i) => literalString(i));
  return values.every((v) => v !== null) ? values : null;
}

/** An argument list split at its top level commas, brackets and Java strings kept whole. Local because Java's escapes (no backtick, a character literal that reads like a one letter string) are its own small dialect, the same reason every other reader here keeps its own copy rather than reaching for one written for someone else's syntax. */
export function splitTop(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const j = skipJava(text, i);
    if (j > i) { i = j - 1; continue; }
    const c = text[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) depth -= 1;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}
