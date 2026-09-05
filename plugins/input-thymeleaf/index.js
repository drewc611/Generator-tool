import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { attrSafe, matchBracket, readInputs, splitCommas } from "../dsp-ir/text.js";

/**
 * Thymeleaf, the natural template of the Spring world: valid HTML whose
 * prototype text and attributes are replaced at render time by th: attributes
 * that sit beside them. That shape is the closest any server dialect comes to
 * the attribute dialect the rest of the tool reads, so the lowering is mostly
 * a renaming: th:if and th:unless onto ng-if, th:each with its status
 * variable onto ng-repeat, th:text onto an interpolation that replaces the
 * prototype text, th:utext onto bound html, th:href and th:src with their
 * link expressions onto ng-href and ng-src, th:class and th:classappend onto
 * ng-class, th:attr onto each attribute it names, th:switch and th:case onto
 * the equalities they test, th:field onto a two way model, th:block onto a
 * transparent container, and [[...]] inline output onto an interpolation.
 * The expression language's words (and, or, not, eq, gt, the Elvis ?:) are
 * spelled as JavaScript outside strings, the utility objects with an exact
 * equivalent (#lists.isEmpty, #strings.toUpperCase) are rewritten and the
 * rest are named. th:fragment with th:insert, th:replace and th:include
 * compose the way the engine composes them, parameters substituted; the
 * Layout Dialect's layout:decorate and layout:fragment compose a page into
 * its layout. A message key (#{...}) is kept as its key and named, because
 * the bundle is not in the markup; th:with aliases are substituted; a
 * th:onclick that built script from data is named, never carried.
 */

const VOID = new Set(["img", "input", "br", "hr", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);
const BOOL = new Set(["disabled", "checked", "selected", "readonly", "required", "hidden", "multiple", "open", "autofocus"]);
const LINK = new Set(["href", "src", "action", "poster", "cite", "formaction", "data"]);
const OPS = { and: "&&", or: "||", eq: "==", ne: "!=", neq: "!=", gt: ">", lt: "<", ge: ">=", le: "<=", div: "/", mod: "%" };
const CONTEXT = /#(authentication|authorization|request|session|servletContext|locale|httpServletRequest|httpSession|vars|ctx|root|execInfo|messages|uris|conversions|temporals|calendars|ids|dates|numbers)\b(?!\.\w+\()/g;
const UTIL = {
  "lists.isEmpty": ([x]) => `!${x} || !${x}.length`,
  "arrays.isEmpty": ([x]) => `!${x} || !${x}.length`,
  "sets.isEmpty": ([x]) => `!${x} || !${x}.length`,
  "maps.isEmpty": ([x]) => `!${x} || !Object.keys(${x}).length`,
  "lists.size": ([x]) => `${x}.length`,
  "arrays.length": ([x]) => `${x}.length`,
  "sets.size": ([x]) => `${x}.length`,
  "strings.length": ([x]) => `${x}.length`,
  "lists.contains": ([x, y]) => `${x}.includes(${y})`,
  "arrays.contains": ([x, y]) => `${x}.includes(${y})`,
  "strings.isEmpty": ([x]) => `!${x}`,
  "strings.toUpperCase": ([x]) => `${x}.toUpperCase()`,
  "strings.toLowerCase": ([x]) => `${x}.toLowerCase()`,
  "strings.trim": ([x]) => `${x}.trim()`,
  "strings.defaultString": ([x, d]) => `(${x} || ${d})`,
  "strings.equals": ([x, y]) => `${x} == ${y}`,
  "strings.startsWith": ([x, y]) => `${x}.startsWith(${y})`,
  "strings.endsWith": ([x, y]) => `${x}.endsWith(${y})`,
  "strings.contains": ([x, y]) => `${x}.includes(${y})`,
  "strings.listJoin": ([x, s]) => `${x}.join(${s})`,
  "strings.arrayJoin": ([x, s]) => `${x}.join(${s})`,
  "strings.substring": ([x, a, b]) => `${x}.substring(${a}${b ? `, ${b}` : ""})`,
  "strings.replace": ([x, a, b]) => `${x}.replace(${a}, ${b})`,
  "strings.concat": (args) => `(${args.join(" + ")})`,
  "objects.nullSafe": ([x, d]) => `(${x} ?? ${d})`,
  "bools.isTrue": ([x]) => `!!${x}`,
  "bools.isFalse": ([x]) => `!${x}`,
};

/** A literal as a JS string, its backslashes escaped before its quotes. */
const quote = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const simplePath = (s) => /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$/.test(s);

/** OGNL / SpEL spelled as JavaScript, outside string literals; aliases substituted. */
export function exprToJs(expr, scope = freshScope()) {
  let s = String(expr).trim();
  // Utility objects first: their brackets hold expressions of their own.
  for (;;) {
    const m = /#(\w+)\.(\w+)\(/.exec(s);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const end = matchBracket(s, open, { ticks: false });
    if (end < 0) break;
    const args = splitCommas(s.slice(open + 1, end - 1), { ticks: false }).map((a) => exprToJs(a, scope));
    const key = `${m[1]}.${m[2]}`;
    let rep;
    if (UTIL[key]) rep = UTIL[key](args);
    else if (/^(dates|calendars|temporals|numbers)\./.test(key)) { scope.note(`#${key}(...) formatted its value on the server; the value was kept unformatted and the format is not in the port.`); rep = args[0] ?? "null"; }
    else { scope.note(`#${key}(...) is a Thymeleaf utility with no dialect equivalent; the call was kept as \`${key}(...)\` and the port must supply \`${m[1]}\`.`); rep = `${key}(${args.join(", ")})`; }
    // The whole expression needs no brackets; a part of one does when it carries an operator.
    if ((m.index !== 0 || end !== s.length) && /\s(\|\||&&|==|!=|\?\?|\+|-)\s/.test(rep) && !/^\(.*\)$/.test(rep)) rep = `(${rep})`;
    s = s.slice(0, m.index) + rep + s.slice(end);
  }
  s = s.replace(CONTEXT, (all, name) => { scope.note(`#${name} is a context object the server supplied; the port must supply \`${name}\` itself.`); return name; });
  const parts = s.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
  return parts.map((p, i) => {
    if (i % 2) return p;
    let c = p.replace(/(?<![\w.$])not\s+/g, "!").replace(/(?<![\w.$])(and|or|eq|neq|ne|gt|lt|ge|le|div|mod)(?![\w$])/g, (w) => OPS[w]);
    c = c.replace(/\?:/g, "||");
    for (const [alias, js] of scope.with) c = c.replace(new RegExp(`(?<![\\w.$#])${escapeRe(alias)}(?![\\w$])(?!\\s*\\()`, "g"), () => (simplePath(js) || /^'[^']*'$/.test(js) || (js.startsWith("(") && matchBracket(js, 0, { ticks: false }) === js.length) ? js : `(${js})`));
    return c;
  }).join("");
}

/** Thymeleaf allows `cond ? 'x'` with no else; JavaScript does not. */
export function withElse(js) {
  let depth = 0; let quote = null; let question = -1; let colon = false;
  for (let i = 0; i < js.length; i += 1) {
    const c = js[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (depth === 0 && c === "?" && js[i + 1] !== "." && js[i + 1] !== ":" && js[i + 1] !== "?") question = i;
    else if (depth === 0 && c === ":" && question >= 0) colon = true;
  }
  return question >= 0 && !colon ? `${js} : ''` : js;
}

export function freshScope(note = () => {}) {
  return { note, object: null, with: new Map(), fragments: new Map(), file: null };
}
const child = (scope, more = {}) => ({ ...scope, with: new Map(scope.with), fragments: new Map(scope.fragments), ...more });

/** *{x} under th:object is object.x; without one it is ${x}. */
function selection(inner, scope) {
  const js = exprToJs(inner, scope);
  if (!scope.object) return js;
  if (simplePath(js)) return `${scope.object}.${js}`;
  // *{stock > 0 and stock < 5}: each path root inside is a field of the object.
  return js.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/).map((p, i) => (i % 2 ? p : p.replace(/(?<![\w.$])([A-Za-z_]\w*)\b(?!\s*\()/g, (w) => (/^(true|false|null|undefined)$/.test(w) || w.startsWith("$") ? w : `${scope.object}.${w}`)))).join("");
}

/** The body of a #{key} or #{key(args)} message expression: the key, the arguments named. */
function messageKey(inner, scope) {
  const m = /^\s*([\w.-]+)\s*(?:\(([\s\S]*)\))?\s*$/.exec(inner);
  scope.note("Message keys (#{...}) were kept as their keys; the port renders the key until a message bundle is wired, and no text was invented.");
  if (!m) return inner.trim();
  if (m[2] !== undefined) scope.note(`#{${m[1]}(...)} carried arguments into its message; they are not in the port.`);
  return m[1];
}

/** A standard expression's value: what it is and how it reads. */
export function lowerValue(value, scope = freshScope()) {
  const v = String(value).trim();
  const whole = (open) => v.startsWith(open) && matchBracket(v, 1, { ticks: false }) === v.length;
  if (whole("${")) return asValue(withElse(exprToJs(v.slice(2, -1), scope)));
  if (whole("*{")) return { kind: "expr", text: selection(v.slice(2, -1), scope) };
  if (whole("#{")) return { kind: "literal", text: messageKey(v.slice(2, -1), scope) };
  if (whole("@{")) return lowerLink(v.slice(2, -1), scope);
  if (whole("~{")) return { kind: "fragment", text: v.slice(2, -1).trim() };
  if (/^\|[\s\S]*\|$/.test(v)) return interp(v.slice(1, -1), scope);
  if (/^'(?:\\.|[^'\\])*'$/.test(v)) return { kind: "literal", text: v.slice(1, -1).replace(/\\'/g, "'") };
  if (/^(true|false|null|-?\d+(?:\.\d+)?)$/.test(v)) return { kind: "literal", text: v };
  // A mixed expression: 'Hello ' + ${name}, ${a} + ' of ' + ${b}.
  return asValue(withElse(exprToJs(replaceExpressions(v, scope, (r) => (r.kind === "literal" ? quote(r.text) : r.kind === "expr" ? r.text : `'${r.text}'`)), scope)));
}

/** An expression that reduced to one string literal (a substituted parameter) is that literal. */
const asValue = (js) => (/^'(?:\\.|[^'\\])*'$/.test(js) ? { kind: "literal", text: js.slice(1, -1).replace(/\\'/g, "'") } : { kind: "expr", text: js });

/** Each ${..} *{..} #{..} @{..} inside text, replaced by what a function makes of it. */
function replaceExpressions(text, scope, make) {
  let out = ""; let i = 0;
  while (i < text.length) {
    const m = /[$*#@]\{/.exec(text.slice(i));
    if (!m) { out += text.slice(i); break; }
    const at = i + m.index;
    const end = matchBracket(text, at + 1, { ticks: false });
    if (end < 0) { out += text.slice(i); break; }
    out += text.slice(i, at) + make(lowerValue(text.slice(at, end), scope));
    i = end;
  }
  return out;
}

const interp = (text, scope) => {
  let expressions = 0;
  const out = replaceExpressions(text, scope, (r) => (r.kind === "expr" ? (expressions += 1, `{{ ${r.text} }}`) : r.text));
  return { kind: expressions ? "interp" : "literal", text: out };
};

/** @{/path/{id}(id=${x},q=${y})} as the address it builds, each variable an interpolation. */
export function lowerLink(inner, scope = freshScope()) {
  let s = inner.trim();
  if (s.startsWith("~/")) s = s.slice(1);
  let params = [];
  if (s.endsWith(")") && !/\}\s*$/.test(s)) {
    let depth = 0; let open = -1;
    for (let i = s.length - 1; i >= 0; i -= 1) {
      if (s[i] === ")") depth += 1;
      else if (s[i] === "(") { depth -= 1; if (depth === 0) { open = i; break; } }
    }
    if (open > 0) { params = splitCommas(s.slice(open + 1, -1), { ticks: false }).map((p) => p.trim()).filter(Boolean); s = s.slice(0, open).trim(); }
  }
  // The path is a literal, an expression, or pieces joined by +.
  let path;
  if (/^'/.test(s) || /\+/.test(s) || /^[$*#]\{/.test(s)) {
    path = { kind: "literal", text: "" };
    for (const piece of splitPlus(s)) {
      const r = lowerValue(piece, scope);
      if (r.kind === "expr") { path.kind = "interp"; path.text += `{{ ${r.text} }}`; }
      else { if (r.kind === "interp") path.kind = "interp"; path.text += r.text; }
    }
  } else path = { kind: "literal", text: s };
  const query = [];
  for (const p of params) {
    const eq = p.indexOf("=");
    const name = (eq < 0 ? p : p.slice(0, eq)).trim();
    const r = eq < 0 ? { kind: "literal", text: "" } : lowerValue(p.slice(eq + 1), scope);
    const text = r.kind === "expr" ? `{{ ${r.text} }}` : r.text;
    if (r.kind !== "literal") path.kind = "interp";
    if (path.text.includes(`{${name}}`)) path.text = path.text.split(`{${name}}`).join(text);
    else query.push(`${name}=${text}`);
  }
  if (query.length) path.text += (path.text.includes("?") ? "&" : "?") + query.join("&");
  return path;
}

function splitPlus(text) {
  const out = []; let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;
    else if (c === "+" && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

/** Comments walked by their markers: a parser level comment goes, a prototype only comment leaves its content. */
function stripComments(text) {
  let out = ""; let i = 0;
  for (;;) {
    const at = text.indexOf("<!--", i);
    if (at < 0) { out += text.slice(i); break; }
    const end = text.indexOf("-->", at + 4);
    if (end < 0) { out += text.slice(i, at); break; }
    const body = text.slice(at + 4, end);
    out += text.slice(i, at);
    if (body.startsWith("/*/") && body.endsWith("/*/")) out += body.slice(3, -3);
    i = end + 3;
  }
  return out;
}

/** Markup into a tree of elements, text and comments, prototype only comments unwrapped. */
export function parseHtml(source) {
  const text = stripComments(String(source ?? "")).replace(/<!DOCTYPE[^>]*>/gi, "");
  const root = { type: "root", children: [] };
  const stack = [root];
  // Names and unquoted values exclude the quote characters, so the three value
  // shapes never overlap and the attribute list matches in one pass.
  const re = /<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) stack[stack.length - 1].children.push({ type: "text", text: text.slice(last, m.index) });
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const at = stack.findLastIndex((n) => n.type === "el" && n.tag === tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const tag = m[2].toLowerCase();
    const attrs = [];
    for (const a of m[3].matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) attrs.push({ name: a[1], value: a[2] ?? a[3] ?? a[4] ?? null });
    const el = { type: "el", tag, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  if (last < text.length) stack[stack.length - 1].children.push({ type: "text", text: text.slice(last) });
  return root;
}

const clone = (n) => JSON.parse(JSON.stringify(n));
const thName = (name) => { const m = /^(?:th:|data-th-)([\w-]+)$/.exec(name); return m ? m[1] : null; };
const layoutName = (name) => { const m = /^(?:layout:|data-layout-)([\w-]+)$/.exec(name); return m ? m[1] : null; };
const getTh = (el, name) => el.attrs.find((a) => thName(a.name) === name)?.value ?? null;
const hasTh = (el, name) => el.attrs.some((a) => thName(a.name) === name);
const elements = (nodes) => nodes.filter((n) => n.type === "el");

/** Every th:fragment in a tree, by name, with its parameter list. */
export function collectFragments(root) {
  const out = new Map();
  const walk = (n) => {
    if (n.type !== "el" && n.type !== "root") return;
    if (n.type === "el") {
      const f = getTh(n, "fragment");
      if (f) {
        const m = /^\s*([\w-]+)\s*(?:\(([^)]*)\))?\s*$/.exec(f);
        if (m) out.set(m[1], { params: (m[2] ?? "").split(",").map((p) => p.trim()).filter(Boolean), el: n });
      }
    }
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Selects the nodes a fragment expression names: file :: selector, ::selector, file, or an alias. */
function selectFragment(spec, scope, library, args) {
  const m = /^\s*(?:([^:\s]+)\s*)?(?:::\s*(.+?))?\s*$/.exec(spec);
  if (!m) return null;
  const file = m[1] && m[1] !== "this" ? m[1] : null;
  const selector = m[2] ?? null;
  const source = file ? library.resolve(file) : { fragments: scope.fragmentsOf, root: null, name: scope.file };
  if (!source) { scope.note(`~{${spec}} names a template this run does not hold; the host stands without it.`); return null; }
  if (!selector) {
    if (!source.root) return null;
    return { nodes: clone(source.root.children), bindings: new Map() };
  }
  const sm = /^([\w-]+)\s*(?:\(([\s\S]*)\))?$/.exec(selector.trim());
  if (!sm) {
    const idm = /^#([\w-]+)$/.exec(selector.trim());
    if (idm && source.root) {
      let hit = null;
      const find = (n) => { if (hit) return; if (n.type === "el" && n.attrs.some((a) => a.name === "id" && a.value === idm[1])) { hit = n; return; } (n.children ?? []).forEach(find); };
      find(source.root);
      if (hit) return { nodes: [clone(hit)], bindings: new Map() };
    }
    scope.note(`~{${spec}} selects with \`${selector.trim()}\`, a selector this reader does not resolve; the host stands without it.`);
    return null;
  }
  const frag = source.fragments.get(sm[1]);
  if (!frag) { scope.note(`~{${spec}} names a fragment ${file ? `${file} ` : ""}does not define; the host stands without it.`); return null; }
  const bindings = new Map();
  const given = sm[2] !== undefined ? splitCommas(sm[2], { ticks: false }).map((a) => a.trim()).filter(Boolean) : (args ?? []);
  given.forEach((arg, i) => {
    const named = /^([\w-]+)\s*=\s*([\s\S]+)$/.exec(arg);
    const key = named ? named[1] : frag.params[i];
    if (key) bindings.set(key, named ? named[2].trim() : arg);
  });
  const el = clone(frag.el);
  el.attrs = el.attrs.filter((a) => thName(a.name) !== "fragment");
  return { nodes: [el], bindings };
}

/** Lower a tree onto the dialect. `library` resolves other templates for fragments. */
export function lowerTree(root, scope = freshScope(), library = { resolve: () => null }) {
  const lowerNodes = (nodes, sc) => nodes.map((n) => lowerNode(n, sc)).join("");

  const lowerText = (text, sc) => replaceInline(text, sc);
  const replaceInline = (text, sc) => {
    let out = ""; let i = 0;
    while (i < text.length) {
      const m = /\[\[|\[\(/.exec(text.slice(i));
      if (!m) { out += text.slice(i); break; }
      const at = i + m.index;
      const close = m[0] === "[[" ? "]]" : ")]";
      const end = text.indexOf(close, at + 2);
      if (end < 0) { out += text.slice(i); break; }
      const r = lowerValue(text.slice(at + 2, end), sc);
      if (m[0] === "[[") out += text.slice(i, at) + (r.kind === "expr" ? `{{ ${r.text} }}` : r.text);
      else out += text.slice(i, at) + (r.kind === "expr" ? `<span ng-bind-html="${attrSafe(r.text)}"></span>` : r.text);
      i = end + 2;
    }
    return out;
  };

  const lowerNode = (n, sc) => {
    if (n.type === "text") return lowerText(n.text, sc);
    if (n.type === "raw") return n.text;
    if (n.type !== "el") return "";
    return lowerEl(n, sc);
  };

  const lowerEl = (input, parentScope) => {
    const el = clone(input);
    const sc = child(parentScope);
    const remove = getTh(el, "remove");
    if (remove === "all") return "";

    // Composition first: what stands here may be another template's markup.
    for (const kind of ["replace", "insert", "include"]) {
      const spec = getTh(el, kind) ?? (el.attrs.find((a) => layoutName(a.name) === kind)?.value ?? null);
      if (spec === null) continue;
      el.attrs = el.attrs.filter((a) => thName(a.name) !== kind && layoutName(a.name) !== kind);
      const r = lowerValue(spec, sc);
      let picked = null;
      if (r.kind === "fragment") picked = r.text === "" ? { nodes: [], bindings: new Map() } : selectFragment(r.text, sc, library);
      else if (r.kind === "expr" && sc.fragments.has(r.text)) picked = { nodes: clone(sc.fragments.get(r.text)), bindings: new Map() };
      else if (r.kind === "expr") { sc.note(`th:${kind}="${spec}" chose its fragment at render time; the host stands without it.`); picked = { nodes: [], bindings: new Map() }; }
      else picked = selectFragment(r.text, sc, library);
      if (!picked) picked = { nodes: [], bindings: new Map() };
      const inner = child(sc);
      for (const [param, arg] of picked.bindings) {
        const v = lowerValue(arg, sc);
        if (v.kind === "fragment") inner.fragments.set(param, v.text === "" ? [] : (selectFragment(v.text, sc, library)?.nodes ?? []));
        else if (v.kind === "expr") inner.with.set(param, v.text);
        else inner.with.set(param, quote(v.text));
      }
      if (kind === "replace") return lowerNodes(picked.nodes, inner);
      const body = kind === "include" ? picked.nodes.flatMap((p) => (p.type === "el" ? p.children : [p])) : picked.nodes;
      el.children = [{ type: "lowered", text: lowerNodes(body, inner) }];
      break;
    }

    // Iteration wraps the element; a condition on the same element applies per item.
    const each = getTh(el, "each");
    let repeat = null;
    if (each !== null) {
      const em = /^\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?:\s*([\s\S]+)$/.exec(each);
      if (!em) sc.note(`th:each="${each.slice(0, 40)}" iterates in a shape this reader does not know; its body was kept once, unrepeated.`);
      else {
        const list = lowerValue(em[3], sc);
        const listJs = list.kind === "expr" ? list.text : `'${list.text}'`;
        const stat = em[2] ?? `${em[1]}Stat`;
        const usesStat = JSON.stringify(el).includes(`${stat}.`);
        repeat = `${em[1]} in ${listJs}${usesStat ? " track by $index" : ""}`;
        // The status object's fields are arithmetic on $index, which every target already carries.
        for (const [k, v] of [["index", "$index"], ["count", "($index + 1)"], ["first", "($index == 0)"], ["last", `($index == ${listJs}.length - 1)`], ["odd", "($index % 2 == 1)"], ["even", "($index % 2 == 0)"], ["size", `${listJs}.length`], ["current", em[1]]]) sc.with.set(`${stat}.${k}`, v);
      }
      el.attrs = el.attrs.filter((a) => thName(a.name) !== "each");
    }

    // Conditions.
    const tests = [];
    const ifV = getTh(el, "if"); const unlessV = getTh(el, "unless");
    if (ifV !== null) { const r = lowerValue(ifV, sc); tests.push(r.kind === "expr" ? r.text : `'${r.text}'`); }
    if (unlessV !== null) { const r = lowerValue(unlessV, sc); tests.push(`!(${r.kind === "expr" ? r.text : `'${r.text}'`})`); }
    if (el.caseTest) tests.push(el.caseTest);
    el.attrs = el.attrs.filter((a) => !["if", "unless", "case"].includes(thName(a.name)));

    // Scope: th:object for *{} and th:with aliases.
    const object = getTh(el, "object");
    if (object !== null) { const r = lowerValue(object, sc); sc.object = r.kind === "expr" ? r.text : null; }
    const withV = getTh(el, "with");
    if (withV !== null) {
      for (const part of splitCommas(withV, { ticks: false })) {
        const wm = /^\s*([\w$]+)\s*=\s*([\s\S]+)$/.exec(part);
        if (!wm) continue;
        const r = lowerValue(wm[2], sc);
        sc.with.set(wm[1], r.kind === "expr" ? r.text : quote(r.text));
      }
    }
    el.attrs = el.attrs.filter((a) => !["object", "with", "remove", "fragment", "inline", "assert", "ref"].includes(thName(a.name)));

    // th:switch marks the children that carry th:case with the tests they mean.
    const switchV = getTh(el, "switch");
    if (switchV !== null) {
      const subject = lowerValue(switchV, sc);
      const subjectJs = subject.kind === "expr" ? subject.text : `'${subject.text}'`;
      const tried = [];
      for (const c of elements(el.children)) {
        const cv = getTh(c, "case");
        if (cv === null) continue;
        if (cv.trim() === "*") c.caseTest = tried.map((t) => `!(${t})`).join(" && ") || "true";
        else { const r = lowerValue(cv, sc); const t = `(${subjectJs}) == ${r.kind === "expr" ? r.text : `'${r.text}'`}`; tried.push(t); c.caseTest = t; }
      }
      el.attrs = el.attrs.filter((a) => thName(a.name) !== "switch");
    }

    // Attributes, then text, in the order the engine applies them.
    const plain = new Map();
    const order = [];
    for (const a of el.attrs) {
      if (thName(a.name) || layoutName(a.name) || /^xmlns:(th|layout|sec)$/.test(a.name)) continue;
      plain.set(a.name, a.value); order.push(a.name);
    }
    const derived = [];
    let content = null;
    let usesModel = false;
    const setAttr = (name, value) => { if (!plain.has(name)) order.push(name); plain.set(name, value); };
    const dropPlain = (name) => { if (plain.has(name)) { plain.delete(name); order.splice(order.indexOf(name), 1); } };
    const generic = (name, r) => {
      if (r.kind === "literal") { setAttr(name, r.text); return; }
      // The prototype's own value is what the engine replaces; it does not survive beside the binding.
      dropPlain(name);
      if (BOOL.has(name)) { if (r.kind === "expr") derived.push(`ng-${name}="${attrSafe(r.text)}"`); else derived.push(`ng-attr-${name}="${attrSafe(r.text)}"`); return; }
      if (name === "class") { if (r.kind === "expr") derived.push(`ng-class="${attrSafe(r.text)}"`); else derived.push(`ng-attr-class="${attrSafe(r.text)}"`); return; }
      if (LINK.has(name) && (name === "href" || name === "src")) { derived.push(`ng-${name}="${attrSafe(r.kind === "expr" ? `{{ ${r.text} }}` : r.text)}"`); return; }
      derived.push(`ng-attr-${name}="${attrSafe(r.kind === "expr" ? `{{ ${r.text} }}` : r.text)}"`);
    };
    for (const a of el.attrs) {
      const name = thName(a.name);
      if (!name || a.value === null) continue;
      const value = a.value;
      if (name === "text") { const r = lowerValue(value, sc); content = r.kind === "expr" ? `{{ ${r.text} }}` : r.text; continue; }
      if (name === "utext") { const r = lowerValue(value, sc); if (r.kind === "expr") { derived.push(`ng-bind-html="${attrSafe(r.text)}"`); content = ""; } else content = r.text; continue; }
      if (name === "attr" || name === "attrappend" || name === "attrprepend") {
        if (name !== "attr") sc.note(`th:${name} joined a value onto an attribute at render time; the port carries the value as the whole attribute.`);
        for (const part of splitCommas(value, { ticks: false })) {
          const eq = part.indexOf("=");
          if (eq < 0) continue;
          generic(part.slice(0, eq).trim(), lowerValue(part.slice(eq + 1), sc));
        }
        continue;
      }
      if (name === "classappend") {
        const r = lowerValue(value, sc);
        if (r.kind === "literal") { setAttr("class", `${plain.get("class") ? `${plain.get("class")} ` : ""}${r.text}`); continue; }
        const js = r.kind === "expr" ? r.text : `'${r.text}'`;
        const at = derived.findIndex((d) => d.startsWith('ng-class="'));
        if (at >= 0) derived[at] = `ng-class="${attrSafe(`(${derived[at].slice(10, -1)}) + ' ' + (${js})`)}"`;
        else derived.push(`ng-class="${attrSafe(js)}"`);
        continue;
      }
      if (name === "style" || name === "styleappend") { const r = lowerValue(value, sc); if (r.kind === "literal") setAttr("style", r.text); else { dropPlain("style"); derived.push(`ng-attr-style="${attrSafe(r.kind === "expr" ? `{{ ${r.text} }}` : r.text)}"`); } continue; }
      if (name === "field") {
        const r = lowerValue(value, sc);
        if (r.kind === "expr") { derived.push(`ng-model="${attrSafe(r.text)}"`); usesModel = true; const leaf = r.text.split(".").pop(); if (!plain.has("name")) setAttr("name", leaf); if (!plain.has("id")) setAttr("id", leaf); }
        continue;
      }
      if (name === "errors" || name === "errorclass") { sc.note(`th:${name} rendered Spring validation errors on the server; the port must carry field errors from its own validation.`); continue; }
      if (/^on\w+$/.test(name)) { sc.note(`th:${name} built inline script from data; the handler was not carried and must be wired in the port.`); continue; }
      if (name === "alt-title") { const r = lowerValue(value, sc); generic("alt", r); generic("title", r); continue; }
      if (name === "lang-xmllang") { const r = lowerValue(value, sc); generic("lang", r); continue; }
      if (["each", "if", "unless", "case", "switch", "object", "with", "remove", "fragment", "inline", "assert", "ref", "insert", "replace", "include", "block"].includes(name)) continue;
      generic(name, lowerValue(value, sc));
    }

    const tag = el.tag === "th:block" ? "ng-container" : el.tag;
    const attrText = [
      ...order.map((k) => (plain.get(k) === null ? k : `${k}="${plain.get(k)}"`)),
      ...derived,
    ];
    if (el.tag === "th:block") attrText.splice(0, order.length);
    const test = tests.length ? tests.join(" && ") : null;

    let body;
    if (content !== null) body = content;
    else if (remove === "body") body = "";
    else if (el.children.length === 1 && el.children[0].type === "lowered") body = el.children[0].text;
    else if (remove === "all-but-first") { const first = elements(el.children)[0]; body = first ? lowerNode(first, sc) : ""; }
    else body = lowerNodes(el.children, sc);

    if (remove === "tag") return body;
    if (usesModel) sc.markTwoWay?.();
    const open = (extra) => `<${tag}${[...attrText, ...extra].map((a) => ` ${a}`).join("")}>`;
    if (repeat && test) return `<ng-container ng-repeat="${attrSafe(repeat)}">${open([`ng-if="${attrSafe(test)}"`])}${body}</${tag}>` + `</ng-container>`;
    const extra = [];
    if (repeat) extra.push(`ng-repeat="${attrSafe(repeat)}"`);
    if (test) extra.push(`ng-if="${attrSafe(test)}"`);
    if (VOID.has(tag)) return open(extra);
    return `${open(extra)}${body}</${tag}>`;
  };

  return lowerNodes(root.children, scope);
}

/** Compose a page into the layout it decorates, the Layout Dialect's way. */
export function decorate(pageRoot, layoutRoot, note) {
  const own = new Map();
  const collect = (n) => { if (n.type === "el") { const f = n.attrs.find((a) => layoutName(a.name) === "fragment"); if (f) own.set(f.value, n); } (n.children ?? []).forEach(collect); };
  collect(pageRoot);
  const out = clone(layoutRoot);
  const fill = (n) => {
    n.children = (n.children ?? []).map((c) => {
      if (c.type !== "el") return c;
      const f = c.attrs.find((a) => layoutName(a.name) === "fragment");
      if (f) {
        const mine = own.get(f.value);
        if (mine) { const r = clone(mine); r.attrs = r.attrs.filter((a) => layoutName(a.name) !== "fragment"); return r; }
        c.attrs = c.attrs.filter((a) => layoutName(a.name) !== "fragment");
      }
      fill(c);
      return c;
    });
    return n;
  };
  fill(out);
  const unwrap = (nodes) => elements(nodes).flatMap((e) => (e.tag === "html" || e.tag === "body" ? unwrap(e.children) : e.tag === "head" ? [] : [e]));
  const outside = unwrap(pageRoot.children).some((e) => !e.attrs.some((a) => layoutName(a.name) === "fragment"));
  if (outside) note("Markup outside any layout:fragment in a page that decorates a layout is not rendered by the Layout Dialect; it was dropped.");
  const strip = (n) => { if (n.type === "el") n.attrs = n.attrs.filter((a) => !layoutName(a.name) || layoutName(a.name) === "insert" || layoutName(a.name) === "replace"); (n.children ?? []).forEach(strip); };
  strip(out);
  return out;
}

const isThymeleaf = (text) => /\b(?:th|data-th)[:-][\w-]+\s*=|xmlns:th=|\blayout:decorate/.test(text);

export default {
  name: "input-thymeleaf",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|xhtml|thtml)$/i.test(f.rel));
      const bodies = new Map();
      for (const f of files) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        if (isThymeleaf(text)) bodies.set(f.rel.replace(/^\.\//, ""), text);
      }
      if (!bodies.size) return log.debug("no Thymeleaf templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };

      const bare = (name) => String(name).replace(/^(\.\.?\/)+/, "").replace(/^(?:src\/main\/resources\/)?templates\//, "").replace(/\.(html?|xhtml|thtml)$/i, "");
      const keys = [...bodies.keys()];
      const findKey = (name) => {
        const b = bare(name);
        return keys.find((k) => bare(k) === b) ?? keys.find((k) => bare(k).endsWith(`/${b}`)) ?? keys.find((k) => bare(k).split("/").pop() === b.split("/").pop());
      };
      const trees = new Map();
      const treeOf = (key) => {
        if (!trees.has(key)) {
          const root = parseHtml(stripStyles(stripScripts(bodies.get(key))));
          trees.set(key, { root, fragments: collectFragments(root), name: key });
        }
        return trees.get(key);
      };
      const library = { resolve: (name) => { const k = findKey(name); return k ? treeOf(k) : null; } };

      const decorated = new Set();
      for (const text of bodies.values()) for (const m of text.matchAll(/layout:decorate\s*=\s*["']~?\{?\s*([^"'}(]+)/g)) decorated.add(bare(m[1].trim()));

      let count = 0;
      for (const [key, text] of bodies) {
        const file = files.find((f) => f.rel.replace(/^\.\//, "") === key);
        if (decorated.has(bare(key))) { note(`${key} is a layout other templates decorate; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        let { root, fragments } = treeOf(key);
        const top = elements(root.children);
        const inner = top.length === 1 && top[0].tag === "html" ? elements(top[0].children).flatMap((e) => (e.tag === "body" ? elements(e.children) : e.tag === "head" ? [] : [e])) : top;
        if (inner.length && inner.every((e) => hasTh(e, "fragment"))) { note(`${key} defines only fragments; they are composed into the templates that name them rather than ported as a screen.`); continue; }
        const html = top.find((e) => e.tag === "html");
        const dec = html?.attrs.find((a) => layoutName(a.name) === "decorate" || layoutName(a.name) === "decorator");
        if (dec) {
          const spec = lowerValue(dec.value, freshScope(note));
          const layout = library.resolve(spec.kind === "fragment" ? spec.text.split("::")[0].trim() : spec.text);
          if (layout) root = decorate(root, layout.root, note);
          else note(`layout:decorate names ${spec.text}, a layout this run does not hold; the page stands without it.`);
        }
        const scope = freshScope(note);
        scope.file = key; scope.fragmentsOf = fragments;
        let twoWay = false;
        scope.markTwoWay = () => { twoWay = true; };
        let template = lowerTree(root, scope, library);
        const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(template);
        if (body) template = body[1];
        template = template.trim();
        if (!template) continue;
        const selector = bare(key).split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file?.rel ?? key,
          inputs: readInputs(template),
          outputs: [],
          template,
          templateOrigin: "a Thymeleaf template, composed and lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: twoWay || /ng-model/.test(template),
          rxjs: [],
          readBy: "thymeleaf",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Thymeleaf template(s) composed and lowered onto the dialect`);
    });
  },
};
