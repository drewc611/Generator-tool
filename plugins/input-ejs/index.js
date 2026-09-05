import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { attrSafe, readInputs, resolveTemplate } from "../dsp-ir/text.js";
import { lowerUnderscore } from "../input-underscore/lower.js";

/**
 * EJS, the template language of a decade of Express apps: underscore's
 * delimiters with the escaping the other way round, `<%= %>` escaped and
 * `<%- %>` raw, plus `<%# %>` comments, `<%_ _%>` and `-%>` whitespace
 * control, `<%%` for a literal `<%`, and `include('path', { locals })` that
 * inlines another file with names bound. The control flow is JavaScript:
 * if, else if, else, forEach with a function or an arrow, for...of,
 * for...in and the counted for. The reader rewrites the EJS spellings onto
 * the shapes the underscore lowering reads, inlines held includes with their
 * locals substituted, and hands the result over. One lowering, two dialects,
 * as with Slim on Haml and Twig on jinja.
 *
 * A raw `<%- %>` output is bound html and lands as the dialect's binding, the
 * same trust decision under every target's name. `<%- body %>` is the layout's
 * slot (express-ejs-layouts): a layout.ejs beside the views is composed around
 * every page that is not itself a layout or a partial. A counted for loop
 * over a list's indexes becomes a loop over the list with the body's index
 * reads named, and a construct the lowering cannot carry is named, never
 * approximated.
 */

const PAGE_MARK = "\u0000EJS_BODY\u0000";

/** EJS onto the underscore lowering's spellings; includes inlined through `resolve(path, from)`. */
export function ejsToUnderscore(source, note = () => {}, resolve = () => null, from = "", depth = 0) {
  let text = String(source ?? "");
  text = text.replace(/<%%/g, "\u0001LT\u0001").replace(/%%>/g, "\u0001GT\u0001");
  text = text.replace(/<%#[\s\S]*?%>/g, "");
  // Whitespace control changes spacing, not the tree.
  text = text.replace(/<%_/g, "<%").replace(/_%>/g, "%>").replace(/-%>/g, "%>");
  text = text.replace(/<%([-=])(?!\s*include\s*\()\s*([\s\S]*?)\s*%>/g, (m, kind, expr) => {
    if (kind === "-" && /^body$/.test(expr)) return PAGE_MARK;
    if (kind === "-") {
      note("`<%- %>` output raw markup. It is kept as bound html, the same trust decision under whatever name the target gives it.");
      return `<span ng-bind-html="${attrSafe(expr)}"></span>`;
    }
    // EJS escapes <%= %>, which underscore spells <%- %>; the underscore lowering then has nothing to warn about.
    return `<%- ${expr} %>`;
  });
  // The JavaScript loops EJS authors write, onto the callback shapes the lowering reads.
  text = text.replace(/<%\s*for\s*\(\s*(?:const|let|var)\s+([\w$]+)\s+of\s+([\s\S]+?)\s*\)\s*\{\s*%>/g, (m, item, list) => `<% ${list.trim()}.forEach(function (${item}) { %>`);
  text = text.replace(/<%\s*for\s*\(\s*(?:const|let|var)\s+([\w$]+)\s+in\s+([\s\S]+?)\s*\)\s*\{\s*%>/g, (m, key, obj) => `<% Object.keys(${obj.trim()}).forEach(function (${key}) { %>`);
  text = text.replace(/<%\s*for\s*\(\s*(?:let|var)\s+([\w$]+)\s*=\s*0\s*;\s*\1\s*<\s*([\w$.]+)\.length\s*;\s*(?:\1\+\+|\+\+\1|\1\s*\+=\s*1)\s*\)\s*\{\s*%>/g, (m, i, list) => {
    note(`\`for (${i} = 0; ${i} < ${list}.length; ${i}++)\` counted over a list; the port repeats over the list itself, and a read of \`${list}[${i}]\` in the body is the item.`);
    return `<% ${list}.forEach(function (${list.replace(/\W/g, "_")}_item, ${i}) { %>\u0001ITEM:${list}:${i}\u0001`;
  });
  // The body of a counted loop reads list[i]; that is the item the loop hands over.
  text = text.replace(/\u0001ITEM:([\w$.]+):([\w$]+)\u0001([\s\S]*?)(<%\s*\}\s*\)?;?\s*%>)/g, (m, list, i, body, close) => {
    const safe = list.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return body.replace(new RegExp(`${safe}\\[${i}\\]`, "g"), `${list.replace(/\W/g, "_")}_item`) + close;
  });
  // include('path', { a: b }) and the legacy <% include path %> inline another file with its locals bound; last, so an
  // inlined body, already rewritten by the recursion, is never rewritten twice.
  text = text.replace(/<%[-=]?\s*include\s*\(\s*(["'])([^"']+)\1\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)\s*;?\s*%>|<%\s*include\s+(\S+)\s*%>/g, (m, q, path, locals, legacy) => {
    const name = path ?? legacy;
    const body = depth < 6 ? resolve(name, from) : null;
    if (body == null) { note(`\`include('${name}')\` names a template this run does not hold; the tag was removed and the content stands without it.`); return ""; }
    let inner = body.text;
    if (locals) {
      const pairs = [...locals.slice(1, -1).matchAll(/([\w$]+)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,}]+)/g)].map((x) => [x[1], x[2].trim()]);
      for (const [local, value] of pairs) {
        const safe = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        inner = inner.replace(/<%[-=_]?[\s\S]*?%>/g, (span) => span.replace(new RegExp(`(?<![\\w.$])${safe}(?![\\w$])`, "g"), () => (/^[\w$.]+$/.test(value) ? value : `(${value})`)));
      }
      if (pairs.length) note(`\`include('${name}', { ... })\` bound ${pairs.map((x) => `\`${x[0]}\``).join(", ")} for the include; each read was replaced with what it named.`);
    }
    return ejsToUnderscore(inner, note, resolve, body.key, depth + 1);
  });
  return text;
}

/** The literal `<%` an author wrote as `<%%`, restored once the lowering has run and can no longer mistake it for a tag. */
export const restoreLiterals = (text) => String(text).replace(/\u0001LT\u0001/g, "<%").replace(/\u0001GT\u0001/g, "%>");

export default {
  name: "input-ejs",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.ejs$/i.test(f.rel));
      if (!files.length) return log.debug("no EJS templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => { note(`${f.rel} could not be read; it is not in the port.`); return ""; }));
      const bare = (n) => String(n).replace(/^(\.\.?\/)+/, "").replace(/^views\//, "").replace(/\.ejs$/i, "");
      const keys = [...bodies.keys()];
      // include('../partials/card') is relative to the including file, then to the views root.
      const resolve = (name, from) => {
        const dir = from.split("/").slice(0, -1);
        const parts = String(name).replace(/\.ejs$/i, "").split("/");
        const rel = [...dir];
        for (const p of parts) { if (p === "..") rel.pop(); else if (p !== ".") rel.push(p); }
        const k = keys.find((x) => x.replace(/\.ejs$/i, "") === rel.join("/")) ?? resolveTemplate(keys, name, bare);
        return k ? { key: k, text: bodies.get(k) } : null;
      };
      const layoutKey = keys.find((k) => /(^|\/)layout\.ejs$/i.test(k) && /<%-\s*body\s*%>/.test(bodies.get(k)));
      let count = 0;
      for (const [key, text] of bodies) {
        if (!text.trim()) continue;
        if (key === layoutKey) { note(`${key} is the layout every page renders inside (its \`<%- body %>\` is the page); it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const partial = /(^|\/)(?:partials?|includes?)\//i.test(key);
        let lowered = restoreLiterals(lowerUnderscore(ejsToUnderscore(text, note, resolve, key), note));
        const composed = [];
        if (layoutKey && !partial) {
          const shell = restoreLiterals(lowerUnderscore(ejsToUnderscore(bodies.get(layoutKey), note, resolve, layoutKey), note));
          if (shell.includes(PAGE_MARK)) { lowered = shell.replace(PAGE_MARK, () => lowered); composed.push(layoutKey); }
        }
        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(lowered);
        const template = (bodyMatch ? bodyMatch[1] : lowered).trim();
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
          composed,
          templateOrigin: composed.length ? "an EJS template, composed into its layout and lowered through underscore" : "an EJS template, lowered through underscore",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "ejs",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} EJS template(s) lowered through the underscore lowering`);
    });
  },
};
