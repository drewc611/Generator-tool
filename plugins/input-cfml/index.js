import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { attrOf, elements, parseMarkup, stripDelimited, VOID_ELEMENTS } from "../dsp-ir/markup.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { attrSafe, matchBracket, quoteJs, readInputs, resolveTemplate, splitCommas, valueJs } from "../dsp-ir/text.js";

/**
 * ColdFusion Markup, the tag language a generation of intranets and shops
 * were written in: HTML with <cfif>, <cfloop>, <cfswitch> and <cfoutput>
 * around it, #expressions# inside a cfoutput, <cfset> and <cfparam> for
 * variables, <cfinclude> for shared markup, <cfquery> for SQL in the page,
 * <cfscript> for code, and a library of functions whose names are its own
 * (Len, UCase, ArrayLen, DateFormat, IsDefined, StructKeyExists). The tags
 * lower onto the dialect: cfif with its cfelseif and cfelse onto the chain
 * negated the way the engine evaluates it, cfloop over an array, a list, a
 * collection or a query onto ng-repeat (a list split on its delimiter, a
 * query's rows with unqualified names read as its columns and named), a
 * counted loop kept once and named, cfswitch and cfcase onto the equalities
 * they test, cfoutput onto the interpolations it turned on, cfset onto a
 * substituted alias where the value is fixed and named where it is not,
 * cfinclude onto the page it names, cfform and cfinput onto a form and its
 * inputs. Expressions are spelled as JavaScript outside strings: the word
 * operators (EQ, NEQ, GT, LT, GTE, LTE, AND, OR, NOT, MOD, IS) become their
 * signs, & becomes +, a doubled quote inside a string is the quote, a
 * function with an exact equivalent is rewritten, a formatter keeps its
 * value unformatted and is named, and an unknown function is kept and named.
 * CFML arrays are one based, so a literal index is shifted and a variable
 * index is shifted and named. A query, a cfscript block, a custom tag, a
 * cflocation and the url, form, cgi and session scopes are named as what
 * the server did or supplied, and never carried.
 */

const OPS = [
  [/\bIS\s+NOT\b/gi, "!="], [/\bNOT\s+EQUAL\b/gi, "!="], [/\bGREATER\s+THAN\s+OR\s+EQUAL\s+TO\b/gi, ">="], [/\bLESS\s+THAN\s+OR\s+EQUAL\s+TO\b/gi, "<="],
  [/\bGREATER\s+THAN\b/gi, ">"], [/\bLESS\s+THAN\b/gi, "<"], [/\bEQUAL\b/gi, "=="], [/\bIS\b/gi, "=="],
  [/\bEQ\b/gi, "=="], [/\bNEQ\b/gi, "!="], [/\bGTE\b/gi, ">="], [/\bLTE\b/gi, "<="], [/\bGE\b/gi, ">="], [/\bLE\b/gi, "<="], [/\bGT\b/gi, ">"], [/\bLT\b/gi, "<"],
  [/\bAND\b/gi, "&&"], [/\bOR\b/gi, "||"], [/\bXOR\b/gi, "!=="], [/\bNOT\b/gi, "!"], [/\bMOD\b/gi, "%"], [/\bCONTAINS\b/gi, "CONTAINS"], [/\bDOES\s+NOT\s+CONTAIN\b/gi, "NOTCONTAINS"],
];
const SCOPES = /\b(url|form|cgi|session|application|request|cookie|client|server|cfhttp|cffile)\.(\w+)/gi;
const FN = {
  len: ([x]) => `${x}.length`, arraylen: ([x]) => `${x}.length`, listlen: ([x, d]) => `${x}.split(${d ?? "','"}).length`, structcount: ([x]) => `Object.keys(${x}).length`,
  arrayisempty: ([x]) => `!${x} || !${x}.length`, structisempty: ([x]) => `!Object.keys(${x}).length`,
  ucase: ([x]) => `${x}.toUpperCase()`, lcase: ([x]) => `${x}.toLowerCase()`, trim: ([x]) => `${x}.trim()`, ltrim: ([x]) => `${x}.trimStart()`, rtrim: ([x]) => `${x}.trimEnd()`,
  isdefined: ([x]) => `${String(x).replace(/^['"]|['"]$/g, "")} != null`, structkeyexists: ([s, k]) => `${s}[${k}] != null`, isnull: ([x]) => `${x} == null`,
  arraycontains: ([a, x]) => `${a}.includes(${x})`, listcontains: ([l, x, d]) => `${l}.split(${d ?? "','"}).includes(${x})`, listfind: ([l, x, d]) => `(${l}.split(${d ?? "','"}).indexOf(${x}) + 1)`,
  find: ([a, s]) => `(${s}.indexOf(${a}) + 1)`, findnocase: ([a, s]) => `(${s}.toLowerCase().indexOf(${a}.toLowerCase()) + 1)`,
  replace: ([s, a, b, scope]) => (/all/i.test(scope ?? "") ? `${s}.split(${a}).join(${b})` : `${s}.replace(${a}, ${b})`), replacenocase: ([s, a, b]) => `${s}.replace(new RegExp(${a}, 'i'), ${b})`,
  left: ([s, n]) => `${s}.slice(0, ${n})`, right: ([s, n]) => `${s}.slice(-${n})`, mid: ([s, a, n]) => `${s}.substr(${a} - 1, ${n})`,
  val: ([x]) => `Number(${x})`, int: ([x]) => `Math.trunc(${x})`, round: ([x]) => `Math.round(${x})`, ceiling: ([x]) => `Math.ceil(${x})`, abs: ([x]) => `Math.abs(${x})`, max: ([a, b]) => `Math.max(${a}, ${b})`, min: ([a, b]) => `Math.min(${a}, ${b})`,
  listgetat: ([l, i, d]) => `${l}.split(${d ?? "','"})[${i} - 1]`, arraytolist: ([a, d]) => `${a}.join(${d ?? "','"})`, listtoarray: ([l, d]) => `${l}.split(${d ?? "','"})`,
  htmleditformat: ([x]) => x, encodeforhtml: ([x]) => x, xmlformat: ([x]) => x, urlencodedformat: ([x]) => `encodeURIComponent(${x})`, jsstringformat: ([x]) => x,
  iif: ([c, a, b]) => `(${c} ? ${a} : ${b})`, yesnoformat: ([x]) => `(${x} ? 'Yes' : 'No')`, isnumeric: ([x]) => `!isNaN(${x})`, isarray: ([x]) => `Array.isArray(${x})`,
};
const FORMATTERS = /^(dateformat|timeformat|datetimeformat|lsdateformat|numberformat|lsnumberformat|dollarformat|lscurrencyformat|decimalformat|lseurocurrencyformat|lstimeformat|now|createdate|dateadd|datediff|createodbcdate|paragraphformat|wrap|repeatstring)$/;

/** A CFML expression as JavaScript, outside strings; #x# inside a string is spliced in. */
export function cfToJs(expr, scope = freshScope()) {
  const hold = (js) => `\u0001${scope.holds.push(js) - 1}\u0002`;
  // Strings first, so a bracket or a word inside one is never an operator or a call.
  let s = String(expr).trim().replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, (p) => {
    const q = p[0];
    const body = p.slice(1, -1).split(q + q).join(q);
    if (!/#[^#]+#/.test(body)) return hold(quoteJs(body));
    const pieces = body.split(/#([^#]+)#/).map((x, j) => (j % 2 ? `(${cfToJs(x, scope)})` : x ? quoteJs(x) : null)).filter(Boolean);
    return hold(`(${pieces.join(" + ")})`);
  });
  // Functions next: their brackets hold expressions of their own.
  for (;;) {
    const m = /(?<![\w.$])([A-Za-z_]\w*)\(/.exec(s);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const end = matchBracket(s, open, { ticks: false, strings: false });
    if (end < 0) break;
    const args = splitCommas(s.slice(open + 1, end - 1), { ticks: false }).map((a) => cfToJs(a, scope));
    const name = m[1].toLowerCase();
    let rep;
    if (FN[name]) rep = FN[name](args);
    else if (FORMATTERS.test(name)) { scope.note(`${m[1]}() formatted or computed its value on the server; the value is unformatted in the port and the format is not carried.`); rep = args[0] ?? "null"; }
    else { scope.note(`${m[1]}() is a ColdFusion function this reader does not know, or one the application defined; the call was kept and the port must supply \`${m[1]}\`.`); rep = `${m[1]}(${args.join(", ")})`; }
    if ((m.index !== 0 || end !== s.length) && /\s(\|\||&&|==|!=)\s/.test(rep) && !/^\(.*\)$/.test(rep)) rep = `(${rep})`;
    s = s.slice(0, m.index) + hold(rep) + s.slice(end);
  }
  // A lone & concatenates; it is rewritten before AND becomes &&.
  let c = s.replace(/\s*(?<!&)&(?!&)\s*/g, " + ");
  for (const [re, to] of OPS) c = c.replace(re, to);
  c = c.replace(/\b(\w+)\s+CONTAINS\s+(\w+)/g, "$1.includes($2)").replace(/\b(\w+)\s+NOTCONTAINS\s+(\w+)/g, "!$1.includes($2)");
  c = c.replace(/\.recordcount\b/gi, ".length");
  c = c.replace(SCOPES, (all, sc, key) => { scope.note(`${sc.toLowerCase()}.${key} is the ${sc.toLowerCase()} scope the server supplied; the port must supply \`${sc.toLowerCase()}\` itself.`); return `${sc.toLowerCase()}.${key}`; });
  // One based arrays: a literal index shifts; a variable index shifts and is named.
  c = c.replace(/\[\s*(\d+)\s*\]/g, (mm, n) => `[${Number(n) - 1}]`);
  c = c.replace(/\[\s*([A-Za-z_]\w*)\s*\]/g, (mm, v) => { scope.note(`CFML arrays are one based; the index \`${v}\` was shifted by one for the port.`); return `[${v} - 1]`; });
  c = c.replace(/(?<![\w.$])(true|false)(?![\w$.])/gi, (w) => w.toLowerCase()).replace(/(?<![\w.$])yes(?![\w$.])/gi, "true").replace(/(?<![\w.$])no(?![\w$.])/gi, "false");
  // Inside a query loop a bare name is a column; a dotted or scoped name is a variable, the way the engine falls through.
  if (scope.row) c = c.replace(/(?<![\w.$])([A-Za-z_]\w*)(?![\w$.[]|\s*\()/g, (w) => (/^(true|false|null|undefined)$/i.test(w) || scope.known.has(w.toLowerCase()) || [...scope.aliases.keys()].some((k) => k.toLowerCase() === w.toLowerCase()) ? w : `${scope.row}.${w}`));
  c = c.replace(/\bvariables\./gi, "").replace(/\battributes\./gi, "");
  for (const [alias, js] of scope.aliases) c = c.replace(new RegExp(`(?<![\\w.$])${alias}(?![\\w$])`, "gi"), () => js);
  return c.replace(/\u0001(\d+)\u0002/g, (m, i) => scope.holds[Number(i)]);
}

export function freshScope(note = () => {}) {
  return { note, aliases: new Map(), holds: [], depth: 0, row: null, known: new Set(), output: 0, queries: new Set() };
}

/** #expr# inside text that cfoutput turned on; ## is a literal #. */
function lowerText(text, scope, always = false) {
  // A folded attribute condition evaluates whether or not a cfoutput is on.
  text = text.replace(/\u0007([\s\S]*?)\u0007/g, (m, e) => `{{ ${cfToJs(e, scope)} }}`);
  if (!scope.output && !always) return text;
  let out = ""; let i = 0;
  while (i < text.length) {
    const at = text.indexOf("#", i);
    if (at < 0) { out += text.slice(i); break; }
    if (text[at + 1] === "#") { out += text.slice(i, at) + "#"; i = at + 2; continue; }
    const end = text.indexOf("#", at + 1);
    if (end < 0) { out += text.slice(i); break; }
    out += text.slice(i, at) + `{{ ${cfToJs(text.slice(at + 1, end), scope)} }}`;
    scope.note("A cfoutput writes a value unescaped; the port escapes every interpolation, so a value that held HTML renders as text until it is bound as HTML by hand.");
    i = end + 1;
  }
  return out;
}

/** A cf tag's attribute: #expr# always evaluates; a bare value is a literal. */
function lowerAttr(value, scope) {
  const v = String(value ?? "").replace(/&quot;/g, '"');
  const m = /^\s*#([\s\S]*)#\s*$/.exec(v);
  if (m && !m[1].includes("#")) return { kind: "expr", text: cfToJs(m[1], scope) };
  const text = lowerText(v, scope, true);
  return { kind: text.includes("{{") ? "interp" : "literal", text };
}
const attr = attrOf;

/** Lower a tree onto the dialect; `resolve(path)` returns another page's text or null. */
export function lowerTree(root, scope = freshScope(), resolve = () => null, depth = 0) {
  const lowerNodes = (nodes) => nodes.map((n) => lowerNode(n)).join("");
  const lowerNode = (n) => {
    if (n.type === "text") return lowerText(n.text, scope);
    if (n.type !== "el") return "";
    if (/^cf_|^cf[a-z]/.test(n.tag)) return lowerCf(n);
    return lowerElement(n);
  };

  const lowerElement = (el) => {
    const parts = [];
    for (const a of el.attrs) {
      if (a.value === null) { parts.push(a.name); continue; }
      const text = lowerText(a.value, scope);
      const name = a.name.toLowerCase();
      if (!text.includes("{{")) { parts.push(`${a.name}="${text}"`); continue; }
      const whole = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(text);
      if (name.startsWith("ng-") && whole) { parts.push(`${a.name}="${attrSafe(whole[1])}"`); continue; }
      if (name === "href" || name === "src") { parts.push(`ng-${name}="${attrSafe(text)}"`); continue; }
      if (name === "class") { parts.push(whole ? `ng-class="${attrSafe(whole[1])}"` : `ng-attr-class="${attrSafe(text)}"`); continue; }
      if (["disabled", "checked", "selected", "readonly", "required", "hidden"].includes(name) && whole) { parts.push(`ng-${name}="${attrSafe(whole[1])}"`); continue; }
      parts.push(`ng-attr-${a.name}="${attrSafe(text)}"`);
    }
    const open = `<${el.tag}${parts.map((p) => ` ${p}`).join("")}>`;
    if (VOID_ELEMENTS.has(el.tag)) return open;
    return `${open}${lowerNodes(el.children)}</${el.tag}>`;
  };

  const test = (el) => { const raw = (attr(el, "test") ?? "").replace(/&quot;/g, '"'); return cfToJs(raw, scope); };

  const lowerCf = (el) => {
    const tag = el.tag;
    switch (tag) {
      case "cfoutput": {
        const query = attr(el, "query");
        scope.output += 1;
        let out;
        if (query) out = repeatRows(query, el);
        else out = lowerNodes(el.children);
        scope.output -= 1;
        return out;
      }
      case "cfif": {
        const tried = []; let out = "";
        const branches = []; let current = { test: test(el), children: [] };
        const buried = (nodes) => nodes.some((c) => c.type === "el" && (c.tag === "cfelse" || c.tag === "cfelseif" || (c.tag !== "cfif" && buried(c.children))));
        if (el.children.some((c) => c.type === "el" && c.tag !== "cfif" && c.tag !== "cfelse" && c.tag !== "cfelseif" && buried(c.children))) scope.note(`A <cfelse> or <cfelseif> inside an element this <cfif ${(attr(el, "test") ?? "").slice(0, 30)}> opened could not be read as a branch; both branches stand in the port and must be wired by hand.`);
        for (const c of el.children) {
          if (c.type === "el" && c.tag === "cfelseif") { branches.push(current); current = { test: test(c), children: [] }; continue; }
          if (c.type === "el" && c.tag === "cfelse") { branches.push(current); current = { test: null, children: [] }; continue; }
          current.children.push(c);
        }
        branches.push(current);
        for (const b of branches) {
          const t = b.test === null ? (tried.map((x) => `!(${x})`).join(" && ") || "true") : [...tried.map((x) => `!(${x})`), tried.length ? `(${b.test})` : b.test].join(" && ");
          if (b.test !== null) tried.push(b.test);
          scope.depth += 1; out += `<ng-container ng-if="${attrSafe(t)}">${lowerNodes(b.children)}</ng-container>`; scope.depth -= 1;
        }
        return out;
      }
      case "cfelseif": case "cfelse": return lowerNodes(el.children);
      case "cfloop": {
        const array = attr(el, "array"); const list = attr(el, "list"); const query = attr(el, "query"); const collection = attr(el, "collection"); const from = attr(el, "from");
        const index = attr(el, "index"); const item = attr(el, "item");
        if (array !== null) {
          const listJs = valueJs(lowerAttr(array, scope));
          const varName = item ?? index ?? "item";
          const withIndex = item && index;
          if (withIndex) scope.aliases.set(index, "($index + 1)");
          scope.known.add(varName.toLowerCase());
          scope.depth += 1; const body = lowerNodes(el.children); scope.depth -= 1;
          if (withIndex) scope.aliases.delete(index);
          return `<ng-container ng-repeat="${attrSafe(`${varName} in ${listJs}${withIndex ? " track by $index" : ""}`)}">${body}</ng-container>`;
        }
        if (list !== null) {
          const listJs = valueJs(lowerAttr(list, scope));
          const delim = attr(el, "delimiters") !== null ? quoteJs(attr(el, "delimiters")) : "','";
          const varName = item ?? index ?? "item";
          scope.known.add(varName.toLowerCase());
          scope.depth += 1; const body = lowerNodes(el.children); scope.depth -= 1;
          return `<ng-container ng-repeat="${attrSafe(`${varName} in ${listJs}.split(${delim})`)}">${body}</ng-container>`;
        }
        if (collection !== null) {
          const objJs = valueJs(lowerAttr(collection, scope));
          const key = item ?? index ?? "key";
          scope.known.add(key.toLowerCase());
          scope.depth += 1; const body = lowerNodes(el.children); scope.depth -= 1;
          return `<ng-container ng-repeat="${attrSafe(`(${key}, value) in ${objJs}`)}">${body}</ng-container>`;
        }
        if (query !== null) return repeatRows(query, el);
        if (from !== null) { scope.note(`<cfloop from="${from}" to="${attr(el, "to") ?? ""}"> counts a range; the port repeats over a list it must be given, and the body was kept once.`); scope.depth += 1; const body = lowerNodes(el.children); scope.depth -= 1; return `<ng-container>${body}</ng-container>`; }
        if (attr(el, "condition") !== null) { scope.note(`<cfloop condition="${attr(el, "condition")}"> loops on a condition; the port repeats over a list it must be given, and the body was kept once.`); scope.depth += 1; const body = lowerNodes(el.children); scope.depth -= 1; return `<ng-container>${body}</ng-container>`; }
        scope.note("<cfloop> in a shape this reader does not know; its body was kept once, unrepeated."); return `<ng-container>${lowerNodes(el.children)}</ng-container>`;
      }
      case "cfswitch": {
        const subject = valueJs(lowerAttr(attr(el, "expression") ?? "", scope));
        const tried = []; let out = "";
        for (const c of elements(el.children)) {
          if (c.tag === "cfcase") {
            const values = String(attr(c, "value") ?? "").split(attr(c, "delimiters") ?? ",").map((v) => v.trim()).filter(Boolean);
            const t = values.map((v) => `(${subject}) == ${/^-?\d+(\.\d+)?$/.test(v) ? v : quoteJs(v)}`).join(" || ");
            tried.push(t);
            scope.depth += 1; out += `<ng-container ng-if="${attrSafe(t)}">${lowerNodes(c.children)}</ng-container>`; scope.depth -= 1;
          } else if (c.tag === "cfdefaultcase") {
            scope.depth += 1; out += `<ng-container ng-if="${attrSafe(tried.map((x) => `!(${x})`).join(" && ") || "true")}">${lowerNodes(c.children)}</ng-container>`; scope.depth -= 1;
          }
        }
        return out;
      }
      case "cfcase": case "cfdefaultcase": return lowerNodes(el.children);
      case "cfset": {
        const code = (attr(el, "code") ?? "").replace(/&quot;/g, '"');
        const m = /^\s*(?:variables\.)?([A-Za-z_][\w.]*)\s*=\s*([\s\S]+)$/.exec(code);
        if (!m) { scope.note(`<cfset ${code.slice(0, 40)}> is an assignment this reader cannot read; the port must carry it.`); return ""; }
        const js = cfToJs(m[2], scope);
        if (scope.depth > 0 || new RegExp(`(?<![\\w.$])${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`, "i").test(js)) { scope.note(`<cfset ${m[1]}> inside a branch or loop, or reading itself, takes a value the port must carry; it was not substituted.`); return ""; }
        scope.aliases.set(m[1], /^[\w$.]+$/.test(js) || /^'[^']*'$/.test(js) || /^-?\d+(\.\d+)?$/.test(js) ? js : `(${js})`);
        return "";
      }
      case "cfparam": {
        const name = attr(el, "name"); const dflt = attr(el, "default");
        if (name && dflt !== null) { scope.note(`<cfparam name="${name}" default="${dflt}"> gave a default on the server; the port reads \`${name}\` and must default it itself.`); }
        return "";
      }
      case "cfinclude": {
        const template = attr(el, "template") ?? "";
        if (depth >= 6) return "";
        const body = resolve(template);
        if (body == null) { scope.note(`${template} is included by this page and is not in the run; the page stands without it.`); return ""; }
        return lowerTree(parseMarkup(stripStyles(stripScripts(prepare(body, scope, resolve, depth + 1)))), scope, resolve, depth + 1);
      }
      case "cfform": return `<form${el.attrs.filter((a) => !/^(format|preservedata|scriptsrc)$/i.test(a.name)).map((a) => (a.value === null ? ` ${a.name}` : ` ${a.name}="${lowerText(a.value, scope, true)}"`)).join("")}>${lowerNodes(el.children)}</form>`;
      case "cfinput": case "cftextarea": case "cfselect": {
        const htmlTag = { cfinput: "input", cftextarea: "textarea", cfselect: "select" }[tag];
        const parts = [];
        for (const a of el.attrs) {
          if (/^(validate|validateat|message|required|range|pattern|onvalidate|mask|bind|autosuggest|query|display|multiple)$/i.test(a.name) && !/^(required|multiple)$/i.test(a.name)) { scope.note(`<${tag} ${a.name}> validated or bound on the server; the port must validate itself.`); continue; }
          if (a.value === null) { parts.push(a.name); continue; }
          const text = lowerText(a.value, scope, true);
          parts.push(text.includes("{{") ? `ng-attr-${a.name}="${attrSafe(text)}"` : `${a.name}="${text}"`);
        }
        const open = `<${htmlTag}${parts.map((p) => ` ${p}`).join("")}>`;
        return htmlTag === "input" ? open : `${open}${lowerNodes(el.children)}</${htmlTag}>`;
      }
      case "cfsilent": { const was = scope.output; scope.output = 0; lowerNodes(el.children); scope.output = was; return ""; }
      case "cftry": return lowerNodes(el.children.filter((c) => !(c.type === "el" && c.tag === "cfcatch")));
      case "cfcatch": return "";
      case "cfscript": case "cfquery": case "cfstoredproc": case "cfabort": case "cfdump": case "cfheader": case "cfcontent": case "cfcookie": case "cfsetting": case "cfprocessingdirective": case "cfimport": case "cfmail": case "cffile": case "cfhttp": case "cflog": case "cfflush": case "cfcache": case "cfapplication": case "cferror": case "cfobject": case "cfinvoke": case "cfdirectory": case "cflock": case "cftransaction": case "cfexit": case "cfreturn": case "cfargument": case "cfproperty": case "cfthrow": case "cfrethrow": case "cfschedule": case "cfwddx": case "cfxml": case "cfsavecontent": case "cfassociate": case "cfsearch": case "cfindex": case "cfcollection": case "cfldap": case "cfpop": case "cfimap": case "cfftp": case "cfregistry": case "cfexecute": case "cfzip": case "cfpdf": case "cfimage": case "cfchart": case "cfspreadsheet": case "cffeed": case "cfthread": case "cfwebsocket": case "cfajaxproxy": case "cfajaximport":
        return "";
      case "cflocation": scope.note(`<cflocation url="${attr(el, "url") ?? ""}"> redirected on the server; the port must route it.`); return "";
      case "cfmodule": scope.note(`<cfmodule template="${attr(el, "template") ?? attr(el, "name") ?? ""}"> ran a custom tag on the server; the tag was removed and its content stands.`); return lowerNodes(el.children);
      default:
        if (tag.startsWith("cf_")) { scope.note(`<${tag}> is a custom tag that rendered on the server; the tag was removed and its content stands.`); return lowerNodes(el.children); }
        scope.note(`<${tag}> is a ColdFusion tag this reader does not know; the tag was removed and its content stands.`);
        return lowerNodes(el.children);
    }
  };

  /** A query's rows: cfoutput query or cfloop query repeat the body per row; unqualified names read as the row's columns. */
  const repeatRows = (query, el) => {
    const previous = scope.row;
    scope.row = null;
    const q = cfToJs(query.replace(/^#|#$/g, ""), scope);
    const row = "row";
    scope.row = row;
    scope.known.add(row);
    scope.known.add(q.toLowerCase());
    const saved = new Map([["currentRow", scope.aliases.get("currentRow")], ["recordCount", scope.aliases.get("recordCount")]]);
    scope.aliases.set("currentRow", "($index + 1)");
    scope.aliases.set("recordCount", `${q}.length`);
    if (!scope.queries.has(q)) { scope.queries.add(q); scope.note(`Inside <cfoutput query="${q}"> a bare name was read as a column of the row (\`${row}.name\`) and a dotted or scoped name as a variable, the way the engine falls through; the query itself ran on the server and the port must fetch \`${q}\`.`); }
    scope.depth += 1; const body = lowerNodes(el.children); scope.depth -= 1;
    scope.row = previous;
    for (const [k, v] of saved) { if (v === undefined) scope.aliases.delete(k); else scope.aliases.set(k, v); }
    return `<ng-container ng-repeat="${attrSafe(`${row} in ${q}`)}">${body}</ng-container>`;
  };

  return lowerNodes(root.children);
}

/** Comments, code blocks, queries and the tags whose bodies are expressions rather than attributes, before the tree is built. */
export function prepare(source, scope, resolve = () => null, depth = 0) {
  let text = String(source ?? "").replace(/\r\n/g, "\n");
  text = stripDelimited(stripDelimited(text, "<!---", "--->"), "<!--", "-->");
  text = text.replace(/<cfscript\b[^>]*>[\s\S]*?<\/cfscript\s*>/gi, () => { scope.note("A <cfscript> block ran code in the page; it was not carried and its values are not in the port."); return ""; });
  text = text.replace(/<cfquery\b([^>]*)>[\s\S]*?<\/cfquery>/gi, (m, attrs) => { const name = /name\s*=\s*["']([^"']+)["']/i.exec(attrs); scope.note(`<cfquery name="${name?.[1] ?? ""}"> ran SQL on the server; the SQL is not in the port and the port must fetch \`${name?.[1] ?? "the query"}\` from an endpoint.`); return ""; });
  text = text.replace(/<cfstoredproc\b[\s\S]*?<\/cfstoredproc>/gi, "");
  // <cfif EXPR> and <cfset a = b> hold an expression where a tag holds attributes.
  const quoteExpr = (e) => e.replace(/"/g, "&quot;");
  // class="<cfif a>x<cfelse>y</cfif>" cannot hold an element; it is the ternary it means, as an expression the attribute evaluates.
  text = text.replace(/=("[^"<]*)<cfif\s+([^>]+)>([^<]*)(?:<cfelse>([^<]*))?<\/cfif>([^"]*")/gi, (m, before, t, a, b, after) => `=${before}\u0007(${t.trim()} ? ${quoteJs(a)} : ${quoteJs(b ?? "")})\u0007${after}`);
  text = text.replace(/<cfelseif\s+([\s\S]*?)>/gi, (m, expr) => `<cfelseif test="${quoteExpr(expr.trim())}"/>`);
  text = text.replace(/<cfelse\s*>/gi, "<cfelse/>");
  // <cfif X>disabled</cfif> standing where an attribute would: a bare attribute the test decides, or named.
  text = text.replace(/(<[\w:-]+(?:\s+[^\s=>/"'<]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"'<]+))?)*)\s*<cfif\s+([^>]+)>\s*([^<]*?)\s*<\/cfif>/gi, (m, head, t, body) => {
    if (/^[\w-]+$/.test(body)) return `${head} ng-${body}="\u0007(${t.trim()})\u0007"`;
    scope.note(`<cfif ${t.trim().slice(0, 40)}> stood where an attribute would and decided \`${body.slice(0, 30)}\` at render time; it is not in the port and must be wired by hand.`);
    return head;
  });
  text = text.replace(/<cfif\s+([\s\S]*?)>/gi, (m, expr) => `<cfif test="${quoteExpr(expr.trim())}">`);
  // The tags that never hold content close themselves, so the page does not nest inside them.
  text = text.replace(/<(cfparam|cfinclude|cfinput|cfsetting|cfabort|cfqueryparam|cfbreak|cfcontinue|cflocation|cfheader|cfcontent|cfcookie|cfdump|cfthrow|cfexit|cfargument|cfproperty|cfflush|cfimport|cfinvokeargument|cfprocparam|cfrethrow|cfassociate|cfobject|cflog|cfapplication|cferror)\b([^>]*?)\s*\/?>/gi, (m, tag, attrs) => `<${tag}${attrs}/>`);
  // The tags that may stand alone or hold children close themselves where the page never closes them.
  for (const tag of ["cffile", "cfhttp", "cfdirectory", "cfimage", "cfschedule", "cfsearch", "cfindex", "cfldap", "cfpop", "cfregistry", "cfexecute", "cfwddx", "cffeed", "cfspreadsheet", "cfzip", "cfpdf", "cfajaximport", "cfajaxproxy", "cfcollection", "cfimap", "cfftp", "cfinvoke", "cfmail", "cfchart", "cfsavecontent", "cflock", "cftransaction", "cfstoredproc", "cfxml", "cfthread"]) {
    if (!new RegExp(`</${tag}\\s*>`, "i").test(text)) text = text.replace(new RegExp(`<${tag}\\b([^>]*?)\\s*/?>`, "gi"), (m, attrs) => `<${tag}${attrs}/>`);
  }
  text = text.replace(/<cfset\s+([\s\S]*?)>/gi, (m, code) => `<cfset code="${quoteExpr(code.trim())}"/>`);
  text = text.replace(/<cfreturn\b[^>]*>/gi, "");
  return text;
}

const isCfml = (text) => /<cf(?:output|if|loop|set|include|switch|param|query|form)\b/i.test(text);

export default {
  name: "input-cfml",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.cfml?$/i.test(f.rel));
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      if (![...bodies.values()].some(isCfml)) return log.debug("no ColdFusion pages");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bare = (name) => String(name).replace(/^(\.\.?\/)+/, "").replace(/^\//, "").replace(/\.cfml?$/i, "");
      const keys = [...bodies.keys()];
      const resolve = (name) => { const k = resolveTemplate(keys, name, bare); return k ? bodies.get(k) : null; };
      let count = 0;
      for (const [key, text] of bodies) {
        if (!isCfml(text)) continue;
        if (/(^|\/)(Application|OnRequestEnd|OnRequest)\.cfml?$/i.test(key)) { note(`${key} is the application's own file, run around every request; it is not a screen and was not ported.`); continue; }
        const file = files.find((f) => f.rel.replace(/^\.\//, "") === key);
        const scope = freshScope(note);
        let template = lowerTree(parseMarkup(stripStyles(stripScripts(prepare(text, scope, resolve)))), scope, resolve);
        const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(template);
        if (body) template = body[1];
        template = template.trim();
        if (!template) continue;
        const selector = (bare(key) || "page").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file?.rel ?? key,
          inputs: readInputs(template),
          outputs: [],
          template,
          templateOrigin: "a ColdFusion page, composed and lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "cfml",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} ColdFusion page(s) composed and lowered onto the dialect`);
    });
  },
};
