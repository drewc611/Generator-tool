import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pascal } from "../dsp-ir/emit.js";

/**
 * Reads Lit components into the same screen shape as every other reader, and
 * closes another loop: portamp emits Lit, so it should read it. A LitElement is
 * a class with `static properties` (or `@property` fields) for its inputs, a
 * `render()` returning an `html` tagged template, `@event` handlers, `.property`
 * and `?boolean` bindings, and `dispatchEvent(new CustomEvent(...))` for outputs.
 *
 * The `html` template lowers onto the AngularJS attribute dialect the rest of
 * the tool already reads, so a Lit component reaches the translator, the
 * endpoint map and every emitter as any other component. `${expr}` is
 * interpolation, `${list.map((x) => html`...`)}` a loop, `${cond ? html`...` :
 * ''}` a conditional, `@click=${h}` an event, `.value=${x}` with `@input` a two
 * way model. A `${...}` this cannot classify, a `.property` binding with no
 * dialect equivalent, or a two branch ternary is named through a note rather
 * than guessed. The inverse of output-lit, held to the same dialect.
 */

const EVENT = new Set(["click", "change", "submit", "input", "blur", "focus",
  "keyup", "keydown", "keypress", "mouseover", "mouseout", "dblclick"]);
const BOOL_ATTR = { disabled: "ng-disabled", checked: "ng-checked", readonly: "ng-readonly", hidden: "ng-hide", required: "ng-required", selected: "ng-selected" };

/**
 * The index of the `}` that closes the `${` at `open`. A stack of modes tracks
 * nesting: an expression can hold a string or a nested `template`, and a nested
 * template can hold its own `${` expression, arbitrarily deep.
 */
function matchInterp(text, open) {
  const stack = [{ mode: "expr", depth: 0 }];
  let i = open + 2;
  let quote = null;
  while (i < text.length && stack.length) {
    const top = stack[stack.length - 1];
    const c = text[i];
    if (quote) { if (c === quote && text[i - 1] !== "\\") quote = null; i += 1; continue; }
    if (top.mode === "expr") {
      if (c === "'" || c === '"') quote = c;
      else if (c === "`") stack.push({ mode: "tmpl" });
      else if (c === "{") top.depth += 1;
      else if (c === "}") { if (top.depth === 0) { stack.pop(); if (!stack.length) return i; } else top.depth -= 1; }
    } else {
      if (c === "\\") i += 1;
      else if (c === "`") stack.pop();
      else if (c === "$" && text[i + 1] === "{") { stack.push({ mode: "expr", depth: 0 }); i += 1; }
    }
    i += 1;
  }
  return -1;
}

/** The balanced `{...}` starting at the `{` at `open`; returns its interior, or null. */
function balancedObject(text, open) {
  let depth = 0;
  let quote = null;
  let tick = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === quote && text[i - 1] !== "\\") quote = null; continue; }
    if (tick) { if (c === "`" && text[i - 1] !== "\\") tick -= 1; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "`") tick += 1;
    else if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return text.slice(open + 1, i); }
  }
  return null;
}

/** The identifiers used as keys at the top level of an object body. */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let tick = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) { if (c === quote && body[i - 1] !== "\\") quote = null; continue; }
    if (tick) { if (c === "`" && body[i - 1] !== "\\") tick -= 1; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === "`") { tick += 1; continue; }
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;
    else if (depth === 0) {
      const m = /^([\w$]+)\s*:/.exec(body.slice(i));
      if (m && (i === 0 || /[\s,{]/.test(body[i - 1]))) { if (!keys.includes(m[1])) keys.push(m[1]); i += m[0].length - 1; }
    }
  }
  return keys;
}

/** The content of the first `html` tagged template, matched to its closing backtick. */
export function findTemplate(source) {
  const start = /\bhtml\s*`/.exec(source);
  if (!start) return null;
  let i = start.index + start[0].length;
  const begin = i;
  let tick = 1;
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === "\\") { i += 1; continue; }
    if (c === "$" && source[i + 1] === "{") { const end = matchInterp(source, i); if (end === -1) break; i = end; continue; }
    if (c === "`") { tick -= 1; if (tick === 0) return source.slice(begin, i); }
  }
  return null;
}

/** The declared reactive properties: `static properties`, `static get properties`, and `@property`/`@state` fields. */
export function readProperties(source) {
  const names = [];
  const add = (n) => { if (n && !names.includes(n)) names.push(n); };
  // `static properties = {` or `static get properties() { return {` open the object;
  // read its balanced body and take only the keys at its top level, not the nested { type }.
  const decl = /static\s+(?:get\s+)?properties\b[^{]*?\{/.exec(source);
  if (decl) {
    const braceAt = source.indexOf("{", decl.index + decl[0].length - 1);
    // For the getter form the first { is the method body; step in to the returned object.
    let openAt = braceAt;
    if (/get\s+properties/.test(decl[0])) {
      const ret = /return\s*\{/.exec(source.slice(braceAt));
      if (ret) openAt = braceAt + ret.index + ret[0].length - 1;
    }
    const body = balancedObject(source, openAt);
    if (body != null) for (const k of topLevelKeys(body)) add(k);
  }
  for (const m of source.matchAll(/@(?:property|state)\s*\([^)]*\)\s*(?:accessor\s+)?([\w$]+)/g)) add(m[1]);
  return names;
}

/** Custom event names the component dispatches are its outputs. */
export function readOutputs(source) {
  const out = [];
  for (const m of source.matchAll(/new\s+CustomEvent\s*\(\s*["'`]([\w-]+)["'`]/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** An event handler reduced to its call: `(e) => this.save(e)` -> `save(e)`, `this.save` -> `save()`. */
function handlerCall(expr) {
  const arrow = /^\s*\(?[\w\s,]*\)?\s*=>\s*([\s\S]+?)\s*$/.exec(expr);
  let body = (arrow ? arrow[1] : expr).trim().replace(/^\{|\}$/g, "").trim().replace(/;$/, "");
  body = body.replace(/\bthis\./g, "");
  if (/^[\w.$]+$/.test(body)) body = `${body}()`;
  return body;
}

const stripThis = (expr) => expr.replace(/\bthis\./g, "").trim();

/** Lower one Lit binding attribute. Returns the replacement token, or null to drop it. */
function lowerBinding(name, expr, note) {
  // @event=${handler}
  if (name[0] === "@") {
    const ev = name.slice(1).toLowerCase();
    if (!EVENT.has(ev)) { note(`\`@${ev}\` has no dialect event; it was left as written.`); return `${name}="${expr}"`; }
    return `ng-${ev === "input" ? "change" : ev}="${handlerCall(expr)}"`;
  }
  // ?attr=${cond} boolean attribute binding
  if (name[0] === "?") {
    const attr = name.slice(1).toLowerCase();
    if (BOOL_ATTR[attr]) return `${BOOL_ATTR[attr]}="${stripThis(expr)}"`;
    note(`\`?${attr}\` is a boolean attribute binding with no dialect directive; it was lowered to an attribute expression.`);
    return `ng-attr-${attr}="{{ ${stripThis(expr)} }}"`;
  }
  // .property=${value} property binding; value on an input is a model half.
  if (name[0] === ".") {
    const prop = name.slice(1).toLowerCase();
    if (prop === "value") return `ng-model="${stripThis(expr)}"`;
    if (prop === "checked") return `ng-model="${stripThis(expr)}"`;
    note(`\`.${prop}\` is a property binding the dialect does not carry directly; it was lowered to an attribute expression.`);
    return `ng-attr-${prop}="{{ ${stripThis(expr)} }}"`;
  }
  // plain attr=${expr}
  const lower = name.toLowerCase();
  if (lower === "src") return `ng-src="${stripThis(expr)}"`;
  if (lower === "href") return `ng-href="${stripThis(expr)}"`;
  if (lower === "class") return `ng-class="${stripThis(expr).replace(/"/g, "'")}"`;
  return `ng-attr-${lower}="{{ ${stripThis(expr)} }}"`;
}

/** Lower the `name=${expr}` bindings within one opening tag's text, expr by expr. */
function lowerTagBindings(tag, note) {
  let out = "";
  let i = 0;
  while (i < tag.length) {
    const m = /^([@.?]?[\w-]+)\s*=\s*\$\{/.exec(tag.slice(i));
    if (m) {
      const dollarAt = i + m[0].length - 2;
      const end = matchInterp(tag, dollarAt);
      if (end !== -1) {
        out += lowerBinding(m[1], tag.slice(dollarAt + 2, end).trim(), note);
        i = end + 1;
        continue;
      }
    }
    out += tag[i];
    i += 1;
  }
  return out;
}

/**
 * Lower every `name=${expr}` binding inside opening tags; the body `${...}` is
 * left for the next pass. A tag's end is the `>` that is not inside a `${...}`
 * expression or a quoted value, so a `>` in an arrow (`() =>`) or a comparison
 * never closes the tag early.
 */
function lowerAttributes(template, note) {
  let out = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "<" && /[a-zA-Z]/.test(template[i + 1] || "")) {
      let j = i;
      let quote = null;
      while (j < template.length) {
        const d = template[j];
        if (quote) { if (d === quote) quote = null; j += 1; continue; }
        if (d === '"' || d === "'") { quote = d; j += 1; continue; }
        if (d === "$" && template[j + 1] === "{") { const e = matchInterp(template, j); if (e === -1) { j = template.length; break; } j = e + 1; continue; }
        if (d === ">") { j += 1; break; }
        j += 1;
      }
      out += lowerTagBindings(template.slice(i, j), note);
      i = j;
    } else { out += template[i]; i += 1; }
  }
  return out;
}

/** Insert an attribute into the first opening tag of a fragment. */
function injectAttr(html, attr) {
  return html.replace(/<([a-zA-Z][\w.-]*)/, (m, tag) => `<${tag} ${attr}`);
}

/** Lower the body `${...}` expressions: loops, conditionals, interpolation. Recursive. */
export function lowerBody(template, note = () => {}) {
  let out = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "$" && template[i + 1] === "{") {
      const end = matchInterp(template, i);
      if (end === -1) { out += template[i]; i += 1; continue; }
      const inner = template.slice(i + 2, end).trim();
      out += lowerExpression(inner, note);
      i = end + 1;
    } else { out += template[i]; i += 1; }
  }
  return out;
}

/** The inner html`...` of an expression fragment, or null. */
function innerHtml(expr) {
  const m = /\bhtml\s*`([\s\S]*)`\s*$/.exec(expr.replace(/[\s)]+$/, "").trim());
  return m ? m[1] : null;
}

function lowerExpression(inner, note) {
  const loop = /^([\w.$]+)\s*\.\s*map\s*\(\s*\(?\s*([\w$]+)\s*(?:,\s*[\w$]+\s*)?\)?\s*=>\s*([\s\S]*)$/.exec(inner);
  if (loop) {
    const body = innerHtml(loop[3]);
    if (body != null) return injectAttr(lowerBody(lowerAttributes(body, note), note), `ng-repeat="${loop[2]} in ${stripThis(loop[1])}"`);
  }
  const cond = /^([\s\S]+?)\?\s*([\s\S]+?)\s*:\s*([\s\S]*)$/.exec(inner);
  if (cond) {
    const thenHtml = innerHtml(cond[2]);
    const elseEmpty = /^(?:''|""|``|null|undefined|nothing)$/.test(cond[3].trim());
    if (thenHtml != null && elseEmpty) return injectAttr(lowerBody(lowerAttributes(thenHtml, note), note), `ng-if="${stripThis(cond[1].trim())}"`);
    if (thenHtml != null) { note("a Lit ternary with two branches was left as written; splitting it is a person's call."); return `{{ ${inner} }}`; }
  }
  const and = /^([^&]+?)\s*&&\s*([\s\S]*)$/.exec(inner);
  if (and) {
    const body = innerHtml(and[2]);
    if (body != null) return injectAttr(lowerBody(lowerAttributes(body, note), note), `ng-if="${stripThis(and[1].trim())}"`);
  }
  if (/\bhtml\s*`/.test(inner)) { const body = innerHtml(inner); if (body != null) return lowerBody(lowerAttributes(body, note), note); }
  return `{{ ${stripThis(inner)} }}`;
}

export function lowerLit(template, note = () => {}) {
  return lowerBody(lowerAttributes(template, note), note);
}

export function readComponent(source, rel, note = () => {}) {
  const raw = findTemplate(source);
  const template = raw != null ? lowerLit(raw, note) : null;
  const name = basename(rel, extname(rel));
  const calls = [];
  for (const m of source.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1/g)) calls.push({ method: "GET", path: m[2], headers: null, body: null });
  const screen = {
    selector: name.replace(/[^\w-]/g, "-").toLowerCase(),
    className: pascal(name),
    file: rel,
    inputs: readProperties(source),
    outputs: readOutputs(source),
    template,
    templateOrigin: template ? "a Lit component, lowered" : null,
    usesNgIf: /ng-if|ng-show|ng-hide/.test(template ?? ""),
    usesNgFor: /ng-repeat/.test(template ?? ""),
    usesTwoWay: /ng-model/.test(template ?? ""),
    rxjs: [],
    readBy: "lit",
  };
  return { screen, calls };
}

/** A LitElement is a class that extends LitElement or renders an html template. */
function looksLikeLit(source) {
  return /\bextends\s+LitElement\b/.test(source) || (/\brender\s*\(\s*\)/.test(source) && /\bhtml\s*`/.test(source));
}

export default {
  name: "input-lit",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|ts)$/i.test(f.rel));
      if (!files.length) return log.debug("no scripts to read for Lit");
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !looksLikeLit(text)) continue;
        const { screen, calls } = readComponent(text, file.rel, note);
        if (!screen.template) { ctx.unverified(`${file.rel} looks like a Lit component but no html template was found, so only its states can be ported.`); continue; }
        ctx.screens.push(screen);
        ctx.api.calls.push(...calls.map((c) => ({ ...c, file: file.rel })));
        count += 1;
      }
      if (!count) return log.debug("no Lit components read");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Lit component(s) lowered`);
    });
  },
};
