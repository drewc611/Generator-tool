import { parseIndented } from "../dsp-ir/markup.js";
import { matchBracket } from "../dsp-ir/text.js";
import { HAML, railsReader } from "../input-haml/index.js";

/**
 * Slim, Haml's terser successor in the Rails world: the same tree written as
 * indentation and the same Ruby in it, with the tag's own name where Haml
 * writes %, attributes as name=value pairs after the tag or inside brackets,
 * | and ' for text, == for unescaped output, / and /! for comments, tag: for
 * an inline child, and javascript: or css: for an embedded block. Only the
 * line grammar is Slim's; the lowering, the Ruby spelled as JavaScript, the
 * layout composed around the page and the partials rendered where they are
 * asked for are the Haml reader's, so one lowering serves both dialects.
 */

const ENGINES = /^(javascript|css|coffee|markdown|ruby|sass|scss|less|erb|textile|rdoc|wiki|creole|builder|nokogiri):\s*$/;

/** A Slim tag line: tag.class#id attrs text, with = or == output, : an inline child, / a self close. */
export function parseTag(line) {
  if (!/^[a-zA-Z.#]/.test(line)) return null;
  let i = 0; let tag = "div";
  // svg:path is a tag; "li: a" is a tag and an inline child after the colon.
  const tm = /^[a-zA-Z][\w-]*(?::(?=\w)[\w-]+)?/.exec(line);
  if (tm) { tag = tm[0]; i = tm[0].length; }
  const classes = []; let id = null;
  for (;;) { const m = /^([.#])([\w-]+)/.exec(line.slice(i)); if (!m) break; if (m[1] === ".") classes.push(m[2]); else id = m[2]; i += m[0].length; }
  const entries = []; const notes = [];
  // Slim's whitespace markers stand right after the tag; they change spacing, not the tree.
  while (line[i] === "<" || line[i] === ">") i += 1;
  // Attributes in a wrapper (a=1 b=2), [..] or {..}, or bare pairs until text begins.
  const wrapper = { "(": ")", "[": "]", "{": "}" }[line[i]];
  let attrText = null;
  if (wrapper) { const e = matchBracket(line, i, { ticks: false }); if (e < 0) return null; attrText = line.slice(i + 1, e - 1); i = e; }
  // name=value pairs; inside a wrapper a bare name is a boolean (Slim renders disabled="")
  // and *name spreads a hash the port cannot see, so it is named and the pairs after it are still read.
  const readPairs = (text, wrapped) => {
    let j = 0;
    while (j < text.length) {
      const m = /^\s*([\w:@-]+)\s*=(=?)\s*/.exec(text.slice(j));
      if (!m) {
        const other = wrapped ? /^\s*(\*\S+|[\w:@-]+|\S+)/.exec(text.slice(j)) : null;
        if (!other) break;
        const token = other[1];
        if (token.startsWith("*")) notes.push(`${token} spread a hash of attributes at render time; they are not in the port.`);
        else if (/^[\w:@-]+$/.test(token)) entries.push([token, '""']);
        else notes.push(`The attribute \`${token.slice(0, 30)}\` has a shape this reader does not know; it was dropped.`);
        j += other[0].length;
        continue;
      }
      j += m[0].length;
      let end = j;
      if (text[j] === '"' || text[j] === "'") { const q = text[j]; end = j + 1; while (end < text.length && text[end] !== q) { if (text[end] === "\\") end += 1; end += 1; } end += 1; }
      else if (text[j] === "(" || text[j] === "[" || text[j] === "{") { end = matchBracket(text, j, { ticks: false }); if (end < 0) end = text.length; }
      else { while (end < text.length && !/\s/.test(text[end])) { if (text[end] === "(" || text[end] === "[") { const e = matchBracket(text, end, { ticks: false }); end = e < 0 ? text.length : e; } else end += 1; } }
      entries.push([m[1], text.slice(j, end).trim()]);
      j = end;
    }
    return j;
  };
  if (attrText !== null) readPairs(attrText, true);
  else i += readPairs(line.slice(i), false);
  // A * followed by a name spreads attributes; a lone * is text.
  const splat = /^\s*\*(\S+)/.exec(line.slice(i));
  if (splat) { notes.push(`*${splat[1]} spread a hash of attributes at render time; they are not in the port.`); i += splat[0].length; }
  let selfClose = false;
  let rest = line.slice(i);
  if (rest.startsWith("/")) { selfClose = true; rest = rest.slice(1); }
  rest = rest.replace(/^[<>]+/, "");
  let mode = "text";
  if (/^\s*==/.test(rest)) { mode = "html"; rest = rest.replace(/^\s*==[<>']*\s*/, ""); }
  else if (/^\s*=/.test(rest)) { mode = "code"; rest = rest.replace(/^\s*=[<>']*\s*/, ""); }
  else if (/^:\s/.test(rest) || rest === ":") { mode = "inline"; rest = rest.slice(1).trim(); }
  else rest = rest.replace(/^ /, "");
  return { tag, classes, id, hash: null, list: null, entries, notes, selfClose, mode, rest };
}

/** Slim's line grammar over the Haml lowering. */
export const SLIM = {
  comment: (line) => line.startsWith("/") || /^doctype\b/i.test(line),
  filter: (line) => (ENGINES.test(line) ? line.replace(/:\s*$/, "") : null),
  text: (line) => (line.startsWith("|") ? line.slice(1).replace(/^ /, "") : line.startsWith("'") ? `${line.slice(1).replace(/^ /, "")} ` : null),
  output: (line) => { const m = /^(==|=)[<>']*\s*([\s\S]*)$/.exec(line); return m ? { code: m[2], html: m[1] === "==" } : null; },
  code: (line) => (line.startsWith("-") ? line.slice(1).trim() : null),
  parseTag,
  parseTree: (source) => {
    const root = parseIndented(source, (line) => {
      const open = /^[a-zA-Z.#][\w.#:-]*\s*[({[]/.exec(line);
      if (open && matchBracket(line, open[0].length - 1, { ticks: false }) < 0) return true;
      // A Ruby line runs on after a comma or a trailing backslash, as Slim allows.
      return /^[-=]/.test(line) && /[,\\]\s*$/.test(line);
    });
    const strip = (n) => { n.line = n.line.replace(/\\\s+/g, " "); n.children.forEach(strip); };
    strip(root);
    return root;
  },
};

export default railsReader({ name: "input-slim", extension: "slim", grammar: SLIM, readBy: "slim", origin: "a Slim template", label: "Slim" });
