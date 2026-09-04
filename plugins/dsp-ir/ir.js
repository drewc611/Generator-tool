import { objectLiteralEntries, parse, splitPipes, styleEntries, VOID } from "./parse.js";
import { lowerBlocks } from "./blocks.js";
import { jsString } from "./emit.js";

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
  angularjs: {
    name: "angularjs",
    when: (n) => (n === "ng-if" || n === "data-ng-if" ? "test" : null),
    each: (n) => (n === "ng-repeat" || n === "data-ng-repeat" ? "loop" : null),
    model: (n) => n === "ng-model" || n === "data-ng-model",
    // ng-bind is one way text; ng-attr-* is a bound attribute in a costume.
    bound: (n) => {
      const m = /^(?:data-)?ng-attr-(.+)$/.exec(n);
      if (m) return m[1];
      if (n === "ng-src") return "src";
      if (n === "ng-href") return "href";
      if (n === "ng-class") return "ngClass";
      if (n === "ng-style") return "ngStyle";
      if (n === "ng-value") return "value";
      if (n === "ng-disabled") return "disabled";
      // The remaining boolean directives each drive one HTML flag.
      const flag = /^(?:data-)?ng-(checked|selected|readonly|required|open|multiple)$/.exec(n);
      if (flag) return flag[1] === "readonly" ? "readOnly" : flag[1];
      return null;
    },
    text: (n) => (/^(?:data-)?ng-bind$/.test(n) ? "expr" : /^(?:data-)?ng-bind-template$/.test(n) ? "template" : null),
    event: (n) => /^(?:data-)?ng-(click|change|submit|blur|focus|keyup|keydown|mouseover|mouseout|dblclick)$/.exec(n)?.[1] ?? null,
    html: (n) => n === "ng-bind-html",
    // ng-show and ng-hide are the same directive with the test inverted.
    show: (n) => (n === "ng-show" ? "show" : n === "ng-hide" ? "hide" : false),
    slot: (t) => t === "ng-transclude",
    transparent: (t) => t === "ng-transclude",
    // ng-switch-when carries a literal, not an expression: `ng-switch-when="new"`
    // compares against the string "new". Reading it as code would turn a label
    // into a variable.
    switchOn: (n) => (n === "ng-switch" || n === "data-ng-switch" ? "expr" : null),
    switchCase: (n) => (n === "ng-switch-when" || n === "data-ng-switch-when" ? "literal" : null),
    switchDefault: (n) => n === "ng-switch-default" || n === "data-ng-switch-default",
    options: (n) => n === "ng-options" || n === "data-ng-options",
    structural: (n) => /^(?:data-)?ng-(controller|app|init|cloak|repeat-start|repeat-end|switch|switch-when|switch-default)$/.test(n),
    loop: (value) => {
      // `item in items | filter:q track by item.id`, and the (key, value)
      // form over an object. The filter narrows the list at runtime, which a
      // static reader cannot do, so it is stripped and said.
      const m = /^\s*(?:\(\s*([\w$]+)\s*,\s*([\w$]+)\s*\)|([\w$]+))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+))?$/.exec(value);
      if (!m) return null;
      const item = m[3] ?? m[2];
      const index = m[3] ? null : m[1];
      let list = m[4].trim();
      let note = null;
      const filtered = /^([^|]+)\|/.exec(list);
      if (filtered) {
        note = `\`${list}\` narrows the list with a filter at render time. The whole list is used; reapply the filter in the port.`;
        list = filtered[1].trim();
      }
      const track = m[5]?.trim();
      return {
        item, list, note,
        index: track === "$index" ? "$index" : index,
        trackBy: null,
        // The (key, value) form iterates an object's entries, not an array,
        // and a printer that maps over it produces nothing.
        object: Boolean(m[1] && m[2]),
        // ng's track by is an expression, not a function, so it already is
        // the key.
        key: track && track !== "$index" ? track : track === "$index" ? "$index" : null,
      };
    },
  },

  knockout: {
    name: "knockout",
    // foreach repeats what is inside the element, not the element. ng-repeat
    // and v-for repeat the element itself. Getting this wrong multiplies the
    // container instead of the rows.
    loopWrapsChildren: true,
    when: (n) => (n === "ko-if" ? "test" : null),
    each: (n) => (n === "ko-foreach" ? "loop" : null),
    model: (n) => n === "ko-model",
    bound: (n) => {
      const attr = /^ko-attr-(.+)$/.exec(n);
      if (attr) return attr[1];
      if (n === "ko-css") return "ngClass";
      if (n === "ko-styles") return "ngStyle";
      return null;
    },
    event: (n) => /^ko-on-(.+)$/.exec(n)?.[1] ?? null,
    // knockout binds a function and calls it with the row and the event; the
    // other dialects bind a call. A bare name becomes a bare call, and the
    // note below says what was lost rather than inventing an argument.
    handler: (value, note) => {
      if (/^[\w$.]+$/.test(value.trim())) {
        note(
          "knockout called a bound handler with the row and the event. The port calls it with the event " +
          "alone; where a handler needs its row, wire it through by hand: (o) => pick(o)."
        );
        return `${value.trim()}(event)`;
      }
      return value;
    },
    html: (n) => n === "ko-html",
    show: (n) => (n === "ko-visible" ? "show" : false),
    slot: () => false,
    transparent: () => false,
    structural: (n) => /^ko-unmapped-/.test(n),
    loop: (value) => {
      const m = /^\s*([\w$]+)\s+in\s+([\s\S]+)$/.exec(value);
      return m ? { item: m[1], list: m[2].trim(), index: null, trackBy: null, key: null } : null;
    },
  },

  angular: {
    name: "angular",
    when: (n) => (n === "*ngIf" ? "test" : null),
    each: (n) => (n === "*ngFor" ? "loop" : null),
    switchOn: (n) => (n === "[ngSwitch]" || n === "ngSwitch" ? "expr" : null),
    switchCase: (n) => (n === "*ngSwitchCase" ? "expr" : null),
    switchDefault: (n) => n === "*ngSwitchDefault",
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
    when: (n) => (n === "v-if" ? "test" : null),
    elseIf: (n) => n === "v-else-if",
    elseFlag: (n) => n === "v-else",
    each: (n) => (n === "v-for" ? "loop" : null),
    model: (n) => n === "v-model" || n.startsWith("v-model:") || n.startsWith("v-model."),
    bound: (n) => (n.startsWith(":") && n.length > 1 ? n.slice(1) : /^v-bind:(.+)$/.exec(n)?.[1] ?? null),
    event: (n) => (n.startsWith("@") ? n.slice(1).split(".")[0] : /^v-on:(.+)$/.exec(n)?.[1]?.split(".")[0] ?? null),
    // The dots after the event name each change when or how the handler runs.
    eventMods: (n) => (n.startsWith("@") ? n.slice(1).split(".").slice(1) : /^v-on:(.+)$/.exec(n)?.[1]?.split(".").slice(1) ?? []),
    html: (n) => n === "v-html",
    show: (n) => n === "v-show",
    slot: (t) => t === "slot",
    transparent: (t) => t === "template",
    text: (n) => (n === "v-text" ? "expr" : null),
    pre: (n) => n === "v-pre",
    once: (n) => n === "v-once",
    dynamic: (t) => t === "component",
    structural: (n) => /^(v-if|v-else-if|v-else|v-for|v-cloak|v-pre|v-once|v-show|v-html|key)$/.test(n) || n === "ref",
    loop: (value) => {
      const m = /^\s*\(?\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\)?\s+(?:in|of)\s+(.+)$/.exec(value);
      if (!m) return null;
      const list = m[3].trim();
      // `v-for="n in 5"` counts from one; the port spells the range out so
      // the number stays visible instead of becoming a magic array.
      if (/^\d+$/.test(list)) {
        return { item: m[1], list, index: m[2] ?? null, trackBy: null, range: true, key: m[1] };
      }
      return { item: m[1], list, index: m[2] ?? null, trackBy: null };
    },
  },
};

/** Which dialect wrote this, judged by what is actually in it. */
export function detectDialect(html) {
  const text = String(html ?? "");
  const angular = (text.match(/\*ngIf|\*ngFor|\[\(ngModel\)\]|\(click\)|\[[\w.]+\]=/g) ?? []).length;
  const vue = (text.match(/v-if|v-else|v-for|v-model|v-show|v-html|v-bind|v-on|@[\w-]+=|:[\w-]+=/g) ?? []).length;
  const angularjs = (text.match(/\bng-(if|repeat|model|click|show|hide|controller|class|src|href|change|submit|switch|switch-when|switch-default|bind-html)[= ]/g) ?? []).length;
  const knockout = (text.match(/\bko-(if|foreach|model|visible|on-\w+|html|css|attr-\w+)=/g) ?? []).length;
  if (knockout > angular && knockout > vue && knockout > angularjs) return DIALECTS.knockout;
  if (angularjs > angular && angularjs > vue) return DIALECTS.angularjs;
  return vue > angular ? DIALECTS.vue : DIALECTS.angular;
}

/**
 * Filters with an exact JS spelling are rewritten instead of noted. The table
 * holds only transforms whose meaning is complete in the name: casing, JSON,
 * slicing. `currency`, `date` and `number` are locale decisions and stay
 * reported, because a wrong format that parses is worse than a visible gap.
 */
const PIPE_MAP = {
  uppercase: (v) => `String(${v}).toUpperCase()`,
  lowercase: (v) => `String(${v}).toLowerCase()`,
  // jinja spells the same two transforms shorter.
  upper: (v) => `String(${v}).toUpperCase()`,
  lower: (v) => `String(${v}).toLowerCase()`,
  length: (v) => `(${v}).length`,
  json: (v) => `JSON.stringify(${v}, null, 2)`,
  slice: (v, args) => (args.length ? `(${v}).slice(${args.join(", ")})` : null),
  limitTo: (v, args) => (args.length === 1 ? `(${v}).slice(0, ${args[0]})` : null),
};

/** `slice:1:3` into its arguments, without cutting a colon inside a string. */
function splitColons(text) {
  const parts = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = null;
    } else if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === ":") { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
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
    let { value, pipes } = splitPipes(String(raw ?? "").trim());
    while (pipes) {
      const step = splitPipes(pipes);
      const [name, ...args] = splitColons(step.value);
      const rewritten = PIPE_MAP[name] ? PIPE_MAP[name](value, args) : null;
      if (!rewritten) {
        note(`The \`${name}\` filter has no direct equivalent. \`${value}\` is passed through unformatted.`);
        break;
      }
      value = rewritten;
      pipes = step.pipes;
    }
    let code = value.replace(/\$event/g, "event");
    // $emit("pick", row) in Vue and pick.emit(row) in Angular both mean
    // "call this component's output". The callback prop is that meaning in
    // every target, so the IR spells it that way; a printer for the source
    // framework simply prints the prop it would have received anyway.
    const callback = (name) => {
      const clean = String(name).replace(/[:.]/g, "-").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return `on${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
    };
    if (d.name === "vue") {
      code = code.replace(/\$emit\(\s*['"]([\w$:.-]+)['"]\s*(?:,\s*)?/g, (m, name) => `${callback(name)}(`);
    }
    if (d.name === "angular") {
      code = code.replace(/\b([\w$]+)\.emit\(/g, (m, name) => `${callback(name)}(`);
    }
    for (const id of rootIdentifiers(code)) reads.add(id);
    return code;
  };

  // Angular's block syntax cannot be parsed as markup, so it is lowered onto
  // the attribute dialect first. Any other dialect passes through untouched.
  const lowered = lowerBlocks(html ?? "", note);
  const tree = parse(lowered);
  // A named <ng-template #ref> is content waiting for a reference. Harvested
  // before conversion so an else branch can resolve to it wherever it sits.
  const templates = harvestTemplates(tree);
  const clean = convertList(tree, d, { expr, note, models, locals, lists, templates }, null);
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

/** Pull named ng-template blocks out of the tree, keyed by their #ref. */
function harvestTemplates(nodes) {
  const found = new Map();
  const walk = (list) => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const node = list[i];
      if (node.type !== "element") continue;
      const ref = node.tag?.toLowerCase() === "ng-template" ? node.attrs.find((a) => a.name.startsWith("#")) : null;
      if (ref) {
        found.set(ref.name.slice(1), node.children);
        list.splice(i, 1);
        continue;
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return found;
}

/**
 * Siblings are where else lives. A branch that says "otherwise" only means
 * something next to the branch it follows, so the chain is folded here, at the
 * list level: each later branch carries the negation of everything before it,
 * exactly as blocks.js does for Angular's @else. Whitespace and comments
 * between branches do not break the chain; anything rendered does.
 */
function convertList(nodes, d, ctx, sw) {
  const out = [];
  let chain = null;
  for (const node of nodes) {
    if (node.type === "text") {
      const converted = convert(node, d, ctx);
      if (converted) { out.push(converted); chain = null; }
      continue;
    }
    if (node.type === "comment") { out.push(convert(node, d, ctx)); continue; }

    // Direct children of a switch container: each case is an equality test
    // against the subject, and the default is everything the cases are not.
    const caseAttr = sw ? node.attrs.find((a) => d.switchCase?.(a.name)) : null;
    const defaultAttr = sw && !caseAttr ? node.attrs.find((a) => d.switchDefault?.(a.name)) : null;
    if (caseAttr || defaultAttr) {
      node.attrs = node.attrs.filter((a) => a !== caseAttr && a !== defaultAttr);
      const converted = convert(node, d, ctx);
      if (converted) {
        const test = caseAttr
          ? `(${sw.subject}) === (${d.switchCase(caseAttr.name) === "literal" ? jsString(caseAttr.value ?? "") : ctx.expr(caseAttr.value)})`
          : sw.seen.map((t) => `!(${t})`).join(" && ") || "true";
        if (caseAttr) sw.seen.push(test);
        out.push({ kind: "when", test, children: [converted] });
      }
      chain = null;
      continue;
    }

    const elseIf = d.elseIf ? node.attrs.find((a) => d.elseIf(a.name)) : null;
    const elseFlag = !elseIf && d.elseFlag ? node.attrs.find((a) => d.elseFlag(a.name)) : null;
    if (elseIf || elseFlag) {
      if (!chain) {
        ctx.note(`<${node.tag}> carries an else with no if beside it. Its condition was kept as written; check the branch it was meant to follow.`);
      }
      node.attrs = node.attrs.filter((a) => a !== elseIf && a !== elseFlag);
      const converted = convert(node, d, ctx);
      const own = elseIf ? ctx.expr(elseIf.value) : null;
      const nots = (chain ?? []).map((t) => `!(${t})`);
      const test = own ? (nots.length ? [...nots, `(${own})`].join(" && ") : own) : nots.join(" && ");
      if (converted) {
        if (test) out.push({ kind: "when", test, children: [converted] });
        else out.push(converted);
      }
      chain = own ? [...(chain ?? []), own] : null;
      continue;
    }

    const opensChain = node.attrs.some((a) => d.when(a.name));
    const converted = convert(node, d, ctx);
    if (converted) out.push(converted);
    chain = opensChain && converted?.kind === "when" ? [converted.test] : null;
  }
  return out;
}

function convert(node, d, ctx) {
  if (node.type === "comment") return { kind: "comment", text: node.text };
  if (node.type === "text") {
    const parts = interpolate(node.text, ctx.expr);
    return parts.some((p) => p.expression !== undefined || p.literal.trim()) ? { kind: "text", parts } : null;
  }

  const tag = node.tag.toLowerCase();
  if (SLOT.has(tag)) {
    // A named slot is a second insertion point and its children are the
    // fallback, shown when the caller passes nothing for it.
    const named = node.attrs.find((a) => a.name === "name")?.value
      ?? node.attrs.find((a) => a.name === "select")?.value?.replace(/^\[/, "").replace(/\]$/, "")
      ?? null;
    const name = named && /^[\w$-]+$/.test(named) ? named : null;
    if (named && !name) ctx.note(`A slot selects on \`${named}\`, which is not a simple name. It is kept as the default slot; split it by hand.`);
    if (name) ctx.expr(name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
    return { kind: "slot", name, children: convertList(node.children ?? [], d, ctx, null) };
  }

  // v-pre asks for no compilation at all: the subtree is carried as written,
  // mustaches included, because the author said these braces are text.
  if (d.pre && node.attrs.some((a) => d.pre(a.name))) return literalElement(node, d);

  if (d.once && node.attrs.some((a) => d.once(a.name))) {
    ctx.note(`<${node.tag}> rendered once and froze. The port re-renders it with state; memoize it by hand if the freeze mattered.`);
  }

  const structural = {};
  for (const { name, value } of node.attrs) {
    if (d.when(name)) structural.when = value;
    else if (d.each(name)) structural.each = value;
    else if (d.html(name)) structural.html = value;
  }

  if (structural.html !== undefined) {
    ctx.note(`<${node.tag}> injected raw markup. It is kept, and it is the same trust decision under whatever name the target gives it.`);
  }

  // A switch names its subject on the container and its values on the
  // children, so the subject is read here and handed to the child pass.
  let childSw = null;
  const switchAttr = d.switchOn ? node.attrs.find((a) => d.switchOn(a.name)) : null;
  if (switchAttr) {
    const consumed = [switchAttr];
    let subject = switchAttr.value;
    if (!subject) {
      // AngularJS also spells it `ng-switch on="status"`.
      const on = node.attrs.find((a) => a.name === "on");
      if (on) { subject = on.value; consumed.push(on); }
    }
    node.attrs = node.attrs.filter((a) => !consumed.includes(a));
    if (subject) childSw = { subject: ctx.expr(subject), seen: [] };
    else ctx.note(`<${node.tag}> switches on nothing readable; its cases render unconditionally.`);
  }

  const element = structural.html !== undefined
    ? { kind: "html", expression: ctx.expr(structural.html) }
    : buildElement(node, d, ctx, childSw);

  let out = element;

  if (structural.each !== undefined) {
    const loop = d.loop(structural.each);
    if (!loop) {
      ctx.note(`Could not read the loop on <${node.tag}>: \`${structural.each}\`. Kept as a plain element.`);
    } else if (d.loopWrapsChildren && element.kind === "element") {
      ctx.locals.add(loop.item);
      if (loop.index) ctx.locals.add(loop.index);
      const list = loopList(loop, ctx);
      element.children = [{
        kind: "each",
        list,
        item: loop.item,
        index: loop.index,
        object: Boolean(loop.object),
        key: loop.key ? ctx.expr(loop.key) : loop.index ?? `${loop.item}.id ?? ${loop.item}`,
        children: element.children,
      }];
      out = element;
    } else {
      ctx.locals.add(loop.item);
      if (loop.index) ctx.locals.add(loop.index);
      const list = loopList(loop, ctx);
      if (loop.trackBy) ctx.expr(loop.trackBy.split(".")[0]);
      if (loop.note) ctx.note(loop.note);
      const authored = element.kind === "element" ? element.attrs.find((a) => a.name === "key") : null;
      // A lowered ng-container exists to carry the directive and the key.
      // Both are taken here, so a container with nothing else on it dissolves
      // and the row underneath is what repeats.
      if (
        element.kind === "element" && element.tag === null && !element.classes.length &&
        !element.styles.length && !element.events.length && !element.model &&
        element.attrs.every((a) => a.name === "key")
      ) {
        out = element.children.length === 1 ? element.children[0] : { kind: "fragment", children: element.children };
      }
      if (!loop.key && !loop.trackBy && !loop.index && !authored) {
        ctx.note(`<${node.tag}> is repeated without a stable key. It falls back to \`${loop.item}.id\`; give it one if the rows can reorder.`);
      }
      out = {
        kind: "each",
        list,
        item: loop.item,
        index: loop.index,
        object: Boolean(loop.object),
        // An author who named the key already answered this better than a
        // derived one can.
        key: authored ? authored.expression
          : loop.key ? ctx.expr(loop.key)
          : loop.trackBy ? `${loop.trackBy}(${loop.index ?? 0}, ${loop.item})`
          : loop.index ?? `${loop.item}.id ?? ${loop.item}`,
        children: [out],
      };
    }
  }

  // In AngularJS the repeat runs before the if, so `ng-if="o.active"` on a
  // repeated row tests each row. The condition moves inside the loop, where
  // its row exists; outside it would reference a name nothing defines.
  if (structural.when !== undefined && structural.each !== undefined && d.name === "angularjs" && out.kind === "each") {
    out.children = [{ kind: "when", test: ctx.expr(String(structural.when)), children: out.children }];
    return out;
  }

  if (structural.when !== undefined) {
    const raw = String(structural.when);
    const alias = /^(.*?)\s+as\s+[\w$]+$/.exec(raw);
    if (alias) ctx.note(`\`${raw}\` bound an alias. The condition alone was kept.`);
    const thenRef = /;\s*then\s+([\w$]+)/.exec(raw);
    const elseRef = /;\s*else\s+([\w$]+)/.exec(raw);
    const test = ctx.expr(
      (alias ? alias[1] : raw).replace(/;\s*then\s+[\w$]+/, "").replace(/;\s*else\s+[\w$]+/, "")
    );

    // then and else name templates harvested earlier; a reference the markup
    // actually holds is resolved, one it does not stays a note, never a guess.
    const resolve = (name) => {
      const body = ctx.templates?.get(name);
      return body ? convertList(body, d, ctx, null) : null;
    };
    const thenBody = thenRef ? resolve(thenRef[1]) : null;
    if (thenRef && !thenBody) {
      ctx.note(`<${node.tag}> renders \`then ${thenRef[1]}\`, and no <ng-template #${thenRef[1]}> is in this markup. The element's own content is used.`);
    }
    out = { kind: "when", test, children: thenBody ?? [out] };

    if (elseRef) {
      const elseBody = resolve(elseRef[1]);
      if (elseBody) {
        out = { kind: "fragment", children: [out, { kind: "when", test: `!(${test})`, children: elseBody }] };
      } else {
        ctx.note(`<${node.tag}> had an \`else ${elseRef[1]}\` branch and no <ng-template #${elseRef[1]}> is in this markup. Wire the fallback in by hand.`);
      }
    }
  }

  return out;
}

/** The list expression a loop maps over; a numeric range is spelled out. */
function loopList(loop, ctx) {
  if (loop.range) return `Array.from({ length: ${loop.list} }, (_, i) => i + 1)`;
  const list = ctx.expr(loop.list);
  ctx.lists.add(list);
  return list;
}

/** The old web shouted its tags: TR and tr are the same element, and a
 * printer that treats TR as a component invents one. An all caps name is
 * lowered to the element it always was; a mixed case name is somebody's
 * component and keeps its spelling. */
const tagOf = (raw) => (/^[A-Z][A-Z0-9]*$/.test(raw) ? raw.toLowerCase() : raw);

/** A subtree the author marked uncompiled: everything stays as written. */
function literalElement(node, d) {
  if (node.type === "text") return { kind: "text", parts: [{ literal: node.text }] };
  if (node.type === "comment") return { kind: "comment", text: node.text };
  const tag = node.tag.toLowerCase();
  return {
    kind: "element",
    tag: tagOf(node.tag),
    void: VOID.has(tag),
    attrs: node.attrs
      .filter((a) => !d.pre?.(a.name))
      .map((a) => (a.value === null ? { name: a.name, kind: "flag" } : { name: a.name, kind: "static", value: a.value })),
    classes: [], styles: [], events: [], model: null, modelKind: null, modelModifiers: [],
    children: (node.children ?? []).map((c) => literalElement(c, d)),
  };
}

function buildElement(node, d, ctx, sw = null) {
  const attrs = [];
  const classes = [];
  const styles = [];
  const events = [];
  const modelModifiers = [];
  let model = null;
  let staticClass = null;
  let optionsLoop = null;
  let textParts = null;

  for (const { name, value } of node.attrs) {
    // A text directive replaces the element's content, exactly as it does at
    // runtime; whatever markup sat inside was the pre-binding placeholder.
    const textKind = d.text?.(name);
    if (textKind) {
      textParts = textKind === "template" ? interpolate(value ?? "", ctx.expr) : [{ expression: ctx.expr(value) }];
      continue;
    }
    const showKind = d.show?.(name);
    if (showKind) {
      // Hiding is not the same as not rendering, and dropping it puts
      // something on screen the original kept off it. ng-hide is the same
      // directive as ng-show with the test inverted.
      const test = showKind === "hide" ? `!(${ctx.expr(value)})` : ctx.expr(value);
      styles.push({ kind: "declaration", property: "display", expression: `${test} ? undefined : "none"` });
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
      // v-model.trim / v-model.number: the modifiers ride on the name.
      for (const mod of name.split(".").slice(1)) modelModifiers.push(mod);
      continue;
    }

    // ng-options is a comprehension that generates the option elements. The
    // common forms carry across; one that cannot be read stays a note, and
    // the select keeps whatever children it had.
    if (d.options?.(name)) {
      const m = /^\s*(?:([\s\S]+?)\s+as\s+)?([\s\S]+?)\s+for\s+([\w$]+)\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+[\s\S]+)?\s*$/.exec(value ?? "");
      if (!m) {
        ctx.note(`The ng-options comprehension \`${value}\` could not be read. The select keeps its markup children only.`);
        continue;
      }
      ctx.locals.add(m[3]);
      const list = ctx.expr(m[4]);
      ctx.lists.add(list);
      optionsLoop = {
        kind: "each",
        list,
        item: m[3],
        index: null,
        object: false,
        key: `${m[3]}.id ?? ${m[3]}`,
        children: [{
          kind: "element",
          tag: "option",
          void: false,
          attrs: [{ name: "value", kind: "bound", expression: ctx.expr(m[1] ?? m[3]) }],
          classes: [], styles: [], events: [], model: null, modelKind: null, modelModifiers: [],
          children: [{ kind: "text", parts: [{ expression: ctx.expr(m[2]) }] }],
        }],
      };
      continue;
    }

    const event = d.event(name);
    if (event) {
      const raw = d.handler ? d.handler(String(value ?? ""), ctx.note) : value;
      events.push({ name: event, handler: ctx.expr(raw), modifiers: d.eventMods?.(name) ?? [] });
      continue;
    }

    const bound = d.bound(name);
    if (bound) {
      // ng-src="{{o.avatar}}" binds by interpolating. A bound attribute whose
      // value interpolates is a template attribute wearing a directive's name.
      if (/\{\{/.test(value ?? "")) {
        attrs.push({ name: bound, kind: "template", parts: interpolate(value, ctx.expr) });
        continue;
      }
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
    if (name.toLowerCase() === "style") {
      // An empty style attribute is consumed too: passed through as a plain
      // attribute it reaches react as a string prop, which throws.
      if (value) for (const e of styleEntries(value)) styles.push({ kind: "declaration", property: e.property, literal: e.value });
      continue;
    }
    // Plain HTML had events before any framework did. An inline onclick is
    // an event in every dialect, and a javascript: href was never a location,
    // so both become the handler they always were.
    const inline = /^on(abort|blur|change|click|contextmenu|dblclick|drag|dragend|dragenter|dragleave|dragover|dragstart|drop|error|focus|input|keydown|keypress|keyup|load|mousedown|mousemove|mouseout|mouseover|mouseup|reset|scroll|select|submit|touchend|touchmove|touchstart|unload|wheel)$/.exec(name.toLowerCase());
    if (inline && value) {
      const code = value
        .replace(/^\s*return\s+/, "")
        .replace(/;?\s*return\s+(true|false)\s*;?\s*$/, "")
        .replace(/[;\s]+$/, "")
        .trim();
      if (code) events.push({ name: inline[1], handler: ctx.expr(code), modifiers: [] });
      continue;
    }
    if (name.toLowerCase() === "href" && /^\s*javascript:/i.test(value ?? "")) {
      const code = value.replace(/^\s*javascript:\s*/i, "").replace(/^void\(0?\);?$/, "").replace(/[;\s]+$/, "").trim();
      if (code) events.push({ name: "click", handler: ctx.expr(code), modifiers: [] });
      continue;
    }

    // The font era wrote style as attributes. Each one has an exact CSS
    // meaning, so it is carried as the style it was, not dropped.
    const lower = name.toLowerCase();
    if (lower === "bgcolor" && value) { styles.push({ kind: "declaration", property: "background-color", literal: value }); continue; }
    if (lower === "align" && value && !/^(img|input|iframe|object|embed)$/i.test(node.tag)) {
      styles.push({ kind: "declaration", property: "text-align", literal: value.toLowerCase() });
      continue;
    }
    if (lower === "valign" && value) { styles.push({ kind: "declaration", property: "vertical-align", literal: value.toLowerCase() }); continue; }

    // What reaches this point is a plain markup attribute; every dialect
    // spelling was claimed above. Pre-HTML2 SGML allowed a bare token here,
    // like <NEXTID 7> on the first website ever written, and no modern
    // target can spell an attribute that opens with anything but a letter,
    // so it is dropped and the note is where it went.
    if (!/^[a-zA-Z_]/.test(name)) {
      ctx.note(`<${node.tag}> carries an attribute spelled \`${name}\`, which no target can carry. It was dropped.`);
      continue;
    }

    // Shouted attribute names are the same attributes; WIDTH is width.
    const spelled = /^[A-Z][A-Z0-9-]*$/.test(name) ? name.toLowerCase() : name;
    if (value === null) attrs.push({ name: spelled, kind: "flag" });
    else if (/\{\{/.test(value)) attrs.push({ name: spelled, kind: "template", parts: interpolate(value, ctx.expr) });
    else attrs.push({ name: spelled, kind: "static", value });
  }

  if (staticClass !== null) classes.unshift({ kind: "literal", value: staticClass });

  const tag = node.tag.toLowerCase();
  // A checked box holds its state in `checked`, not `value`; a radio holds it
  // in which one of the group is checked. A printer that wires `value` to a
  // checkbox writes "on" into the model forever.
  const typeAttr = attrs.find((a) => a.name.toLowerCase() === "type" && a.kind === "static");
  const modelKind = model && tag === "input" && typeAttr && /^(checkbox|radio)$/i.test(typeAttr.value ?? "")
    ? typeAttr.value.toLowerCase()
    : model && tag === "select" && attrs.some((a) => a.name.toLowerCase() === "multiple")
      ? "select-multiple"
      : null;
  // <component :is="widget"> renders whichever component the expression
  // names. The expression travels on its own field; a printer that cannot
  // render a dynamic tag keeps the element visible instead of guessing.
  // The bound attribute stays in the list, so a printer with no dynamic tag
  // still shows `<component is={...}>` instead of losing the expression.
  let tagExpression = null;
  if (d.dynamic?.(tag)) {
    tagExpression = attrs.find((a) => a.name === "is" && a.kind === "bound")?.expression ?? null;
  }

  return {
    kind: "element",
    tag: TRANSPARENT.has(tag) ? null : tagOf(node.tag),
    tagExpression,
    void: VOID.has(tag),
    attrs, classes, styles, events, model, modelKind,
    modelModifiers,
    children: textParts ? [{ kind: "text", parts: textParts }]
      : optionsLoop ? [optionsLoop]
      : convertList(node.children, d, ctx, sw),
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
