import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { attrSafe, matchBracket as matchShared, readInputs } from "../dsp-ir/text.js";

const matchBracket = (text, open) => matchShared(text, open, { ticks: false });

/**
 * Velocity, the Java template language of the early web frameworks: directives
 * that begin with a hash, references that begin with a dollar, and a page
 * composed by #parse of shared pieces or by a layout servlet that drops the
 * page into $screen_content. Each construct that shapes markup has an exact
 * spelling in the dialect and is lowered onto it: #if with its #elseif and
 * #else chain negated the way the engine evaluates it, #foreach as a loop with
 * its #else as the empty state and $foreach.count and friends as the index,
 * $ref and ${ref} and $!ref as interpolation, a reference's Java methods with
 * a JS spelling rewritten (size(), isEmpty(), get(n), equals(), the string
 * methods) and the word operators as their symbols, a held #parse inlined, a
 * macro defined in the file expanded at its call with its arguments
 * substituted and named, and a layout carrying $screen_content composed around
 * each page.
 *
 * #set, #define, #evaluate, #include of a file the run does not hold, a range
 * and a method with no JS spelling are named rather than approximated. The
 * context's top level names are the inputs, read from the expressions only.
 */

const WORD_OPS = [[/\band\b/g, "&&"], [/\bor\b/g, "||"], [/\bnot\b/g, "!"], [/\beq\b/g, "=="], [/\bne\b/g, "!="], [/\ble\b/g, "<="], [/\bge\b/g, ">="], [/\blt\b/g, "<"], [/\bgt\b/g, ">"]];

/** A Velocity expression as the JS it names, outside of strings. */
export function vtlToJs(code, note = () => {}) {
  const parts = String(code).split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
  return parts.map((part, i) => {
    // A double quoted string interpolates its references; a single quoted one is literal.
    if (i % 2) return part[0] === "'" ? part : part.replace(/\$!?\{?([\w.]+)\}?/g, (m, name) => `\${${name}}`).replace(/^"(.*)"$/s, (m, inner) => (/\$\{/.test(inner) ? "`" + inner + "`" : m));
    let out = part;
    if (/\[\s*[\w$.]+\s*\.\.\s*[\w$.]+\s*\]/.test(out)) note(`\`${part.trim().slice(0, 40)}\` is a range; the port repeats over a list it must be given.`);
    out = out
      .replace(/\$foreach\.(count|index|first|last|hasNext)\b/g, (m, f) => ({ count: "($index + 1)", index: "$index", first: "($index == 0)", last: "$last", hasNext: "$hasNext" })[f])
      .replace(/\$velocityCount\b/g, "($index + 1)")
      .replace(/\$!?\{([\w]+(?:\.[\w]+)*)\}/g, "$1")
      .replace(/\$!?(?!(?:index|last|hasNext)\b)(?=[A-Za-z_])/g, "")
      .replace(/\.size\(\)/g, ".length").replace(/\.length\(\)/g, ".length")
      .replace(/\.isEmpty\(\)/g, ".length == 0")
      .replace(/\.get\(([^()]+)\)/g, "[$1]")
      .replace(/([\w.\[\]]+)\.equals\(([^()]+)\)/g, "$1 == $2")
      .replace(/\.equalsIgnoreCase\(([^()]+)\)/g, ".toLowerCase() == ($1).toLowerCase()")
      .replace(/\.toString\(\)/g, "");
    for (const [re, to] of WORD_OPS) out = out.replace(re, to);
    if (/\$hasNext/.test(out)) note("`$foreach.hasNext` was read; the dialect's repeat has $last and $index, so it is left as written for a person.");
    return out;
  }).join("");
}


function splitCallArgs(text) {
  const out = []; let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if ((c === "," || /\s/.test(c)) && depth === 0) { if (i > start) out.push(text.slice(start, i)); start = i + 1; }
  }
  if (text.length > start) out.push(text.slice(start));
  return out;
}

/** The end index of a $reference starting at `at` (the $), or -1 when the $ is literal. */
function referenceEnd(text, at) {
  let i = at + 1;
  if (text[i] === "!") i += 1;
  if (text[i] === "{") { const e = text.indexOf("}", i); return e < 0 ? -1 : e + 1; }
  if (!/[A-Za-z_]/.test(text[i] ?? "")) return -1;
  while (/[\w]/.test(text[i] ?? "")) i += 1;
  for (;;) {
    if (text[i] === "." && /[A-Za-z_]/.test(text[i + 1] ?? "")) { i += 1; while (/[\w]/.test(text[i] ?? "")) i += 1; if (text[i] === "(") { const e = matchBracket(text, i); if (e < 0) break; i = e; } continue; }
    if (text[i] === "[") { const e = matchBracket(text, i); if (e < 0) break; i = e; continue; }
    break;
  }
  return i;
}

/** Lower a Velocity template onto the attribute dialect. resolve(name) returns a held template or null. */
export function lowerVelocity(source, note = () => {}, resolve = null, depth = 0, macros = new Map()) {
  let text = String(source ?? "").replace(/#\*[\s\S]*?\*#/g, "").replace(/^[ \t]*##.*$/gm, "").replace(/([^\\])##.*$/gm, "$1");
  // #macro(name $a $b) ... #end, defined here or in a #parse before the call,
  // shared down every expansion so a macro that calls a macro still resolves.
  const macroRe = /#macro\s*\(\s*(\w+)([^)]*)\)/g;
  for (let m = macroRe.exec(text); m; m = macroRe.exec(text)) {
    const end = blockEnd(text, m.index + m[0].length);
    if (end < 0) break;
    macros.set(m[1], { params: splitCallArgs(m[2].trim()).map((p) => p.replace(/^\$!?/, "")), body: text.slice(m.index + m[0].length, end.start) });
    text = text.slice(0, m.index) + text.slice(end.end);
    macroRe.lastIndex = m.index;
  }
  const expandMacro = (name, argText) => {
    const mac = macros.get(name);
    const args = splitCallArgs(argText);
    let body = mac.body;
    mac.params.forEach((p, i) => {
      if (args[i] === undefined) { note(`The macro \`#${name}\` was called without \`$${p}\`; the name is left as written.`); return; }
      const re = new RegExp(`\\$!?\\{?${p}\\b\\}?`, "g");
      const lit = /^(["'])([\s\S]*)\1$/.exec(args[i]);
      if (!lit) { body = body.replace(re, () => args[i]); return; }
      // A string literal argument keeps its quotes inside a directive's
      // parentheses and sheds them in the page, as Velocity renders it.
      body = body.replace(/#\w+\s*\([^)]*\)/g, (seg) => seg.replace(re, () => args[i]));
      body = body.replace(re, () => lit[2]);
    });
    note(`The macro \`#${name}(...)\` was expanded at its call site with its arguments substituted textually. Check any body text that shares a parameter's name.`);
    return body;
  };

  const out = [];
  const stack = [];
  let i = 0;
  function step(limit) {
    const hash = text.indexOf("#", i); const dollar = text.indexOf("$", i);
    let next = [hash, dollar].filter((x) => x >= 0 && x < limit).sort((a, b) => a - b)[0];
    if (next === undefined) { out.push(text.slice(i, limit)); i = limit; return; }
    if (next > 0 && text[next - 1] === "\\") { out.push(text.slice(i, next - 1) + text[next]); i = next + 1; return; }
    out.push(text.slice(i, next));
    i = next;
    if (text[i] === "$") {
      const end = referenceEnd(text, i);
      if (end < 0) { out.push("$"); i += 1; return; }
      out.push(`{{ ${vtlToJs(text.slice(i, end), note)} }}`);
      i = end;
      return;
    }
    // A directive: #name, #{name}, with an optional (argument).
    const dm = /^#\{?([A-Za-z]\w*)\}?/.exec(text.slice(i));
    if (!dm) { out.push("#"); i += 1; return; }
    const name = dm[1];
    let argText = null; let after = i + dm[0].length;
    const paren = /^\s*\(/.exec(text.slice(after));
    if (paren && !/^(end|else|break|stop)$/.test(name)) { const e = matchBracket(text, after + paren[0].length - 1); if (e < 0) { note(`#${name}( never closes; the rest of the file was kept as text.`); out.push(text.slice(i, limit)); i = limit; return; } argText = text.slice(after + paren[0].length, e - 1); after = e; }
    i = after;
    switch (name) {
      case "if": { const t = vtlToJs(argText ?? "true", note); out.push(`<ng-container ng-if="${attrSafe(t)}">`); stack.push({ kind: "if", tried: [t] }); return; }
      case "elseif": case "else": {
        const frame = stack.at(-1);
        if (frame?.kind === "if") {
          const nots = frame.tried.map((c) => `!(${c})`);
          const own = name === "elseif" ? vtlToJs(argText ?? "true", note) : null;
          const t = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
          if (own) frame.tried.push(own);
          out.push(`</ng-container><ng-container ng-if="${attrSafe(t)}">`);
        } else if (frame?.kind === "foreach" && name === "else") {
          out.push(`</ng-container><ng-container ng-if="!${attrSafe(frame.list)} || !${attrSafe(frame.list)}.length">`);
          frame.kind = "if"; frame.tried = [];
        }
        return;
      }
      case "foreach": {
        const fm = /^\s*\$!?\{?(\w+)\}?\s+in\s+([\s\S]+)$/.exec(argText ?? "");
        if (fm) { const list = vtlToJs(fm[2].trim(), note); out.push(`<ng-container ng-repeat="${attrSafe(`${fm[1]} in ${list}`)}">`); stack.push({ kind: "foreach", list }); }
        else { note(`#foreach(${(argText ?? "").slice(0, 40)}) has a shape this reader does not know; its body was kept once, unrepeated.`); out.push("<ng-container>"); stack.push({ kind: "plain" }); }
        return;
      }
      case "end": { if (stack.length) { stack.pop(); out.push("</ng-container>"); } return; }
      case "break": case "stop": return;
      case "parse": {
        const nm = /^\s*["']([^"']+)["']\s*$/.exec(argText ?? "");
        const body = nm && resolve && depth < 6 ? resolve(nm[1]) : null;
        if (body == null) { note(`#parse(${(argText ?? "").trim().slice(0, 40)}) names a template this run does not hold or computes; the tag was removed and the content stands without it.`); return; }
        out.push(lowerVelocity(body, note, resolve, depth + 1, macros));
        return;
      }
      case "include": {
        const nm = /^\s*["']([^"']+)["']\s*$/.exec(argText ?? "");
        const body = nm && resolve ? resolve(nm[1]) : null;
        if (body == null) { note(`#include(${(argText ?? "").trim().slice(0, 40)}) names a file this run does not hold; the tag was removed.`); return; }
        out.push(String(body).replace(/[{}#$]/g, (c) => `&#${c.charCodeAt(0)};`));
        return;
      }
      case "set": case "define": case "evaluate": case "literal":
        note(`#${name}(${(argText ?? "").trim().slice(0, 40)}) is server side machinery with no client equivalent. It was removed and is named here so the gap is visible.`);
        if (name === "define" || name === "literal") { const e = blockEnd(text, i); if (e !== -1) i = e.end; else note(`#${name} never reaches its #end; the rest of the file was kept as text.`); }
        return;
      default:
        if (macros.has(name)) { out.push(lowerVelocity(expandMacro(name, argText ?? ""), note, resolve, depth + 1, macros)); return; }
        if (argText !== null) { note(`#${name}(...) calls a macro this run does not hold (a library or a #parse the run lacks); the call was removed.`); return; }
        // #hashtag in prose is text, as Velocity prints it.
        out.push(dm[0]);
    }
  }
  while (i < text.length) step(text.length);
  while (stack.length) { stack.pop(); out.push("</ng-container>"); }
  return out.join("");
}

/** The #end that closes a block starting at `from`, skipping nested blocks; returns { start, end } or -1. */
function blockEnd(text, from) {
  const re = /#\{?(if|foreach|macro|define|literal)\b|#\{?end\}?/g;
  re.lastIndex = from;
  let depth = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1]) depth += 1;
    else if (depth === 0) return { start: m.index, end: m.index + m[0].length };
    else depth -= 1;
  }
  return -1;
}


export default {
  name: "input-velocity",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(vm|vtl)$/i.test(f.rel));
      if (!files.length) return log.debug("no Velocity templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      const resolve = (name) => {
        const clean = String(name).replace(/^\.?\//, "");
        const key = [...bodies.keys()].find((k) => k === clean || k.endsWith(`/${clean}`)) ?? [...bodies.keys()].find((k) => k.endsWith(`/${clean.split("/").pop()}`));
        return key ? bodies.get(key) : null;
      };
      // A layout servlet drops each page into $screen_content; the file that
      // reads it is the chrome and is composed around every other page.
      const layouts = [...bodies.entries()].filter(([, t]) => /\$!?\{?screen_content\}?/.test(t));
      const layout = layouts.length === 1 ? layouts[0] : null;
      if (layouts.length > 1) note(`${layouts.length} templates read $screen_content; with more than one layout this reader composes none and ports each page bare.`);

      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const raw = bodies.get(rel) ?? "";
        if (!raw.trim()) continue;
        if (layout && rel === layout[0]) { note(`${rel} is the layout every page is dropped into; it is composed around each of them rather than ported as a screen of its own.`); continue; }
        const composed = layout ? layout[1].replace(/\$!?\{?screen_content\}?/g, () => raw) : raw;
        let template = lowerVelocity(composed, note, resolve);
        const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(template);
        if (body) template = body[1];
        template = template.trim();
        if (!template) continue;
        const selector = rel.replace(/\.(vm|vtl)$/i, "").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          composed: layout ? [layout[0]] : [],
          inputs: readInputs(template),
          outputs: [],
          template,
          templateOrigin: layout ? "a Velocity template, lowered inside its layout" : "a Velocity template, lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "velocity",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Velocity template(s) lowered onto the dialect`);
    });
  },
};
