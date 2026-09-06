import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { readInputs, resolveTemplate } from "../dsp-ir/text.js";
import { lowerJinja } from "../input-jinja/lower.js";
import { twigToJinja } from "../input-twig/index.js";

/**
 * Pebble, the Java template engine modelled on Twig: the same tags and the
 * same tests, with a handful of spellings of its own. `equals` is ==,
 * `contains` asks a collection or a string, `loop.index` counts from zero
 * where Twig's counts from one, `?:` falls back the way || does, `{% parallel %}`,
 * `{% cache %}` and `{% autoescape %}` wrap a block the port renders once,
 * `{% flush %}` writes the buffer, `{% filter %}` applies a filter to a
 * block, and `{% embed %}` includes a template while overriding its blocks.
 * The reader rewrites Pebble's own spellings onto Twig's, Twig's onto jinja's,
 * and hands the result to the jinja lowering: one lowering, and Pebble is the
 * fourth dialect riding it through Twig's front.
 *
 * A filter applied to a whole block, an embed's block overrides and a test the
 * client cannot make are named rather than approximated.
 */

/** Pebble spellings onto Twig's, outside of strings. */
export function pebbleToTwig(source, note = () => {}) {
  let text = String(source ?? "");
  // Wrappers the port renders once: parallel, cache, autoescape.
  text = text.replace(/\{%-?\s*(?:parallel|endparallel|cache\b[^%]*|endcache|autoescape\b[^%]*|endautoescape|flush)\s*-?%\}/g, "");
  text = text.replace(/\{%-?\s*filter\s+([\w|() ,"']+?)\s*-?%\}([\s\S]*?)\{%-?\s*endfilter\s*-?%\}/g, (m, filter, body) => { note(`\`{% filter ${filter.trim().split(/[\s(|]/)[0]} %}\` applied a filter to a whole block; the block stands unfiltered and the filter is named.`); return body; });
  text = text.replace(/\{%-?\s*embed\s+(["'][^"']+["'])[^%]*-?%\}([\s\S]*?)\{%-?\s*endembed\s*-?%\}/g, (m, name) => { note(`\`{% embed ${name} %}\` included a template while overriding its blocks; the template is included as it stands and the overrides are named, not applied.`); return `{% include ${name} %}`; });
  // Rewrites run outside strings. `a contains "x"` has its right operand in the string part that follows, so the
  // operator is closed there; `equals` the operator is not `.equals(` the method.
  const rewriteExpr = (expr) => {
    const parts = expr.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i]
        .replace(/(?<!\.)\bequals\b/g, "==")
        .replace(/([\w.$\]\)]+)\s+contains\s+([\w.$\[\]]+)/g, "($1).includes($2)")
        .replace(/\s\?:\s/g, " || ");
      const open = /([\w.$\]\)]+)\s+contains\s*$/.exec(parts[i]);
      if (open && parts[i + 1] !== undefined) { parts[i] = parts[i].slice(0, open.index) + `(${open[1]}).includes(`; parts[i + 1] += ")"; }
    }
    return parts.join("");
  };
  // Pebble counts loop.index from zero where Twig and jinja count from one.
  text = text.replace(/\bloop\.index\b(?!0)/g, "loop.index0").replace(/\bloop\.revindex\b(?!0)/g, "loop.revindex0");
  text = text.replace(/\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g, (m, a, expr, b) => `{{${a} ${rewriteExpr(expr)} ${b}}}`);
  text = text.replace(/\{%(-?)\s*(if|elseif|elif|for|set)\s+([\s\S]*?)\s*(-?)%\}/g, (m, a, tag, expr, b) => `{%${a} ${tag} ${rewriteExpr(expr)} ${b}%}`);
  return text;
}

export default {
  name: "input-pebble",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(peb|pebble)$/i.test(f.rel));
      if (!files.length) return log.debug("no Pebble templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      const bare = (n) => String(n).replace(/^(\.\.?\/)+/, "").replace(/^(?:templates|views)\//, "").replace(/\.(peb|pebble)$/i, "");
      const keys = [...bodies.keys()];
      const lower = (text) => twigToJinja(pebbleToTwig(text, note), note);
      const resolve = (name) => { const k = resolveTemplate(keys, name, bare); return k ? lower(bodies.get(k)) : null; };
      const extended = new Set(keys.flatMap((k) => [...bodies.get(k).matchAll(/\{%-?\s*extends\s+["']([^"']+)["']/g)].map((m) => resolveTemplate(keys, m[1], bare))).filter(Boolean));
      let count = 0;
      for (const [key, text] of bodies) {
        if (!text.trim()) continue;
        if (extended.has(key) && !/\{%-?\s*extends\s/.test(text)) { note(`${key} is a layout other templates extend; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const ext = /\{%-?\s*extends\s+["']([^"']+)["']/.exec(text);
        const parentKey = ext ? resolveTemplate(keys, ext[1], bare) : null;
        const lowered = lowerJinja(lower(text), note, resolve);
        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(lowered);
        const template = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : lowered)).trim();
        if (!template) continue;
        const selector = (bare(key) || "page").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        const file = files.find((f) => f.rel.replace(/^\.\//, "") === key);
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file?.rel ?? key,
          inputs: readInputs(template),
          outputs: [],
          template,
          composed: parentKey ? [parentKey] : [],
          templateOrigin: parentKey ? "a Pebble template, composed into its layout and lowered through Twig and jinja" : "a Pebble template, lowered through Twig and jinja",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "pebble",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Pebble template(s) lowered through the jinja lowering`);
    });
  },
};
