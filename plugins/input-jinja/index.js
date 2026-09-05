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
      // Nunjucks is jinja's JavaScript port; its .njk files are read by the same lowering and credited to it by name.
      const candidates = ctx.sources.files.filter((f) => /\.(jinja2?|j2|html?|njk|nunjucks)$/i.test(f.rel));
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
      const keyOf = (name) => { const clean = String(name).replace(/^\.\//, ""); if (bodies.has(clean)) return clean; const base = clean.split("/").pop(); return [...bodies.keys()].find((k) => k.endsWith(`/${base}`) || k === base) ?? null; };
      const resolveInclude = (name) => { const k = keyOf(name); return k ? bodies.get(k) : null; };

      // A layout other templates extend is chrome: composed into each of them, not a screen of its own.
      const extended = new Set([...bodies.values()].flatMap((b) => [...b.matchAll(/\{%-?\s*extends\s+['"]([^'"]+)['"]/g)].map((m) => keyOf(m[1]))).filter(Boolean));
      for (const file of candidates) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = bodies.get(rel) ?? "";
        // A tag marks a jinja file; an .njk file is Nunjucks's whatever it holds. A page with only {{ }} is another dialect's.
        if (!text || !(/\{%/.test(text) || /\.(njk|nunjucks)$/i.test(rel))) continue;
        // Django's own spellings are input-django's to read, and so is every file it already read or composed into a screen.
        if (isDjango(text) || ctx.screens.some((s) => s.file?.replace(/^\.\//, "") === rel || (s.composed ?? []).includes(rel))) continue;
        if (extended.has(rel) && /\{%-?\s*block\s/.test(text) && !/\{%-?\s*extends\s/.test(text)) { note(`${rel} is a layout other templates extend; it is composed into each of them rather than ported as a screen of its own.`); continue; }

        const parentKey = keyOf(/\{%-?\s*extends\s+['"]([^'"]+)['"]/.exec(text)?.[1] ?? "");
        // Scripts and styles are stripped and the body cut after the page is composed into its layout, so the document
        // around a child template, and the layout's own scripts, never reach the port.
        const composedText = lowerJinja(text, note, resolveInclude);
        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(composedText);
        const lowered = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : composedText)).trim();
        if (!lowered) continue;
        const nunjucks = /\.(njk|nunjucks)$/i.test(file.rel);
        const name = file.rel.replace(/\.(jinja2?|j2|html?|njk|nunjucks)$/i, "").split("/").filter((p) => p !== ".").join("-");
        const selector = name.toLowerCase().replace(/[^\w-]/g, "-") || "page";
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          inputs: [],
          outputs: [],
          template: lowered,
          composed: parentKey ? [parentKey] : [],
          templateOrigin: parentKey ? (nunjucks ? "a Nunjucks template, composed into its layout and lowered through jinja" : "a jinja template, composed into its layout and lowered") : nunjucks ? "a Nunjucks template, lowered through jinja" : "a jinja template, lowered",
          usesNgIf: /ng-if/.test(lowered),
          usesNgFor: /ng-repeat/.test(lowered),
          usesTwoWay: false,
          rxjs: [],
          readBy: nunjucks ? "nunjucks" : "jinja",
        });
        count += 1;
      }
      if (!count) return log.debug("no jinja templates");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} jinja template(s) lowered`);
    });
  },
};
