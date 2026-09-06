import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseRptdesign } from "./parse.js";
import { lowerRptdesign } from "./lower.js";

/**
 * Eclipse BIRT's `.rptdesign` report definitions: the visually designed
 * report format that ran banking, insurance and government back office
 * reporting alongside JasperReports from the mid 2000s onward, built in
 * Eclipse's BIRT Report Designer. A report is a document layout, not an
 * interactive form: no input, no button, no event, so it becomes a read
 * only screen the way input-jasperreports's reports do, one section per
 * page-header/body/page-footer part in the order the page prints them, a
 * table's own header/detail/footer bands lowered onto a real HTML table.
 *
 * A bare `resultSetColumn` reference is the one shape read for real, lowered
 * onto the dialect's own interpolation; a computed BIRT expression, a list
 * BIRT's own repeating container, an image's source, and an element with no
 * vocabulary entry are each named through ctx.unverified rather than
 * guessed. BIRT.md gathers every file's parameters, dataset columns and
 * gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A PascalCase class name's humps as hyphens, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-birt",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.rptdesign$/i.test(f.rel));
      if (!files.length) return log.debug("no BIRT .rptdesign files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "report-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const reportEl = parseRptdesign(text);
        if (!reportEl) { ctx.unverified(`${rel}: no <report> root element; nothing was read.`); seen.push({ rel, lowered: null }); continue; }

        const notes = [];
        const lowered = lowerRptdesign(reportEl, (n) => notes.push(n));
        lowered.notes = notes;

        const selector = unique(kebabClass(lowered.className));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A dataset column read as a bare resultSetColumn reference is a value the report is handed, so it
          // reads as an input; a scalar parameter never appears as a bare reference in the body (BIRT only ever
          // reads one inside a computed expression this reader does not evaluate), so it is listed in BIRT.md
          // but never invented as a template input. There is nothing this screen holds as its own state, so
          // nothing is skipped on purpose the way a form's own fields are.
          inputs: readInputs(lowered.template),
          outputs: [],
          template: lowered.template,
          templateOrigin: `a BIRT .rptdesign report definition, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: false,
          usesTwoWay: false,
          rxjs: [],
          readBy: "birt",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        for (const n of notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no BIRT .rptdesign files read");
      log.info(`${files.length} .rptdesign file(s): ${screens} screen(s) read from BIRT report definitions`);
      ctx.birt = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.birt?.length) return;
      await ctx.write("BIRT.md", render(ctx.birt));
      log.info("BIRT.md written");
    });
  },
};

function render(files) {
  const out = [
    "# BIRT report definitions",
    "",
    "Every `.rptdesign` file this run read: its parameters, its datasets'",
    "columns, the sections it laid out, and every gap. A computed BIRT",
    "expression this reader does not evaluate, a list it does not inline, an",
    "image whose source it does not evaluate, and an element with no",
    "vocabulary entry are each named here rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); continue; }
    out.push(`Read as \`${f.lowered.className}\`.`, "");
    out.push(`Parameters: ${f.lowered.parameters.length ? f.lowered.parameters.map((p) => `${p.name} (${p.dataType})`).join(", ") : "none declared"}.`, "");
    if (f.lowered.dataSets.length) {
      for (const ds of f.lowered.dataSets) {
        out.push(`Dataset \`${ds.name}\` columns: ${ds.columns.length ? ds.columns.map((c) => `${c.name} (${c.dataType})`).join(", ") : "none declared"}.`, "");
      }
    } else {
      out.push("Datasets: none declared.", "");
    }
    out.push(`Sections laid out: ${f.lowered.sectionsRendered.length ? f.lowered.sectionsRendered.join(", ") : "none"}.`, "");
    if (f.lowered.notes.length) out.push(...f.lowered.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
