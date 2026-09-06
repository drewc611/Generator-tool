import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { lowerBody } from "../input-react/index.js";

/**
 * Reads Stencil components onto the same dialect every other reader targets.
 *
 * A Stencil component is a class with a `@Component({ tag })` decorator, `@Prop`
 * fields for its inputs, `@Event` emitters for its outputs, `@State` for local
 * state, and a `render()` that returns JSX. The JSX is the same shape React
 * emits, so it lowers with the React reader's own lowering, once `this.` is
 * stripped from the expressions: `this.items.map(...)` a loop, `this.open &&
 * (...)` a conditional, `onClick={() => this.pick(x)}` an event, `{this.name}`
 * interpolation. The tag from the decorator is the component's name, so a design
 * system's elements reach the translator and every emitter as any other
 * component.
 *
 * What has no honest lowering is left to the shared React reader to note rather
 * than guessed here. No dependency; the JSX lowering is reused, not reinvented.
 */

/** The balanced `(...)` or the single element after a `return`, from `render()`. */
function renderJsx(source) {
  const render = /\brender\s*\(\s*\)\s*\{/.exec(source);
  if (!render) return null;
  const body = source.slice(render.index + render[0].length);
  const ret = /return\s*\(/.exec(body);
  if (ret) {
    let depth = 1;
    let i = ret.index + ret[0].length;
    for (; i < body.length; i += 1) {
      if (body[i] === "(") depth += 1;
      else if (body[i] === ")") { depth -= 1; if (depth === 0) return body.slice(ret.index + ret[0].length, i).trim(); }
    }
    return null;
  }
  const single = /return\s*(<[\s\S]*?>[\s\S]*?);/.exec(body);
  return single ? single[1].trim() : null;
}

/** The tag a `@Component({ tag: 'x' })` declares, or null. */
export function readTag(source) {
  const c = /@Component\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(source);
  if (!c) return null;
  return /tag\s*:\s*['"`]([\w-]+)['"`]/.exec(c[1])?.[1] ?? null;
}

/** The @Prop fields (inputs), @Event emitters (outputs), and whether it looks like Stencil. */
export function readMembers(source) {
  const inputs = [];
  for (const m of source.matchAll(/@Prop\s*\([^)]*\)\s*(?:public\s+|readonly\s+)?([\w$]+)/g)) if (!inputs.includes(m[1])) inputs.push(m[1]);
  const outputs = [];
  for (const m of source.matchAll(/@Event\s*\(([^)]*)\)\s*([\w$]+)/g)) {
    const named = /eventName\s*:\s*['"`]([\w-]+)['"`]/.exec(m[1]);
    const name = named ? named[1] : m[2];
    if (!outputs.includes(name)) outputs.push(name);
  }
  return { inputs, outputs };
}

export function readComponent(source, rel, note = () => {}) {
  const tag = readTag(source);
  const cls = /class\s+([A-Z]\w*)/.exec(source)?.[1];
  if (!tag && !cls) return null;
  const { inputs, outputs } = readMembers(source);
  const raw = renderJsx(source);
  // Stencil reads state and props through this.; strip it so the shared JSX
  // lowering sees plain names, the way every other reader's expressions look.
  const jsx = raw != null ? raw.replace(/\bthis\./g, "") : null;
  const template = jsx ? lowerBody(jsx, note) : null;
  const name = tag ? tag : cls;
  const selector = tag ?? (cls ? cls.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() : "component");
  return {
    selector,
    className: pascal(name),
    file: rel,
    inputs,
    outputs,
    template,
    templateOrigin: template ? "a Stencil component, lowered" : null,
    usesNgIf: /ng-if/.test(template ?? ""),
    usesNgFor: /ng-repeat/.test(template ?? ""),
    usesTwoWay: /ng-model/.test(template ?? ""),
    rxjs: [],
    readBy: "stencil",
  };
}

/** A Stencil component declares @Component and renders JSX. */
function looksLikeStencil(source) {
  return /@Component\s*\(/.test(source) && /\brender\s*\(\s*\)/.test(source);
}

export default {
  name: "input-stencil",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(tsx|ts|jsx)$/i.test(f.rel));
      if (!files.length) return log.debug("no scripts to read for Stencil");
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !looksLikeStencil(text)) continue;
        const screen = readComponent(text, file.rel, note);
        if (!screen) continue;
        if (!screen.template) { ctx.unverified(`${file.rel} looks like a Stencil component but no render JSX was found, so only its states can be ported.`); continue; }
        for (const m of text.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1/g)) ctx.api.calls.push({ method: "GET", path: m[2], file: file.rel, headers: null, body: null });
        ctx.screens.push(screen);
        count += 1;
      }
      if (!count) return log.debug("no Stencil components read");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Stencil component(s) lowered`);
    });
  },
};
