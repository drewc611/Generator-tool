import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { attrSafe, readInputs, resolveTemplate, splitCommas } from "../dsp-ir/text.js";
import { lowerJinja } from "../input-jinja/lower.js";
import { twigToJinja } from "../input-twig/index.js";

/**
 * Volt, Phalcon's template engine: jinja's grammar with Twig's tests and a
 * handful of PHP framework helpers. `{{ content() }}` is where a controller
 * drops the view into its layout, `{{ partial('x') }}` inlines a file,
 * `{{ url('x') }}`, `{{ static_url('x') }}` and `{{ link_to('x', 'Text') }}`
 * name routes the server resolves, `{{ tag.textField('name') }}` and its
 * siblings render form fields, `{% do %}` runs an expression for its side
 * effect, `{% cache %}` wraps a block, and `{% break %}`, `{% continue %}`
 * and `{% return %}` leave a loop or a template early. The reader rewrites
 * the Volt spellings onto Twig's and jinja's and hands the result to the
 * jinja lowering, composing every view into the one layout that renders
 * `content()`, the way the framework does by configuration the run cannot
 * see, and naming it when there is more than one.
 *
 * A route helper is kept as a call to `url`, the reverse router the port must
 * supply; a form helper is the field it renders with its model; a flash
 * message, an early exit and a side effect are named.
 */

const PAGE_MARK = "\u0000VOLT_CONTENT\u0000";
const FIELDS = { textField: "text", passwordField: "password", emailField: "email", numericField: "number", dateField: "date", hiddenField: "hidden", fileField: "file", checkField: "checkbox", radioField: "radio", textArea: "textarea", select: "select", selectStatic: "select" };

/** Volt spellings onto jinja's, outside of strings; `resolve(name)` returns a partial's text or null. */
export function voltToJinja(source, note = () => {}, resolve = () => null, depth = 0) {
  let text = String(source ?? "");
  text = text.replace(/\{%-?\s*(?:cache\b[^%]*|endcache|autoescape\b[^%]*|endautoescape)\s*-?%\}/g, "");
  text = text.replace(/\{%-?\s*do\s+([\s\S]*?)\s*-?%\}/g, (m, expr) => { note(`\`{% do ${expr.trim().split(/[\s(]/)[0]} %}\` ran an expression for its side effect on the server; it has no client equivalent and was removed.`); return ""; });
  text = text.replace(/\{%-?\s*(break|continue|return)\b[^%]*-?%\}/g, (m, tag) => { note(`\`{% ${tag} %}\` left a loop or the template early; the port renders the whole and the exit is a person's to write.`); return ""; });
  text = text.replace(/\{%(-?)\s*elseif\s+/g, "{%$1 elif ");
  // {{ content() }} is the layout's slot; the rest of the helpers are calls the server made.
  text = text.replace(/\{\{-?\s*content\(\)\s*-?\}\}/g, PAGE_MARK);
  text = text.replace(/\{\{-?\s*partial\(\s*(["'])([^"']+)\1\s*(?:,\s*(\[[\s\S]*?\]))?\s*\)\s*-?\}\}/g, (m, q, name, params) => {
    const body = depth < 6 ? resolve(name) : null;
    if (body == null) { note(`\`partial('${name}')\` names a template this run does not hold; the call was removed and the content stands without it.`); return ""; }
    if (params) note(`\`partial('${name}', [...])\` passed names into the partial; the partial is inlined and reads them from the view's own.`);
    return voltToJinja(body, note, resolve, depth + 1);
  });
  text = text.replace(/\{\{-?\s*link_to\(\s*([\s\S]*?)\s*\)\s*-?\}\}/g, (m, args) => {
    const parts = splitCommas(args, { ticks: false });
    note("`link_to()` built an anchor from a route name on the server; the route stands as a call to `url`, the reverse router the port must supply.");
    return `<a href="{{ url(${parts[0] ?? "''"}) }}">{{ ${parts[1] ?? "''"} }}</a>`;
  });
  text = text.replace(/\{\{-?\s*(?:tag\.)?(\w+)\(\s*([\s\S]*?)\s*\)\s*-?\}\}/g, (m, helper, args) => {
    if (!(helper in FIELDS)) return m;
    const parts = splitCommas(args, { ticks: false });
    const first = parts[0] ?? "";
    const name = /^\[/.test(first) ? splitCommas(first.slice(1, -1), { ticks: false })[0] ?? "" : first;
    const model = /^["'](\w+)["']$/.exec(name.trim());
    if (!model) { note(`\`tag.${helper}(...)\` names its field through an expression; the field was dropped rather than guessed.`); return ""; }
    note("`tag.*` form helpers render fields bound to names the controller reads back; each is the field it renders, and the port must post the form itself.");
    const type = FIELDS[helper];
    if (type === "textarea") return `<textarea ng-model="${attrSafe(model[1])}"></textarea>`;
    if (type === "select") { note("`tag.select` took its options from a server list; the `<select>` is emitted with none and the port must supply them."); return `<select ng-model="${attrSafe(model[1])}"></select>`; }
    return `<input type="${type}" ng-model="${attrSafe(model[1])}">`;
  });
  text = text.replace(/\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g, (m, a, expr, b) => {
    let e = expr;
    if (/\b(?:url|static_url)\s*\(/.test(e)) { note("`url()` and `static_url()` resolved a route or an asset by name on the server; the call is kept as written and `url` is the reverse router the port must supply."); e = e.replace(/\bstatic_url\s*\(/g, "url("); }
    if (/\bflash\.output\(\)/.test(e)) { note("`flash.output()` printed the session's flash messages; the port must render its own."); return ""; }
    return `{{${a} ${e} ${b}}}`;
  });
  return twigToJinja(text, note);
}

export default {
  name: "input-volt",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.volt$/i.test(f.rel));
      if (!files.length) return log.debug("no Volt templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      const bare = (n) => String(n).replace(/^(\.\.?\/)+/, "").replace(/^(?:app\/)?views\//, "").replace(/\.volt$/i, "");
      const keys = [...bodies.keys()];
      const resolve = (name) => { const k = resolveTemplate(keys, name, bare); return k ? bodies.get(k) : null; };
      const resolveLowered = (name) => { const k = resolveTemplate(keys, name, bare); return k ? voltToJinja(bodies.get(k), note, resolve) : null; };
      // The layout is the file that renders content(); the controller chose it, which the run cannot see.
      const layouts = keys.filter((k) => /\{\{-?\s*content\(\)\s*-?\}\}/.test(bodies.get(k)));
      const layoutKey = layouts.length ? layouts.find((k) => /(^|\/)layouts\/(?:main|index)\.volt$/i.test(k)) ?? layouts[0] : null;
      if (layouts.length > 1) note(`${layouts.length} templates render \`content()\` (${layouts.join(", ")}); Phalcon picks a layout per controller, which the run cannot know, so ${layoutKey} was composed around every view.`);
      const shell = layoutKey ? voltToJinja(bodies.get(layoutKey), note, resolve) : null;
      const partial = (k) => /(^|\/)partials?\//i.test(k);
      let count = 0;
      for (const [key, text] of bodies) {
        if (!text.trim()) continue;
        if (layouts.includes(key)) { note(`${key} is a layout the views render inside (its \`content()\` is the view); it is composed into each of them rather than ported as a screen of its own.`); continue; }
        let rewritten = voltToJinja(text, note, resolve);
        const composed = [];
        if (shell && !partial(key) && shell.includes(PAGE_MARK)) { rewritten = shell.replace(PAGE_MARK, () => rewritten); composed.push(layoutKey); }
        const lowered = lowerJinja(rewritten, note, resolveLowered);
        const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(lowered);
        const template = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : lowered)).trim();
        if (!template) continue;
        const selector = (bare(key) || "page").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        const file = files.find((f) => f.rel.replace(/^\.\//, "") === key);
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file?.rel ?? key,
          inputs: readInputs(template, { skip: ["url"] }),
          outputs: [],
          template,
          composed,
          templateOrigin: composed.length ? "a Volt template, composed into its layout and lowered through jinja" : "a Volt template, lowered through jinja",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: /ng-model/.test(template),
          rxjs: [],
          readBy: "volt",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Volt template(s) lowered through the jinja lowering`);
    });
  },
};
