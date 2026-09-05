import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";

/**
 * FreeMarker, the template language Spring MVC shipped with for a decade:
 * directives as tags with a hash, <#if>, <#list>, <#switch>, <#include>,
 * <#macro> and <@call/>, interpolations as ${expr} with a language of its own
 * for defaults (x!"none"), existence (x??) and built ins (x?size,
 * x?upper_case). Each construct that shapes markup has an exact spelling in
 * the dialect and is lowered onto it: <#if> with its <#elseif> and <#else>
 * chain negated the way the engine evaluates it, <#list> as a loop with its
 * <#else> as the empty state and the key value form kept, <#switch> and
 * <#case> as the equalities they test, ${expr} as interpolation with the
 * defaults, existence tests and built ins that have a JS spelling rewritten,
 * a held <#include> inlined, and a macro defined in the file expanded at its
 * call with its arguments substituted and named.
 *
 * <#assign>, <#import>, <#function>, <#attempt>, a range, a built in with no
 * JS spelling and a macro the run does not hold are named rather than
 * approximated. The data model is the one input, read through the names the
 * template uses at the top level.
 */

const GLOBALS_SKIP = new Set(["true", "false", "null", "undefined"]);

/** A FreeMarker expression as the JS it names, outside of strings. */
export function fmToJs(code, note = () => {}) {
  const parts = String(code).split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
  // x!"none": the default is the string part that follows the code part, so the
  // two are joined here, and a ! inside a string stays the prose it is.
  for (let i = 0; i < parts.length; i += 2) {
    const tail = /([\w.\[\]()]+)!\s*$/.exec(parts[i]);
    if (tail && parts[i + 1] !== undefined) { parts[i] = parts[i].slice(0, tail.index) + `(${tail[1]} || ${parts[i + 1]})`; parts[i + 1] = ""; }
  }
  return parts.map((part, i) => {
    if (i % 2) return part;
    let out = part
      .replace(/([\w.\[\]()]+)!\s*([\w.]+)/g, "($1 || $2)")
      .replace(/([\w.\[\]()]+)!(?=\s*[}\s)]|$)/g, "($1 || '')");
    if (/\d+\.\.\d*|\.\.</.test(out)) note(`\`${part.trim().slice(0, 40)}\` is a range; the port repeats over a list it must be given.`);
    out = out
      .replace(/([\w.\[\]()]+)\?\?/g, "($1 != null)")
      .replace(/\?(?:size|length)\b/g, ".length")
      .replace(/\?upper_case\b/g, ".toUpperCase()")
      .replace(/\?lower_case\b/g, ".toLowerCase()")
      .replace(/\?trim\b/g, ".trim()")
      .replace(/\?first\b/g, "[0]")
      .replace(/\?last\b/g, ".at(-1)")
      .replace(/\?join\(/g, ".join(")
      .replace(/\?has_content\b/g, "?.length")
      .replace(/\?(?:string|html|js_string|json_string|xhtml|no_esc|c)\b(?:\([^)]*\))?/g, "")
      .replace(/\bgte\b/g, ">=").replace(/\blte\b/g, "<=").replace(/\bgt\b/g, ">").replace(/\blt\b/g, "<");
    for (const m of out.matchAll(/\?([a-z_]+)/g)) note(`The built in \`?${m[1]}\` has no JS spelling this reader knows; it is left as written for a person.`);
    return out;
  }).join("");
}

const q = (s) => String(s).replace(/"/g, "'");
const attrSafe = q;

function matchBrace(text, open) {
  let depth = 0; let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return i + 1; }
  }
  return -1;
}

function splitArgs(text) {
  const out = []; let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (/\s/.test(c) && depth === 0) { if (i > start) out.push(text.slice(start, i)); start = i + 1; }
  }
  if (text.length > start) out.push(text.slice(start));
  return out;
}

/** Lower a FreeMarker template onto the attribute dialect. resolve(name) returns a held include or null. */
export function lowerFreemarker(source, note = () => {}, resolve = null, depth = 0) {
  let text = String(source ?? "").replace(/<#--[\s\S]*?-->/g, "").replace(/<#ftl\b[^>]*>/g, "");

  // Macros defined here expand at their calls, arguments substituted textually.
  const macros = new Map();
  text = text.replace(/<#macro\s+(\w+)([^>]*)>([\s\S]*?)<\/#macro>/g, (m, name, params, body) => {
    const spec = splitArgs(params.trim()).map((p) => { const [k, v] = p.split("="); return { name: k.trim(), fallback: v?.trim() }; });
    macros.set(name, { spec, body });
    return "";
  });
  const expandMacro = (name, argText, nested) => {
    const mac = macros.get(name);
    if (!mac) { note(`<@${name}> calls a macro this run does not hold (an import, or a library); the call was removed.`); return ""; }
    const given = new Map(splitArgs(argText.trim()).map((a) => { const i = a.indexOf("="); return i < 0 ? [a, "true"] : [a.slice(0, i).trim(), a.slice(i + 1).trim()]; }));
    let body = mac.body;
    for (const p of mac.spec) {
      const value = given.get(p.name) ?? p.fallback;
      if (value === undefined) { note(`The macro \`${name}\` was called without \`${p.name}\` and it has no default; the name is left as written.`); continue; }
      body = body.replace(new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), () => value);
    }
    body = body.replace(/<#nested\s*\/?>/g, () => nested ?? "");
    note(`The macro \`<@${name}>\` was expanded at its call site with its arguments substituted textually. Check any body text that shares a parameter's name.`);
    return body;
  };
  text = text.replace(/<@(\w+)([^>]*?)\/>/g, (m, name, args) => expandMacro(name, args, null));
  text = text.replace(/<@(\w+)((?:[^>/]|\/(?!>))*?)>([\s\S]*?)<\/@\1>/g, (m, name, args, inner) => expandMacro(name, args, inner));

  if (resolve && depth < 6) {
    text = text.replace(/<#include\s+["']([^"']+)["'][^>]*>/g, (m, name) => {
      const body = resolve(name);
      if (body == null) { note(`<#include "${name}"> names a template this run does not hold; the tag was removed and the content stands without it.`); return ""; }
      return lowerFreemarker(body, note, resolve, depth + 1);
    });
  }

  const out = [];
  const stack = [];
  // A directive's parameters may carry > inside parentheses or a string, so the
  // tag ends at the first > outside both, not the first > there is.
  const tagEnd = (from) => {
    let depth = 0; let quote = null;
    for (let i = from; i < text.length; i += 1) {
      const c = text[i];
      if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(" || c === "[" || c === "{") depth += 1;
      else if (c === ")" || c === "]" || c === "}") depth -= 1;
      else if (c === ">" && depth <= 0) return i;
    }
    return -1;
  };
  const tokens = [];
  const re = /<#(\w+)|<\/#(\w+)\s*>|\$\{|#\{/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      const end = tagEnd(m.index + m[0].length);
      if (end < 0) { note(`<#${m[1]} never closes; the rest of the file was kept as text.`); break; }
      const params = text.slice(m.index + m[0].length, end).replace(/\/\s*$/, "");
      tokens.push({ start: m.index, end: end + 1, open: m[1], params });
      re.lastIndex = end + 1;
    } else if (m[2] !== undefined) {
      tokens.push({ start: m.index, end: m.index + m[0].length, close: m[2] });
    } else {
      const end = matchBrace(text, m.index + m[0].length - 1);
      if (end < 0) { note("An interpolation never closes; the rest of the file was kept as text."); break; }
      tokens.push({ start: m.index, end, expr: text.slice(m.index + 2, end - 1) });
      re.lastIndex = end;
    }
  }
  let last = 0;
  for (const tk of tokens) {
    out.push(text.slice(last, tk.start));
    last = tk.end;
    if (tk.expr !== undefined) { out.push(`{{ ${fmToJs(tk.expr.trim(), note)} }}`); continue; }
    if (tk.close !== undefined) {
      const tag = tk.close;
      const frame = stack.at(-1);
      if (tag === "if" || tag === "list" || tag === "items" || tag === "compress" || tag === "escape" || tag === "noescape" || tag === "attempt" || tag === "outputformat" || tag === "autoesc" || tag === "noautoesc") {
        if (!frame) continue;
        stack.pop();
        if (frame.kind === "listOuter") continue;
        if (frame.kind === "switch") { if (frame.open) out.push("</ng-container>"); continue; }
        if (frame.kind === "plain") { out.push("</ng-container>"); continue; }
        out.push("</ng-container>");
      } else if (tag === "switch") {
        const f = stack.pop(); if (f?.open) out.push("</ng-container>");
      }
      continue;
    }
    const tag = tk.open; const rest = tk.params.trim();
    switch (tag) {
      case "if": { const t = fmToJs(rest, note); out.push(`<ng-container ng-if="${attrSafe(t)}">`); stack.push({ kind: "if", tried: [t] }); break; }
      case "elseif": case "else": {
        const frame = stack.at(-1);
        if (frame?.kind === "if") {
          const nots = frame.tried.map((c) => `!(${c})`);
          const own = tag === "elseif" ? fmToJs(rest, note) : null;
          const t = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
          if (own) frame.tried.push(own);
          out.push(`</ng-container><ng-container ng-if="${attrSafe(t)}">`);
        } else if ((frame?.kind === "list" || frame?.kind === "listOuter") && tag === "else") {
          if (frame.kind === "list") out.push("</ng-container>");
          out.push(`<ng-container ng-if="!${attrSafe(frame.list)} || !${attrSafe(frame.list)}.length">`);
          frame.kind = "if"; frame.tried = [];
        }
        break;
      }
      case "list": {
        const lm = /^([\s\S]+?)\s+as\s+(\w+)(?:\s*,\s*(\w+))?$/.exec(rest);
        if (lm) {
          const list = fmToJs(lm[1], note);
          out.push(`<ng-container ng-repeat="${attrSafe(lm[3] ? `(${lm[2]}, ${lm[3]}) in ${list}` : `${lm[2]} in ${list}`)}">`);
          stack.push({ kind: "list", list });
        } else {
          // <#list seq> ... <#items as x> ... </#items> ... </#list>: the outer wraps, the items repeat.
          stack.push({ kind: "listOuter", list: fmToJs(rest, note), opened: false });
        }
        break;
      }
      case "items": {
        const frame = stack.at(-1);
        const im = /^as\s+(\w+)(?:\s*,\s*(\w+))?$/.exec(rest);
        if (frame?.kind === "listOuter" && im) {
          out.push(`<ng-container ng-repeat="${attrSafe(im[2] ? `(${im[1]}, ${im[2]}) in ${frame.list}` : `${im[1]} in ${frame.list}`)}">`);
          frame.opened = true;
          stack.push({ kind: "list", list: frame.list });
        } else { note("<#items> outside a <#list> has nothing to repeat; its body was kept once."); out.push("<ng-container>"); stack.push({ kind: "plain" }); }
        break;
      }
      case "sep": case "break": case "continue": break;
      case "switch": stack.push({ kind: "switch", subject: fmToJs(rest, note), tried: [], open: false }); break;
      case "case": {
        const frame = stack.at(-1);
        if (frame?.kind === "switch") {
          const t = `(${frame.subject}) == ${fmToJs(rest, note)}`;
          if (frame.open) out.push("</ng-container>");
          out.push(`<ng-container ng-if="${attrSafe(t)}">`); frame.tried.push(t); frame.open = true;
        }
        break;
      }
      case "default": {
        const frame = stack.at(-1);
        if (frame?.kind === "switch") { if (frame.open) out.push("</ng-container>"); out.push(`<ng-container ng-if="${attrSafe(frame.tried.map((c) => `!(${c})`).join(" && ") || "true")}">`); frame.open = true; }
        break;
      }
      case "compress": case "escape": case "noescape": case "outputformat": case "autoesc": case "noautoesc": out.push("<ng-container>"); stack.push({ kind: "plain" }); break;
      case "attempt": note("<#attempt> ran a block and recovered from its errors on the server; the block was kept once and the recovery is not in the port."); out.push("<ng-container>"); stack.push({ kind: "plain" }); break;
      case "recover": { const frame = stack.at(-1); if (frame?.kind === "plain") { out.push("</ng-container><ng-container ng-if=\"false\">"); } break; }
      case "assign": case "local": case "global": case "import": case "setting": case "function": case "return": case "stop": case "flush": case "t": case "lt": case "rt": case "nt": case "visit": case "recurse": case "nested": case "include":
        note(`<#${tag} ${rest.slice(0, 40)}> is server side machinery with no client equivalent. It was removed and is named here so the gap is visible.`);
        break;
      default: note(`A template construct could not be carried across and was removed: <#${tag} ${rest.slice(0, 40)}>.`);
    }
  }
  out.push(text.slice(last));
  while (stack.length) { const f = stack.pop(); if (f.kind === "switch") { if (f.open) out.push("</ng-container>"); } else if (!(f.kind === "listOuter" && !f.opened)) out.push("</ng-container>"); }
  return out.join("");
}

/** The data model's top level names the template reads, from its expressions only. */
export function readInputs(template) {
  const names = new Set();
  const expressions = [
    ...[...template.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]),
    ...[...template.matchAll(/\sng-[\w-]+="([^"]*)"/g)].map((m) => m[1].replace(/^\(?[\w]+(?:,\s*\w+)?\)?\s+in\s+/, "")),
  ].join("\n");
  const locals = new Set([...template.matchAll(/ng-repeat="\(?(\w+)(?:,\s*(\w+))?\)?\s+in/g)].flatMap((m) => [m[1], m[2]].filter(Boolean)));
  for (const m of expressions.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "").matchAll(/(?<![\w.$])([A-Za-z_]\w*)\b(?!\s*\()/g)) {
    if (!GLOBALS_SKIP.has(m[1]) && !locals.has(m[1]) && m[1] !== "$index") names.add(m[1]);
  }
  return [...names].sort();
}

export default {
  name: "input-freemarker",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.ftlh?$/i.test(f.rel));
      if (!files.length) return log.debug("no FreeMarker templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      const resolve = (name) => {
        const clean = String(name).replace(/^\.?\//, "");
        const key = [...bodies.keys()].find((k) => k === clean || k.endsWith(`/${clean}`)) ?? [...bodies.keys()].find((k) => k.endsWith(`/${clean.split("/").pop()}`));
        return key ? bodies.get(key) : null;
      };
      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const raw = bodies.get(rel) ?? "";
        if (!raw.trim()) continue;
        let template = lowerFreemarker(raw, note, resolve);
        const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(template);
        if (body) template = body[1];
        template = template.trim();
        if (!template) continue;
        const selector = rel.replace(/\.ftlh?$/i, "").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          inputs: readInputs(template),
          outputs: [],
          template,
          templateOrigin: "a FreeMarker template, lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "freemarker",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} FreeMarker template(s) lowered onto the dialect`);
    });
  },
};
