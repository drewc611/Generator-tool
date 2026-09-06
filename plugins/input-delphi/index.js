import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { formsReport, kebab, lowerForm, stripPrefix } from "../input-vb6/forms.js";
import { modelForm, readDfm } from "./dfm.js";

/**
 * Reads Delphi and Lazarus form files as the legacy front end they are. A
 * text .dfm, .fmx or .lfm declares the form and every component on it with
 * its class, name, caption, rectangle in pixels, tab order, initial state and
 * the handlers wired to it; a main menu as nested items; and the components
 * that draw nothing, the data sources, queries and connections the code read
 * through. The form becomes a screen on the shared dialect through the
 * lowering input-vb6 shares, because the two formats describe the same
 * window and one lowering keeps the two readers from disagreeing about it.
 *
 * What the file cannot say is named: a combo box whose items the code fills,
 * a query whose SQL is present and not printed, a page control whose visible
 * page is state, a grid whose columns the code supplies.
 */

const decode = (bytes) => { const utf = bytes.toString("utf8").replace(/^﻿/, ""); return utf.includes("�") ? bytes.toString("latin1") : utf; };

export default {
  name: "input-delphi",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(dfm|fmx|lfm)$/i.test(f.rel));
      if (!files.length) return log.debug("no Delphi forms");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };
      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const bytes = await readFile(file.path).catch(() => null);
        if (!bytes) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); continue; }
        // A binary .dfm opens with the TPF0 signature; the IDE's "Text DFM" setting or convert.exe writes the text form this reader reads.
        if (bytes.length >= 4 && (bytes.toString("latin1", 0, 4) === "TPF0" || (bytes[0] === 0xff && bytes.toString("latin1", 2, 6) === "TPF0"))) { ctx.unverified(`${rel} is a binary form file; save it as text (the IDE's Text DFM setting, or convert.exe) and it will be read. Nothing was read from it.`); continue; }
        const read = readDfm(decode(bytes));
        if (read.error) { ctx.unverified(`${rel}: ${read.error}; nothing was read from it.`); continue; }
        for (const p of read.problems) ctx.unverified(`${rel}: ${p}.`);
        const forms = [];
        for (const node of read.forms) {
          const form = modelForm(node);
          const lowered = lowerForm(form, (n) => ctx.unverified(`${rel}, form ${form.name}: ${n}`));
          const selector = unique(`form-${kebab(stripPrefix(form.name)) || "form"}`);
          ctx.screens.push({
            selector, className: pascal(selector), file: rel,
            inputs: readInputs(lowered.template, { skip: lowered.fields }), outputs: lowered.outputs, template: lowered.template,
            templateOrigin: `form ${form.name} in ${rel}, read from its text form file`,
            usesNgIf: lowered.usesNgIf, usesNgFor: lowered.usesNgFor, usesTwoWay: lowered.usesTwoWay, rxjs: [],
            readBy: "delphi", title: lowered.title || form.name,
          });
          forms.push(form);
          count += 1;
        }
        seen.push({ rel, forms, problems: [] });
      }
      if (seen.length) log.info(`${seen.length} Delphi form file(s): ${count} form(s) read as screens`);
    });

    on("emit", async (ctx) => {
      if (!seen.length) return;
      await ctx.write("FORMS_DELPHI.md", formsReport(seen, {
        heading: "Forms (Delphi)",
        intro: "Every form the .dfm, .fmx and .lfm files declared, with each component's class, caption, rectangle in pixels (left, top, width × height), tab order and the handlers wired to it; then the menu tree and the components that draw nothing, which are the data access the port must supply. The port lays the controls out in reading order; this is the layout the original drew. No property value other than a caption is printed, and no SQL.",
        units: "px",
      }));
      log.info("FORMS_DELPHI.md written");
    });
  },
};
