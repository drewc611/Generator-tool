import { matchBracket } from "../dsp-ir/text.js";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The two things this reader needs out of a UiBinder view's paired .java
 * file, both found by scanning rather than parsing Java: which `@UiHandler`
 * methods exist, so the widget tree can say which button has one wired, and
 * whether any field carries `@UiField`. Comments are blanked to spaces first,
 * the same discipline input-rc keeps for its own script (a `//` inside a
 * string is text, a quote inside a comment is not) so every offset and line
 * number survives; a handler's own body is never read, only where it starts
 * and how many lines it runs.
 */

/** Comments blanked to spaces, strings and everything else kept, so lines and offsets never shift. */
function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === "\\") j += 1; j += 1; }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      const end = nl < 0 ? text.length : nl;
      out += text.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close < 0 ? text.length : close + 2;
      out += text.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else { out += c; i += 1; }
  }
  return out;
}

const HANDLER = /@UiHandler\s*\(\s*"([^"]*)"\s*\)/g;
const METHOD_OPEN = /^[^;{}]*?\)\s*(?:throws\s+[\w.,\s]+)?\s*\{/;
const HAS_UIFIELD = /@UiField\b/;

/**
 * Every `@UiHandler("field")` matched to the method it decorates: the field
 * name, the line the annotation sits on, and the line the method's own body
 * closes on. A method the scanner cannot find (a stray annotation, a body
 * that never opens) is still named, with its own line standing in for both.
 */
export function scanJava(source) {
  const clean = stripComments(String(source ?? ""));
  const handlers = [];
  HANDLER.lastIndex = 0;
  let m;
  while ((m = HANDLER.exec(clean))) {
    const field = m[1];
    const line = lineAt(clean, m.index);
    const after = clean.slice(HANDLER.lastIndex);
    const open = METHOD_OPEN.exec(after);
    if (!open) { handlers.push({ field, line, endLine: line, lines: 1 }); continue; }
    const braceAt = HANDLER.lastIndex + open.index + open[0].length - 1;
    const close = matchBracket(clean, braceAt);
    const endLine = close < 0 ? line : lineAt(clean, close - 1);
    handlers.push({ field, line, endLine, lines: endLine - line + 1 });
  }
  return { handlers, hasUiField: HAS_UIFIELD.test(clean) };
}
