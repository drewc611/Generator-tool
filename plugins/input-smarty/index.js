import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { lowerJinja } from "../input-jinja/lower.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { matchBracket, readInputs, resolveTemplate } from "../dsp-ir/text.js";

/**
 * Smarty, the template engine of a generation of PHP applications: {$var}
 * with its |modifier chains, {if}/{elseif}/{else}/{/if}, {foreach ... as}
 * with {foreachelse}, {section}, {include file=}, {extends file=} with
 * {block name=} and its append and prepend, {assign}, {literal}, {* comments *}
 * and a library of function plugins that rendered widgets on the server. The
 * grammar is jinja's shape under different braces, so the reader rewrites the
 * Smarty spellings onto jinja's at the tag level and hands the result to the
 * jinja lowering, which already composes inheritance, inlines held includes
 * and names what it cannot carry. One lowering, three dialects, as with Twig.
 *
 * Expressions are spelled as JavaScript on the way: $var loses its sigil,
 * -> becomes a dot, $a.$b becomes a[b], the word operators (eq, ne, gt, lt,
 * ge, le, mod) become their signs, and a modifier with an exact equivalent
 * (upper, lower, count, default, cat, replace, truncate) is rewritten while
 * one that formatted a value on the server (date_format, number_format,
 * string_format) is dropped and named, leaving the value unformatted. The
 * foreach properties, $item@index and $smarty.foreach.name.index and their
 * siblings, are the arithmetic on $index every target already carries. A
 * function plugin ({html_options}, {cycle}, {math}) rendered on the server
 * and is named, never approximated; {php} is named and never carried; the
 * $smarty.get, .post, .session and .server reads are context the port must
 * supply itself, and are named as such.
 */

const WORD_OPS = { eq: "==", ne: "!=", neq: "!=", gt: ">", lt: "<", gte: ">=", ge: ">=", lte: "<=", le: "<=", mod: "%" };
const BLOCK_FUNCTIONS = new Set(["strip", "nocache", "capture", "php", "literal", "textformat", "block", "if", "foreach", "section", "while", "for", "function", "setfilter"]);

const unquote = (s) => String(s).trim().replace(/^(['"])([\s\S]*)\1$/, "$2");

/** Splits at a character outside strings and brackets. */
function splitTop(text, ch) {
  const out = []; let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === ch && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

/** A Smarty variable reference as a JavaScript path: $a.b->c[$d] to a.b.c[d], $item@index to the loop's own. */
function variable(ref, scope) {
  let s = ref.trim();
  const at = /^\$([\w]+)@(\w+)$/.exec(s);
  if (at) return loopProperty(at[1], at[2], scope);
  const smartyForeach = /^\$smarty\.foreach\.(\w+)\.(\w+)$/.exec(s);
  if (smartyForeach) return loopProperty(scope.loopsByName.get(smartyForeach[1]) ?? null, smartyForeach[2], scope);
  const smartySection = /^\$smarty\.section\.(\w+)\.(\w+)$/.exec(s);
  if (smartySection) return loopProperty(smartySection[1], smartySection[2], scope);
  if (/^\$smarty\.block\.parent$/.test(s)) return "SUPER";
  const smartyCtx = /^\$smarty\.(get|post|request|cookies|session|server|env|const|config|now|template|version|current_dir)\b/.exec(s);
  if (smartyCtx) { scope.note(`$smarty.${smartyCtx[1]} is context the server supplied; the port must supply \`smarty.${smartyCtx[1]}\` itself.`); return s.slice(1).replace(/->/g, "."); }
  const root = /^\$([\w]+)/.exec(s)?.[1];
  if (root && scope.keyAliases.has(root) && s === `$${root}`) return scope.keyAliases.get(root);
  // {assign var=low value=5} read later as $low is the value it was given, in this template.
  if (root && scope.assigned.has(root)) { const v = scope.assigned.get(root); return s === `$${root}` ? v : `(${v})${s.slice(root.length + 1).replace(/->/g, ".")}`; }
  // $a.$b is a dynamic index, $a->b a property, $a.b a key; all are paths in JS.
  s = s.replace(/->/g, ".");
  s = s.replace(/\.\$([\w]+)/g, "[$1]");
  s = s.replace(/\.(\d+)(?![\w])/g, "[$1]");
  s = s.replace(/\[\$([\w]+)\]/g, "[$1]");
  s = s.replace(/^\$/, "");
  // Inside {section name=i loop=$items}, $items[i] is the row the loop stands on.
  for (const [name, list] of scope.sectionItems) if (s.startsWith(`${list}[${name}]`)) s = name + s.slice(list.length + name.length + 2);
  return s;
}

function loopProperty(item, prop, scope) {
  const list = item ? scope.listsByItem.get(item) : null;
  switch (prop) {
    case "index": return "$index";
    case "iteration": return "($index + 1)";
    case "first": return "($index == 0)";
    case "last": return list ? `($index == ${list}.length - 1)` : (scope.note("A loop's last flag was read where the loop's list is not known; the port must carry it."), "false");
    case "total": return list ? `${list}.length` : (scope.note("A loop's total was read where the loop's list is not known; the port must carry it."), "0");
    case "key": return "$index";
    case "show": return list ? `(${list}.length > 0)` : "true";
    default: scope.note(`The loop property @${prop} has no equivalent in the dialect; it was read as \`${prop}\`.`); return prop;
  }
}

/** A modifier chain applied to a JS expression: exact ones rewritten, formatters dropped and named. */
function applyModifiers(js, mods, scope) {
  let out = js;
  for (const raw of mods) {
    const [nameRaw, ...args] = splitTop(raw, ":");
    const name = nameRaw.trim().replace(/^@/, "");
    const a = args.map((x) => exprToJs(x.trim(), scope));
    switch (name) {
      case "upper": out = `${out}.toUpperCase()`; break;
      case "lower": out = `${out}.toLowerCase()`; break;
      case "count": out = `${out}.length`; break;
      case "default": out = `(${out} || ${a[0] ?? "''"})`; break;
      case "cat": out = `(${out} + ${a[0] ?? "''"})`; break;
      case "replace": out = `${out}.split(${a[0] ?? "''"}).join(${a[1] ?? "''"})`; break;
      case "truncate": out = `${out} | limitTo:${a[0] ?? 80}`; break;
      case "trim": out = `${out}.trim()`; break;
      case "strip": case "escape": case "nofilter": case "unescape": break;
      case "nl2br": case "strip_tags": case "wordwrap": case "indent": case "spacify": case "capitalize": case "date_format": case "number_format": case "string_format": case "regex_replace": case "json_encode": case "htmlspecialchars": case "implode": case "explode": case "count_characters": case "count_words":
        scope.note(`The modifier |${name} formatted its value on the server; the value is unformatted in the port and the format is not carried.`); break;
      default:
        scope.note(`The modifier |${name} is a Smarty plugin this reader does not know; the value is carried unmodified.`);
    }
  }
  return out;
}

/** A Smarty expression as JavaScript: variables, word operators, modifiers, outside strings. */
const MODIFIERS = String.raw`((?:\s*\|\s*@?\w+(?::(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\$?[\w.>\[\]-]+))*)*)`;
const VARIABLE = new RegExp(String.raw`\$[\w]+(?:@\w+|(?:->[\w]+|\.\$?[\w]+|\[[^\]]*\])*)` + MODIFIERS, "g");

export function exprToJs(expr, scope = freshScope()) {
  const text = String(expr).trim();
  // One pass over strings and variables, each with the modifier chain bound to it as Smarty reads it.
  const re = new RegExp(String.raw`('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")` + MODIFIERS + "|" + VARIABLE.source, "g");
  let out = ""; let last = 0; let m;
  while ((m = re.exec(text))) {
    out += operators(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) {
      const js = m[1].startsWith('"') ? m[1].replace(/^"((?:[^"\\]|\\.)*)"$/, (mm, inner) => (/\$[\w]/.test(inner) ? `"${inner.replace(/\{?\$([\w.>-]+)\}?/g, (mmm, v) => `" + ${variable(`$${v}`, scope)} + "`)}"` : mm)) : m[1];
      out += m[2] ? applyModifiers(js, splitTop(m[2], "|").slice(1), scope) : js;
    } else {
      const mods = m[3] ?? "";
      const js = variable(m[0].slice(0, m[0].length - mods.length), scope);
      out += mods ? applyModifiers(js, splitTop(mods, "|").slice(1), scope) : js;
    }
  }
  return phpFunctions(out + operators(text.slice(last)), scope);
}

const PHP = {
  isset: (a) => `${a[0]} != null`,
  empty: (a) => `!${a[0]}`,
  count: (a) => `${a[0]}.length`,
  sizeof: (a) => `${a[0]}.length`,
  strlen: (a) => `${a[0]}.length`,
  is_array: (a) => `Array.isArray(${a[0]})`,
  in_array: (a) => `${a[1]}.includes(${a[0]})`,
  strtoupper: (a) => `${a[0]}.toUpperCase()`,
  strtolower: (a) => `${a[0]}.toLowerCase()`,
  trim: (a) => `${a[0]}.trim()`,
  implode: (a) => `${a[1]}.join(${a[0]})`,
  str_replace: (a) => `${a[2]}.split(${a[0]}).join(${a[1]})`,
  is_null: (a) => `${a[0]} == null`,
  array_key_exists: (a) => `(${a[0]} in ${a[1]})`,
};

/** A PHP function called inside an expression: the ones with an exact equivalent rewritten, the rest kept and named. */
function phpFunctions(js, scope) {
  let s = js;
  const re = /(?<![\w.$])([a-z_]\w*)\(/g;
  let m;
  while ((m = re.exec(s))) {
    const end = matchBracket(s, m.index + m[0].length - 1, { ticks: false });
    if (end < 0) break;
    const args = splitTop(s.slice(m.index + m[0].length, end - 1), ",").map((x) => x.trim()).filter(Boolean);
    let rep;
    if (PHP[m[1]]) rep = PHP[m[1]](args);
    else if (/^(number_format|date|sprintf|printf|htmlspecialchars|nl2br|ucfirst|ucwords|json_encode|round|floor|ceil|substr|strip_tags|money_format|strftime)$/.test(m[1])) { scope.note(`${m[1]}() formatted its value on the server; the value is unformatted in the port and the format is not carried.`); rep = args[0] ?? "null"; }
    else { scope.note(`${m[1]}() is a PHP function the template called; the call was kept and the port must supply \`${m[1]}\`.`); continue; }
    s = s.slice(0, m.index) + rep + s.slice(end);
    re.lastIndex = m.index + rep.length;
  }
  return s;
}

/** The word operators as their signs, outside of strings and variables. */
const operators = (c) => c
  .replace(/(?<![\w.$])(eq|neq|ne|gte|ge|gt|lte|le|lt|mod)(?![\w$])/g, (w) => WORD_OPS[w])
  .replace(/(?<![\w.$])is\s+(not\s+)?even(?![\w$])/g, (mm, not) => (not ? "% 2 != 0" : "% 2 == 0"))
  .replace(/(?<![\w.$])is\s+(not\s+)?odd(?![\w$])/g, (mm, not) => (not ? "% 2 != 1" : "% 2 == 1"));

export function freshScope(note = () => {}) {
  return { note, listsByItem: new Map(), loopsByName: new Map(), keyAliases: new Map(), sectionItems: new Map(), assigned: new Map(), blocks: [], depth: 0 };
}

/** Smarty tags onto jinja's, expressions onto JavaScript. */
export function smartyToJinja(source, note = () => {}) {
  const scope = freshScope(note);
  let text = String(source ?? "").replace(/\{\*[\s\S]*?\*\}/g, "");
  // {literal} keeps its braces as text; {ldelim} and {rdelim} are a brace each.
  const brace = (s) => s.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
  text = text.replace(/\{literal\}([\s\S]*?)\{\/literal\}/g, (m, body) => brace(body));
  text = text.replace(/\{ldelim\}/g, "&#123;").replace(/\{rdelim\}/g, "&#125;");
  // Blocks that are only machinery around their content.
  text = text.replace(/\{\/?(?:strip|nocache)\}/g, "");
  text = text.replace(/\{php\}[\s\S]*?\{\/php\}/g, () => { note("A {php} block ran code inside the template; it was not carried and its output is not in the port."); return ""; });
  text = text.replace(/\{capture(?:\s+[^}]*)?\}([\s\S]*?)\{\/capture\}/g, (m, body) => { note("{capture} held its content for a later {$smarty.capture} read; the content stands where it was captured and the later read is unresolved."); return body; });

  // A foreach's item and list are remembered so @last and @total can name the list.
  const out = [];
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("{", i);
    if (at < 0) { out.push(text.slice(i)); break; }
    // A brace followed by whitespace is literal text, as Smarty 3 reads it.
    if (/\s/.test(text[at + 1] ?? " ") || text[at + 1] === undefined) { out.push(text.slice(i, at + 1)); i = at + 1; continue; }
    const end = matchBracket(text, at, { ticks: false });
    if (end < 0) { out.push(text.slice(i)); break; }
    out.push(text.slice(i, at));
    out.push(lowerTag(text.slice(at + 1, end - 1), scope, note));
    i = end;
  }
  return out.join("");
}

function lowerTag(inner, scope, note) {
  const tag = inner.trim();
  if (!tag) return "";
  // Output: {$x}, {$x|mod}, {"string"}, {$x = ...} assignment.
  if (tag.startsWith("$")) {
    const assign = /^\$([\w]+)\s*=\s*([\s\S]+)$/.exec(tag);
    if (assign && !/^==/.test(tag.slice(assign[1].length + 1).trim())) return assignment(assign[1], assign[2], scope, note);
    const js = exprToJs(tag.replace(/\s+nofilter$/, ""), scope);
    if (js === "SUPER") return "{{ super() }}";
    return `{{ ${js} }}`;
  }
  if (/^['"]/.test(tag)) return `{{ ${exprToJs(tag, scope)} }}`;
  if (tag.startsWith("/")) {
    const name = tag.slice(1).trim();
    if (name === "if") { scope.depth -= 1; return "{% endif %}"; }
    if (name === "foreach" || name === "section" || name === "for" || name === "while") { scope.depth -= 1; return "{% endfor %}"; }
    if (name === "block") return `${scope.blocks.pop() ? "{{ super() }}" : ""}{% endblock %}`;
    if (BLOCK_FUNCTIONS.has(name)) return "";
    note(`{/${name}} closes a Smarty block function this reader does not know; the tag was removed and its content stands.`);
    return "";
  }
  const m = /^([\w]+)([\s\S]*)$/.exec(tag);
  if (!m) return "";
  const [, name, restRaw] = m;
  const rest = restRaw.trim();
  switch (name) {
    case "if": scope.depth += 1; return `{% if ${exprToJs(rest, scope)} %}`;
    case "elseif": return `{% elif ${exprToJs(rest, scope)} %}`;
    case "else": return rest.startsWith("if") ? `{% elif ${exprToJs(rest.slice(2), scope)} %}` : "{% else %}";
    case "foreachelse": case "sectionelse": return "{% else %}";
    case "foreach": {
      // Smarty 3: {foreach $list as $item} or {foreach $list as $k => $v}; Smarty 2: {foreach from=$list item=x key=k name=n}.
      const modern = /^([\s\S]+?)\s+as\s+\$([\w]+)(?:\s*=>\s*\$([\w]+))?\s*$/.exec(rest);
      const attrs = attributesOf(rest);
      let list; let item; let key = null; let loopName = null;
      scope.depth += 1;
      if (modern) { list = exprToJs(modern[1], scope); item = modern[3] ?? modern[2]; key = modern[3] ? modern[2] : null; }
      else if (attrs.from && attrs.item) { list = exprToJs(attrs.from, scope); item = unquote(attrs.item); key = attrs.key ? unquote(attrs.key) : null; loopName = attrs.name ? unquote(attrs.name) : null; }
      else { note(`{foreach ${rest.slice(0, 40)}} loops in a shape this reader does not know; its body was kept once, unrepeated.`); return "{% if true %}"; }
      if (key) note(`{foreach} named its key \`$${key}\`; the port carries the item and the index, and the key is read as the index.`);
      scope.listsByItem.set(item, list);
      if (loopName) scope.loopsByName.set(loopName, item);
      if (key) scope.keyAliases.set(key, "$index");
      return `{% for ${item} in ${list} %}`;
    }
    case "section": {
      const attrs = attributesOf(rest);
      scope.depth += 1;
      if (!attrs.name || !attrs.loop) { note(`{section ${rest.slice(0, 40)}} loops in a shape this reader does not know; its body was kept once.`); return "{% if true %}"; }
      const sName = unquote(attrs.name); const list = exprToJs(attrs.loop, scope);
      scope.listsByItem.set(sName, list);
      note(`{section name=${sName}} iterates by index; each \`${list}[${sName}]\` inside it is read as the item \`${sName}\`.`);
      scope.sectionItems.set(sName, list);
      return `{% for ${sName} in ${list} %}`;
    }
    case "include": {
      const attrs = attributesOf(rest);
      const file = attrs.file ? unquote(attrs.file) : null;
      if (!file) { note(`{include ${rest.slice(0, 40)}} names no file this reader can read; the tag was removed.`); return ""; }
      const passed = Object.keys(attrs).filter((k) => !["file", "assign", "cache_lifetime", "compile_id", "cache_id", "scope", "inline", "caching"].includes(k));
      if (passed.length) note(`{include file='${file}'} passed ${passed.join(", ")} into the included template; the port reads them from the same scope.`);
      return `{% include '${file}' %}`;
    }
    case "extends": {
      const attrs = attributesOf(rest);
      const file = attrs.file ? unquote(attrs.file) : unquote(rest);
      return `{% extends '${file}' %}`;
    }
    case "block": {
      const attrs = attributesOf(rest);
      const bName = attrs.name ? unquote(attrs.name) : unquote(rest.split(/\s+/)[0]);
      // append and prepend are super() on one side or the other, which the jinja lowering composes.
      const prepend = /\bprepend\b/.test(rest);
      scope.blocks.push(prepend);
      return `{% block ${bName} %}${/\bappend\b/.test(rest) ? "{{ super() }}" : ""}`;
    }
    case "assign": {
      const attrs = attributesOf(rest);
      return assignment(unquote(attrs.var ?? "x"), attrs.value ?? "''", scope, note);
    }
    case "config_load": case "debug": case "setfilter": case "function": case "call": case "insert":
      note(`{${name}} is Smarty machinery with no client equivalent; it was removed and is named here.`);
      return "";
    case "while": case "for":
      scope.depth += 1;
      note(`{${name} ${rest.slice(0, 30)}} loops on a condition or a range; the port repeats over a list it must be given.`);
      return "{% if true %}";
    default:
      note(`{${name}} is a Smarty function plugin that rendered on the server; it was removed and the port must render its widget itself.`);
      return "";
  }
}

/** An assignment is substituted where the variable is read; one that reads itself accumulates and cannot be. */
function assignment(name, valueRaw, scope, note) {
  const js = exprToJs(valueRaw, scope);
  if (new RegExp(`(?<![\\w.$])${name}(?![\\w$])`).test(js)) {
    note(`{assign} of \`$${name}\` reads its own previous value; the accumulation is server side machinery and the port must carry it.`);
    return `{% set ${name} = ${js} %}`;
  }
  // Inside a branch or a loop the value depends on the branch taken; substituting one of them would be a guess.
  if (scope.depth > 0) {
    scope.assigned.delete(name);
    note(`{assign} of \`$${name}\` inside a branch or loop takes a value the port must carry; it was not substituted.`);
    return `{% set ${name} = ${js} %}`;
  }
  scope.assigned.set(name, js);
  return "";
}

/** name=value pairs of a Smarty tag, values kept raw. */
function attributesOf(rest) {
  const out = {};
  for (const m of rest.matchAll(/([\w]+)\s*=\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\$[\w.>@\[\]$-]+|[^\s}]+)/g)) out[m[1]] = m[2];
  return out;
}

const isSmarty = (text) => /\{(?:\$[\w]|if\s|foreach\s|include\s|extends\s|block\s|section\s|\*)/.test(text) && !/<%/.test(text);

export default {
  name: "input-smarty",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.tpl$/i.test(f.rel));
      const bodies = new Map();
      for (const f of files) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        if (isSmarty(text)) bodies.set(f.rel.replace(/^\.\//, ""), text);
      }
      if (!bodies.size) return log.debug("no Smarty templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bare = (name) => String(name).replace(/^(\.\.?\/)+/, "").replace(/^(?:templates|views)\//, "").replace(/\.tpl$/i, "");
      const keys = [...bodies.keys()];
      const resolve = (name) => { const k = resolveTemplate(keys, name, bare); return k ? smartyToJinja(bodies.get(k), note) : null; };
      const extended = new Set();
      for (const text of bodies.values()) for (const m of text.matchAll(/\{extends\s+(?:file=)?(['"])([^'"]+)\1/g)) extended.add(bare(m[2]));

      let count = 0;
      for (const [key, text] of bodies) {
        const file = files.find((f) => f.rel.replace(/^\.\//, "") === key);
        if ([...extended].some((p) => bare(key) === p || bare(key).endsWith(`/${p}`))) { note(`${key} is a layout other templates extend; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const ext = /\{extends\s+(?:file=)?(['"])([^'"]+)\1/.exec(text);
        const parentKey = ext ? resolveTemplate(keys, ext[2], bare) : null;
        const lowered = lowerJinja(smartyToJinja(text, note), note, resolve);
        const bodyMatch = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(lowered);
        const template = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : lowered)).trim();
        if (!template) continue;
        const selector = bare(key).split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-") || "page";
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file?.rel ?? key,
          composed: parentKey ? [parentKey] : [],
          inputs: readInputs(template),
          outputs: [],
          template,
          templateOrigin: "a Smarty template, lowered through jinja",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "smarty",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Smarty template(s) lowered through the jinja lowering`);
    });
  },
};
