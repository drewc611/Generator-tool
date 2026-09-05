import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { lowerJinja } from "../input-jinja/lower.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";

/**
 * Twig, the template language of Symfony, Drupal and Craft, is jinja's
 * grammar with a handful of its own spellings: {% elseif %} for elif, ~ for
 * string concatenation, `is defined`, `is empty` and `is null` tests, the
 * `?:` and `??` shorthands, `|e` and `|raw` filters, `path()` and `asset()`
 * calls that name a server route, and `{% set %}` in place of assignment.
 * Everything else, if and for and their else, extends and block and include
 * and macro, is jinja's own, so the reader rewrites the Twig spellings onto
 * jinja's at the word level and hands the result to the jinja lowering, which
 * already composes inheritance, inlines held includes and names what it
 * cannot carry. One lowering, two dialects, exactly as with Liquid.
 *
 * A `path()` or `asset()` call names a route the server resolved; it is kept
 * as a call and named, because the route table is the server's and the port's
 * endpoint map is where an address belongs.
 */

/** Twig spellings onto jinja's, outside of strings. */
export function twigToJinja(source, note = () => {}) {
  let text = String(source ?? "");
  // Tags first: elseif, set, and the tests inside {% %} and {{ }}.
  text = text.replace(/\{%(-?)\s*elseif\s+/g, "{%$1 elif ");
  text = text.replace(/\{%(-?)\s*set\s+([\s\S]*?)\s*(-?)%\}/g, (m, a, body, b) => `{%${a} set ${body} ${b}%}`);
  const rewriteExpr = (expr) => {
    const parts = expr.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
    return parts.map((part, i) => {
      if (i % 2) return part;
      return part
        .replace(/\bis\s+not\s+defined\b/g, "== null")
        .replace(/\bis\s+defined\b/g, "!= null")
        .replace(/\bis\s+not\s+(?:empty|null)\b/g, "!= null")
        .replace(/\bis\s+(?:empty|null)\b/g, "== null")
        .replace(/\bis\s+not\s+same\s+as\s*\(/g, "!== (")
        .replace(/\bis\s+same\s+as\s*\(/g, "=== (")
        .replace(/\s~\s/g, " + ")
        .replace(/\|\s*(?:e|escape|raw)\b(?:\([^)]*\))?/g, "")
        .replace(/\|\s*(?:trans|t)\b/g, "")
        .replace(/\s*\|\s*length\b/g, " | length")
        .replace(/\s*\|\s*upper\b/g, " | upper")
        .replace(/\s*\|\s*lower\b/g, " | lower");
    }).join("");
  };
  text = text.replace(/\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g, (m, a, expr, b) => {
    if (/\b(path|url|asset)\s*\(/.test(expr)) note(`\`{{ ${expr.trim().slice(0, 50)} }}\` names a route or asset the server resolved by name. The call is kept as written; the address belongs in the port's endpoint map.`);
    return `{{${a} ${rewriteExpr(expr)} ${b}}}`;
  });
  text = text.replace(/\{%(-?)\s*(if|elif|for)\s+([\s\S]*?)\s*(-?)%\}/g, (m, a, tag, expr, b) => `{%${a} ${tag} ${rewriteExpr(expr)} ${b}%}`);
  // Twig's for iterates `key, value in map` like jinja, and `for x in 1..n` is a range jinja spells range().
  text = text.replace(/\{%(-?)\s*for\s+([\w$]+)\s+in\s+(\S+)\.\.(\S+)\s*(-?)%\}/g, (m, a, v, lo, hi, b) => { note(`{% for ${v} in ${lo}..${hi} %} loops over a range; the port repeats over a list it must be given.`); return `{%${a} for ${v} in [] ${b}%}`; });
  // Twig only tags with no jinja equivalent are left for the jinja lowering to name.
  return text;
}

export default {
  name: "input-twig",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.twig$/i.test(f.rel));
      if (!files.length) return log.debug("no Twig templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      // An include or extends resolves against the run's own files, by exact
      // path first and by basename second, the way Twig's loader searches its
      // configured paths.
      const resolve = (name) => {
        const clean = String(name).replace(/^@\w+\//, "").replace(/^\.\//, "");
        if (bodies.has(clean)) return twigToJinja(bodies.get(clean), note);
        const base = clean.split("/").pop();
        const hit = [...bodies.keys()].find((k) => k.endsWith(`/${clean}`) || k.endsWith(`/${base}`) || k === base);
        return hit ? twigToJinja(bodies.get(hit), note) : null;
      };
      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = bodies.get(rel) ?? "";
        if (!text.trim()) continue;
        // A layout every page extends is chrome; it is composed into each page
        // by the lowering and not ported as a screen of its own.
        if (/\{%-?\s*block\s/.test(text) && !/\{%-?\s*extends\s/.test(text) && files.length > 1 && [...bodies.values()].some((b) => b !== text && /\{%-?\s*extends\s/.test(b))) {
          note(`${rel} is a layout other templates extend; it is composed into each of them rather than ported as a screen of its own.`);
          continue;
        }
        const lowered = lowerJinja(twigToJinja(text, note), note, resolve);
        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(lowered);
        const markup = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : lowered)).trim();
        if (!markup) continue;
        const selector = rel.replace(/\.(html\.)?twig$/i, "").split("/").filter((p) => p !== ".").join("-").toLowerCase().replace(/[^\w-]/g, "-") || "page";
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          inputs: [],
          outputs: [],
          template: markup,
          templateOrigin: "a Twig template, lowered through jinja",
          usesNgIf: /ng-if/.test(markup),
          usesNgFor: /ng-repeat/.test(markup),
          usesTwoWay: false,
          rxjs: [],
          readBy: "twig",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Twig template(s) lowered through the jinja lowering`);
    });
  },
};
