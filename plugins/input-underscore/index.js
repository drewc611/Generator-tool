import { readFile } from "node:fs/promises";
import { lowerUnderscore } from "./lower.js";

/**
 * The reader input-backbone deferred to: underscore templates, found where
 * Backbone apps keep them, in <script type="text/template"> blocks and in
 * .tpl and .ejs files. Each becomes a screen in the AngularJS attribute
 * dialect, which is what the lowering emits and dsp-ir already reads.
 */

const BLOCK = /<script\b[^>]*\btype\s*=\s*["']text\/(?:template|html)["'][^>]*>([\s\S]*?)<\/script\b[^>]*>/gi;

const pascal = (s) =>
  String(s).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

export function readTemplates(text, rel) {
  const found = [];
  for (const m of text.matchAll(BLOCK)) {
    if (!/<%/.test(m[1])) continue;
    const id = /\bid\s*=\s*["']([\w-]+)["']/.exec(m[0].slice(0, m[0].indexOf(">") + 1));
    found.push({ id: id ? id[1] : null, body: m[1] });
  }
  return found.map((t, i) => ({ ...t, id: t.id ?? `${rel.replace(/\W/g, "-")}-template-${i + 1}` }));
}

function screenOf(id, body, rel, notes) {
  const note = (text) => { if (!notes.includes(text)) notes.push(text); };
  const lowered = lowerUnderscore(body, note);
  const selector = id.toLowerCase().replace(/[^\w-]/g, "-").replace(/-?template-?/g, "") || id.toLowerCase();
  return {
    selector,
    className: pascal(selector),
    file: rel,
    inputs: [],
    outputs: [],
    template: lowered,
    templateOrigin: "an underscore template, lowered",
    usesNgIf: /ng-if/.test(lowered),
    usesNgFor: /ng-repeat/.test(lowered),
    usesTwoWay: false,
    rxjs: [],
    readBy: "underscore",
  };
}

export default {
  name: "input-underscore",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const candidates = ctx.sources.files.filter((f) => /\.(html?|tpl|ejs)$/i.test(f.rel));
      let count = 0;
      const notes = [];
      for (const file of candidates) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !/<%/.test(text)) continue;

        if (/\.(tpl|ejs)$/i.test(file.rel)) {
          const id = file.rel.split("/").pop().replace(/\.(tpl|ejs)$/i, "");
          ctx.screens.push(screenOf(id, text, file.rel, notes));
          count += 1;
          continue;
        }
        for (const t of readTemplates(text, file.rel)) {
          ctx.screens.push(screenOf(t.id, t.body, file.rel, notes));
          count += 1;
        }
      }
      if (!count) return log.debug("no underscore templates");
      for (const note of notes) ctx.unverified(note);
      log.info(`${count} underscore template(s) lowered`);
    });
  },
};
