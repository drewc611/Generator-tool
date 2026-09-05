import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { readInputs, resolveTemplate } from "../dsp-ir/text.js";
import { isDjango, lowerJinja } from "../input-jinja/lower.js";

/**
 * Django's template language is jinja's grandparent with spellings of its
 * own: {% empty %} for a for's else, {% ifequal %}, {% comment %} blocks,
 * {% trans %} and {% blocktrans %}, {% static %} and {% url %} that name what
 * the server resolved, {% with %} that binds names for a block, {% firstof %},
 * {% cycle %}, {% now %}, forloop.counter, and filter arguments after a colon,
 * {{ x|date:"Y" }}. Everything else, if and for and their else, extends and
 * block and include, is jinja's own, so the reader rewrites the Django
 * spellings onto jinja's and hands the result to the jinja lowering, which
 * composes inheritance, inlines held includes and names what it cannot carry.
 * One lowering, three dialects, as with Twig.
 *
 * A {% url %} names a route the server reversed; it is kept as a call and
 * named, because the route table is the server's. A {% static %} keeps its
 * path as written, because the static prefix is deployment configuration.
 * A translation keeps its key or its source text and is named so the port can
 * wire its own i18n. Server time, a cycle and a regroup have no client
 * equivalent and are named rather than approximated.
 */

const TAG = /\{%-?\s*([\s\S]*?)\s*-?%\}/g;

/** A filter argument after a colon, {{ x|date:"Y" }}, is the call jinja spells with parentheses. */
function colonFilters(expr) {
  return expr.split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/).map((part, i, parts) => {
    if (i % 2) return part;
    // The colon's argument may be the string part that follows; it is joined here so the two stay one call.
    return part.replace(/\|\s*(\w+):(?=\s*$)/g, (m, f) => { parts[i + 1] = `${parts[i + 1]}\u0000`; return `|${f}(`; }).replace(/\|\s*(\w+):([\w.$-]+)/g, "|$1($2)");
  }).join("").replace(/\u0000/g, ")");
}

/** Django spellings onto jinja's, outside of strings; a `with` block's names substituted inside it. */
export function djangoToJinja(source, note = () => {}) {
  let text = String(source ?? "");
  text = text.replace(/\{%-?\s*comment\b[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, "");
  text = text.replace(/\{%-?\s*(?:load|localize|endlocalize|spaceless|endspaceless|autoescape\b[^%]*|endautoescape|verbatim|endverbatim)\s*-?%\}/g, (m) => (/verbatim/.test(m) ? (note("`{% verbatim %}` kept its body from the template engine; the body is lowered like the rest, so any braces in it are read as template syntax."), "") : ""));
  // {% blocktrans with n=x %}Hello {{ n }}{% plural %}...{% endblocktrans %} is its singular text with its names bound as a with block.
  text = text.replace(/\{%-?\s*(?:blocktrans|blocktranslate)\b([^%]*?)\s*-?%\}([\s\S]*?)\{%-?\s*end(?:blocktrans|blocktranslate)\s*-?%\}/g, (m, head, body) => {
    note("`{% blocktrans %}` looked a translation up on the server; its source text stands as written with its placeholders and is named so the port can wire its own i18n.");
    const singular = body.split(/\{%-?\s*plural\s*-?%\}/);
    if (singular.length > 1) note("`{% plural %}` chose a form by count on the server; only the singular text is carried.");
    const withs = [...head.matchAll(/([\w$]+)\s*=\s*([\w.$|:"'-]+)/g)].filter((x) => x[1] !== "count" && x[1] !== "context");
    return withs.length ? `{% with ${withs.map((x) => `${x[1]}=${x[2]}`).join(" ")} %}${singular[0]}{% endwith %}` : singular[0];
  });
  // {% with a=b c=d %} and {% with b as a %} bind names for their block: substituted where they are read.
  for (;;) {
    const w = /\{%-?\s*with\s+([\s\S]*?)\s*-?%\}([\s\S]*?)\{%-?\s*endwith\s*-?%\}/.exec(text);
    if (!w) break;
    const pairs = [];
    const asForm = /^([\s\S]+?)\s+as\s+([\w$]+)$/.exec(w[1].trim());
    if (asForm) pairs.push([asForm[2], asForm[1].trim()]);
    else for (const m of w[1].matchAll(/([\w$]+)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/g)) pairs.push([m[1], m[2]]);
    let body = w[2];
    for (const [name, value] of pairs) {
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      body = body.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (span) => span.replace(new RegExp(`(?<![\\w.$])${safe}(?![\\w$])`, "g"), () => value));
    }
    note(`\`{% with %}\` bound ${pairs.map((p) => `\`${p[0]}\``).join(", ")} for its block; each read was replaced with what it named.`);
    text = text.slice(0, w.index) + body + text.slice(w.index + w[0].length);
  }
  const aliases = new Map();
  text = text.replace(TAG, (whole, code) => {
    const c = code.trim();
    let m;
    if (c === "empty") return "{% else %}";
    if ((m = /^ifequal\s+(\S+)\s+([\s\S]+)$/.exec(c))) return `{% if ${m[1]} == ${m[2]} %}`;
    if ((m = /^ifnotequal\s+(\S+)\s+([\s\S]+)$/.exec(c))) return `{% if ${m[1]} != ${m[2]} %}`;
    if (/^end(?:ifequal|ifnotequal|ifchanged)$/.test(c)) return "{% endif %}";
    if ((m = /^ifchanged\b/.exec(c))) { note("`{% ifchanged %}` rendered its body only when a value differed from the last row; the body is rendered every row and the comparison is a person's to write."); return "{% if true %}"; }
    if ((m = /^(?:trans|translate)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\w.$]+)(?:\s+noop)?(?:\s+context\s+\S+)?(?:\s+as\s+([\w$]+))?$/.exec(c))) {
      note("`{% trans %}` looked a translation up on the server; the source text stands as written and is named so the port can wire its own i18n.");
      const value = /^["']/.test(m[1]) ? m[1].slice(1, -1) : `{{ ${m[1]} }}`;
      if (m[2]) { aliases.set(m[2], /^["']/.test(m[1]) ? m[1] : m[1]); return ""; }
      return value;
    }
    if ((m = /^static\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\w.$]+)(?:\s+as\s+([\w$]+))?$/.exec(c))) {
      note("`{% static %}` prefixed a path with the deployment's static root; the path stands as written and the prefix is the port's to add.");
      const value = /^["']/.test(m[1]) ? m[1].slice(1, -1) : `{{ ${m[1]} }}`;
      if (m[2]) { aliases.set(m[2], m[1]); return ""; }
      return value;
    }
    if ((m = /^url\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\w.$]+)([\s\S]*?)(?:\s+as\s+([\w$]+))?$/.exec(c))) {
      note("`{% url %}` reversed a route by name on the server; the call is kept as written and `url` is the reverse router the port must supply.");
      const args = m[2].trim() ? m[2].trim().split(/\s+/).map((a) => a.replace(/^(\w+)=/, "")) : [];
      const call = `url(${[m[1], ...args].join(", ")})`;
      if (m[3]) { aliases.set(m[3], call); return ""; }
      return `{{ ${call} }}`;
    }
    if ((m = /^firstof\s+([\s\S]+)$/.exec(c))) return `{{ ${m[1].trim().split(/\s+/).join(" || ")} }}`;
    if ((m = /^widthratio\s+(\S+)\s+(\S+)\s+(\S+)/.exec(c))) { note("`{% widthratio %}` rounded a ratio on the server; the port carries the ratio unrounded."); return `{{ ${m[1]} / ${m[2]} * ${m[3]} }}`; }
    if (/^now\b/.test(c)) { note("`{% now %}` printed the server's clock; it has no client equivalent and was removed."); return ""; }
    if (/^cycle\b/.test(c)) { note("`{% cycle %}` alternated values across rows on the server; it has no dialect spelling and was removed, so the alternation is a person's to write from the loop index."); return ""; }
    if (/^(?:lorem|debug|querystring|resetcycle)\b/.test(c)) { note(`\`{% ${c.split(/\s/)[0]} %}\` is server side machinery with no client equivalent; it was removed.`); return ""; }
    if (/^regroup\b/.test(c)) { note("`{% regroup %}` grouped a list on the server; the grouping is a person's to write in the port and the tag was removed."); return ""; }
    if ((m = /^include\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s+[\s\S]+)?$/.exec(c))) {
      if (m[2]) note(`\`{% include ${m[1]} ${m[2].trim().slice(0, 30)} %}\` passed names into the include; the include is inlined and reads its names from the page's own.`);
      return `{% include ${m[1]} %}`;
    }
    if ((m = /^for\s+([\s\S]+?)\s+reversed$/.exec(c))) { note("`{% for ... reversed %}` walked the list backwards; the port walks it forwards and the order is a person's to keep."); return `{% for ${m[1]} %}`; }
    if ((m = /^(if|elif)\s+([\s\S]+)$/.exec(c))) return `{% ${m[1]} ${colonFilters(m[2])} %}`;
    if (/^extends\s+[\w.$]+$/.test(c)) { note(`\`{% ${c} %}\` names its parent through a variable; the parent cannot be resolved and the page stands alone.`); return ""; }
    return whole;
  });
  // forloop.* is jinja's loop.*; the jinja lowering spells the index and names the rest.
  text = text.replace(/\bforloop\.counter0\b/g, "loop.index0").replace(/\bforloop\.counter\b/g, "loop.index").replace(/\bforloop\.(\w+)/g, "loop.$1");
  // Filters with colon arguments in interpolations; a translated or reversed name read where it was bound.
  text = text.replace(/\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g, (m, a, expr, b) => {
    let e = colonFilters(expr);
    for (const [name, value] of aliases) e = e.replace(new RegExp(`(?<![\\w.$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`, "g"), () => value);
    e = e.replace(/\|\s*(?:safe|escape|force_escape|escapejs|linebreaks|linebreaksbr|striptags|urlencode|iriencode|addslashes|autoescape)\b/g, "");
    if (/\bblock\.super\b/.test(e)) { note("`{{ block.super }}` spliced the parent block's default back in; jinja spells it super() and the lowering carries that."); e = e.replace(/\bblock\.super\b/g, "super()"); }
    return `{{${a} ${e} ${b}}}`;
  });
  return text;
}

export default {
  name: "input-django",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const candidates = ctx.sources.files.filter((f) => /\.(html?|djhtml|txt)$/i.test(f.rel) && !/\.scala\.html$/i.test(f.rel));
      const bodies = new Map();
      for (const f of candidates) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        if (/\{%/.test(text)) bodies.set(f.rel.replace(/^\.\//, ""), text);
      }
      const own = [...bodies.keys()].filter((k) => isDjango(bodies.get(k)));
      if (!own.length) return log.debug("no Django templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bare = (n) => String(n).replace(/^(\.\.?\/)+/, "").replace(/^(?:[\w-]+\/)?templates\//, "").replace(/\.(html?|djhtml|txt)$/i, "");
      const keys = [...bodies.keys()];
      // {% extends "base.html" %} and {% include "includes/nav.html" %} name a path under a templates directory; a jinja file the run also holds may be the parent.
      const resolve = (name) => { const k = resolveTemplate(keys, name, bare); return k ? djangoToJinja(bodies.get(k), note) : null; };
      const layouts = new Set(keys.filter((k) => /\{%-?\s*block\s/.test(bodies.get(k)) && !/\{%-?\s*extends\s/.test(bodies.get(k)) && keys.some((o) => new RegExp(`\\{%-?\\s*extends\\s+['"][^'"]*${bare(k).split("/").pop().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(bodies.get(o)))));
      let count = 0;
      for (const key of own) {
        const text = bodies.get(key);
        if (layouts.has(key)) { note(`${key} is a layout other templates extend; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const extend = /\{%-?\s*extends\s+['"]([^'"]+)['"]/.exec(text);
        const parentKey = extend ? resolveTemplate(keys, extend[1], bare) : null;
        const lowered = lowerJinja(djangoToJinja(text, note), note, resolve);
        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(lowered);
        const markup = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : lowered)).trim();
        if (!markup) continue;
        const selector = (bare(key) || "page").split("/").filter((p) => p !== ".").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        const file = ctx.sources.files.find((f) => f.rel.replace(/^\.\//, "") === key);
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file?.rel ?? key,
          inputs: readInputs(markup, { skip: ["url"] }),
          outputs: [],
          template: markup,
          composed: parentKey ? [parentKey] : [],
          templateOrigin: parentKey ? "a Django template, composed into its layout and lowered through jinja" : "a Django template, lowered through jinja",
          usesNgIf: /ng-if/.test(markup),
          usesNgFor: /ng-repeat/.test(markup),
          usesTwoWay: false,
          rxjs: [],
          readBy: "django",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Django template(s) lowered through the jinja lowering`);
    });
  },
};
