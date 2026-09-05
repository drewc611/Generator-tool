import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { pascal } from "../dsp-ir/emit.js";
import { matchBracket, splitCommas as splitArgs } from "../dsp-ir/text.js";

/**
 * Marko, eBay's template language, writes control flow as tags and bindings
 * as bare attributes: <if(cond)>, <for|row, i| of=rows>, <div class=input.cls
 * on-click("pick", row)>, ${expr} in text. Every one of those has an exact
 * spelling in the attribute dialect the other readers target, so the template
 * is lowered onto it: the control tags become ng-container blocks with an
 * else-if chain negated the way the runtime evaluates it, a for with an index
 * param becomes track by $index with the index renamed in its body, a bare
 * attribute value becomes ng-class, ng-disabled, ng-href or ng-attr as its
 * name decides, an on-<event>(...) becomes the dialect's event with its method
 * and arguments, and $!{expr} becomes bound html. The component class in the
 * file or in component.js beside it gives the inputs (the input.x it and the
 * template read, rewritten to the input itself) and the outputs (this.emit).
 *
 * The concise indentation syntax, a dynamic <${tag}>, <include>, <await>,
 * <macro>, a spread attribute and an inline $ statement have no honest
 * equivalent here and are named rather than approximated.
 */

const VOID = new Set(["input", "img", "br", "hr", "meta", "link", "source", "track", "wbr", "area", "base", "col", "embed", "param"]);
const CONTROL = new Set(["if", "else-if", "else", "for", "while"]);
const NAMED_ONLY = new Set(["include", "await", "macro", "layout-use", "layout-put", "invoke", "import", "static", "html-comment"]);

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Marko attributes: name, name="quoted", name=expression, name(args), ...spread. */
export function scanAttrs(text) {
  const attrs = []; let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i += 1; };
  while (i < text.length) {
    ws(); if (i >= text.length) break;
    if (text.startsWith("...", i)) {
      const start = i; i += 3;
      while (i < text.length && !/\s/.test(text[i])) { if (text[i] === "(" || text[i] === "[" || text[i] === "{") i = matchBracket(text, i); else i += 1; }
      attrs.push({ name: "...", spread: text.slice(start + 3, i) }); continue;
    }
    const nm = /^[\w:.$@-]+/.exec(text.slice(i));
    if (!nm) { i += 1; continue; }
    const name = nm[0]; i += name.length;
    if (text[i] === "(") { const end = matchBracket(text, i); attrs.push({ name, args: text.slice(i + 1, end - 1) }); i = end; continue; }
    if (text[i] !== "=") { attrs.push({ name, bare: true }); continue; }
    i += 1;
    // := is Marko's two way shorthand; the binding is the expression after it.
    if (text[i] === "=") i += 1;
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i]; let j = i + 1;
      while (j < text.length && text[j] !== q) { if (text[j] === "\\") j += 1; j += 1; }
      attrs.push({ name, quoted: text.slice(i + 1, j) }); i = j + 1; continue;
    }
    const start = i;
    while (i < text.length && !/\s/.test(text[i])) { if (text[i] === "(" || text[i] === "[" || text[i] === "{") { const e = matchBracket(text, i); i = e < 0 ? text.length : e; } else if (text[i] === '"' || text[i] === "'" || text[i] === "`") { const q = text[i]; i += 1; while (i < text.length && text[i] !== q) i += 1; i += 1; } else i += 1; }
    attrs.push({ name, expr: text.slice(start, i) });
  }
  return attrs;
}

/** ${expr} becomes an interpolation and $!{expr} bound html; the braces are balanced. */
export function lowerText(text) {
  let out = ""; let i = 0;
  while (i < text.length) {
    const bang = text.startsWith("$!{", i); const plain = text.startsWith("${", i);
    if (!bang && !plain) { out += text[i]; i += 1; continue; }
    const open = i + (bang ? 2 : 1);
    const end = matchBracket(text, open);
    if (end < 0) { out += text.slice(i); break; }
    const expr = text.slice(open + 1, end - 1).trim();
    out += bang ? `<span ng-bind-html="${expr}"></span>` : `{{ ${expr} }}`;
    i = end;
  }
  return out;
}

const handlerFrom = (args) => {
  const parts = splitArgs(args);
  if (!parts.length) return "";
  const head = parts.shift();
  const method = /^(["'])(.*)\1$/.exec(head)?.[2] ?? head;
  return parts.length ? `${method}(${parts.join(", ")})` : /^[\w.$]+$/.test(method) ? `${method}($event)` : method;
};

function lowerAttrList(attrs, note) {
  const parts = [];
  for (const a of attrs) {
    if (a.name === "...") { note(`A spread attribute (...${a.spread}) cannot be read; its attributes are not in the port.`); continue; }
    if (a.name === "key" || a.name.startsWith("no-update")) continue;
    const ev = /^on-([\w-]+)$/.exec(a.name) ?? /^on([A-Z]\w*)$/.exec(a.name);
    if (ev && a.args !== undefined) { parts.push(`ng-${kebab(ev[1])}="${handlerFrom(a.args).replace(/"/g, "'")}"`); continue; }
    if (a.args !== undefined) { note(`The \`${a.name}(...)\` attribute call has no dialect equivalent; it was dropped.`); continue; }
    if (a.bare) { parts.push(a.name); continue; }
    if (a.quoted !== undefined) { parts.push(`${a.name}="${lowerText(a.quoted)}"`); continue; }
    const expr = a.expr.replace(/"/g, "'");
    if (a.name === "class") parts.push(`ng-class="${expr}"`);
    else if (a.name === "style") parts.push(`ng-style="${expr}"`);
    else if (["disabled", "checked", "selected", "readonly", "required", "open", "multiple"].includes(a.name)) parts.push(`ng-${a.name}="${expr}"`);
    else if (a.name === "href" || a.name === "src") parts.push(`ng-${a.name}="{{ ${expr} }}"`);
    else parts.push(`ng-attr-${a.name}="{{ ${expr} }}"`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

/** Strip the class, style, import and $ statements from a .marko file; returns { markup, script }. */
export function splitMarko(text, note) {
  let script = "";
  let markup = text.replace(/^\s*(?:import\s.*|static\s.*)$/gm, "");
  const cls = /(^|\n)\s*class\s*\{/.exec(markup);
  if (cls) {
    const open = markup.indexOf("{", cls.index);
    const end = matchBracket(markup, open);
    if (end > 0) { script = markup.slice(open, end); markup = markup.slice(0, cls.index) + markup.slice(end); }
  }
  markup = markup.replace(/(^|\n)\s*style(?:\.\w+)?\s*\{[\s\S]*?\n\}/g, "$1");
  // Removed until none is left, so a style block that closes inside another
  // cannot leave a fragment behind for the tag scanner to read as markup.
  for (let prev = null; prev !== markup;) { prev = markup; markup = markup.replace(/<style[\s\S]*?<\/style>/gi, ""); }
  markup = markup.replace(/^\s*\$\s+.*$/gm, () => { note("An inline `$` statement runs code while rendering; it was not carried and its values are not in the port."); return ""; });
  return { markup, script };
}

/** Lower a Marko template onto the attribute dialect. Returns { template }. */
export function lowerMarko(text, note = () => {}) {
  const { markup, script } = splitMarko(text, note);
  if (!/</.test(markup) && markup.trim()) {
    note("The template is written in Marko's concise indentation syntax, which this reader does not lower; the component is a name and its states only.");
    return { template: null, script };
  }
  let out = "";
  const stack = [];
  let pending = null;
  let i = 0;
  const closeChain = (tag) => { if (tag === "if" || tag === "else-if") pending = stack.at(-1)?.chain ?? pending; };

  while (i < markup.length) {
    if (markup.startsWith("<!--", i)) { const end = markup.indexOf("-->", i); out += markup.slice(i, end + 3); i = end + 3; continue; }
    if (markup[i] !== "<") {
      const next = markup.indexOf("<", i);
      const chunk = markup.slice(i, next < 0 ? markup.length : next);
      if (chunk.trim()) pending = null;
      out += lowerText(chunk);
      i = next < 0 ? markup.length : next;
      continue;
    }
    if (markup[i + 1] === "/") {
      const end = markup.indexOf(">", i);
      const name = markup.slice(i + 2, end).trim();
      const frame = stack.pop();
      if (CONTROL.has(name) || NAMED_ONLY.has(name)) {
        if (frame?.index) out = out.slice(0, frame.at) + out.slice(frame.at).replace(new RegExp(`\\b${frame.index}\\b`, "g"), "$index");
        out += "</ng-container>";
        if (name === "if" || name === "else-if") pending = frame?.chain ?? null;
      } else out += `</${name}>`;
      i = end + 1;
      continue;
    }
    // An opening tag: name, an optional (argument) or |params|, then attributes to the closing >.
    let j = i + 1;
    let dynamic = false;
    let name;
    if (markup.startsWith("${", j)) { const e = matchBracket(markup, j + 1); name = "ng-container"; dynamic = true; j = e; }
    else { const nm = /^[A-Za-z][\w:-]*/.exec(markup.slice(j)); name = nm[0]; j += name.length; }
    // <section.card#main> carries its class and id on the tag name.
    let shorthand = "";
    const sh = /^(?:[.#][\w-]+)+/.exec(markup.slice(j));
    if (sh) {
      const classes = [...sh[0].matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      const id = /#([\w-]+)/.exec(sh[0])?.[1];
      shorthand = `${id ? ` id="${id}"` : ""}${classes.length ? ` class="${classes.join(" ")}"` : ""}`;
      j += sh[0].length;
    }
    let argument = null; let params = null;
    if (markup[j] === "(") { const e = matchBracket(markup, j); argument = markup.slice(j + 1, e - 1).trim(); j = e; }
    if (markup[j] === "|") { const e = markup.indexOf("|", j + 1); params = markup.slice(j + 1, e).split(",").map((s) => s.trim()).filter(Boolean); j = e + 1; }
    let k = j; let depth = 0; let quote = null;
    while (k < markup.length) {
      const c = markup[k];
      if (quote) { if (c === "\\") k += 1; else if (c === quote) quote = null; k += 1; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "(" || c === "[" || c === "{") depth += 1;
      else if (c === ")" || c === "]" || c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
      k += 1;
    }
    let attrText = markup.slice(j, k);
    const selfClose = /\/\s*$/.test(attrText);
    attrText = attrText.replace(/\/\s*$/, "");
    i = k + 1;

    if (dynamic) note("A dynamic tag <${...}> renders a tag the template computes; it was lowered as a container and the tag name is not in the port.");

    if (name === "if" || name === "else-if" || name === "else") {
      const chain = name === "if" ? [] : [...(pending ?? [])];
      const test = name === "else" ? chain.map((c) => `!(${c})`).join(" && ") : [...chain.map((c) => `!(${c})`), name === "if" ? argument : `(${argument})`].join(" && ");
      chain.push(argument ?? "true");
      stack.push({ tag: name, chain, at: out.length });
      out += `<ng-container ng-if="${(test || "true").replace(/"/g, "'")}">`;
      pending = null;
      continue;
    }
    if (name === "for") {
      const attrs = scanAttrs(attrText);
      const of = attrs.find((a) => a.name === "of")?.expr; const inObj = attrs.find((a) => a.name === "in")?.expr;
      let repeat = null; let index = null;
      if (params && of) { repeat = `${params[0]} in ${of}${params[1] ? " track by $index" : ""}`; index = params[1] ?? null; }
      else if (params && inObj) repeat = `(${params[0]}, ${params[1] ?? "value"}) in ${inObj}`;
      else if (argument) { const m = /^(\w+)(?:\s*,\s*(\w+))?\s+in\s+([\s\S]+)$/.exec(argument); if (m) { repeat = `${m[1]} in ${m[3]}${m[2] ? " track by $index" : ""}`; index = m[2] ?? null; } }
      if (!repeat) note(`A <for> over a range or with a shape this reader does not know (${(attrText || argument || "").trim().slice(0, 40)}) was lowered as a plain container; its repetition is not in the port.`);
      stack.push({ tag: "for", index, at: out.length });
      out += repeat ? `<ng-container ng-repeat="${repeat.replace(/"/g, "'")}">` : "<ng-container>";
      pending = null;
      continue;
    }
    if (name === "while" || NAMED_ONLY.has(name)) {
      note(`<${name}> has no dialect equivalent; its contents were kept as a plain container and what it did is not in the port.`);
      stack.push({ tag: name, at: out.length });
      out += "<ng-container>";
      if (selfClose) { stack.pop(); out += "</ng-container>"; }
      pending = null;
      continue;
    }

    pending = null;
    const lowered = shorthand + lowerAttrList(scanAttrs(attrText), note);
    if (VOID.has(name)) { out += `<${name}${lowered}>`; continue; }
    if (selfClose) { out += `<${name}${lowered}></${name}>`; continue; }
    stack.push({ tag: name, at: out.length });
    out += `<${name}${lowered}>`;
  }
  return { template: out.replace(/\n\s*\n/g, "\n").trim(), script };
}

/** One .marko file into a screen; the class in the file or component.js beside it supplies members. */
export function readMarko(text, rel, note = () => {}, companion = "") {
  const { template: raw, script } = lowerMarko(text, note);
  const code = `${script}\n${companion}`;
  const outputs = new Set();
  for (const m of code.matchAll(/this\.emit\(\s*["']([\w-]+)["']/g)) outputs.add(m[1]);
  const inputs = new Set();
  for (const m of `${raw ?? ""}\n${code}`.matchAll(/\binput\.(\w+)/g)) inputs.add(m[1]);
  const template = raw ? raw.replace(/\binput\.(\w+)/g, "$1") : null;
  const calls = [];
  for (const m of code.matchAll(/\bfetch\(\s*(["'`])([^"'`]+)\1/g)) calls.push({ method: "GET", path: m[2], file: rel, headers: null, body: null });

  const file = basename(rel).replace(/\.marko$/i, "");
  const selector = kebab(file === "index" || file === "template" ? basename(dirname(rel)) : file);
  return {
    screen: {
      selector,
      className: pascal(selector),
      file: rel,
      inputs: [...inputs].sort(),
      outputs: [...outputs].sort(),
      template,
      templateOrigin: template ? "a Marko template, lowered" : null,
      usesNgIf: /ng-if/.test(template ?? ""),
      usesNgFor: /ng-repeat/.test(template ?? ""),
      usesTwoWay: false,
      rxjs: [],
      readBy: "marko",
    },
    calls,
  };
}

export default {
  name: "input-marko",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.marko$/i.test(f.rel));
      if (!files.length) return log.debug("no Marko templates");
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const companion = await readFile(join(dirname(file.path), "component.js"), "utf8").catch(() => "");
        const { screen, calls } = readMarko(text, file.rel, note, companion);
        if (!screen.template) ctx.unverified(`<${screen.selector}> is a Marko component whose markup could not be lowered, so only its states can be ported.`);
        ctx.screens.push(screen);
        ctx.api.calls.push(...calls);
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Marko template(s) lowered onto the dialect`);
    });
  },
};
