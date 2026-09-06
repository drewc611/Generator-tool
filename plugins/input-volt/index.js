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
// Volt spells every helper in snake_case as well as Phalcon's camelCase.
for (const [camel, type] of Object.entries(FIELDS)) FIELDS[camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = type;
const OTHER_HELPERS = /^(?:submit_?[Bb]utton|image|form|end_?[Ff]orm|stylesheet_?[Ll]ink|javascript_?[Ii]nclude|title|prepend_?[Tt]itle|append_?[Tt]itle|get_?[Tt]itle|friendly_?[Tt]itle|date_?[Ff]ield|color_?[Ff]ield|range_?[Ff]ield|search_?[Ff]ield|tel_?[Tt]ield|url_?[Ff]ield|week_?[Ff]ield|time_?[Ff]ield|month_?[Ff]ield|tag_?[Hh]tml|tag_?[Hh]tml_?[Cc]lose)$/;

/** The `'key': value` pairs after a helper's name, as attributes on the element it renders; a value the model owns is named. */
function helperAttrs(pairs, note, helper) {
  const attrs = []; let model = null;
  for (const pair of pairs) {
    const m = /^\s*(["'])([\w-]+)\1\s*:\s*([\s\S]+)$/.exec(pair);
    if (!m) { note(`\`${helper}\` was given an argument this reader cannot read as a name or a \`'key': value\` pair; it was dropped.`); continue; }
    const literal = /^(["'])([\s\S]*)\1$/.exec(m[3].trim());
    if (m[2] === "value") { model = literal ? literal[2] : m[3].trim(); note(`\`${helper}\` set an initial value; the port holds it in the model it binds.`); continue; }
    if (/^(?:true|false)$/.test(m[3].trim())) { if (m[3].trim() === "true") attrs.push(m[2]); continue; }
    attrs.push(literal ? `${m[2]}="${literal[2].replace(/"/g, "&quot;")}"` : `${m[2]}="{{ ${attrSafe(m[3].trim())} }}"`);
  }
  return { attrs: attrs.length ? ` ${attrs.join(" ")}` : "", initial: model };
}

/** Volt spellings onto jinja's, outside of strings; `resolve(name)` returns a partial's text or null. */
export function voltToJinja(source, note = () => {}, resolve = () => null, chain = []) {
  let text = String(source ?? "");
  text = text.replace(/\{%-?\s*(?:cache\b[^%]*|endcache|autoescape\b[^%]*|endautoescape)\s*-?%\}/g, "");
  text = text.replace(/\{%-?\s*do\s+([\s\S]*?)\s*-?%\}/g, (m, expr) => { note(`\`{% do ${expr.trim().split(/[\s(]/)[0]} %}\` ran an expression for its side effect on the server; it has no client equivalent and was removed.`); return ""; });
  // A return inside a macro is the macro's value, which the lowering's macro expansion carries; elsewhere it is an early exit.
  text = text.replace(/\{%-?\s*macro\b[\s\S]*?\{%-?\s*endmacro\s*-?%\}/g, (m) => m.replace(/\{%-?\s*return\b/g, "\u0001RETURN"));
  text = text.replace(/\{%-?\s*(break|continue|return)\b[^%]*-?%\}/g, (m, tag) => { note(`\`{% ${tag} %}\` left a loop or the template early; the port renders the whole and the exit is a person's to write.`); return ""; });
  text = text.replace(/\u0001RETURN/g, "{% return");
  // {% set a = 1, b = 2 %} binds two names; each is its own set for the lowering.
  text = text.replace(/\{%(-?)\s*set\s+([\s\S]*?)\s*(-?)%\}/g, (m, a, body, b) => { const parts = splitCommas(body, { ticks: false }); return parts.length > 1 && parts.every((x) => /^[\w$]+\s*=/.test(x)) ? parts.map((x) => `{%${a} set ${x.trim()} ${b}%}`).join("") : m; });
  // {% for x in xs if cond %} filters the rows; the condition is the loop's own first child, closed before the loop's end.
  for (;;) {
    // Neither the list nor the condition may run past the tag's own %}, or the rewritten tag would match again.
    const f = /\{%(-?)\s*for\s+((?:(?!%\})[\s\S])+?)\s+in\s+((?:(?!%\})[\s\S])+?)\s+if\s+((?:(?!%\})[\s\S])+?)\s*(-?)%\}/.exec(text);
    if (!f) break;
    let depth = 1; const tag = /\{%-?\s*(end)?for\b[\s\S]*?%\}/g; tag.lastIndex = f.index + f[0].length; let close = text.length;
    for (let t; (t = tag.exec(text));) { depth += t[1] ? -1 : 1; if (depth === 0) { close = t.index; break; } }
    text = `${text.slice(0, f.index)}{%${f[1]} for ${f[2]} in ${f[3]} ${f[5]}%}{% if ${f[4]} %}${text.slice(f.index + f[0].length, close)}{% endif %}${text.slice(close)}`;
  }
  // {{ content() }} is the layout's slot; the rest of the helpers are calls the server made.
  text = text.replace(/\{\{-?\s*content\(\)\s*-?\}\}/g, PAGE_MARK);
  text = text.replace(/\{\{-?\s*partial\(\s*(["'])([^"']+)\1\s*(?:,\s*(\[[\s\S]*?\]))?\s*\)\s*-?\}\}/g, (m, q, name, params) => {
    const body = resolve(name);
    if (body == null) { note(`\`partial('${name}')\` names a template this run does not hold; the call was removed and the content stands without it.`); return ""; }
    if (chain.includes(body.key)) { note(`\`partial('${name}')\` includes a template already on the include chain; the cycle was cut there.`); return ""; }
    if (params) note(`\`partial('${name}', [...])\` passed names into the partial; the partial is inlined and reads them from the view's own.`);
    return voltToJinja(body.text, note, resolve, [...chain, body.key]);
  });
  text = text.replace(/\{\{-?\s*link_to\(\s*([\s\S]*?)\s*\)\s*-?\}\}/g, (m, args) => {
    const parts = splitCommas(args, { ticks: false });
    note("`link_to()` built an anchor from a route name on the server; the route stands as a call to `url`, the reverse router the port must supply.");
    const { attrs } = helperAttrs(parts.slice(2), note, "link_to");
    return `<a href="{{ url(${parts[0] ?? "''"}) }}"${attrs}>{{ ${parts[1] ?? "''"} }}</a>`;
  });
  text = text.replace(/\{\{-?\s*(tag\.)?(\w+)\(\s*([\s\S]*?)\s*\)\s*-?\}\}/g, (m, dotted, helper, args) => {
    const parts = splitCommas(args, { ticks: false });
    if (helper in FIELDS) {
      const first = parts[0] ?? "";
      const inner = /^\[/.test(first) ? splitCommas(first.slice(1, -1), { ticks: false }) : [first];
      const model = /^["'](\w+)["']$/.exec(inner[0]?.trim() ?? "");
      if (!model) { note(`\`tag.${helper}(...)\` names its field through an expression; the field was dropped rather than guessed.`); return ""; }
      note("`tag.*` form helpers render fields bound to names the controller reads back; each is the field it renders, and the port must post the form itself.");
      const { attrs } = helperAttrs([...inner.slice(1), ...parts.slice(1).filter((x) => !/^\[/.test(x.trim()))], note, `tag.${helper}`);
      const type = FIELDS[helper];
      if (type === "textarea") return `<textarea ng-model="${attrSafe(model[1])}"${attrs}></textarea>`;
      if (type === "select") { note("`tag.select` took its options from a server list; the `<select>` is emitted with none and the port must supply them."); return `<select ng-model="${attrSafe(model[1])}"${attrs}></select>`; }
      return `<input type="${type}" ng-model="${attrSafe(model[1])}"${attrs}>`;
    }
    if (/^submit_?[Bb]utton$/.test(helper)) { const label = /^(["'])([\s\S]*)\1$/.exec(parts[0]?.trim() ?? ""); const { attrs } = helperAttrs(parts.slice(1), note, "tag.submitButton"); return `<button type="submit"${attrs}>${label ? label[2] : `{{ ${parts[0] ?? "''"} }}`}</button>`; }
    if (/^image$/.test(helper)) { const src = /^(["'])([\s\S]*)\1$/.exec(parts[0]?.trim() ?? ""); note("`tag.image()` prefixed a path with the deployment's static root; the path stands as written and the prefix is the port's to add."); const { attrs } = helperAttrs(parts.slice(1), note, "tag.image"); return `<img src="${src ? src[2] : `{{ ${parts[0] ?? "''"} }}`}"${attrs}>`; }
    if (/^form$/.test(helper)) { const action = /^(["'])([\s\S]*)\1$/.exec(parts[0]?.trim() ?? ""); const { attrs } = helperAttrs(parts.slice(1), note, "tag.form"); note("`tag.form()` opened a form on a route the server resolved; the route stands as a call to `url`, the reverse router the port must supply."); return `<form action="{{ url(${action ? `'${action[2]}'` : parts[0] ?? "''"}) }}"${attrs}>`; }
    if (/^end_?[Ff]orm$/.test(helper)) return "</form>";
    if (/^(?:stylesheet_?[Ll]ink|javascript_?[Ii]nclude)$/.test(helper)) { note(`\`${dotted ?? ""}${helper}()\` loaded a stylesheet or a script from the static root into the document; the port's own bundle carries its assets, so the call was removed.`); return ""; }
    if (OTHER_HELPERS.test(helper) || dotted) { note(`\`${dotted ?? ""}${helper}()\` is a Phalcon tag helper this reader does not render; the call was removed and is named here so the gap is visible.`); return ""; }
    return m;
  });
  text = text.replace(/\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g, (m, a, expr, b) => {
    let e = expr;
    if (/\b(?:url|static_url)\s*\(/.test(e)) { note("`url()` and `static_url()` resolved a route or an asset by name on the server; both are kept as a call to `url`, the reverse router the port must supply."); e = e.replace(/\bstatic_url\s*\(/g, "url("); }
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
      const resolve = (name) => { const k = resolveTemplate(keys, name, bare); return k ? { key: k, text: bodies.get(k) } : null; };
      const resolveLowered = (name) => { const k = resolveTemplate(keys, name, bare); return k ? voltToJinja(bodies.get(k), note, resolve, [k]) : null; };
      // Phalcon's hierarchy is knowable from the tree: views/index.volt is the main layout around everything, and
      // views/layouts/<controller>.volt wraps that controller's views first. Any other file rendering content() is named.
      const layouts = keys.filter((k) => /\{\{-?\s*content\(\)\s*-?\}\}/.test(bodies.get(k)));
      const mainKey = layouts.find((k) => bare(k) === "index") ?? null;
      const controllerLayout = (key) => { const dir = bare(key).split("/").slice(0, -1).join("/"); return dir ? layouts.find((k) => bare(k) === `layouts/${dir}`) ?? null : null; };
      const shells = new Map(layouts.map((k) => [k, voltToJinja(bodies.get(k), note, resolve, [k])]));
      const partial = (k) => /(^|\/)partials?\//i.test(k);
      const used = new Set();
      let count = 0;
      for (const [key, text] of bodies) {
        if (!text.trim() || layouts.includes(key)) continue;
        let rewritten = voltToJinja(text, note, resolve, [key]);
        const composed = [];
        if (!partial(key)) {
          for (const layoutKey of [controllerLayout(key), mainKey].filter(Boolean)) {
            const shell = shells.get(layoutKey);
            if (shell.includes(PAGE_MARK)) { rewritten = shell.replace(PAGE_MARK, () => rewritten); composed.push(layoutKey); used.add(layoutKey); }
          }
        }
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
          inputs: readInputs(template, { skip: ["url", "tag"] }),
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
      for (const k of layouts) {
        if (used.has(k)) note(`${k} is a layout the views render inside (its \`content()\` is the view); it is composed into each of them rather than ported as a screen of its own.`);
        else note(`${k} renders \`content()\` but is neither views/index.volt nor layouts/<controller>.volt for a controller in the run; Phalcon applies it by configuration the run cannot see, so it was not composed and is not a screen.`);
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Volt template(s) lowered through the jinja lowering`);
    });
  },
};
