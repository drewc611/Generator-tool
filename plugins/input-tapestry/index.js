import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { lowerTapestry } from "./lower.js";

/**
 * Apache Tapestry's `.tml` component templates: the enterprise intranet
 * framework of roughly 2005 to 2015, built so a template stays plain HTML a
 * designer can open, with Tapestry's own behaviour marked out by `t:`
 * namespaced attributes and elements rather than a second language layered
 * over the markup. That shape reads the same way input-jinja and input-twig
 * already read a template dialect riding on HTML, not the way a desktop
 * form's abstract widget tree does, so lower.js walks the shared markup
 * parser's tree and translates only what actually carries Tapestry meaning.
 * TAPESTRY.md gathers every file's gaps: an unresolved select model, a
 * submit button's convention bound handler, and any `t:type` or `t:`
 * namespaced element this reader does not recognise.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A PascalCase file name's humps as hyphens before kebab-casing, so `LoginForm.tml` reads as `login-form` rather
 * than `loginform`, the same spelling qt, gwt and jasperreports each already keep for a designer's own PascalCase names. */
const humpKebab = (text) => kebab(String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-tapestry",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.tml$/i.test(f.rel));
      if (!files.length) return log.debug("no Tapestry .tml templates");

      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, notes: [], screen: false }); continue; }

        const notes = [];
        const note = (t) => { if (!notes.includes(t)) notes.push(t); };
        const template = lowerTapestry(text, note).trim();
        if (!template) { seen.push({ rel, notes, screen: false }); continue; }

        const base = rel.replace(/\.tml$/i, "").split("/").filter((p) => p !== ".").map(humpKebab).join("-");
        const selector = unique(base || "screen");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          inputs: readInputs(template),
          outputs: [],
          template,
          templateOrigin: `a Tapestry .tml template, read structurally from ${rel}`,
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: /ng-model/.test(template),
          rxjs: [],
          readBy: "tapestry",
        });
        count += 1;
        for (const n of notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, notes, screen: true });
      }
      if (!count) return log.debug("no Tapestry .tml templates read as screens");
      log.info(`${count} Tapestry .tml template(s) lowered onto the dialect`);
      ctx.tapestry = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.tapestry?.length) return;
      await ctx.write("TAPESTRY.md", render(ctx.tapestry));
      log.info("TAPESTRY.md written");
    });
  },
};

function render(files) {
  const out = [
    "# Tapestry .tml templates",
    "",
    "Every `.tml` file this run read. Plain HTML with no `t:` attribute or",
    "`t:` namespaced tag passed through unchanged; `t:type=\"textfield\"`,",
    "`\"passwordfield\"`, `\"checkbox\"`, `\"select\"` and `\"submit\"`, `<t:if>`,",
    "`<t:loop>` and a bare `${property}` reference lowered onto the dialect the",
    "rest of the tool reads. A `t:model` a Java `SelectModel` builds, a submit",
    "button's convention bound handler, a computed `${...}` expression, and any",
    "`t:type` or `t:` namespaced element with no vocabulary entry are each",
    "named here rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.screen && !f.notes.length) { out.push("Not read as a screen.", ""); continue; }
    if (!f.notes.length) { out.push("Nothing to name; every construct in the file matched the vocabulary.", ""); continue; }
    out.push(...f.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
