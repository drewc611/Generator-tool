import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";

/**
 * Reads vanilla custom elements onto the same dialect every other reader targets.
 *
 * Before Lit, Stencil, Polymer or Riot, a team could reach for the platform
 * itself: `class X extends HTMLElement`, a `static get observedAttributes` that
 * lists the attributes it reacts to, a `connectedCallback` that writes its
 * markup with `innerHTML`, and `dispatchEvent(new CustomEvent('name'))` to speak
 * back out. `customElements.define('x-thing', X)` gives it a tag. This reads
 * that shape:
 *
 *   - the registered tag is the component's name, so it reaches the translator
 *     and every emitter as any other component.
 *   - observedAttributes are its inputs.
 *   - the CustomEvent names it dispatches are its outputs.
 *   - the innerHTML template literal is its markup; a `${x}` interpolation
 *     lowers to `{{ x }}` once `this.` is stripped, the way every other reader's
 *     expressions look.
 *
 * A vanilla element often builds its DOM imperatively, and an expression with no
 * plain interpolation (a `.map`, a ternary, a nested template) has no honest
 * lowering, so it is named through the note rather than guessed. No dependency.
 */

/** The balanced `{...}` body of `class <name> extends HTMLElement`, or null. */
function classBody(source, name) {
  const open = new RegExp(`class\\s+${name}\\s+extends\\s+HTMLElement\\s*\\{`).exec(source);
  if (!open) return null;
  let depth = 1;
  let i = open.index + open[0].length;
  const start = i;
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") { depth -= 1; if (depth === 0) return source.slice(start, i); }
  }
  return null;
}

/** Tag -> class name for every customElements.define in the file. */
export function readDefines(source) {
  const map = [];
  for (const m of source.matchAll(/customElements\s*\.\s*define\s*\(\s*(['"`])([\w-]+)\1\s*,\s*([A-Za-z_$][\w$]*)/g)) {
    map.push({ tag: m[2], cls: m[3] });
  }
  return map;
}

/** The string entries of `static get observedAttributes() { return [...] }`. */
export function readObserved(body) {
  const m = /observedAttributes\s*\(\s*\)\s*\{[\s\S]*?return\s*\[([^\]]*)\]/.exec(body);
  if (!m) return [];
  return [...m[1].matchAll(/(['"`])([\w-]+)\1/g)].map((x) => x[2]);
}

/** The CustomEvent names dispatched from the body. */
export function readEvents(body) {
  const out = [];
  for (const m of body.matchAll(/new\s+CustomEvent\s*\(\s*(['"`])([\w-]+)\1/g)) if (!out.includes(m[2])) out.push(m[2]);
  return out;
}

/** The first innerHTML template literal assigned in the body, or null. */
export function readTemplateLiteral(body) {
  const m = /\.innerHTML\s*=\s*`/.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  for (let i = start; i < body.length; i += 1) {
    if (body[i] === "\\") { i += 1; continue; }
    if (body[i] === "`") return body.slice(start, i);
  }
  return null;
}

/** Lower a template literal's `${...}` to interpolation; note what cannot be. */
export function lowerTemplate(tpl, note = () => {}) {
  let out = "";
  for (let i = 0; i < tpl.length; i += 1) {
    if (tpl[i] === "$" && tpl[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      for (; j < tpl.length && depth > 0; j += 1) {
        if (tpl[j] === "{") depth += 1;
        else if (tpl[j] === "}") depth -= 1;
      }
      const expr = tpl.slice(i + 2, j - 1).trim();
      const plain = expr.replace(/\bthis\./g, "");
      if (/`|\.map\s*\(|\?[^?]*:/.test(plain)) {
        note(`a template expression in a custom element (${plain.slice(0, 40)}...) has no plain interpolation and was left out; port it by hand.`);
      } else {
        out += `{{ ${plain} }}`;
      }
      i = j - 1;
    } else {
      out += tpl[i];
    }
  }
  return out.trim();
}

export function readComponent(source, cls, tag, rel, note = () => {}) {
  const body = classBody(source, cls);
  if (body == null) return null;
  const inputs = readObserved(body);
  const outputs = readEvents(body);
  const raw = readTemplateLiteral(body);
  const template = raw != null ? lowerTemplate(raw, note) : null;
  return {
    selector: tag,
    className: pascal(tag),
    file: rel,
    inputs,
    outputs,
    template,
    templateOrigin: template ? "a vanilla custom element, lowered" : null,
    usesNgIf: false,
    usesNgFor: false,
    usesTwoWay: false,
    rxjs: [],
    readBy: "webcomponents",
  };
}

function looksLikeWebComponent(source) {
  return /extends\s+HTMLElement\b/.test(source) && /customElements\s*\.\s*define\s*\(/.test(source);
}

export default {
  name: "input-webcomponents",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|mjs|ts)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      if (!files.length) return log.debug("no scripts to read for custom elements");
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !looksLikeWebComponent(text)) continue;
        for (const { tag, cls } of readDefines(text)) {
          const screen = readComponent(text, cls, tag, file.rel, note);
          if (!screen) continue;
          if (!screen.template) { ctx.unverified(`<${tag}> is a custom element but builds its DOM without an innerHTML template, so only its inputs and outputs are read.`); continue; }
          for (const m of text.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1/g)) ctx.api.calls.push({ method: "GET", path: m[2], file: file.rel, headers: null, body: null });
          ctx.screens.push(screen);
          count += 1;
        }
      }
      if (!count) return log.debug("no custom elements read");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} custom element(s) lowered`);
    });
  },
};
