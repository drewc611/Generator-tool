import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { formsReport, kebab, lowerForm, stripPrefix } from "./forms.js";
import { modelForm, readFrm } from "./frm.js";

/**
 * Reads Visual Basic 6 form files as the legacy front end they are. A .frm
 * is text: the form and every control on it with its class, name, caption,
 * rectangle in twips, tab index and initial state, the menu bar as nested
 * blocks, and after the form the code. The form becomes a screen on the
 * shared dialect through the lowering input-delphi shares; the code is not
 * ported, but the handlers it wires and the messages it shows are read so
 * the report can say what was there and the notes what the port must write.
 *
 * The .frx companion is binary and holds the properties the text points into
 * it: list items, pictures, long text. It is named and never read, so a combo
 * box filled from it is a list the port is handed.
 */

/** A .frm is Windows ANSI; one saved as UTF 8 decodes cleanly and one that does not is read byte for byte. */
const decode = (bytes) => { const utf = bytes.toString("utf8"); return utf.includes("�") ? bytes.toString("latin1") : utf; };

export default {
  name: "input-vb6",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.frm$/i.test(f.rel));
      if (!files.length) return log.debug("no VB6 forms");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };
      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const bytes = await readFile(file.path).catch(() => null);
        if (!bytes) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); continue; }
        const read = readFrm(decode(bytes));
        if (read.error) { ctx.unverified(`${rel}: ${read.error}; nothing was read from it.`); continue; }
        for (const p of read.problems) ctx.unverified(`${rel}: ${p}.`);
        const form = modelForm(read);
        if (read.name && read.name !== form.name) ctx.unverified(`${rel}: the form block is named ${form.name} and its VB_Name attribute ${read.name}; the block's name is used.`);
        const frxName = basename(file.path).replace(/\.frm$/i, ".frx");
        const frx = await stat(file.path.replace(/\.frm$/i, ".frx")).then(() => true, () => false);
        const lines = [];
        if (frx) { lines.push(`The binary companion ${frxName} holds ${form.frxRefs} propert(ies) the text points into it; it is named and not read`); ctx.unverified(`${rel}: the binary companion ${frxName} holds ${form.frxRefs} propert(ies) the text form points into it (list items, pictures, long text); it is named and not read.`); }
        else if (form.frxRefs) ctx.unverified(`${rel}: ${form.frxRefs} propert(ies) point into ${frxName}, which is not in the tree; each is a value the port is not handed.`);
        const lowered = lowerForm(form, (n) => ctx.unverified(`${rel}, form ${form.name}: ${n}`));
        const selector = unique(`form-${kebab(stripPrefix(form.name)) || "form"}`);
        ctx.screens.push({
          selector, className: pascal(selector), file: rel,
          // A field is the form's own state, not something it is handed.
          inputs: readInputs(lowered.template, { skip: lowered.fields }), outputs: lowered.outputs, template: lowered.template,
          templateOrigin: `form ${form.name} in ${rel}, read from its text form file`,
          usesNgIf: lowered.usesNgIf, usesNgFor: lowered.usesNgFor, usesTwoWay: lowered.usesTwoWay, rxjs: [],
          readBy: "vb6", title: lowered.title || form.name,
        });
        if (form.messages.length) ctx.unverified(`${rel}: ${form.messages.length} MsgBox message(s) the code shows are listed in FORMS_VB6.md; the port has no place for them until the code that showed each is ported.`);
        seen.push({ rel, forms: [form], problems: lines, objects: read.objects });
        count += 1;
      }
      if (seen.length) log.info(`${seen.length} VB6 form file(s): ${count} form(s) read as screens`);
    });

    on("emit", async (ctx) => {
      if (!seen.length) return;
      await ctx.write("FORMS_VB6.md", formsReport(seen, {
        heading: "Forms (Visual Basic 6)",
        intro: "Every form the .frm files declared, with each control's class, caption, rectangle in twips (left, top, width × height), tab index and the handlers the code wired to it; then the menu tree, the components that draw nothing, and the messages MsgBox showed. The port lays the controls out in reading order; this is the layout the original drew. No property value other than a caption or a message is printed.",
        units: "twips",
      }));
      log.info("FORMS_VB6.md written");
    });
  },
};
