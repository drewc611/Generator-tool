import { objectLiteralEntries, parse, splitPipes, styleEntries, VOID } from "./parse.js";

/**
 * One representation, in the middle.
 *
 * Every reader turns its own dialect into this, and every emitter turns this
 * into its own target. Without it, porting N frameworks to M frameworks means
 * N times M translators, and the second target is as much work as the first.
 * With it, a reader is one dialect table and an emitter is one printer.
 *
 * The IR says what the markup means, not how anybody spells it:
 *
 *   { kind: "element", tag, attrs, classes, styles, events, model, children }
 *   { kind: "text", parts: [{ literal } | { expression }] }
 *   { kind: "when", test, children }          an if
 *   { kind: "each", list, item, index, key, children }
 *   { kind: "slot" }                          projected children
 *   { kind: "html", expression }              raw, and it says so
 *   { kind: "fragment", children }
 *   { kind: "comment", text }
 */

// `slot` never means anything else in an Angular template and `ng-content`
// never appears in a Vue one, so these do not need the dialect to be known.
const SLOT = new Set(["ng-content", "slot"]);
const TRANSPARENT = new Set(["ng-container", "ng-template", "template"]);

export const DIALECTS = {
  angular: {
    name: "angular",
    when: (n) => (n === "*ngIf" ? "test" : null),
    each: (n) => (n === "*ngFor" ? "loop" : null),
    model: (n) => /^\[\(ngModel\)\]$/.test(n),
    bound: (n) => (/^\[[^\]]+\]$/.test(n) ? n.slice(1, -1) : null),
    event: (n) => (/^\([\w.:-]+\)$/.test(n) ? n.slice(1, -1) : null),
    html: (n) => n === "[innerHTML]",
    show: () => false,
    slot: (t) => t === "ng-content",
    transparent: (t) => t === "ng-container" || t === "ng-template",
    structural: (n) => /^\*ng/.test(n) || n.startsWith("#"),
    loop: (value) => {
      const m = /let\s+([\w$]+)\s+of\s+([^;]+)/.exec(value);
      if (!m) return null;
      return {
        item: m[1],
        list: m[2].trim(),
        index: /index\s+as\s+([\w$]+)/.exec(value)?.[1] ?? null,
        trackBy: /trackBy\s*:\s*([\w$.]+)/.exec(value)?.[1] ?? null,
      };
    },
  },
  vue: {
    name: "vue",
    when: (n) => (n === "v-if" || n === "v-else-if" ? "test" : null),
    each: (n) => (n === "v-for" ? "loop" : null),
    model: (n) => n === "v-model" || n.startsWith("v-model:"),
    bound: (n) => (n.startsWith(":") && n.length > 1 ? n.slice(1) : /^v-bind:(.+)$/.exec(n)?.[1] ?? null),
    event: (n) => (n.startsWith("@") ? n.slice(1).split(".")[0] : /^v-on:(.+)$/.exec(n)?.[1]?.split(".")[0] ?? null),
    html: (n) => n === "v-html",
    show: (n) => n === "v-show",
    slot: (t) => t === "slot",
    transparent: (t) => t === "template",
    structural: (n) => /^(v-if|v-else-if|v-else|v-for|v-cloak|v-pre|v-once|v-show|v-html|key)$/.test(n) || n === "ref",
    loop: (value) => {
      const m = /^\s*\(?\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\)?\s+(?:in|of)\s+(.+)$/.exec(value);
      return m ? { item: m[1], list: m[3].trim(), index: m[2] ?? null, trackBy: null } : null;
    },
  },
};

/** Which dialect wrote this, judged by what is actually in it. */
export function detectDialect(html) {
  const text = String(html ?? "");
  const angular = (text.match(/\*ngIf|\*ngFor|\[\(ngModel\)\]|\(click\)|\[[\w.]+\]=/g) ?? []).length;
  const vue = (text.match(/v-if|v-for|v-model|v-show|v-html|v-bind|v-on|@[\w-]+=|:[\w-]+=/g) ?? []).length;
  return vue > angular ? DIALECTS.vue : DIALECTS.angular;
}

const GLOBALS = new Set(["true", "false", "null", "undefined", "this", "new", "typeof", "in", "of",
  "Math", "JSON", "Intl", "Object", "Array", "String", "Number", "Boolean", "Date", "event", "children"]);

function rootIdentifiers(code) {
  // A word inside a string is text, not a name.
  const bare = String(code).replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');
  const found = [];
  const re = /(\.\s*)?\b([A-Za-z_$][\w$]*)\b(\s*:)?/g;
  let m;
  while ((m = re.exec(bare))) {
    if (m[1] || m[3] || GLOBALS.has(m[2])) continue;
    found.push(m[2]);
  }
  return found;
}

export function buildIr(html, { dialect } = {}) {
  const d = dialect ?? detectDialect(html);
  const notes = [];
  const models = new Set();
  const reads = new Set();
  const locals = new Set();
  const lists = new Set();

  const note = (text) => {
    if (!notes.includes(text)) notes.push(text);
  };

  const expr = (raw) => {
    const { value, pipes } = splitPipes(String(raw ?? "").trim());
    if (pipes) {
      note(`The \`${pipes.split(":")[0].trim()}\` filter has no direct equivalent. \`${value}\` is passed through unformatted.`);
    }
    const code = value.replace(/\$event/g, "event");
    for (const id of rootIdentifiers(code)) reads.add(id);
    return code;
  };

  const nodes = parse(html ?? "").map((n) => convert(n, d, { expr, note, models, locals, lists }));
  const clean = nodes.filter(Boolean);
  const root = clean.length === 1 ? clean[0] : { kind: "fragment", children: clean };

  const modelRoots = new Set([...models].map((m) => m.split(".")[0]));
  return {
    dialect: d.name,
    root,
    notes,
    models: [...models],
    reads: [...reads].filter((n) => !locals.has(n) && !modelRoots.has(n)).sort(),
    collections: [...lists],
  };
}

function convert(node, d, ctx) {
  if (node.type === "comment") return { kind: "comment", text: node.text };
  if (node.type === "text") {
    const parts = interpolate(node.text, ctx.expr);
    return parts.some((p) => p.expression !== undefined || p.literal.trim()) ? { kind: "text", parts } : null;
  }

  const tag = node.tag.toLowerCase();
  if (SLOT.has(tag)) return { kind: "slot" };

  const structural = {};
  for (const { name, value } of node.attrs) {
    if (d.when(name)) structural.when = value;
    else if (d.each(name)) structural.each = value;
    else if (d.html(name)) structural.html = value;
  }

  if (structural.html !== undefined) {
    ctx.note(`<${node.tag}> injected raw markup. It is kept, and it is the same trust decision under whatever name the target gives it.`);
  }

  const element = structural.html !== undefined
    ? { kind: "html", expression: ctx.expr(structural.html) }
    : buildElement(node, d, ctx);

  let out = element;

  if (structural.each !== undefined) {
    const loop = d.loop(structural.each);
    if (!loop) {
      ctx.note(`Could not read the loop on <${node.tag}>: \`${structural.each}\`. Kept as a plain element.`);
    } else {
      ctx.locals.add(loop.item);
      if (loop.index) ctx.locals.add(loop.index);
      const list = ctx.expr(loop.list);
      ctx.lists.add(list);
      if (loop.trackBy) ctx.expr(loop.trackBy.split(".")[0]);
      const authored = element.kind === "element" ? element.attrs.find((a) => a.name === "key") : null;
      if (!loop.trackBy && !loop.index && !authored) {
        ctx.note(`<${node.tag}> is repeated without a stable key. It falls back to \`${loop.item}.id\`; give it one if the rows can reorder.`);
      }
      out = {
        kind: "each",
        list,
        item: loop.item,
        index: loop.index,
        // An author who named the key already answered this better than a
        // derived one can.
        key: authored ? authored.expression : loop.trackBy ? `${loop.trackBy}(${loop.index ?? 0}, ${loop.item})` : loop.index ?? `${loop.item}.id ?? ${loop.item}`,
        children: [out],
      };
    }
  }

  if (structural.when !== undefined) {
    const raw = String(structural.when);
    const alias = /^(.*?)\s+as\s+[\w$]+$/.exec(raw);
    if (alias) ctx.note(`\`${raw}\` bound an alias. The condition alone was kept.`);
    const elseRef = /;\s*else\s+([\w$]+)/.exec(raw);
    if (elseRef) ctx.note(`<${node.tag}> had an \`else ${elseRef[1]}\` branch. Wire the fallback in by hand.`);
    out = { kind: "when", test: ctx.expr((alias ? alias[1] : raw).replace(/;\s*else\s+[\w$]+/, "")), children: [out] };
  }

  return out;
}

function buildElement(node, d, ctx) {
  const attrs = [];
  const classes = [];
  const styles = [];
  const events = [];
  let model = null;
  let staticClass = null;

  for (const { name, value } of node.attrs) {
    if (d.show?.(name)) {
      // Hiding is not the same as not rendering, and dropping it puts
      // something on screen the original kept off it.
      styles.push({ kind: "declaration", property: "display", expression: `${ctx.expr(value)} ? undefined : "none"` });
      continue;
    }
    if (d.structural(name) || d.when(name) || d.each(name) || d.html(name)) {
      // key and ref are read below where they matter, not dropped silently.
      if (name === "key" || name === ":key") attrs.push({ name: "key", kind: "bound", expression: ctx.expr(value) });
      continue;
    }

    if (d.model(name)) {
      model = ctx.expr(value);
      ctx.models.add(model);
      continue;
    }

    const event = d.event(name);
    if (event) {
      events.push({ name: event, handler: ctx.expr(value) });
      continue;
    }

    const bound = d.bound(name);
    if (bound) {
      const code = ctx.expr(value);
      if (bound === "ngClass" || bound === "class") {
        const entries = objectLiteralEntries(code);
        if (entries) for (const e of entries) classes.push({ kind: "conditional", when: e.value, name: e.key });
        else {
          classes.push({ kind: "expression", expression: code });
          ctx.note(`\`${bound}="${code}"\` on <${node.tag}> was not an object literal. It is used as is; confirm it produces class names.`);
        }
      } else if (bound === "ngStyle" || bound === "style") {
        styles.push({ kind: "spread", expression: code });
      } else if (bound.startsWith("class.")) {
        classes.push({ kind: "conditional", when: code, name: bound.slice(6) });
      } else if (bound.startsWith("style.")) {
        const [property, unit] = bound.slice(6).split(".");
        styles.push({ kind: "declaration", property, expression: code, unit: unit ?? null });
      } else if (bound.startsWith("attr.")) {
        attrs.push({ name: bound.slice(5), kind: "bound", expression: code });
      } else {
        attrs.push({ name: bound, kind: "bound", expression: code });
      }
      continue;
    }

    if (name.toLowerCase() === "class") { staticClass = value ?? ""; continue; }
    if (name.toLowerCase() === "style" && value) {
      for (const e of styleEntries(value)) styles.push({ kind: "declaration", property: e.property, literal: e.value });
      continue;
    }
    if (value === null) attrs.push({ name, kind: "flag" });
    else if (/\{\{/.test(value)) attrs.push({ name, kind: "template", parts: interpolate(value, ctx.expr) });
    else attrs.push({ name, kind: "static", value });
  }

  if (staticClass !== null) classes.unshift({ kind: "literal", value: staticClass });

  const tag = node.tag.toLowerCase();
  return {
    kind: "element",
    tag: TRANSPARENT.has(tag) ? null : node.tag,
    void: VOID.has(tag),
    attrs, classes, styles, events, model,
    children: node.children.map((c) => convert(c, d, ctx)).filter(Boolean),
  };
}

export function interpolate(text, expr) {
  const parts = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    parts.push({ literal: text.slice(last, m.index) });
    parts.push({ expression: expr(m[1]) });
    last = re.lastIndex;
  }
  parts.push({ literal: text.slice(last) });
  return parts;
}
