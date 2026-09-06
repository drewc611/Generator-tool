import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";

/**
 * Reads Riot tags into the same screen shape as every other reader. A Riot
 * file is a custom tag with its markup, a `<script>` and a `<style>`, and its
 * own small binding language: `{ expr }` interpolation, `each={ x in xs }`,
 * `if={ cond }`, `show`/`hide`, and `on<event>={ handler }`.
 *
 * All of it lowers onto the AngularJS attribute dialect the rest of the tool
 * already reads, so a Riot tag reaches the translator, the endpoint map and
 * the emitters as any other component does. The lowering does not invent a
 * binding it cannot prove: a delimiter a person changed, or an expression it
 * cannot place, is left as written rather than guessed.
 */

const EVENTS = new Set(["click", "change", "submit", "input", "blur", "focus",
  "keyup", "keydown", "mouseover", "mouseout", "dblclick"]);

/** Each top level custom tag in a Riot file, by matching its own close. */
export function rootTags(text) {
  const tags = [];
  const open = /<([a-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)>/gi;
  let m;
  while ((m = open.exec(text))) {
    const name = m[1].toLowerCase();
    if (name === "script" || name === "style") continue;
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
    tags.push({ name, attrs: m[2] ?? "", body: text.slice(m.index + m[0].length, end) });
  }
  return tags;
}

const braced = (value) => {
  const m = /^\s*\{\s*([\s\S]*?)\s*\}\s*$/.exec(value ?? "");
  return m ? m[1] : null;
};

/** One Riot attribute lowered onto the dialect. */
function lowerAttr(name, value, note) {
  const expr = braced(value);
  const lower = name.toLowerCase();

  if (lower === "each") {
    const loop = expr ?? value ?? "";
    const m = /^\s*(?:\(?\s*([\w$]+)\s*(?:,\s*([\w$]+)\s*)?\)?\s+in\s+)?([\s\S]+?)\s*$/.exec(loop);
    if (!m) { note(`\`each={${loop}}\` could not be read as a loop; it was left as written.`); return `data-each="${loop.replace(/"/g, "'")}"`; }
    const item = m[1] ?? "item";
    const list = m[3];
    return `ng-repeat="${item} in ${list}"`;
  }
  if (lower === "if") return `ng-if="${expr ?? value}"`;
  if (lower === "show") return `ng-show="${expr ?? value}"`;
  if (lower === "hide") return `ng-hide="${expr ?? value}"`;

  const onEvent = /^on([a-z]+)$/i.exec(lower);
  if (onEvent && EVENTS.has(onEvent[1] === "input" ? "input" : onEvent[1])) {
    const ev = onEvent[1] === "input" ? "change" : onEvent[1];
    const handler = (expr ?? value ?? "").trim();
    return `ng-${ev}="${/[()]/.test(handler) ? handler : `${handler}()`}"`;
  }

  if (expr !== null) {
    if (lower === "src") return `ng-src="${expr}"`;
    if (lower === "href") return `ng-href="${expr}"`;
    if (lower === "class") return `ng-class="${expr.replace(/"/g, "'")}"`;
    if (lower === "style") return `ng-style="${expr.replace(/"/g, "'")}"`;
    return `ng-attr-${lower}="${expr.replace(/"/g, "'")}"`;
  }
  // A quoted value that mixes text and { bindings } becomes interpolation.
  if (value != null && /\{[^}]*\}/.test(value)) {
    return `${name}="${value.replace(/\{\s*([^{}]+?)\s*\}/g, "{{ $1 }}").replace(/"/g, "'")}"`;
  }
  return value == null ? name : `${name}="${value.replace(/"/g, "'")}"`;
}

export function lowerRiot(templateHtml, note = () => {}) {
  // Braces are excluded from the catch all so a `{ }` binding can never also
  // be matched character by character by it; that overlap backtracks
  // exponentially on a tag full of braces.
  const tagged = templateHtml.replace(/<([a-z][\w-]*)((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^>"'{}])*?)(\/?)>/gi, (whole, tag, attrs, slash) => {
    const parts = [];
    const re = /([^\s=/<>"'{}]+)(?:\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\}|[^\s"'>{}]+))?/g;
    let a;
    while ((a = re.exec(attrs))) {
      const name = a[1];
      if (name === "/") continue;
      let raw = a[2] ?? null;
      if (raw && (raw[0] === '"' || raw[0] === "'")) raw = raw.slice(1, -1);
      parts.push(lowerAttr(name, raw, note));
    }
    return `<${tag}${parts.length ? " " + parts.join(" ") : ""}${slash}>`;
  });
  // Whatever single { expr } survives is text interpolation. A value the
  // attribute pass already doubled into {{ }} is skipped by the guards.
  return tagged.replace(/(?<!\{)\{\s*([^{}]+?)\s*\}(?!\})/g, "{{ $1 }}");
}

/**
 * Remove every `<tag>...</tag>` block, repeating until the string stops
 * changing so a block nested inside another cannot survive one pass and
 * reappear whole. The closing tag allows attributes and stray whitespace.
 */
function stripBlock(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\b[^>]*>`, "gi");
  let prev;
  let out = html;
  do { prev = out; out = out.replace(re, ""); } while (out !== prev);
  return out;
}

export function readTag(text, rel, note = () => {}) {
  const screens = [];
  const calls = [];
  for (const tag of rootTags(text)) {
    const scriptBody = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i.exec(tag.body)?.[1] ?? "";
    const markup = stripBlock(stripBlock(tag.body, "script"), "style").trim();
    const template = markup ? lowerRiot(markup, note) : null;

    const inputs = new Set();
    for (const m of scriptBody.matchAll(/\b(?:opts|this\.props)\.([\w$]+)/g)) inputs.add(m[1]);
    const outputs = new Set();
    for (const m of scriptBody.matchAll(/this\.trigger\s*\(\s*["']([\w-]+)["']/g)) outputs.add(m[1]);
    for (const m of scriptBody.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1/g)) {
      calls.push({ method: "GET", path: m[2], file: rel, headers: null, body: null });
    }

    screens.push({
      selector: tag.name,
      className: pascal(tag.name),
      file: rel,
      inputs: [...inputs],
      outputs: [...outputs],
      template,
      templateOrigin: template ? "a Riot tag, lowered" : null,
      usesNgIf: /ng-if|ng-show|ng-hide/.test(template ?? ""),
      usesNgFor: /ng-repeat/.test(template ?? ""),
      usesTwoWay: false,
      rxjs: [],
      readBy: "riot",
    });
  }
  return { screens, calls };
}

export default {
  name: "input-riot",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(riot|tag)$/i.test(f.rel));
      if (!files.length) return log.debug("no Riot tags");
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const { screens, calls } = readTag(text, file.rel, note);
        for (const s of screens) {
          if (!s.template) ctx.unverified(`<${s.selector}> is a Riot tag with no markup, so only its states can be ported.`);
          ctx.screens.push(s);
        }
        ctx.api.calls.push(...calls);
        count += screens.length;
      }
      if (!count) return log.debug("no Riot tags read");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Riot tag(s) lowered`);
    });
  },
};
