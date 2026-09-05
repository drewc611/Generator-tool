import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pascal } from "../dsp-ir/emit.js";

/**
 * Reads Alpine islands into the same screen shape as every other reader, the
 * inverse of output-alpine. Alpine writes behaviour on the markup, so each
 * `x-data` element is a component: the object it declares is the state, and its
 * subtree is the template.
 *
 * Alpine and the AngularJS dialect the rest of the tool reads are both attribute
 * languages, so the lowering is close to a rename: `x-for` is `ng-repeat`,
 * `x-if` is `ng-if`, `x-show` is `ng-show`, `x-model` is `ng-model`, `@event`
 * and `x-on:event` are the dialect event, `:attr` and `x-bind:attr` are the
 * bound attribute, and `x-text` is `ng-bind`, which the IR carries natively.
 * A `$dispatch` names an output. An `x-html` is kept but flagged, and a
 * modifier or a directive with no dialect equivalent is named through a note
 * rather than guessed.
 */

const EVENT = new Set(["click", "change", "submit", "input", "blur", "focus",
  "keyup", "keydown", "keypress", "mouseover", "mouseout", "dblclick"]);
const BOOL_BIND = new Set(["disabled", "checked", "readonly", "required", "selected", "hidden", "multiple", "open"]);

/** Every top level `x-data` element in the page, matched to its own close. */
export function dataRoots(text) {
  const roots = [];
  const open = /<([a-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)>/gi;
  let m;
  while ((m = open.exec(text))) {
    if (!/\bx-data\b/.test(m[2])) continue;
    const name = m[1].toLowerCase();
    const any = new RegExp(`<(/?)${name}\\b(?:"[^"]*"|'[^']*'|[^>"'])*?>`, "gi");
    any.lastIndex = open.lastIndex;
    let depth = 1;
    let step;
    let end = -1;
    while ((step = any.exec(text))) {
      depth += step[1] ? -1 : 1;
      if (depth === 0) { end = step.index; open.lastIndex = any.lastIndex; break; }
    }
    if (end === -1) continue;
    roots.push({ tag: name, attrs: m[2] ?? "", body: text.slice(m.index + m[0].length, end) });
  }
  return roots;
}

/** The top level keys of an `x-data` object are the component's state names. */
export function readState(attrs) {
  const m = /\bx-data\s*=\s*("|')([\s\S]*?)\1/.exec(attrs);
  if (!m) return [];
  const body = m[2].trim().replace(/^\{/, "").replace(/\}$/, "");
  const names = [];
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (quote) { if (c === quote && body[i - 1] !== "\\") quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "{" || c === "(" || c === "[") depth += 1;
    else if (c === "}" || c === ")" || c === "]") depth -= 1;
    else if (depth === 0) {
      const k = /^([\w$]+)\s*:/.exec(body.slice(i));
      if (k && (i === 0 || /[\s,]/.test(body[i - 1]))) { if (!names.includes(k[1])) names.push(k[1]); i += k[0].length - 1; }
    }
  }
  return names;
}

/** One Alpine attribute lowered onto the dialect. Returns the replacement token, or "" to drop it. */
function lowerAttr(name, value, note) {
  const lower = name.toLowerCase();
  if (lower === "x-data" || lower === "x-cloak" || lower === "x-ref" || /^x-transition/.test(lower)) return "";
  if (lower === "x-init") { note("`x-init` holds setup logic that runs on mount; it has no dialect equivalent and was dropped."); return ""; }

  if (lower === "x-for") {
    const loop = /^\s*\(?\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\)?\s+in\s+([\s\S]+?)\s*$/.exec(value ?? "");
    if (!loop) { note(`\`x-for="${value}"\` could not be read as a loop; it was left as written.`); return `data-x-for="${(value ?? "").replace(/"/g, "'")}"`; }
    if (loop[2]) note(`the x-for index \`${loop[2]}\` maps to $index in the dialect.`);
    return `ng-repeat="${loop[1]} in ${loop[3]}"`;
  }
  if (lower === "x-if") return `ng-if="${value}"`;
  if (lower === "x-show") return `ng-show="${value}"`;
  if (lower === "x-model" || /^x-model\./.test(lower)) {
    if (lower !== "x-model") note(`\`${name}\` carries a modifier the dialect does not spell; the binding was kept, the modifier was not.`);
    return `ng-model="${value}"`;
  }
  if (lower === "x-text") return `ng-bind="${value}"`;
  if (lower === "x-html") { note("`x-html` renders raw HTML; it was kept as a bound html expression that needs a person's review for safety."); return `ng-bind-html="${value}"`; }

  // @event / x-on:event, with optional .modifiers
  const on = /^(?:@|x-on:)([a-z]+)((?:\.[\w-]+)*)$/i.exec(lower);
  if (on) {
    const ev = on[1];
    if (on[2]) note(`\`${name}\` carries event modifiers (${on[2].slice(1)}) the dialect does not spell; the handler was kept, the modifiers were not.`);
    if (!EVENT.has(ev)) { note(`\`${name}\` has no dialect event; it was left as written.`); return `${name}="${(value ?? "").replace(/"/g, "'")}"`; }
    return `ng-${ev === "input" ? "change" : ev}="${(value ?? "").replace(/"/g, "'")}"`;
  }
  // :attr / x-bind:attr
  const bind = /^(?::|x-bind:)([\w-]+)$/i.exec(lower);
  if (bind) {
    const attr = bind[1];
    if (attr === "class") return `ng-class="${(value ?? "").replace(/"/g, "'")}"`;
    if (attr === "src") return `ng-src="${value}"`;
    if (attr === "href") return `ng-href="${value}"`;
    // A bound boolean attribute is a directive, not a string, so it toggles rather than reads "false".
    if (BOOL_BIND.has(attr)) return `ng-${attr}="${value}"`;
    return `ng-attr-${attr}="{{ ${value} }}"`;
  }

  return value == null ? name : `${name}="${value}"`;
}

export function lowerAlpine(markup, note = () => {}) {
  return markup.replace(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g, (whole, tag, attrs, slash) => {
    const parts = [];
    // Most specific first: a bare @ or : must never win over @event or :attr.
    const re = /(x-on:[\w.:-]+|x-bind:[\w-]+|x-[\w-]+(?:\.[\w-]+)*|@[\w-]+(?:\.[\w-]+)*|:[\w-]+|[A-Za-z_][\w-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    let a;
    while ((a = re.exec(attrs))) {
      const name = a[1];
      if (!name || name === "/") continue;
      let raw = a[2] ?? null;
      if (raw && (raw[0] === '"' || raw[0] === "'")) raw = raw.slice(1, -1);
      const token = lowerAttr(name, raw, note);
      if (token) parts.push(token);
    }
    return `<${tag}${parts.length ? " " + parts.join(" ") : ""}${slash}>`;
  });
}

/** The id attribute of an element's opening tag, or null. */
function idOf(attrs) {
  const m = /\bid\s*=\s*("|')([\w-]+)\1/.exec(attrs);
  return m ? m[2] : null;
}

export function readComponent(text, rel, note = () => {}, index = 0) {
  const roots = dataRoots(text);
  if (!roots.length) return [];
  const base = basename(rel, extname(rel)).replace(/[^\w-]/g, "-").toLowerCase();
  return roots.map((root, i) => {
    const template = lowerAlpine(root.body, note).trim() || null;
    const calls = [];
    for (const m of (root.attrs + root.body).matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1/g)) calls.push({ method: "GET", path: m[2], headers: null, body: null });
    const outputs = [];
    for (const m of (root.attrs + root.body).matchAll(/\$dispatch\(\s*['"`]([\w-]+)['"`]/g)) if (!outputs.includes(m[1])) outputs.push(m[1]);
    // A page is also read as a static screen named for the file, so the island
    // always takes an -app suffix (on its id where it has one) and the two
    // readings can never collide, whatever the id happens to be.
    const id = idOf(root.attrs);
    const ordinal = roots.length > 1 ? `-${index + i + 1}` : "";
    const selector = `${id ?? base}-app${ordinal}`;
    return {
      screen: {
        selector,
        className: pascal(selector),
        file: rel,
        inputs: readState(root.attrs),
        outputs,
        template,
        templateOrigin: template ? "an Alpine island, lowered" : null,
        usesNgIf: /ng-if|ng-show|ng-hide/.test(template ?? ""),
        usesNgFor: /ng-repeat/.test(template ?? ""),
        usesTwoWay: /ng-model/.test(template ?? ""),
        rxjs: [],
        readBy: "alpine",
      },
      calls,
    };
  });
}

export default {
  name: "input-alpine",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|php)$/i.test(f.rel));
      if (!files.length) return log.debug("no pages to read for Alpine");
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !/\bx-data\b/.test(text)) continue;
        for (const { screen, calls } of readComponent(text, file.rel, note, count)) {
          if (!screen.template) { ctx.unverified(`<${screen.selector}> is an Alpine island with no markup, so only its states can be ported.`); continue; }
          ctx.screens.push(screen);
          ctx.api.calls.push(...calls.map((c) => ({ ...c, file: file.rel })));
          count += 1;
        }
      }
      if (!count) return log.debug("no Alpine islands read");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Alpine island(s) lowered`);
    });
  },
};
