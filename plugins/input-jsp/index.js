import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { elements, parseMarkup, stripDelimited, VOID_ELEMENTS } from "../dsp-ir/markup.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { attrSafe, matchBracket, quoteJs, readInputs, splitCommas } from "../dsp-ir/text.js";

/**
 * JSP with the standard tag library, the enterprise Java page for twenty
 * years: HTML with <c:if>, <c:choose>, <c:forEach> and <c:out> around it,
 * the expression language's ${...} inside it, <fmt:> for messages and
 * formats, fn: functions, jsp: actions, the directives that name the tag
 * libraries and include other pages, and the scriptlets that ran Java where
 * a tag would not do. The tags lower onto the dialect: c:if onto ng-if,
 * c:choose with its when and otherwise onto the chain negated the way the
 * container evaluates it, c:forEach with its varStatus onto ng-repeat with
 * the status fields as arithmetic on $index, c:out onto an interpolation or
 * bound html, c:set onto a substituted alias where the value is fixed, c:url
 * onto the address it builds, a static or dynamic include onto the page it
 * names, and the Spring form tags onto a two way model. EL is spelled as
 * JavaScript outside strings (and, or, not, eq, empty), the fn: functions
 * with an exact equivalent are rewritten, a formatter keeps its value
 * unformatted and is named, and a message key is kept as its key.
 *
 * A scriptlet ran Java in the page and is named, never carried; an implicit
 * object (param, sessionScope, pageContext) is context the port must supply
 * and is named as such; a tag from a library this reader does not know is
 * named and its content stands.
 */

const OPS = { and: "&&", or: "||", eq: "==", ne: "!=", gt: ">", lt: "<", ge: ">=", le: "<=", div: "/", mod: "%" };
const IMPLICIT = /\b(param|paramValues|header|headerValues|cookie|initParam|pageContext|pageScope|requestScope|sessionScope|applicationScope)\b(?=\.|\[)/g;
const FN = {
  "fn:length": ([x]) => `${x}.length`,
  "fn:toUpperCase": ([x]) => `${x}.toUpperCase()`,
  "fn:toLowerCase": ([x]) => `${x}.toLowerCase()`,
  "fn:trim": ([x]) => `${x}.trim()`,
  "fn:contains": ([x, y]) => `${x}.includes(${y})`,
  "fn:containsIgnoreCase": ([x, y]) => `${x}.toLowerCase().includes(${y}.toLowerCase())`,
  "fn:startsWith": ([x, y]) => `${x}.startsWith(${y})`,
  "fn:endsWith": ([x, y]) => `${x}.endsWith(${y})`,
  "fn:indexOf": ([x, y]) => `${x}.indexOf(${y})`,
  "fn:replace": ([x, a, b]) => `${x}.split(${a}).join(${b})`,
  "fn:substring": ([x, a, b]) => `${x}.substring(${a}, ${b})`,
  "fn:join": ([x, s]) => `${x}.join(${s})`,
  "fn:split": ([x, s]) => `${x}.split(${s})`,
  "fn:escapeXml": ([x]) => x,
};

/** EL spelled as JavaScript, outside string literals. */
export function elToJs(expr, scope = freshScope()) {
  let s = String(expr).trim();
  for (;;) {
    const m = /\b(fn:\w+|\w+:\w+)\(/.exec(s);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const end = matchBracket(s, open, { ticks: false });
    if (end < 0) break;
    const args = splitCommas(s.slice(open + 1, end - 1), { ticks: false }).map((a) => elToJs(a, scope));
    let rep;
    if (FN[m[1]]) rep = FN[m[1]](args);
    else { scope.note(`${m[1]}() is a tag library function this reader does not know; the call was kept and the port must supply it.`); rep = `${m[1].replace(":", "_")}(${args.join(", ")})`; }
    s = s.slice(0, m.index) + rep + s.slice(end);
  }
  const parts = s.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
  return parts.map((p, i) => {
    if (i % 2) return p;
    let c = p.replace(/(?<![\w.$])not\s+/g, "!").replace(/(?<![\w.$])(and|or|eq|ne|gt|lt|ge|le|div|mod)(?![\w$])/g, (w) => OPS[w]);
    // `empty x` is null or nothing in it. Where the page itself iterates x it is a
    // collection and reads as the dialect's empty state; elsewhere an object
    // with no length is not empty, so the general sense is spelled out.
    c = c.replace(/(?<![\w.$])empty\s+([\w$][\w$.\[\]'"]*)/g, (mm, x, at) => {
      const whole = at === 0 && mm.length === c.length;
      if (scope.lists.has(x)) return whole ? `!${x} || !${x}.length` : `(!${x} || !${x}.length)`;
      return whole ? `${x} == null || ${x}.length === 0` : `(${x} == null || ${x}.length === 0)`;
    });
    c = c.replace(IMPLICIT, (name) => { scope.note(`${name} is an implicit object the container supplied; the port must supply \`${name}\` itself.`); return name; });
    for (const [alias, js] of scope.aliases) c = c.replace(new RegExp(`(?<![\\w.$])${alias}(?![\\w$])`, "g"), () => js);
    return c;
  }).join("");
}

export function freshScope(note = () => {}) {
  return { note, aliases: new Map(), interp: new Map(), lists: new Set(), depth: 0, prefixes: new Set(["c", "fmt", "fn", "form", "jsp", "spring"]) };
}

/** ${..} and #{..} in text or an attribute, as interpolations; a value that is one expression, as its JS. */
export function lowerText(text, scope) {
  let out = ""; let i = 0;
  while (i < text.length) {
    const at = text.slice(i).search(/[$#]\{/);
    if (at < 0) { out += text.slice(i); break; }
    const start = i + at;
    if (text[start - 1] === "\\") { out += text.slice(i, start - 1) + text.slice(start, start + 2); i = start + 2; continue; }
    const end = matchBracket(text, start + 1, { ticks: false });
    if (end < 0) { out += text.slice(i); break; }
    const inner = text.slice(start + 2, end - 1).trim();
    out += text.slice(i, start) + (scope.interp.has(inner) ? scope.interp.get(inner) : `{{ ${elToJs(inner, scope)} }}`);
    i = end;
  }
  return out;
}

/** An attribute's value: literal, an interpolated string, or one expression. */
function lowerValue(value, scope) {
  const v = String(value ?? "");
  const m = /^\s*[$#]\{([\s\S]*)\}\s*$/.exec(v);
  if (m && scope.interp.has(m[1].trim())) { const text = scope.interp.get(m[1].trim()); return { kind: text.includes("{{") ? "interp" : "literal", text }; }
  if (m && matchBracket(v.trimStart(), 1, { ticks: false }) === v.trimStart().length) return { kind: "expr", text: elToJs(m[1], scope) };
  const text = lowerText(v, scope);
  return { kind: text.includes("{{") ? "interp" : "literal", text };
}

const attr = (el, name) => el.attrs.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value ?? null;

/** Lower a tree onto the dialect. `resolve(path)` returns the text of another page in the run, or null. */
export function lowerTree(root, scope = freshScope(), resolve = () => null, depth = 0) {
  const lowerNodes = (nodes) => nodes.map((n) => lowerNode(n)).join("");
  const lowerNode = (n) => {
    if (n.type === "text") return lowerText(n.text, scope);
    if (n.type === "raw") return n.text;
    if (n.type !== "el") return "";
    const el = n;
    const [prefix, local] = el.tag.includes(":") ? el.tag.toLowerCase().split(":") : [null, el.tag];
    if (!prefix) return lowerElement(el);
    if (prefix === "c") return lowerCore(local, el);
    if (prefix === "fmt") return lowerFmt(local, el);
    if (prefix === "jsp") return lowerJspAction(local, el);
    if (prefix === "form") return lowerSpringForm(local, el);
    if (prefix === "spring") { if (local === "message") return message(attr(el, "code"), el); scope.note(`<spring:${local}> rendered on the server; the tag was removed and its content stands.`); return lowerNodes(el.children); }
    if (prefix === "svg" || prefix === "xlink") return lowerElement(el);
    scope.note(`The \`${prefix}:\` tag library rendered <${prefix}:${local}> on the server; this reader does not know it, so the tag was removed and its content stands.`);
    return lowerNodes(el.children);
  };

  const message = (key, el) => {
    scope.note("Message keys (fmt:message, spring:message) were kept as their keys; the port renders the key until a message bundle is wired, and no text was invented.");
    if (elements(el.children).some((c) => c.tag === "fmt:param" || c.tag === "spring:argument")) scope.note(`The message \`${key}\` carried arguments; they are not in the port.`);
    const varName = attr(el, "var");
    if (varName) { scope.aliases.set(varName, quoteJs(key ?? "")); return ""; }
    return key ?? "";
  };

  const lowerElement = (el) => {
    const parts = [];
    for (const a of el.attrs) {
      if (a.value === null) { parts.push(a.name); continue; }
      const r = lowerValue(a.value, scope);
      const name = a.name.toLowerCase();
      if (r.kind === "literal") { parts.push(`${a.name}="${r.text}"`); continue; }
      if (name === "href" || name === "src") { parts.push(`ng-${name}="${attrSafe(r.kind === "expr" ? `{{ ${r.text} }}` : r.text)}"`); continue; }
      if (name === "class") { parts.push(r.kind === "expr" ? `ng-class="${attrSafe(r.text)}"` : `ng-attr-class="${attrSafe(r.text)}"`); continue; }
      if (["disabled", "checked", "selected", "readonly", "required", "hidden"].includes(name) && r.kind === "expr") { parts.push(`ng-${name}="${attrSafe(r.text)}"`); continue; }
      parts.push(`ng-attr-${a.name}="${attrSafe(r.kind === "expr" ? `{{ ${r.text} }}` : r.text)}"`);
    }
    const open = `<${el.tag}${parts.map((p) => ` ${p}`).join("")}>`;
    if (VOID_ELEMENTS.has(el.tag)) return open;
    return `${open}${lowerNodes(el.children)}</${el.tag}>`;
  };

  const test = (value) => { const r = lowerValue(value ?? "", scope); return r.kind === "expr" ? r.text : `'${r.text}'`; };

  const lowerCore = (local, el) => {
    switch (local) {
      case "if": {
        const t = test(attr(el, "test"));
        const varName = attr(el, "var");
        if (varName) scope.aliases.set(varName, `(${t})`);
        scope.depth += 1; const body = lowerNodes(el.children); scope.depth -= 1;
        return `<ng-container ng-if="${attrSafe(t)}">${body}</ng-container>`;
      }
      case "choose": {
        const tried = []; let out = "";
        for (const c of elements(el.children)) {
          if (c.tag === "c:when") {
            const own = test(attr(c, "test"));
            const t = [...tried.map((x) => `!(${x})`), tried.length ? `(${own})` : own].join(" && ");
            tried.push(own);
            scope.depth += 1; out += `<ng-container ng-if="${attrSafe(t)}">${lowerNodes(c.children)}</ng-container>`; scope.depth -= 1;
          } else if (c.tag === "c:otherwise") {
            scope.depth += 1; out += `<ng-container ng-if="${attrSafe(tried.map((x) => `!(${x})`).join(" && ") || "true")}">${lowerNodes(c.children)}</ng-container>`; scope.depth -= 1;
          }
        }
        return out;
      }
      case "when": case "otherwise": return lowerNodes(el.children);
      case "foreach": {
        const items = attr(el, "items"); const item = attr(el, "var") ?? "item"; const status = attr(el, "varStatus");
        if (items === null) { scope.note(`<c:forEach begin="${attr(el, "begin") ?? ""}" end="${attr(el, "end") ?? ""}"> counts a range; the port repeats over a list it must be given, and the body was kept once.`); return `<ng-container>${lowerNodes(el.children)}</ng-container>`; }
        if (attr(el, "begin") !== null || attr(el, "end") !== null || attr(el, "step") !== null) scope.note(`<c:forEach> over \`${items}\` bounded its range with begin, end or step; the bounds are not carried and the port repeats over the whole list.`);
        const list = test(items);
        if (status) {
          for (const [k, v] of [["index", "$index"], ["count", "($index + 1)"], ["first", "($index == 0)"], ["last", `($index == ${list}.length - 1)`], ["current", item]]) scope.aliases.set(`${status}.${k}`, v);
        }
        scope.depth += 1; const body = lowerNodes(el.children); scope.depth -= 1;
        if (status) for (const k of ["index", "count", "first", "last", "current"]) scope.aliases.delete(`${status}.${k}`);
        return `<ng-container ng-repeat="${attrSafe(`${item} in ${list}${status ? " track by $index" : ""}`)}">${body}</ng-container>`;
      }
      case "fortokens": scope.note(`<c:forTokens> split \`${attr(el, "items")}\` on \`${attr(el, "delims")}\` at render time; the body was kept once and the port must split it.`); return `<ng-container>${lowerNodes(el.children)}</ng-container>`;
      case "out": {
        const value = lowerValue(attr(el, "value") ?? "", scope);
        const dflt = attr(el, "default");
        let js = value.kind === "expr" ? value.text : quoteJs(value.text);
        if (dflt !== null) { const d = lowerValue(dflt, scope); js = `(${js} || ${d.kind === "expr" ? d.text : `'${d.text}'`})`; }
        if (/^\s*false\s*$/i.test(attr(el, "escapeXml") ?? "")) return `<span ng-bind-html="${attrSafe(js)}"></span>`;
        return value.kind === "literal" && dflt === null ? value.text : `{{ ${js} }}`;
      }
      case "set": {
        const varName = attr(el, "var");
        if (!varName) { scope.note(`<c:set target="${attr(el, "target") ?? ""}" property="${attr(el, "property") ?? ""}"> wrote into an object on the server; the port must carry it.`); return ""; }
        const value = attr(el, "value") !== null ? lowerValue(attr(el, "value"), scope) : { kind: "expr", text: quoteJs(lowerNodes(el.children)) };
        const js = value.kind === "expr" ? value.text : /^(?:-?\d+(?:\.\d+)?|true|false|null)$/.test(value.text.trim()) ? value.text.trim() : quoteJs(value.text);
        if (scope.depth > 0 || new RegExp(`(?<![\\w.$])${varName}(?![\\w$])`).test(js)) { scope.note(`<c:set var="${varName}"> inside a branch or loop, or reading itself, takes a value the port must carry; it was not substituted.`); return ""; }
        scope.aliases.set(varName, /^[\w$.]+$/.test(js) || /^'[^']*'$/.test(js) ? js : `(${js})`);
        return "";
      }
      case "url": {
        const value = lowerValue(attr(el, "value") ?? "", scope);
        const params = elements(el.children).filter((c) => c.tag === "c:param").map((c) => `${attr(c, "name")}=${(() => { const r = lowerValue(attr(c, "value") ?? "", scope); return r.kind === "expr" ? `{{ ${r.text} }}` : r.text; })()}`);
        let address = value.kind === "expr" ? `{{ ${value.text} }}` : value.text;
        if (params.length) address += (address.includes("?") ? "&" : "?") + params.join("&");
        const varName = attr(el, "var");
        if (varName) { scope.interp.set(varName, address); return ""; }
        return address;
      }
      case "param": return "";
      case "import": {
        const url = attr(el, "url") ?? "";
        if (/^https?:\/\//.test(url)) { scope.note(`<c:import url="${url}"> fetched a remote resource at render time; it is not in the port.`); return ""; }
        return include(url, el);
      }
      case "redirect": scope.note(`<c:redirect url="${attr(el, "url") ?? ""}"> redirected on the server; the port must route it.`); return "";
      case "remove": return "";
      case "catch": scope.note("<c:catch> caught an exception on the server; its body stands and the port has no exception to catch."); return lowerNodes(el.children);
      default: scope.note(`<c:${local}> is a core tag this reader does not know; the tag was removed and its content stands.`); return lowerNodes(el.children);
    }
  };

  const include = (path, el) => {
    if (!path) return "";
    if (depth >= 6) { scope.note(`${path} includes deeper than this reader follows.`); return ""; }
    const body = resolve(path);
    if (body == null) { scope.note(`${path} is included by this page and is not in the run; the page stands without it.`); return ""; }
    const params = el ? elements(el.children).filter((c) => c.tag === "jsp:param").map((c) => attr(c, "name")).filter(Boolean) : [];
    if (params.length) scope.note(`<jsp:include page="${path}"> passed ${params.join(", ")} into the included page; the port reads them from the same scope.`);
    return lowerTree(parseMarkup(prepare(body, scope, resolve, depth + 1)), scope, resolve, depth + 1);
  };

  const lowerFmt = (local, el) => {
    switch (local) {
      case "message": return message(attr(el, "key"), el);
      case "param": return "";
      case "formatnumber": case "formatdate": case "parsenumber": case "parsedate": {
        const value = lowerValue(attr(el, "value") ?? "", scope);
        scope.note(`<fmt:${local}> formatted its value on the server; the value is unformatted in the port and the format is not carried.`);
        const js = value.kind === "expr" ? value.text : `'${value.text}'`;
        const varName = attr(el, "var");
        if (varName) { scope.aliases.set(varName, js); return ""; }
        return `{{ ${js} }}`;
      }
      case "setlocale": case "setbundle": case "settimezone": case "timezone": case "requestencoding": return lowerNodes(el.children);
      case "bundle": return lowerNodes(el.children);
      default: scope.note(`<fmt:${local}> is a formatting tag this reader does not know; the tag was removed and its content stands.`); return lowerNodes(el.children);
    }
  };

  const lowerJspAction = (local, el) => {
    switch (local) {
      case "include": return include(attr(el, "page"), el);
      case "getproperty": return `{{ ${attr(el, "name")}.${attr(el, "property")} }}`;
      case "usebean": case "setproperty": scope.note(`<jsp:${local}> bound a bean on the server; the port reads \`${attr(el, "id") ?? attr(el, "name") ?? ""}\` from its own state.`); return "";
      case "forward": scope.note(`<jsp:forward page="${attr(el, "page") ?? ""}"> forwarded on the server; the port must route it.`); return "";
      case "param": case "body": case "attribute": case "text": return lowerNodes(el.children);
      default: scope.note(`<jsp:${local}> is an action this reader does not know; the tag was removed and its content stands.`); return lowerNodes(el.children);
    }
  };

  const lowerSpringForm = (local, el) => {
    const path = attr(el, "path");
    const model = scope.formModel ?? null;
    const bind = path ? (model ? `${model}.${path}` : path) : null;
    const carry = el.attrs.filter((a) => !["path", "cssClass", "cssErrorClass", "items", "itemValue", "itemLabel", "modelAttribute", "commandName", ...(local === "input" ? ["type"] : [])].includes(a.name)).map((a) => (a.value === null ? a.name : `${a.name}="${lowerText(a.value, scope)}"`));
    const css = attr(el, "cssClass"); if (css) carry.push(`class="${css}"`);
    const named = bind ? [`name="${path}"`, `id="${path}"`, `ng-model="${attrSafe(bind)}"`] : [];
    if (bind) scope.twoWay = true;
    switch (local) {
      case "form": {
        const previous = scope.formModel;
        scope.formModel = attr(el, "modelAttribute") ?? attr(el, "commandName") ?? "command";
        const body = lowerNodes(el.children);
        scope.formModel = previous;
        const action = attr(el, "action"); const method = attr(el, "method") ?? "post";
        return `<form${action ? ` action="${lowerText(action, scope)}"` : ""} method="${method}">${body}</form>`;
      }
      case "input": case "password": case "hidden": case "checkbox": case "radiobutton": {
        const type = { input: attr(el, "type") ?? "text", password: "password", hidden: "hidden", checkbox: "checkbox", radiobutton: "radio" }[local];
        return `<input type="${type}"${[...named, ...carry].map((p) => ` ${p}`).join("")}>`;
      }
      case "textarea": return `<textarea${[...named, ...carry].map((p) => ` ${p}`).join("")}></textarea>`;
      case "select": {
        const items = attr(el, "items");
        let options = lowerNodes(el.children);
        if (items) {
          const r = lowerValue(items, scope);
          const list = r.kind === "expr" ? r.text : `'${r.text}'`;
          const value = attr(el, "itemValue"); const label = attr(el, "itemLabel");
          options += `<option ng-repeat="o in ${attrSafe(list)}" ng-attr-value="{{ ${value ? `o.${value}` : "o"} }}">{{ ${label ? `o.${label}` : "o"} }}</option>`;
        }
        return `<select${[...named, ...carry].map((p) => ` ${p}`).join("")}>${options}</select>`;
      }
      case "option": return `<option${el.attrs.filter((a) => a.name === "value").map((a) => ` value="${lowerText(a.value ?? "", scope)}"`).join("")}>${lowerNodes(el.children)}</option>`;
      case "options": {
        const r = lowerValue(attr(el, "items") ?? "", scope); const list = r.kind === "expr" ? r.text : `'${r.text}'`;
        const value = attr(el, "itemValue"); const label = attr(el, "itemLabel");
        return `<option ng-repeat="o in ${attrSafe(list)}" ng-attr-value="{{ ${value ? `o.${value}` : "o"} }}">{{ ${label ? `o.${label}` : "o"} }}</option>`;
      }
      case "checkboxes": case "radiobuttons": {
        const r = lowerValue(attr(el, "items") ?? "", scope); const list = r.kind === "expr" ? r.text : `'${r.text}'`;
        const type = local === "checkboxes" ? "checkbox" : "radio";
        return `<label ng-repeat="o in ${attrSafe(list)}"><input type="${type}" name="${path}" ng-attr-value="{{ o }}"${bind ? ` ng-model="${attrSafe(bind)}"` : ""}>{{ o }}</label>`;
      }
      case "label": return `<label for="${path ?? ""}">${lowerNodes(el.children)}</label>`;
      case "errors": scope.note(`<form:errors path="${path ?? ""}"> rendered Spring validation errors on the server; the port must carry field errors from its own validation.`); return "";
      case "button": return `<button${carry.map((p) => ` ${p}`).join("")}>${lowerNodes(el.children)}</button>`;
      default: scope.note(`<form:${local}> is a Spring form tag this reader does not know; the tag was removed and its content stands.`); return lowerNodes(el.children);
    }
  };

  return lowerNodes(root.children);
}

/** Directives, comments, scriptlets and static includes handled before the tree is built. */
export function prepare(source, scope, resolve = () => null, depth = 0) {
  let text = String(source ?? "").replace(/\r\n/g, "\n");
  text = stripDelimited(stripDelimited(text, "<%--", "--%>"), "<!--", "-->");
  text = text.replace(/<%@\s*include\s+file\s*=\s*["']([^"']+)["']\s*%>/g, (m, file) => {
    if (depth >= 6) return "";
    const body = resolve(file);
    if (body == null) { scope.note(`${file} is included by this page and is not in the run; the page stands without it.`); return ""; }
    return prepare(body, scope, resolve, depth + 1);
  });
  text = text.replace(/<%@\s*taglib\b[^%]*%>/g, (m) => { const p = /prefix\s*=\s*["'](\w+)["']/.exec(m); if (p) scope.prefixes.add(p[1]); return ""; });
  text = text.replace(/<%@[\s\S]*?%>/g, "");
  text = text.replace(/<%!([\s\S]*?)%>/g, () => { scope.note("A declaration (<%! %>) defined Java in the page; it was not carried."); return ""; });
  text = text.replace(/<%=([\s\S]*?)%>/g, (m, expr) => { scope.note("A Java expression (<%= %>) was evaluated in the page; it is kept as written inside an interpolation and the port must supply what it reads."); return `{{ ${expr.trim()} }}`; });
  text = text.replace(/<%([\s\S]*?)%>/g, () => { scope.note("A scriptlet (<% %>) ran Java while rendering; it was not carried and its values are not in the port."); return ""; });
  text = text.replace(/<!DOCTYPE[^>]*>/gi, "");
  // What the page iterates is a collection; `empty` over it is the dialect's empty state.
  for (const m of text.matchAll(/\bitems\s*=\s*["']\s*\$\{([^}]*)\}\s*["']/g)) scope.lists.add(elToJs(m[1], freshScope()));
  // ${cond ? 'disabled' : ''} standing where an attribute would decided the attribute at render time.
  text = text.replace(/(<[\w:-]+(?:\s+[^\s=>/"'$]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*\s+)\$\{([^}]*)\}/g, (m, head, expr) => {
    scope.note(`\${${expr.trim().slice(0, 40)}} stood where an attribute would and decided it at render time; the attribute is not in the port and must be wired by hand.`);
    return head.trimEnd();
  });
  return text;
}

const isJsp = (rel, text) => /\.(jsp|jspf|jspx|tag)$/i.test(rel) && (/<%@|<%[\s=!-]|<c:\w+|<jsp:\w+|<fmt:\w+|<form:\w+|\$\{/.test(text));

export default {
  name: "input-jsp",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(jsp|jspf|jspx)$/i.test(f.rel));
      const bodies = new Map();
      for (const f of files) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        if (isJsp(f.rel, text)) bodies.set(f.rel.replace(/^\.\//, ""), text);
      }
      if (!bodies.size) return log.debug("no JSP pages");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bare = (name) => String(name).replace(/^(\.\.?\/)+/, "").replace(/^\//, "").replace(/^(?:src\/main\/webapp\/|webapp\/)?(?:WEB-INF\/)?(?:jsp|views|pages)?\/?/, "").replace(/\.(jsp|jspf|jspx)$/i, "");
      const keys = [...bodies.keys()];
      // By its path or a suffix of it; a basename alone would be a guess at which header.jspf was meant.
      const resolve = (name) => {
        const b = bare(name);
        const k = keys.find((x) => bare(x) === b) ?? keys.find((x) => bare(x).endsWith(`/${b}`));
        return k ? bodies.get(k) : null;
      };
      let count = 0;
      for (const [key, text] of bodies) {
        if (/\.jspf$/i.test(key)) { note(`${key} is a fragment other pages include; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const file = files.find((f) => f.rel.replace(/^\.\//, "") === key);
        const scope = freshScope(note);
        const prepared = prepare(text, scope, resolve);
        let template = lowerTree(parseMarkup(stripStyles(stripScripts(prepared))), scope, resolve);
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
          templateOrigin: "a JSP page, composed and lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: Boolean(scope.twoWay) || /ng-model/.test(template),
          rxjs: [],
          readBy: "jsp",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} JSP page(s) composed and lowered onto the dialect`);
    });
  },
};
