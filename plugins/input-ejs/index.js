import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { attrSafe, readInputs, resolveTemplate, splitCommas } from "../dsp-ir/text.js";
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
export function ejsToUnderscore(source, note = () => {}, resolve = () => null, from = "", chain = []) {
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
  text = text.replace(/<%\s*for\s*\(\s*(?:const|let|var)\s+(\[\s*[\w$]+\s*,\s*[\w$]+\s*\]|[\w$]+)\s+of\s+([\s\S]+?)\s*\)\s*\{\s*%>/g, (m, item, list) => `<% ${list.trim()}.forEach(function (${item.replace(/\s+/g, "")}) { %>`);
  text = text.replace(/<%\s*for\s*\(\s*(?:const|let|var)\s+([\w$]+)\s+in\s+([\s\S]+?)\s*\)\s*\{\s*%>/g, (m, key, obj) => `<% Object.keys(${obj.trim()}).forEach(function (${key}) { %>`);
  text = text.replace(/<%\s*for\s*\(\s*(?:let|var)\s+([\w$]+)\s*=\s*0\s*;\s*\1\s*<\s*([\w$.]+)\.length\s*;\s*(?:\1\+\+|\+\+\1|\1\s*\+=\s*1)\s*\)\s*\{\s*%>/g, (m, i, list) => {
    note(`\`for (${i} = 0; ${i} < ${list}.length; ${i}++)\` counted over a list; the port repeats over the list itself, and a read of \`${list}[${i}]\` in the body is the item.`);
    return `<% ${list}.forEach(function (${list.replace(/\W/g, "_")}_item, ${i}) { %>\u0001ITEM:${list}:${i}\u0001`;
  });
  // The body of a counted loop reads list[i]; that is the item the loop hands over. The body ends at the closer that
  // matches the loop, found by depth over the tags between, innermost loop first so a nested one is whole.
  for (;;) {
    const markers = [...text.matchAll(/\u0001ITEM:([\w$.]+):([\w$]+)\u0001/g)];
    if (!markers.length) break;
    const mk = markers[markers.length - 1];
    const start = mk.index + mk[0].length;
    let depth = 1; let end = text.length;
    const tag = /<%[\s\S]*?%>/g; tag.lastIndex = start;
    for (let t; (t = tag.exec(text));) {
      const code = t[0].slice(2, -2).trim();
      if (/^\}/.test(code)) depth -= 1;
      if (/\{$/.test(code)) depth += 1;
      if (depth === 0) { end = t.index; break; }
    }
    const safe = mk[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = text.slice(start, end).replace(new RegExp(`${safe}\\[${mk[2]}\\]`, "g"), `${mk[1].replace(/\W/g, "_")}_item`);
    text = text.slice(0, mk.index) + body + text.slice(end);
  }
  // include('path', { a: b }) and the legacy <% include path %> inline another file with its locals bound; last, so an
  // inlined body, already rewritten by the recursion, is never rewritten twice.
  text = text.replace(/<%[-=]?\s*include\s*\(\s*(["'])([^"']+)\1\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)\s*;?\s*%>|<%\s*include\s+(\S+)\s*%>/g, (m, q, path, locals, legacy) => {
    const name = path ?? legacy;
    const body = resolve(name, from);
    if (body == null) { note(`\`include('${name}')\` names a template this run does not hold; the tag was removed and the content stands without it.`); return ""; }
    if (chain.includes(body.key) || body.key === from) { note(`\`include('${name}')\` includes a template already on the include chain; the cycle was cut there.`); return ""; }
    let inner = body.text;
    if (locals) {
      // { item: related[0], x: fn(p, q), nested: { a: b }, shorthand }: split at the top level commas, a key before its first colon.
      const pairs = splitCommas(locals.slice(1, -1), { ticks: false }).map((entry) => { const m = /^([\w$]+)\s*(?::\s*([\s\S]+))?$/.exec(entry.trim()); return m ? [m[1], (m[2] ?? m[1]).trim()] : null; }).filter(Boolean);
      for (const [local, value] of pairs) {
        const safe = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        inner = inner.replace(/<%[-=_]?[\s\S]*?%>/g, (span) => span.replace(new RegExp(`(?<![\\w.$])${safe}(?![\\w$])`, "g"), () => (/^[\w$.]+$/.test(value) ? value : `(${value})`)));
      }
      if (pairs.length) note(`\`include('${name}', { ... })\` bound ${pairs.map((x) => `\`${x[0]}\``).join(", ")} for the include; each read was replaced with what it named.`);
    }
    return ejsToUnderscore(inner, note, resolve, body.key, [...chain, from]);
  });
  // An include whose path is computed cannot be resolved without running the code; it is removed and named.
  text = text.replace(/<%[-=]?\s*include\s*\([\s\S]*?\)\s*;?\s*%>/g, () => { note("`include(...)` with a computed path names a template the run cannot resolve without running the code; the include was removed and the content stands without it."); return ""; });
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
        // '/partials/nav' is against the views root; 'partials/nav' and '../partials/nav' against the including file.
        const rooted = /^\//.test(String(name));
        const clean = String(name).replace(/^\/+/, "").replace(/\.ejs$/i, "");
        const dir = rooted ? [] : from.split("/").slice(0, -1);
        const rel = [...dir];
        for (const p of clean.split("/")) { if (p === "..") rel.pop(); else if (p !== ".") rel.push(p); }
        const k = keys.find((x) => x.replace(/\.ejs$/i, "") === rel.join("/")) ?? resolveTemplate(keys, clean, bare);
        return k ? { key: k, text: bodies.get(k) } : null;
      };
      // The layout is the file whose <%- body %> is the page, whatever it is called; two are a choice the run cannot make.
      const layouts = keys.filter((k) => /<%-\s*body\s*%>/.test(bodies.get(k)));
      const layoutKey = layouts.length ? layouts.find((k) => /(^|\/)layout\.ejs$/i.test(k)) ?? layouts[0] : null;
      if (layouts.length > 1) note(`${layouts.length} templates render \`<%- body %>\` (${layouts.join(", ")}); express-ejs-layouts picks per route, which the run cannot know, so ${layoutKey} was composed around every page.`);
      const shell = layoutKey ? restoreLiterals(lowerUnderscore(ejsToUnderscore(bodies.get(layoutKey), note, resolve, layoutKey), note)) : null;
      let count = 0;
      for (const [key, text] of bodies) {
        if (!text.trim()) continue;
        if (layouts.includes(key)) { note(`${key} is a layout every page renders inside (its \`<%- body %>\` is the page); it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const partial = /(^|\/)(?:partials?|includes?)\//i.test(key);
        let lowered = restoreLiterals(lowerUnderscore(ejsToUnderscore(text, note, resolve, key), note));
        const composed = [];
        if (shell && !partial && shell.includes(PAGE_MARK)) { lowered = shell.replace(PAGE_MARK, () => lowered); composed.push(layoutKey); }
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
