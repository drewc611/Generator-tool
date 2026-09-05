import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pascal } from "../dsp-ir/emit.js";

/**
 * Reads Ember components onto the same dialect every other reader targets.
 *
 * An Ember component is a Glimmer template, `.hbs`, beside or under a class
 * that names what it takes and what it says. The template is Handlebars with
 * Ember's own shapes: `{{#each list as |row|}}` with block params, `@arg` for
 * what the parent passed, `this.` for the component's own state, `{{on
 * "click" this.save}}` and classic `{{action "save"}}` for events, `<Input
 * @value={{this.q}} />` for a bound field, `<UserBadge @user={{x}} />` for a
 * child component, and `{{yield}}` for projected content. Each lowers onto
 * the attribute dialect: ng-if with its else chain, ng-repeat naming the
 * block param, ng-click and the other events, ng-model, ng-attr for a child's
 * arg, ng-transclude for the yield. A helper with an exact JS spelling (if,
 * eq, not, and, or, concat, fn) becomes that expression; any other helper
 * becomes a call and is named so a person confirms the function exists.
 *
 * Inputs are the `@args` the template reads and the `this.args.x` the class
 * reads; outputs are the `this.args.onX(...)` the class calls and any `@onX`
 * the template wires as a handler. A `@onX={{...}}` written on a child tag is
 * the child's arg, not this component's, and is not counted.
 *
 * Ownership of a `.hbs` file is decided by one exported predicate that the
 * handlebars reader honours too, so a template is read by exactly one of them.
 */

const attrSafe = (code) => String(code).replace(/"/g, "'");
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const EVENTS = new Set(["click", "submit", "change", "input", "keydown", "keyup", "keypress", "blur", "focus", "mouseenter", "mouseleave", "mouseover", "mousedown", "mouseup", "dblclick", "paste", "cut", "copy", "scroll"]);
const BOOL_ATTR = { disabled: "ng-disabled", checked: "ng-checked", readonly: "ng-readonly", hidden: "ng-hide", required: "ng-required", selected: "ng-selected" };

/** An Ember template: Glimmer shapes in the text, or the Ember components folder. */
export function isEmberTemplate(text, rel = "") {
  if (/(^|[\\/])components[\\/]/.test(rel) && /\.hbs$/i.test(rel)) return true;
  return /\{\{#each\s+[^}]*\s+as\s*\|/.test(text)
    || /\{\{@[\w.]+\}\}|\s@\w+=\{\{/.test(text)
    || /\{\{on\s+["']/.test(text)
    || /\{\{yield\b/.test(text)
    || /\{\{action\s+["']/.test(text)
    || /<[A-Z][A-Za-z0-9]*[\s/>]/.test(text)
    || /\{\{#(let|each-in)\s/.test(text)
    || /\{\{(input|textarea)\s/.test(text);
}

const plain = (e) => String(e).trim().replace(/\bthis\./g, "").replace(/@([\w.]+)/g, "$1");

/** Split helper arguments on whitespace, keeping quoted strings and (sub expressions) whole. */
function splitArgs(s) {
  const out = [];
  let cur = "", depth = 0, quote = null;
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.filter((a) => !/^\w+=/.test(a) || a.startsWith("this"));
}

function helperCall(name, args, note) {
  const a = args.map((x) => lowerExpr(x, note));
  switch (name) {
    case "if": return a.length >= 3 ? `(${a[0]} ? ${a[1]} : ${a[2]})` : `(${a[0]} ? ${a[1]} : "")`;
    case "unless": return a.length >= 3 ? `(!${a[0]} ? ${a[1]} : ${a[2]})` : `(!${a[0]} ? ${a[1]} : "")`;
    case "eq": return `(${a[0]} === ${a[1]})`;
    case "not-eq": return `(${a[0]} !== ${a[1]})`;
    case "not": return `!${a[0]}`;
    case "and": return `(${a.join(" && ")})`;
    case "or": return `(${a.join(" || ")})`;
    case "concat": return `(${a.join(" + ")})`;
    case "gt": return `(${a[0]} > ${a[1]})`;
    case "lt": return `(${a[0]} < ${a[1]})`;
    case "fn": return `${a[0]}(${a.slice(1).join(", ")})`;
    default:
      note(`The helper \`{{${name} ...}}\` became the call \`${name}(${a.join(", ")})\`. Confirm a function by that name exists in the port.`);
      return `${name}(${a.join(", ")})`;
  }
}

/** An Ember expression to the dialect's JS: helpers resolved, this. and @ stripped. */
export function lowerExpr(code, note = () => {}) {
  let e = String(code).trim();
  if (/^\(.*\)$/.test(e)) e = e.slice(1, -1).trim();
  const parts = splitArgs(e);
  if (parts.length > 1 && /^[a-z][\w-]*$/.test(parts[0]) && !/^(this|true|false|null)$/.test(parts[0])) return helperCall(parts[0], parts.slice(1), note);
  if (/^[a-z][\w-]*$/.test(parts[0]) && parts[0].includes("-")) { note(`The helper \`{{${e}}}\` became the call \`${e}()\`.`); return `${e}()`; }
  return plain(e);
}

/** A handler expression to a call: this.save -> save(), (fn this.pick x) -> pick(x), @onSave -> onSave(). */
function handlerCall(code, note) {
  const e = String(code).trim();
  if (/^\(fn\s/.test(e)) return lowerExpr(e, note);
  const p = plain(e);
  return /\(/.test(p) ? p : `${p}()`;
}

/** Rewrite the inside of one element tag: modifiers, @args, bound attributes. */
function lowerTag(tag, note, outputs) {
  let m = /^<([A-Za-z][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(tag);
  if (!m) return tag;
  let [, name, attrs, selfClose] = m;
  const isComponent = /^[A-Z]/.test(name);
  let elName = name;
  if (name === "Input") elName = "input";
  else if (name === "Textarea") elName = "textarea";
  else if (name === "LinkTo") { elName = "a"; note("`<LinkTo>` became an `<a>`; its `@route` is a router concern the port wires in src/app."); }
  else if (isComponent) elName = kebab(name);

  // {{on "event" handler}} and {{action "name" args}} modifiers.
  attrs = attrs.replace(/\{\{on\s+["'](\w+)["']\s+([\s\S]*?)\}\}/g, (_, ev, handler) => {
    if (!EVENTS.has(ev)) note(`\`{{on "${ev}"}}\` is an event the dialect has no attribute for; it was lowered as ng-${ev} and needs a hand check.`);
    const h = handler.trim();
    if (/^@on\w+$/.test(h)) outputs.add(plain(h));
    return ` ng-${ev}="${attrSafe(handlerCall(h, note))}"`;
  });
  attrs = attrs.replace(/\{\{action\s+["'](\w+)["']([^}]*)\}\}/g, (_, fn, rest) => {
    const args = splitArgs(rest).filter((a) => !/^on=/.test(a));
    const onM = /\bon=["'](\w+)["']/.exec(rest);
    const ev = onM ? onM[1] : "click";
    return ` ng-${ev}="${attrSafe(`${fn}(${args.map((a) => lowerExpr(a, note)).join(", ")})`)}"`;
  });

  // @arg={{expr}} on a component or a built in field.
  attrs = attrs.replace(/\s@(\w+)=\{\{([\s\S]*?)\}\}/g, (_, arg, expr) => {
    if ((elName === "input" || elName === "textarea") && (arg === "value" || arg === "checked")) return ` ng-model="${attrSafe(plain(expr))}"`;
    if (/^on[A-Z]/.test(arg)) return ` ng-${kebab(arg.slice(2))}="${attrSafe(handlerCall(expr, note))}"`;
    return ` ng-attr-${arg}="{{ ${attrSafe(lowerExpr(expr, note))} }}"`;
  });
  attrs = attrs.replace(/\s@(\w+)=(["'])([^"']*)\2/g, (_, arg, q, val) => ` ${arg}=${q}${val}${q}`);

  // Unquoted mustache attribute values: disabled={{this.busy}}, class={{if ...}}.
  attrs = attrs.replace(/\s([\w-]+)=\{\{([\s\S]*?)\}\}/g, (_, attr, expr) => {
    if (BOOL_ATTR[attr]) return ` ${BOOL_ATTR[attr]}="${attrSafe(plain(expr))}"`;
    return ` ${attr}="{{ ${attrSafe(lowerExpr(expr, note))} }}"`;
  });
  // Quoted values with mustaches inside stay as interpolation, lowered.
  attrs = attrs.replace(/\{\{([^#/!][\s\S]*?)\}\}/g, (_, expr) => `{{ ${lowerExpr(expr, note)} }}`);

  // One space between attributes and none before the close, whatever the
  // modifiers left behind; a built in field is a void element, a component
  // gets its closing tag.
  attrs = (" " + attrs).replace(/\s+/g, " ").trimEnd();
  if (elName === "input" && selfClose) return `<${elName}${attrs}>`;
  if (isComponent && selfClose) return `<${elName}${attrs}></${elName}>`;
  return `<${elName}${attrs}${selfClose}>`;
}

/** Lower a Glimmer template onto the attribute dialect. Returns { template, outputs }. */
export function lowerGlimmer(source, note = () => {}) {
  const outputs = new Set();
  let text = String(source ?? "").replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![\s\S]*?\}\}/g, "");

  // Element tags first, so a modifier or @arg inside a tag is not mistaken
  // for text interpolation. A tag can hold mustaches, so the match tolerates
  // braces inside it.
  text = text.replace(/<\/([A-Z][\w]*)>/g, (_, n) => `</${kebab(n)}>`);
  text = text.replace(/<[A-Za-z][\w:.-]*(?:[^<>{}]|\{\{[^}]*\}\})*\/?>/g, (tag) => lowerTag(tag, note, outputs));

  const out = [];
  const stack = [];
  let last = 0;
  const re = /\{\{\{?\s*([\s\S]*?)\s*\}?\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    last = re.lastIndex;
    const raw = m[0];
    const code = m[1].trim();
    const triple = raw.startsWith("{{{");

    if (code.startsWith("#if ")) { const t = lowerExpr(code.slice(4), note); out.push(`<ng-container ng-if="${attrSafe(t)}">`); stack.push({ kind: "if", tried: [t] }); continue; }
    if (code.startsWith("#unless ")) { const t = `!(${lowerExpr(code.slice(8), note)})`; out.push(`<ng-container ng-if="${attrSafe(t)}">`); stack.push({ kind: "if", tried: [t] }); continue; }
    if (code.startsWith("#each-in ")) {
      const em = /^#each-in\s+([\s\S]+?)\s+as\s*\|\s*(\w+)\s+(\w+)\s*\|$/.exec(code);
      if (em) { const list = plain(em[1]); out.push(`<ng-container ng-repeat="(${em[2]}, ${em[3]}) in ${attrSafe(list)}">`); stack.push({ kind: "each", item: em[3], list, openAt: out.length - 1 }); continue; }
    }
    if (code.startsWith("#each ")) {
      const em = /^#each\s+([\s\S]+?)(?:\s+as\s*\|\s*(\w+)(?:\s+(\w+))?\s*\|)?$/.exec(code);
      const list = plain(em ? em[1] : code.slice(6));
      const depth = stack.filter((f) => f.kind === "each").length + 1;
      const item = em?.[2] ?? `item${depth > 1 ? depth : ""}`;
      out.push(`<ng-container ng-repeat="${item} in ${attrSafe(list)}">`);
      stack.push({ kind: "each", item, index: em?.[3] ?? null, list, openAt: out.length - 1 });
      continue;
    }
    if (code.startsWith("#let ")) {
      const lm = /^#let\s+([\s\S]+?)\s+as\s*\|\s*([\w\s]+?)\s*\|$/.exec(code);
      note(`\`{{#let ${lm ? lm[1] : ""}}}\` binds ${lm ? `\`${lm[2].trim()}\`` : "a local"}; the dialect has no local binding, so the block was kept and the name needs a local in the port.`);
      out.push("<ng-container>"); stack.push({ kind: "let" }); continue;
    }
    if (code === "else" || code.startsWith("else if ")) {
      const frame = stack[stack.length - 1];
      if (frame?.kind === "if") {
        const nots = frame.tried.map((c) => `!(${c})`);
        const own = code.startsWith("else if ") ? lowerExpr(code.slice(8), note) : null;
        const test = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
        if (own) frame.tried.push(own);
        out.push(`</ng-container><ng-container ng-if="${attrSafe(test)}">`);
      } else if (frame?.kind === "each") {
        out.push(`</ng-container><ng-container ng-if="!${attrSafe(frame.list)} || !${attrSafe(frame.list)}.length">`);
        frame.kind = "if"; frame.tried = [];
      }
      continue;
    }
    if (/^\/(if|unless|each|each-in|let)$/.test(code)) { if (stack.length) { stack.pop(); out.push("</ng-container>"); } continue; }
    if (/^yield\b/.test(code)) {
      if (/\bto=/.test(code)) note(`\`{{${code}}}\` yields to a named block; the dialect carries one projection, so it was lowered as the default and needs a named slot by hand.`);
      out.push("<ng-transclude></ng-transclude>"); continue;
    }
    if (code === "outlet") { note("`{{outlet}}` is the router's slot; it was lowered as a projection and the route lives in src/app."); out.push("<ng-transclude></ng-transclude>"); continue; }

    // A block param used as the index reshapes the loop that declared it.
    const eachFrame = [...stack].reverse().find((f) => f.kind === "each");
    if (eachFrame && (code === eachFrame.index || code === "@index")) {
      out[eachFrame.openAt] = `<ng-container ng-repeat="${eachFrame.item} in ${attrSafe(eachFrame.list)} track by $index">`;
      out.push("{{ $index }}"); continue;
    }

    const expr = lowerExpr(code, note);
    if (triple) { out.push(`<ng-container ng-bind-html="${attrSafe(expr)}"></ng-container>`); continue; }
    out.push(`{{ ${expr} }}`);
  }
  out.push(text.slice(last));
  while (stack.length) { stack.pop(); out.push("</ng-container>"); }
  return { template: out.join(""), outputs: [...outputs] };
}

/** The @args the template reads (in mustaches, not on a child tag) and the class's this.args. */
export function readMembers(template, source) {
  const inputs = new Set();
  const outputs = new Set();
  for (const m of template.matchAll(/\{\{[^}]*?@(\w+)/g)) inputs.add(m[1]);
  // `@x={{...}}` on a child tag is the child's arg: remove any input that only appears that way.
  for (const m of template.matchAll(/\s@(\w+)=\{\{/g)) { if (!new RegExp(`\\{\\{[^}]*?@${m[1]}(?![\\w=])`).test(template)) inputs.delete(m[1]); }
  for (const m of (source ?? "").matchAll(/this\.args\.(\w+)\s*\??\.?\(/g)) outputs.add(m[1]);
  for (const m of (source ?? "").matchAll(/this\.args\.(\w+)/g)) if (!outputs.has(m[1])) inputs.add(m[1]);
  for (const o of outputs) inputs.delete(o);
  return { inputs: [...inputs], outputs: [...outputs] };
}

export function readComponent({ template, source, rel }, note = () => {}) {
  const selector = kebab(basename(rel).replace(/\.hbs$/i, "")).replace(/[^\w-]/g, "-");
  const lowered = lowerGlimmer(template, note);
  const members = readMembers(template, source);
  const outputs = [...new Set([...members.outputs, ...lowered.outputs])];
  return {
    selector,
    className: pascal(selector),
    file: rel,
    inputs: members.inputs.filter((i) => !outputs.includes(i)),
    outputs,
    template: lowered.template,
    templateOrigin: "an Ember component, lowered",
    usesNgIf: /ng-if/.test(lowered.template),
    usesNgFor: /ng-repeat/.test(lowered.template),
    usesTwoWay: /ng-model/.test(lowered.template),
    rxjs: [],
    readBy: "ember",
  };
}

/** The class beside the template: colocated, or app/components/<name>.js for a classic layout. */
async function classFor(file, files) {
  const stem = file.rel.replace(/\.hbs$/i, "");
  const candidates = [`${stem}.js`, `${stem}.ts`, stem.replace(/(^|\/)templates\/components\//, "$1components/") + ".js"];
  const hit = files.find((f) => candidates.includes(f.rel));
  return hit ? readFile(hit.path, "utf8").catch(() => "") : "";
}

export default {
  name: "input-ember",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files;
      const templates = files.filter((f) => /\.hbs$/i.test(f.rel));
      if (!templates.length) return log.debug("no .hbs templates to read for Ember");
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of templates) {
        const template = await readFile(file.path, "utf8").catch(() => "");
        if (!template || !isEmberTemplate(template, file.rel)) continue;
        const source = await classFor(file, files);
        const screen = readComponent({ template, source, rel: file.rel }, note);
        for (const m of source.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1/g)) ctx.api.calls.push({ method: "GET", path: m[2], file: file.rel, headers: null, body: null });
        ctx.screens.push(screen);
        count += 1;
      }
      if (!count) return log.debug("no Ember components read");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Ember component(s) lowered`);
    });
  },
};
