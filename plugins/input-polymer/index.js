import { readFile } from "node:fs/promises";
import { balanced } from "../dsp-ir/scan.js";
import { pascal } from "../dsp-ir/emit.js";

/**
 * Reads Polymer elements into the same screen shape every other reader
 * produces. Polymer wrote a component as a `<dom-module>` with a `<template>`
 * inside and a class or a `Polymer({...})` call beside it, and it had its own
 * binding spelling: `[[x]]` one way, `{{x}}` two way, `on-event` handlers,
 * and `<template is="dom-if">` and `<template is="dom-repeat">` for the two
 * structural cases.
 *
 * None of that survives into the target directly, and none of it has to. The
 * template is lowered onto the AngularJS attribute dialect the rest of the
 * tool already reads, so `detectDialect` picks it up and the translator, the
 * endpoint map and every emitter treat a Polymer element exactly as they treat
 * an Angular component. Where a binding has no honest equivalent the lowering
 * says so rather than inventing one.
 */

const EVENTS = {
  tap: "click", click: "click", change: "change", input: "change", submit: "submit",
  blur: "blur", focus: "focus", keyup: "keyup", keydown: "keydown",
  mouseover: "mouseover", mouseout: "mouseout", dblclick: "dblclick",
};

/** The body of the first `<template>` directly under a `<dom-module>`. */
function moduleTemplate(source, index) {
  const open = /<template(\s[^>]*)?>/gi;
  open.lastIndex = index;
  const m = open.exec(source);
  if (!m) return null;
  const any = /<(\/?)template(\s[^>]*)?>/gi;
  any.lastIndex = open.lastIndex;
  let depth = 1;
  let step;
  while ((step = any.exec(source))) {
    depth += step[1] ? -1 : 1;
    if (depth === 0) return source.slice(open.lastIndex, step.index);
  }
  return source.slice(open.lastIndex);
}

/** Rewrite the two structural `<template is="...">` forms to ng-container. */
function lowerStructural(html, note) {
  const any = /<(\/?)template(\s[^>]*)?>/gi;
  let out = "";
  let last = 0;
  const stack = [];
  let m;
  while ((m = any.exec(html))) {
    out += html.slice(last, m.index);
    last = any.lastIndex;
    if (m[1]) {
      out += stack.pop() ? "</ng-container>" : "</template>";
      continue;
    }
    const attrs = m[2] ?? "";
    const is = /\bis\s*=\s*["'](dom-if|dom-repeat)["']/i.exec(attrs)?.[1];
    if (is === "dom-if") {
      const cond = /\bif\s*=\s*["']\s*(?:\[\[|\{\{)?\s*([^\]}"']+?)\s*(?:\]\]|\}\})?\s*["']/i.exec(attrs)?.[1] ?? "true";
      out += `<ng-container ng-if="${cond.trim()}">`;
      stack.push(true);
    } else if (is === "dom-repeat") {
      const list = /\bitems\s*=\s*["']\s*(?:\[\[|\{\{)?\s*([^\]}"']+?)\s*(?:\]\]|\}\})?\s*["']/i.exec(attrs)?.[1] ?? "items";
      const as = /\bas\s*=\s*["']([\w$]+)["']/i.exec(attrs)?.[1] ?? "item";
      out += `<ng-container ng-repeat="${as} in ${list.trim()}">`;
      stack.push(true);
    } else {
      out += m[0];
      stack.push(false);
    }
  }
  out += html.slice(last);
  if (stack.some(Boolean)) note("A Polymer structural template was left open; the lowering closed it at the end of the element.");
  return out;
}

/** One attribute's value lowered: a whole binding, a partial one, or plain. */
function lowerAttr(name, value, note) {
  const whole = /^\s*(\[\[|\{\{)\s*([\s\S]+?)\s*(\]\]|\}\})\s*$/.exec(value);
  if (whole) {
    const expr = whole[2];
    const twoWay = whole[1] === "{{";
    if (name === "on-" ) return null;
    if ((name === "value" || name === "checked") && twoWay) return { name: "ng-model", value: expr };
    if (name === "src") return { name: "ng-src", value: expr };
    if (name === "href") return { name: "ng-href", value: expr };
    if (twoWay) note(`\`${name}="{{${expr}}}"\` was two way in Polymer; the port binds it one way. Wire the write back by hand where the child changes it.`);
    return { name: `ng-attr-${name}`, value: expr };
  }
  // A value that mixes text and bindings becomes an interpolated attribute,
  // which the dialect reads directly.
  if (/\[\[|\{\{/.test(value)) {
    return { name, value: value.replace(/\[\[\s*([\s\S]+?)\s*\]\]/g, "{{ $1 }}").replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, "{{ $1 }}") };
  }
  return { name, value };
}

/** Lower every tag's attributes: bindings, events, and interpolation. */
function lowerTags(html, note) {
  return html.replace(/<([a-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/gi, (whole, tag, attrs, slash) => {
    const parts = [];
    const re = /([^\s=/<>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = re.exec(attrs))) {
      const name = a[1];
      if (name === "/") continue;
      const value = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : null;
      const onEvent = /^on-([\w-]+)$/i.exec(name);
      if (onEvent) {
        const mapped = EVENTS[onEvent[1].toLowerCase()];
        const handler = (value ?? "").replace(/[\[{]{2}|[\]}]{2}/g, "").trim();
        if (mapped) parts.push(`ng-${mapped}="${/[()]/.test(handler) ? handler : `${handler}()`}"`);
        else { parts.push(`data-on-${onEvent[1]}="${handler}"`); note(`\`on-${onEvent[1]}\` has no dialect event; it is kept as a data attribute for a person to wire.`); }
        continue;
      }
      if (value === null) { parts.push(name); continue; }
      const lowered = lowerAttr(name, value, note);
      if (lowered) parts.push(`${lowered.name}="${lowered.value.replace(/"/g, "'")}"`);
    }
    return `<${tag}${parts.length ? " " + parts.join(" ") : ""}${slash}>`;
  });
}

export function lowerPolymer(templateHtml, note = () => {}) {
  const structural = lowerStructural(templateHtml, note);
  const tagged = lowerTags(structural, note);
  // Any binding left in a text node is interpolation, in both spellings.
  return tagged
    .replace(/\[\[\s*([\s\S]+?)\s*\]\]/g, "{{ $1 }}")
    .replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, "{{ $1 }}");
}

/** Property names from `properties: {...}` or `static get properties()`. */
export function propertyNames(body) {
  const at = body.search(/\bproperties\s*(?::|\(\)\s*\{[\s\S]*?return\s*)/);
  if (at < 0) return [];
  const open = body.indexOf("{", at);
  const block = open < 0 ? null : balanced(body, open);
  if (!block) return [];

  // Split the object's entries at its top level commas, so a key only counts
  // when it sits directly in `properties`, not inside a `{ type: String }`.
  const inner = block.slice(1, -1);
  const names = new Set();
  let depth = 0;
  let quote = null;
  let start = 0;
  const entry = (text) => {
    const key = /^\s*([\w$]+)\s*:/.exec(text);
    if (key) names.add(key[1]);
  };
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (quote) { if (c === quote && inner[i - 1] !== "\\") quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if ("{([".includes(c)) depth += 1;
    else if ("})]".includes(c)) depth -= 1;
    else if (c === "," && depth === 0) { entry(inner.slice(start, i)); start = i + 1; }
  }
  entry(inner.slice(start));
  return [...names];
}

export function readModule(source, rel, note = () => {}) {
  const screens = [];
  const calls = [];
  const modules = [...source.matchAll(/<dom-module\s+id\s*=\s*["']([\w-]+)["'][^>]*>/gi)];
  for (const m of modules) {
    const id = m[1].toLowerCase();
    const template = moduleTemplate(source, m.index);
    const lowered = template ? lowerPolymer(template, note) : null;
    // The declared properties are the element's inputs, read from the class or
    // the Polymer factory wherever it sits in the same file.
    const inputs = propertyNames(source);
    const outputs = new Set();
    for (const e of source.matchAll(/(?:this\.)?(?:fire|dispatchEvent)\s*\(\s*(?:new\s+CustomEvent\s*\(\s*)?["']([\w-]+)["']/g)) outputs.add(e[1]);
    for (const a of source.matchAll(/<iron-ajax\b[^>]*\burl\s*=\s*["']([^"']+)["']/gi)) {
      calls.push({ method: "GET", path: a[1].replace(/\[\[|\]\]|\{\{|\}\}/g, "").trim(), file: rel, headers: null, body: null });
    }
    for (const f of source.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1/g)) {
      calls.push({ method: "GET", path: f[2], file: rel, headers: null, body: null });
    }
    screens.push({
      selector: id,
      className: pascal(id),
      file: rel,
      inputs,
      outputs: [...outputs],
      template: lowered,
      templateOrigin: lowered ? "a Polymer dom-module, lowered" : null,
      usesNgIf: /ng-if/.test(lowered ?? ""),
      usesNgFor: /ng-repeat/.test(lowered ?? ""),
      usesTwoWay: /ng-model/.test(lowered ?? ""),
      rxjs: [],
      readBy: "polymer",
    });
  }
  return { screens, calls };
}

export default {
  name: "input-polymer",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|js)$/i.test(f.rel));
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/<dom-module\b/i.test(text)) continue;
        const { screens, calls } = readModule(text, file.rel, note);
        for (const s of screens) {
          if (!s.template) ctx.unverified(`<${s.selector}> is a Polymer element with no template, so only its states can be ported.`);
          ctx.screens.push(s);
        }
        ctx.api.calls.push(...calls);
        count += screens.length;
      }
      if (!count) return log.debug("no Polymer elements");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Polymer element(s) lowered`);
    });
  },
};
