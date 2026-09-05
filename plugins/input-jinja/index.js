import { readFile } from "node:fs/promises";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { isDjango, lowerJinja } from "./lower.js";
import { pascal } from "../dsp-ir/emit.js";

/**
 * The jinja and Django template reader. A server rendered page is a screen
 * whose framework lives on the other side of the wire; the markup and its
 * control flow are still the model, and they lower onto the attribute dialect
 * the same way a client template does.
 */


export default {
  name: "input-jinja",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const candidates = ctx.sources.files.filter((f) => /\.(jinja2?|j2|html?)$/i.test(f.rel));
      let count = 0;
      const notes = [];
      const note = (text) => { if (!notes.includes(text)) notes.push(text); };

      // {% include %} resolves against the run's own files, by basename when
      // the exact relative path is not there, which is how template loaders
      // usually search anyway.
      const bodies = new Map();
      for (const file of candidates) {
        bodies.set(file.rel.replace(/^\.\//, ""), await readFile(file.path, "utf8").catch(() => ""));
      }
      const resolveInclude = (name) => {
        const clean = String(name).replace(/^\.\//, "");
        if (bodies.has(clean)) return bodies.get(clean);
        const base = clean.split("/").pop();
        const hit = [...bodies.keys()].find((k) => k.endsWith(`/${base}`) || k === base);
        return hit ? bodies.get(hit) : null;
      };

      for (const file of candidates) {
        const text = bodies.get(file.rel.replace(/^\.\//, "")) ?? "";
        if (!text || !/\{%/.test(text)) continue;
        // Django's own spellings are input-django's to read, and so is every file it already read or composed into a screen.
        const rel = file.rel.replace(/^\.\//, "");
        if (isDjango(text) || ctx.screens.some((s) => s.file?.replace(/^\.\//, "") === rel || (s.composed ?? []).includes(rel))) continue;

        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(text);
        const markup = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : text)).trim();
        if (!markup) continue;

        const lowered = lowerJinja(markup, note, resolveInclude);
        const name = file.rel.replace(/\.(jinja2?|j2|html?)$/i, "").split("/").filter((p) => p !== ".").join("-");
        const selector = name.toLowerCase().replace(/[^\w-]/g, "-") || "page";
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          inputs: [],
          outputs: [],
          template: lowered,
          templateOrigin: "a jinja template, lowered",
          usesNgIf: /ng-if/.test(lowered),
          usesNgFor: /ng-repeat/.test(lowered),
          usesTwoWay: false,
          rxjs: [],
          readBy: "jinja",
        });
        count += 1;
      }
      if (!count) return log.debug("no jinja templates");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} jinja template(s) lowered`);
    });
  },
};
