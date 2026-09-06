import { matchBracket } from "../dsp-ir/text.js";
import { isGenerated } from "../input-swing/parse.js";

/**
 * Java AWT/Swing UI built entirely by ordinary executable statements, one
 * `new ClassName(...)` construction and one `add(...)` call at a time, with
 * no separate declarative designer file and no builder-generated
 * initComponents method at all: the same "screen built one statement in
 * source" pattern input-autoit already reads from AutoIt's own
 * GUICreate/GUICtrlCreate* calls. AWT and Swing share the identical
 * construct-then-configure-then-add idiom one level apart only in class
 * name (`Label` vs `JLabel`), so both spellings are read as the same kind
 * of control.
 *
 * A whole `.java` file is one screen, the same "no separate boundary
 * marker" choice input-tk already makes for a Tcl script. A file already
 * bracketed by input-swing's own GEN-BEGIN/GEN-END or editor-fold markers
 * was written by a GUI builder, not by hand, and belongs entirely to
 * input-swing; `isGenerated` is imported rather than copied so the two
 * readers can never disagree about what a marked file looks like.
 *
 * There is no separate declarative body to bound the way input-swing bounds
 * initComponents, so this reader scans the whole file for `new
 * ClassName(args)` occurrences directly, in file order, which is also
 * construction order: a control renders in the order its own construction
 * statement appears, not the order any `add(...)` call reaches it, since a
 * construction is often followed by several configuration statements
 * before it is actually added.
 */

/** AWT's older class name and Swing's `J`-prefixed one are the same control kind. */
const KIND = {
  Label: "label", JLabel: "label",
  TextField: "text", JTextField: "text",
  TextArea: "text", JTextArea: "text",
  Checkbox: "checkbox", JCheckBox: "checkbox",
  Choice: "combo", JComboBox: "combo",
  Button: "button", JButton: "button",
};

/**
 * Classes constructed for layout, containment or event plumbing rather than
 * as a control this reader's vocabulary reads: skipped with no note, the
 * boundary this reader draws between "not a control" and "a control it does
 * not recognise". Kept short and named here on purpose, so the boundary is
 * visible rather than an ever-growing allowlist.
 */
const CONTAINER_OR_SUPPORT = new Set([
  "JPanel", "Panel", "JFrame", "Frame", "JDialog", "Dialog", "JWindow", "Window", "JApplet",
  "JScrollPane", "ScrollPane", "JTabbedPane", "JSplitPane", "JToolBar", "JMenuBar", "JMenu", "JMenuItem",
  "JLayeredPane", "JInternalFrame", "Canvas", "JTable", "JList", "List", "JTree",
  "GridLayout", "BorderLayout", "FlowLayout", "GridBagLayout", "GridBagConstraints", "BoxLayout", "CardLayout",
  "Dimension", "Insets", "Font", "Color", "Point", "Rectangle",
  "EmptyBorder", "TitledBorder", "LineBorder", "Border",
  "ActionListener", "MouseAdapter", "MouseListener", "KeyAdapter", "KeyListener",
  "WindowAdapter", "WindowListener", "FocusAdapter", "FocusListener", "ComponentAdapter",
  "Thread", "Runnable", "ArrayList", "HashMap", "StringBuilder", "String", "Object",
]);

export { isGenerated };

/** Java string/character literal or comment starting at `i`, its own end, or `i` when none opens there. A small
 * copy rather than a shared import: Java's escaping rules are the same ones input-swing's skipJava already reads,
 * but keeping one small scanner per reader is the convention every legacy reader in this tool already follows. */
function skipJava(t, i) {
  const c = t[i];
  if (c === "/" && t[i + 1] === "/") { const nl = t.indexOf("\n", i); return nl < 0 ? t.length : nl; }
  if (c === "/" && t[i + 1] === "*") { const e = t.indexOf("*/", i + 2); return e < 0 ? t.length : e + 2; }
  if (c !== '"' && c !== "'") return i;
  let j = i + 1;
  while (j < t.length && t[j] !== c) { if (t[j] === "\\") j += 1; j += 1; }
  return j + 1;
}

/** The source with every string, character literal and comment blanked to spaces of the same length: keyword and
 * bracket positions still line up with the real source, but a `;` or a word inside a string or a comment can no
 * longer be mistaken for one that matters structurally. */
function mask(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const j = skipJava(source, i);
    if (j > i) { out += " ".repeat(j - i); i = j; continue; }
    out += source[i];
    i += 1;
  }
  return out;
}

/** A Java string literal decoded, or null when the text is not one whole literal: the caller's own gap, never a
 * guess at what a variable, a method call or a concatenation would have printed. */
export function literalString(raw) {
  const t = String(raw ?? "").trim();
  if (!/^"(?:[^"\\]|\\.)*"$/.test(t)) return null;
  return t.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e) => {
    if (e[0] === "u") return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "0": "\0" }[e] ?? e;
  });
}

/** An argument list's items split at the top level, brackets and Java strings kept whole; kept as its own copy
 * because splitCommas in dsp-ir/text.js treats a backtick as a quote and Java has none. */
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const j = skipJava(text, i);
    if (j > i) { i = j - 1; continue; }
    const c = text[i];
    if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

/** The variable a construction beginning at `newIndex` in `masked` was assigned to: the text back to the nearest
 * preceding `;`, `{` or `}` (Java's own statement separators, string and comment content already blanked away),
 * read as either `Type name =` (a local declaration) or plain `name =` (an already declared field), or null when
 * the segment is not an assignment at all, a bare statement or an argument passed straight into another call. */
function assignedVariable(masked, newIndex) {
  let start = newIndex - 1;
  while (start >= 0 && !";{}".includes(masked[start])) start -= 1;
  const prefix = masked.slice(start + 1, newIndex);
  const m = /^\s*(?:[\w$.[\]<>]+\s+)*([A-Za-z_$][\w$]*)\s*=\s*$/.exec(prefix);
  return m ? m[1] : null;
}

/** Every `.methodName(` call in `masked` whose receiver is exactly `variable`, each with its argument text taken
 * from `source` (the real text, quotes and all) through matchBracket. Used for both a button's own
 * addActionListener wiring and its optional setText caption, so a call reference resolves the same way twice. */
function callsOn(masked, source, variable, method) {
  const re = new RegExp(`\\b${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.${method}\\s*\\(`, "g");
  const out = [];
  let m;
  while ((m = re.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(source, open);
    if (close === -1) continue;
    out.push(source.slice(open + 1, close - 1));
  }
  return out;
}

/**
 * A lambda argument's body resolved to the single bare, zero-argument method
 * call it is (`e -> handleOk()`, or the equivalent block form `e -> {
 * handleOk(); }`), or null when it is anything else: a multi-statement
 * block, a call that takes arguments, an anonymous inner class, a method
 * reference, a variable. `null` is the caller's own signal to name the
 * wiring as "not read for what it does" rather than approximate it.
 */
function lambdaCall(argText) {
  const m = /^\s*(?:\(\s*[A-Za-z_$][\w$]*\s*\)|[A-Za-z_$][\w$]*)\s*->\s*([\s\S]*)$/.exec(argText);
  if (!m) return null;
  let body = m[1].trim();
  if (body.startsWith("{")) {
    const close = matchBracket(body, 0);
    if (close !== body.length) return null; // more code follows the block: not one clean lambda body
    body = body.slice(1, close - 1).trim();
  }
  const call = /^([A-Za-z_$][\w$]*)\s*\(\s*\)\s*;?\s*$/.exec(body);
  return call ? call[1] : null;
}

/**
 * A whole `.java` file's `new ClassName(...)` constructions read in file
 * order: each with its recognised kind (or null when the class is not this
 * reader's vocabulary), the variable it was assigned to (or null), its own
 * argument text, and, for a button only, the wiring and caption calls
 * `lower.js` needs. A construction whose class is a container, layout or
 * listener support type is left out of the list entirely, the same silent
 * skip input-autoit gives ordinary control flow around its own calls.
 */
export function parseAwt(source) {
  const text = String(source ?? "");
  const masked = mask(text);
  const constructions = [];
  const problems = [];
  const re = /\bnew\s+([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(masked))) {
    const className = m[1];
    const openIndex = m.index + m[0].length - 1;
    const close = matchBracket(text, openIndex);
    if (close === -1) { problems.push(`a \`new ${className}(...)\` construction has an argument list with no closing bracket; it is skipped.`); continue; }
    const kind = KIND[className] ?? null;
    if (!kind && CONTAINER_OR_SUPPORT.has(className)) continue; // layout, container or listener plumbing: not this reader's vocabulary, no gap either
    const argsText = text.slice(openIndex + 1, close - 1);
    const variable = assignedVariable(masked, m.index);
    const entry = { className, kind, variable, args: splitArgs(argsText), index: m.index };
    if (kind === "button" && variable) {
      const setTexts = callsOn(masked, text, variable, "setText");
      entry.setTextArg = setTexts.length ? setTexts[0] : null;
      const wired = callsOn(masked, text, variable, "addActionListener");
      entry.wiring = wired.length ? wired[0] : undefined; // undefined: never referenced at all; a string (possibly unresolved): referenced once
    }
    constructions.push(entry);
  }
  return { constructions, problems, lambdaCall };
}
