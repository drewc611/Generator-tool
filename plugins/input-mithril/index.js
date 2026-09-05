import { readFile } from "node:fs/promises";
import { matchBracket, splitCommas as splitArgs } from "../dsp-ir/text.js";

export { matchBracket, splitArgs };

const CLOSERS = { "(": ")", "[": "]", "{": "}" };

/**
 * Mithril writes its markup as JavaScript: m("div.card", { onclick }, [
 * m("h1", title), list.map((row) => m("li", row.name)) ]). There is no
 * template to lower, only a tree of calls, so this reads the tree the way the
 * runtime would and prints it onto the attribute dialect every other reader
 * targets. A selector string gives the tag, id and classes; an attrs object
 * gives attributes, with on<event> becoming the dialect's event, value plus
 * oninput becoming a model, and an expression valued attribute becoming
 * ng-attr; a child that is a string is text, an expression is an
 * interpolation, cond ? m(...) : null and cond && m(...) are a conditional,
 * list.map((row) => m(...)) is a loop, m.trust(x) is bound html, and
 * m(Child, { attrs }) is that component's tag. A component is any object or
 * closure with a view; its inputs are the vnode.attrs it reads and its
 * outputs the vnode.attrs.onX it calls. m.request calls reach the API surface.
 *
 * Whatever shape has no honest equivalent, a ternary that picks between two
 * elements, a spread, a computed key, is named through the notes rather than
 * approximated, because a wrong element that looks right is the defect this
 * tool exists to avoid.
 */

const EVENTS = new Set(["click", "change", "input", "submit", "keyup", "keydown", "keypress", "blur", "focus", "mouseenter", "mouseleave", "dblclick"]);

const isString = (s) => /^(["'`])[\s\S]*\1$/.test(s);
const unquote = (s) => s.slice(1, -1);
const isCall = (s) => /^m\s*\(/.test(s) && matchBracket(s, s.indexOf("(")) === s.length;
const isNothing = (s) => /^(null|undefined|""|''|false|\[\])$/.test(s);
const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** "div.card#main[role=list]" into its tag, classes, id and attributes. */
export function parseSelector(sel) {
  let tag = "div"; const classes = []; let id = null; const attrs = [];
  const re = /([.#][\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|^([\w-]+)/g;
  for (const m of sel.matchAll(re)) {
    if (m[6]) tag = m[6];
    else if (m[1]?.[0] === ".") classes.push(m[1].slice(1));
    else if (m[1]?.[0] === "#") id = m[1].slice(1);
    else if (m[2]) attrs.push([m[2], m[3] ?? m[4] ?? m[5] ?? ""]);
  }
  return { tag, classes, id, attrs };
}

const handlerCall = (expr) => {
  // e => save(e.item) keeps its call; a bare name is called with $event.
  const arrow = /^\(?\s*(\w*)\s*\)?\s*=>\s*([\s\S]+)$/.exec(expr);
  if (arrow) {
    const body = arrow[2].trim().replace(/^\{([\s\S]*)\}$/, "$1").trim().replace(/;$/, "");
    return arrow[1] ? body.replace(new RegExp(`\\b${arrow[1]}\\b`, "g"), "$event") : body;
  }
  return /^[\w.$]+$/.test(expr) ? `${expr}($event)` : expr;
};

/** Lower an attrs object literal onto dialect attributes; returns the attribute string. */
export function lowerAttrs(objectText, note, outputs = null) {
  const inner = objectText.trim().replace(/^\{/, "").replace(/\}$/, "");
  const pairs = splitArgs(inner).map((p) => {
    if (p.startsWith("...")) { note(`A spread in an attrs object (${p}) cannot be read; its attributes are not in the port.`); return null; }
    const idx = p.indexOf(":");
    if (idx < 0) return /^\w+$/.test(p) ? [p, p] : null;
    return [p.slice(0, idx).trim().replace(/^["']|["']$/g, ""), p.slice(idx + 1).trim()];
  }).filter(Boolean);

  const get = (k) => pairs.find((x) => x[0] === k)?.[1];
  const parts = [];
  let model = null;
  const valueKey = get("value") !== undefined ? "value" : get("checked") !== undefined ? "checked" : null;
  const setter = get("oninput") ?? get("onchange");
  if (valueKey && setter) {
    const target = /=>\s*\{?\s*([\w.$]+)\s*=\s*\w+\.target\.(?:value|checked)/.exec(setter)?.[1];
    if (target && target === get(valueKey)) model = target;
  }

  for (const [key, value] of pairs) {
    if (key === "key") continue;
    if (model && (key === valueKey || key === "oninput" || key === "onchange")) continue;
    if (/^on[a-z]+$/.test(key)) {
      const ev = key.slice(2);
      if (!EVENTS.has(ev)) { note(`The \`${key}\` handler has no dialect event; it was dropped.`); continue; }
      parts.push(`ng-${ev}="${handlerCall(value).replace(/"/g, "'")}"`);
      continue;
    }
    // onClear on a child component is that child's output, wired as an event here.
    if (/^on[A-Z]/.test(key)) { if (outputs) outputs.add(key); parts.push(`ng-${kebab(key.slice(2))}="${handlerCall(value).replace(/"/g, "'")}"`); continue; }
    if (key === "class" || key === "className") {
      if (isString(value)) parts.push(`class="${unquote(value)}"`);
      else parts.push(`ng-class="${value.replace(/"/g, "'")}"`);
      continue;
    }
    if (key === "style") { note("A style object on a hyperscript node was not carried; styles belong in the tokens."); continue; }
    if (["disabled", "checked", "selected", "readonly", "required"].includes(key) && !isString(value)) { parts.push(`ng-${key}="${value}"`); continue; }
    if (isString(value)) { parts.push(`${key}="${unquote(value)}"`); continue; }
    if (key === "href" || key === "src") { parts.push(`ng-${key}="{{ ${value} }}"`); continue; }
    parts.push(`ng-attr-${kebab(key)}="{{ ${value.replace(/"/g, "'")} }}"`);
  }
  if (model) parts.unshift(`ng-model="${model}"`);
  return parts.length ? " " + parts.join(" ") : "";
}

/** Lower one child expression; returns dialect markup. */
export function lowerChild(expr, note, outputs) {
  const e = expr.trim();
  if (!e || isNothing(e)) return "";
  if (isString(e)) return unquote(e);
  if (isCall(e)) return lowerCall(e, note, outputs);
  if (e.startsWith("[") && matchBracket(e, 0) === e.length) return splitArgs(e.slice(1, -1)).map((c) => lowerChild(c, note, outputs)).join("");
  const trust = /^m\.trust\(([\s\S]+)\)$/.exec(e);
  if (trust) return `<span ng-bind-html="${trust[1].trim()}"></span>`;
  const fragment = /^m\.fragment\(([\s\S]+)\)$/.exec(e);
  if (fragment) return `<ng-container>${splitArgs(fragment[1]).slice(1).map((c) => lowerChild(c, note, outputs)).join("")}</ng-container>`;

  // list.map((row, i) => m(...)) is a loop over that list.
  const map = /^([\w.$]+(?:\([^)]*\))?)\s*\.map\(\s*(?:\(\s*(\w+)\s*(?:,\s*(\w+))?\s*\)|(\w+))\s*=>\s*([\s\S]+)\)$/.exec(e);
  if (map) {
    const list = map[1]; const item = map[2] ?? map[4]; const index = map[3];
    let body = map[5].trim().replace(/^\{\s*return\s+([\s\S]*?);?\s*\}$/, "$1").trim();
    let markup = lowerChild(body, note, outputs);
    const repeat = `ng-repeat="${item} in ${list}${index ? " track by $index" : ""}"`;
    if (index) markup = markup.replace(new RegExp(`\\b${index}\\b`, "g"), "$index");
    return isCall(body) ? markup.replace(/^<([\w-]+)/, `<$1 ${repeat}`) : `<ng-container ${repeat}>${markup}</ng-container>`;
  }

  // cond ? m(...) : null is a conditional; cond && m(...) too. Two elements is a choice this does not make.
  const ternary = splitTernary(e);
  if (ternary) {
    const [cond, yes, no] = ternary;
    if (isNothing(no.trim())) return conditional(cond, yes, note, outputs);
    if (isNothing(yes.trim())) return conditional(`!(${cond})`, no, note, outputs);
    if (isCall(yes.trim()) && isCall(no.trim())) return conditional(cond, yes, note, outputs) + conditional(`!(${cond})`, no, note, outputs);
    note(`A ternary picking between two values (${e.slice(0, 40)}${e.length > 40 ? "..." : ""}) was interpolated as written; confirm it.`);
    return `{{ ${e} }}`;
  }
  const and = /^([\s\S]+?)\s*&&\s*(m\s*\([\s\S]+)$/.exec(e);
  if (and && isCall(and[2].trim())) return conditional(and[1], and[2], note, outputs);

  return `{{ ${e} }}`;
}

function conditional(cond, branch, note, outputs) {
  const markup = lowerChild(branch, note, outputs);
  const test = cond.trim().replace(/"/g, "'");
  return isCall(branch.trim()) ? markup.replace(/^<([\w-]+)/, `<$1 ng-if="${test}"`) : `<ng-container ng-if="${test}">${markup}</ng-container>`;
}

function splitTernary(e) {
  let depth = 0; let quote = null; let q = -1;
  for (let i = 0; i < e.length; i += 1) {
    const c = e[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c in CLOSERS) depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (depth === 0 && c === "?" && e[i + 1] !== "." && e[i + 1] !== "?") { q = i; break; }
  }
  if (q < 0) return null;
  depth = 0; quote = null; let nested = 0;
  for (let i = q + 1; i < e.length; i += 1) {
    const c = e[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c in CLOSERS) depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (depth === 0 && c === "?" && e[i + 1] !== ".") nested += 1;
    else if (depth === 0 && c === ":") { if (nested) nested -= 1; else return [e.slice(0, q).trim(), e.slice(q + 1, i).trim(), e.slice(i + 1).trim()]; }
  }
  return null;
}

/** Lower one m(...) call. */
export function lowerCall(call, note, outputs) {
  const open = call.indexOf("(");
  const args = splitArgs(call.slice(open + 1, matchBracket(call, open) - 1));
  if (!args.length) return "";
  const head = args.shift();
  let tag; let fixed = "";
  if (isString(head)) {
    const sel = parseSelector(unquote(head));
    tag = sel.tag;
    if (sel.id) fixed += ` id="${sel.id}"`;
    if (sel.classes.length) fixed += ` class="${sel.classes.join(" ")}"`;
    for (const [k, v] of sel.attrs) fixed += ` ${k}="${v}"`;
  } else if (/^[A-Z]\w*$/.test(head)) {
    tag = kebab(head);
  } else {
    note(`A hyperscript node whose tag is the expression \`${head}\` cannot be named; it was left out.`);
    return "";
  }
  let attrs = "";
  if (args.length && args[0].startsWith("{") && matchBracket(args[0], 0) === args[0].length) {
    attrs = lowerAttrs(args.shift(), note, /^[A-Z]/.test(head) ? null : outputs);
  }
  // A class attribute from the object joins the one the selector gave.
  if (fixed.includes(' class="') && / class="([^"]*)"/.test(attrs)) {
    const extra = / class="([^"]*)"/.exec(attrs)[1];
    attrs = attrs.replace(/ class="[^"]*"/, "");
    fixed = fixed.replace(/ class="([^"]*)"/, (_, c) => ` class="${c} ${extra}"`);
  }
  const children = args.map((a) => lowerChild(a, note, outputs)).join("");
  const VOID = new Set(["input", "img", "br", "hr", "meta", "link"]);
  if (VOID.has(tag) && !children) return `<${tag}${fixed}${attrs}>`;
  return `<${tag}${fixed}${attrs}>${children}</${tag}>`;
}

/** Every component in a Mithril source file: an object or closure with a view. */
export function readComponents(source, rel, note = () => {}) {
  const screens = [];
  const calls = [];
  const views = [...source.matchAll(/\bview\s*(?:\(\s*(?:\{[^}]*\}|(\w*))\s*\)\s*\{|:\s*(?:function\s*)?\(\s*(?:\{[^}]*\}|(\w*))\s*\)\s*(?:=>\s*)?\{?)/g)];
  for (const [i, v] of views.entries()) {
    const before = source.slice(0, v.index);
    const decl = [...before.matchAll(/(?:const|let|var|function)\s+([A-Z]\w*)|export\s+default\s+(?:function\s+)?([A-Z]\w*)?/g)].pop();
    const name = decl?.[1] ?? decl?.[2] ?? `Component${i + 1}`;
    const vnode = v[1] || v[2] || "vnode";
    const region = source.slice(decl?.index ?? 0, views[i + 1]?.index ?? source.length);

    const bodyStart = v.index + v[0].length;
    // A block body returns its tree; an arrow expression body is the tree.
    const block = v[0].trim().endsWith("{");
    const ret = block ? /return\s+(m\s*\(|\[)/.exec(source.slice(bodyStart)) : /^\s*(m\s*\(|\[)/.exec(source.slice(bodyStart));
    let template = null;
    if (ret) {
      const start = bodyStart + ret.index + ret[0].indexOf(ret[1]);
      const end = matchBracket(source, source[start] === "[" ? start : source.indexOf("(", start));
      const expr = source.slice(start, end).trim();
      // An attrs read is the input itself once the component is a screen.
      template = lowerChild(expr, note, new Set()).replace(new RegExp(`\\b(?:${vnode}\\.attrs|attrs)\\.`, "g"), "");
    } else {
      note(`${name}'s view returns something that is not a hyperscript call; its markup was not read.`);
    }

    const outputs = new Set();
    const inputs = new Set();
    const attrsRe = new RegExp(`\\b(?:${vnode}\\.attrs|attrs)\\.(\\w+)`, "g");
    for (const m of region.matchAll(attrsRe)) {
      // The prop is onPick; the output it carries is pick, as every reader names it.
      if (/^on[A-Z]/.test(m[1])) outputs.add(m[1].slice(2).replace(/^./, (c) => c.toLowerCase())); else inputs.add(m[1]);
    }
    for (const m of region.matchAll(/m\.request\(\s*(\{[^}]*\}|["'`][^"'`]+["'`])/g)) {
      const opts = m[1];
      const url = /\burl\s*:\s*["'`]([^"'`]+)["'`]/.exec(opts)?.[1] ?? (opts.startsWith("{") ? null : opts.slice(1, -1));
      const method = /\bmethod\s*:\s*["'](\w+)["']/.exec(opts)?.[1] ?? "GET";
      if (url) calls.push({ method: method.toUpperCase(), path: url, file: rel, headers: null, body: null });
    }

    screens.push({
      selector: kebab(name),
      className: name,
      file: rel,
      inputs: [...inputs].sort(),
      outputs: [...outputs].sort(),
      template,
      templateOrigin: template ? "a Mithril view, lowered from hyperscript" : null,
      usesNgIf: /ng-if/.test(template ?? ""),
      usesNgFor: /ng-repeat/.test(template ?? ""),
      usesTwoWay: /ng-model/.test(template ?? ""),
      rxjs: [],
      readBy: "mithril",
    });
  }
  return { screens, calls };
}

export const isMithril = (text) => /from\s+["']mithril["']|require\(\s*["']mithril["']\s*\)/.test(text) || /\bm\.(mount|route|request)\(/.test(text);

export default {
  name: "input-mithril",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|mjs|ts)$/i.test(f.rel) && !/\.(test|spec|min)\./i.test(f.rel));
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !isMithril(text) || !/\bview\b/.test(text)) continue;
        const { screens, calls } = readComponents(text, file.rel, note);
        for (const s of screens) ctx.screens.push(s);
        ctx.api.calls.push(...calls);
        count += screens.length;
      }
      if (!count) return log.debug("no Mithril components");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Mithril component(s), lowered from hyperscript`);
    });
  },
};
