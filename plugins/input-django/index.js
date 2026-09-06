import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { readInputs } from "../dsp-ir/text.js";
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
  const asvars = new Map();
  text = text.replace(/\{%-?\s*(?:blocktrans|blocktranslate)\b([^%]*?)\s*-?%\}([\s\S]*?)\{%-?\s*end(?:blocktrans|blocktranslate)\s*-?%\}/g, (m, head, body) => {
    note("`{% blocktrans %}` looked a translation up on the server; its source text stands as written with its placeholders and is named so the port can wire its own i18n.");
    const singular = body.split(/\{%-?\s*plural\s*-?%\}/);
    if (singular.length > 1) note("`{% plural %}` chose a form by count on the server; only the singular text is carried.");
    const withs = [...head.matchAll(/([\w$]+)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/g)].filter((x) => x[1] !== "count" && x[1] !== "context");
    const asvar = /\basvar\s+([\w$]+)/.exec(head);
    const inner = withs.length ? `{% with ${withs.map((x) => `${x[1]}=${x[2]}`).join(" ")} %}${singular[0]}{% endwith %}` : singular[0];
    // asvar bound the text to a name read later; the text is that name's value, quoted, and nothing is printed here.
    if (asvar) { asvars.set(asvar[1], `"${singular[0].replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, "' + $1 + '").replace(/"/g, "'")}"`); note(`\`{% blocktrans asvar ${asvar[1]} %}\` bound its text to a name; each read of the name is the text.`); return ""; }
    return inner;
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
    const shadowed = new Set([...body.matchAll(/\{%-?\s*for\s+([\w$]+)(?:\s*,\s*([\w$]+))?\s+in\b/g)].flatMap((f) => [f[1], f[2]].filter(Boolean)));
    for (const [name, value] of pairs) {
      if (shadowed.has(name)) { note(`\`{% with %}\` bound \`${name}\`, which a loop inside the block binds again; the loop's own name stands and the with binding is left as written there.`); continue; }
      const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      body = body.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (span) => span.replace(new RegExp(`(?<![\\w.$])${safe}(?![\\w$])`, "g"), () => value));
    }
    note(`\`{% with %}\` bound ${pairs.map((p) => `\`${p[0]}\``).join(", ")} for its block; each read was replaced with what it named.`);
    text = text.slice(0, w.index) + body + text.slice(w.index + w[0].length);
  }
  const aliases = new Map(asvars);
  const defined = new Set();
  text = text.replace(TAG, (whole, code) => {
    // A filter argument after a colon may stand in any tag's expression: a for's list, a url's argument, a firstof operand.
    const c = colonFilters(code.trim());
    let m;
    if (c === "empty") return "{% else %}";
    if ((m = /^ifequal\s+(\S+)\s+([\s\S]+)$/.exec(c))) return `{% if ${m[1]} == ${m[2]} %}`;
    if ((m = /^ifnotequal\s+(\S+)\s+([\s\S]+)$/.exec(c))) return `{% if ${m[1]} != ${m[2]} %}`;
    if (/^end(?:ifequal|ifnotequal|ifchanged)$/.test(c)) return "{% endif %}";
    if ((m = /^ifchanged\b/.exec(c))) { note("`{% ifchanged %}` rendered its body only when a value differed from the last row; the body is rendered every row, an else branch never, and the comparison is a person's to write."); return "{% if true %}"; }
    if ((m = /^(?:trans|translate)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\w.$]+)(?:\s+noop)?(?:\s+context\s+\S+)?(?:\s+as\s+([\w$]+))?$/.exec(c))) {
      note("`{% trans %}` looked a translation up on the server; the source text stands as written and is named so the port can wire its own i18n.");
      const value = /^["']/.test(m[1]) ? m[1].slice(1, -1) : `{{ ${m[1]} }}`;
      if (m[2]) { aliases.set(m[2], m[1]); return ""; }
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
      const words = m[2].trim() ? m[2].trim().split(/\s+/) : [];
      const positional = words.filter((a) => !/^\w+=/.test(a));
      const keyed = words.filter((a) => /^\w+=/.test(a)).map((a) => a.replace(/^(\w+)=/, "$1: "));
      const call = `url(${[m[1], ...positional, ...(keyed.length ? [`{ ${keyed.join(", ")} }`] : [])].join(", ")})`;
      if (m[3]) { aliases.set(m[3], call); return ""; }
      return `{{ ${call} }}`;
    }
    if ((m = /^firstof\s+([\s\S]+)$/.exec(c))) return `{{ ${m[1].trim().split(/\s+/).join(" || ")} }}`;
    if ((m = /^widthratio\s+(\S+)\s+(\S+)\s+(\S+)/.exec(c))) { note("`{% widthratio %}` rounded a ratio on the server; the port carries the ratio unrounded."); return `{{ ${m[1]} / ${m[2]} * ${m[3]} }}`; }
    if (/^now\b/.test(c)) { note("`{% now %}` printed the server's clock; it has no client equivalent and was removed."); return ""; }
    if (/^cycle\b/.test(c)) { const as = /\sas\s+([\w$]+)/.exec(c); if (as) defined.add(as[1]); note("`{% cycle %}` alternated values across rows on the server; it has no dialect spelling and was removed, so the alternation is a person's to write from the loop index."); return ""; }
    if (/^(?:lorem|debug|querystring|resetcycle)\b/.test(c)) { note(`\`{% ${c.split(/\s/)[0]} %}\` is server side machinery with no client equivalent; it was removed.`); return ""; }
    if (/^regroup\b/.test(c)) { const as = /\sas\s+([\w$]+)/.exec(c); if (as) defined.add(as[1]); note("`{% regroup %}` grouped a list on the server; the grouping is a person's to write in the port and the tag was removed."); return ""; }
    if ((m = /^include\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s+[\s\S]+)?$/.exec(c))) {
      const names = [...(m[2] ?? "").matchAll(/([\w$]+)\s*=/g)].map((x) => x[1]);
      if (names.length) note(`\`{% include ${m[1]} with %}\` passed ${names.map((n) => `\`${n}\``).join(", ")} into the include; the include is inlined and reads those names from the page's own.`);
      else if (/\bonly\b/.test(m[2] ?? "")) note(`\`{% include ${m[1]} only %}\` restricted the include to no context; inlined, it reads the page's names.`);
      return `{% include ${m[1]} %}`;
    }
    if ((m = /^for\s+([\s\S]+?)\s+reversed$/.exec(c))) { note("`{% for ... reversed %}` walked the list backwards; the port walks it forwards and the order is a person's to keep."); return `{% for ${m[1]} %}`; }
    if ((m = /^(if|elif)\s+([\s\S]+)$/.exec(c))) return `{% ${m[1]} ${colonFilters(m[2])} %}`;
    if (/^extends\s+[\w.$]+$/.test(c)) { note(`\`{% ${c} %}\` names its parent through a variable; the parent cannot be resolved and the page stands alone.`); return ""; }
    // Any other tag stands, with its colon filters rewritten.
    return c === code.trim() ? whole : `{% ${c} %}`;
  });
  // forloop.* is jinja's loop.*; the jinja lowering spells the index and names the rest.
  text = text.replace(/\bforloop\.counter0\b/g, "loop.index0").replace(/\bforloop\.counter\b/g, "loop.index").replace(/\bforloop\.(\w+)/g, "loop.$1");
  // Filters with colon arguments in interpolations; a translated or reversed name read where it was bound.
  const FILTER_MEANING = { safe: "marked the value as html the page trusts; the port escapes everything, so a value carrying markup shows as text", escape: "escaped the value; the port escapes everything, so it is dropped", force_escape: "escaped the value; the port escapes everything, so it is dropped", escapejs: "escaped the value for a script; the port carries the value and the escaping is its own", linebreaks: "turned line breaks into paragraphs; the port carries the text and the breaks are its own to render", linebreaksbr: "turned line breaks into <br>; the port carries the text and the breaks are its own to render", striptags: "stripped markup from the value; the port carries the value as given", urlencode: "encoded the value for a URL; the port must encode it itself", iriencode: "encoded the value for an IRI; the port must encode it itself", addslashes: "escaped quotes for a script; the port carries the value as given" };
  const substitute = (e) => { let out = e; for (const [name, value] of aliases) out = out.replace(new RegExp(`(?<![\\w.$])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`, "g"), () => value); return out; };
  // A translated or reversed name read inside a tag's test or list, not only inside {{ }}.
  if (aliases.size) text = text.replace(/\{%-?\s*(if|elif|for)\s+([\s\S]*?)\s*-?%\}/g, (m, tag, expr) => `{% ${tag} ${substitute(expr)} %}`);
  text = text.replace(/\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g, (m, a, expr, b) => {
    let e = substitute(colonFilters(expr));
    // A filter the port cannot carry is dropped and its meaning named, because dropping it changes what the value means.
    e = e.replace(/\|\s*(safe|escape|force_escape|escapejs|linebreaks|linebreaksbr|striptags|urlencode|iriencode|addslashes)\b/g, (mm, f) => { note(`\`|${f}\` ${FILTER_MEANING[f]}.`); return ""; });
    if (/\bblock\.super\b/.test(e)) { note("`{{ block.super }}` spliced the parent block's default back in; jinja spells it super() and the lowering carries that."); e = e.replace(/\bblock\.super\b/g, "super()"); }
    return `{{${a} ${e} ${b}}}`;
  });
  djangoToJinja.defined = defined;
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
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bare = (n) => String(n).replace(/^(\.\.?\/)+/, "").replace(/^(?:[\w-]+\/)?templates\//, "").replace(/\.(html?|djhtml|txt)$/i, "");
      const app = (k) => (/(^|\/)templates\//.test(k) ? k.replace(/(^|\/)templates\/[\s\S]*$/, "") : "");
      const keys = [...bodies.keys()];
      // {% extends "base.html" %} names a path under a templates directory; two apps may both hold one, and
      // Django picks by app order, which the run cannot know: the caller's own app wins, and a tie is named.
      const locate = (name, from) => {
        const b = bare(name);
        const exact = keys.filter((k) => bare(k) === b);
        const hits = exact.length ? exact : keys.filter((k) => bare(k).endsWith(`/${b}`));
        if (hits.length <= 1) return hits[0] ?? null;
        const same = hits.find((k) => app(k) === app(from));
        if (same) return same;
        note(`\`${name}\` is answered by ${hits.length} templates in different apps and Django would pick by app order, which the run cannot know; the first by path was used.`);
        return hits[0];
      };
      const named = (text) => [...text.matchAll(/\{%-?\s*(?:extends|include)\s+["']([^"']+)["']/g)].map((x) => x[1]);
      // A template is Django's by its own spellings, and so is every template in its tree: the base it extends, the include it names, the child that extends it.
      const own = new Set(keys.filter((k) => isDjango(bodies.get(k))));
      for (let grew = true; grew;) {
        grew = false;
        for (const k of keys) {
          if (own.has(k)) continue;
          const reaches = named(bodies.get(k)).some((n) => own.has(locate(n, k)));
          const reached = [...own].some((o) => named(bodies.get(o)).some((n) => locate(n, o) === k));
          if (reaches || reached) { own.add(k); grew = true; }
        }
      }
      if (!own.size) return log.debug("no Django templates");
      // Two apps may both hold an index.html; the selector keeps the app when the bared path alone would collide.
      const bared = new Map();
      for (const k of own) bared.set(bare(k), (bared.get(bare(k)) ?? 0) + 1);
      const selectorOf = (k) => ((bared.get(bare(k)) > 1 ? k.replace(/(^|\/)templates\//, "$1").replace(/\.(html?|djhtml|txt)$/i, "") : bare(k)) || "page").split("/").filter((p) => p !== ".").join("-").toLowerCase().replace(/[^\w-]/g, "-");
      const resolveFrom = (from) => (name) => { const k = locate(name, from); return k ? djangoToJinja(bodies.get(k), note) : null; };
      const layouts = new Set(keys.filter((k) => /\{%-?\s*block\s/.test(bodies.get(k)) && !/\{%-?\s*extends\s/.test(bodies.get(k)) && keys.some((o) => new RegExp(`\\{%-?\\s*extends\\s+['"][^'"]*${bare(k).split("/").pop().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(bodies.get(o)))));
      let count = 0;
      for (const key of own) {
        const text = bodies.get(key);
        if (layouts.has(key)) { note(`${key} is a layout other templates extend; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const extend = /\{%-?\s*extends\s+['"]([^'"]+)['"]/.exec(text);
        const parentKey = extend ? locate(extend[1], key) : null;
        const rewritten = djangoToJinja(text, note);
        // A name a removed tag defined (regroup ... as, cycle ... as) is a server computed local, not an input the port can be handed.
        const defined = [...djangoToJinja.defined];
        if (defined.length) note(`${key} reads ${defined.map((d) => `\`${d}\``).join(", ")}, which server side tags defined; the port must compute them, so they are not listed as inputs.`);
        const lowered = lowerJinja(rewritten, note, resolveFrom(key));
        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(lowered);
        const markup = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : lowered)).trim();
        if (!markup) continue;
        const selector = selectorOf(key);
        const file = ctx.sources.files.find((f) => f.rel.replace(/^\.\//, "") === key);
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file?.rel ?? key,
          inputs: readInputs(markup, { skip: ["url", ...defined] }),
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
