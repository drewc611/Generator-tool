import { readFile } from "node:fs/promises";
import { lowerHandlebars } from "./lower.js";

/**
 * The handlebars reader. Templates arrive from .hbs and .handlebars files and
 * from the <script type="text/x-handlebars-template"> blocks an Ember classic
 * or a hand rolled app kept in its pages. Each is lowered onto the attribute
 * dialect and becomes a screen like any other.
 */

const BLOCK = /<script\b[^>]*\btype\s*=\s*["']text\/x-handlebars(?:-template)?["'][^>]*>([\s\S]*?)<\/script\b[^>]*>/gi;

const pascal = (s) =>
  String(s).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

function screenOf(id, body, rel, notes, resolvePartial = null) {
  const note = (text) => { if (!notes.includes(text)) notes.push(text); };
  const lowered = lowerHandlebars(body, note, resolvePartial);
  const selector = id.toLowerCase().replace(/[^\w-]/g, "-");
  return {
    selector,
    className: pascal(selector),
    file: rel,
    inputs: [],
    outputs: [],
    template: lowered,
    templateOrigin: "a handlebars template, lowered",
    usesNgIf: /ng-if/.test(lowered),
    usesNgFor: /ng-repeat/.test(lowered),
    usesTwoWay: false,
    rxjs: [],
    readBy: "handlebars",
  };
}

export default {
  name: "input-handlebars",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      let count = 0;
      const notes = [];
      const files = ctx.sources.files.filter((f) => /\.(hbs|handlebars|html?)$/i.test(f.rel));
      const bodies = new Map();
      for (const file of files) {
        bodies.set(file.rel.replace(/^\.\//, ""), await readFile(file.path, "utf8").catch(() => ""));
      }
      // {{> name}} resolves against the run's own .hbs files, by basename,
      // with and without the extension, which is how registries usually key.
      const resolvePartial = (name) => {
        const clean = String(name).replace(/^\.\//, "");
        for (const key of [clean, `${clean}.hbs`, `${clean}.handlebars`]) {
          if (bodies.has(key)) return bodies.get(key);
          const hit = [...bodies.keys()].find((k) => k.endsWith(`/${key}`));
          if (hit) return bodies.get(hit);
        }
        return null;
      };

      // A template inlined into another is not also its own screen: a nav
      // partial is chrome, not a page.
      const inlined = new Set();
      for (const [, text] of bodies) {
        for (const m of text.matchAll(/\{\{>\s*([\w./-]+)/g)) {
          for (const key of [m[1], `${m[1]}.hbs`, `${m[1]}.handlebars`]) {
            const hit = bodies.has(key) ? key : [...bodies.keys()].find((k) => k.endsWith(`/${key}`));
            if (hit) inlined.add(hit);
          }
        }
      }

      for (const file of files) {
        const text = bodies.get(file.rel.replace(/^\.\//, "")) ?? "";
        if (!text) continue;

        if (/\.(hbs|handlebars)$/i.test(file.rel)) {
          if (!/\{\{/.test(text) || inlined.has(file.rel.replace(/^\.\//, ""))) continue;
          const id = file.rel.split("/").pop().replace(/\.(hbs|handlebars)$/i, "");
          ctx.screens.push(screenOf(id, text, file.rel, notes, resolvePartial));
          count += 1;
          continue;
        }
        for (const m of text.matchAll(BLOCK)) {
          const id = /\bid\s*=\s*["']([\w-]+)["']/.exec(m[0].slice(0, m[0].indexOf(">") + 1))?.[1] ?? `hbs-${count + 1}`;
          ctx.screens.push(screenOf(id, m[1], file.rel, notes, resolvePartial));
          count += 1;
        }
      }
      if (!count) return log.debug("no handlebars templates");
      for (const note of notes) ctx.unverified(note);
      log.info(`${count} handlebars template(s) lowered`);
    });
  },
};
