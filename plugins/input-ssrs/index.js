import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseRdl } from "./parse.js";
import { lowerRdl } from "./lower.js";

/**
 * Microsoft SQL Server Reporting Services' `.rdl` report definitions: the
 * dominant Microsoft enterprise reporting format since SQL Server 2000,
 * still enormous in banking, insurance and government back offices, built
 * in Report Builder or Visual Studio's Report Designer. A report is a
 * document layout, not an interactive form: no input, no button, no event,
 * so it becomes a read only screen the way input-jasperreports's and
 * input-birt's reports do, one section per PageHeader/Body/PageFooter part
 * in the order the page prints them, a Tablix's own deeply nested row/cell
 * layout flattened onto a real HTML table.
 *
 * A bare `=Fields!name.Value` or `=Parameters!name.Value` reference is the
 * one shape read for real, lowered onto the dialect's own interpolation; a
 * computed RDL expression, a subreport, an image's source, and an element
 * with no vocabulary entry are each named through ctx.unverified rather than
 * guessed. RDL carries no report level name of its own, so the file's own
 * name, the same honest source input-pdf reads a document's identity from,
 * names the screen. SSRS.md gathers every file's parameters, dataset fields
 * and gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A PascalCase class name's humps as hyphens, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-ssrs",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.rdl$/i.test(f.rel));
      if (!files.length) return log.debug("no SSRS .rdl files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "report-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const reportEl = parseRdl(text);
        if (!reportEl) { ctx.unverified(`${rel}: no <Report> root element; nothing was read.`); seen.push({ rel, lowered: null }); continue; }

        const stem = rel.split("/").pop().replace(/\.rdl$/i, "");
        const notes = [];
        const lowered = lowerRdl(reportEl, stem, (n) => notes.push(n));
        lowered.notes = notes;

        const selector = unique(kebabClass(lowered.className));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A dataset field read as a bare =Fields!x.Value reference, or a report parameter read as a bare
          // =Parameters!x.Value reference, is a value the report is handed, so it reads as an input. There is
          // nothing this screen holds as its own state, so nothing is skipped on purpose the way a form's own
          // fields are.
          inputs: readInputs(lowered.template),
          outputs: [],
          template: lowered.template,
          templateOrigin: `a SQL Server Reporting Services .rdl report definition, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: false,
          usesTwoWay: false,
          rxjs: [],
          readBy: "ssrs",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        for (const n of notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no SSRS .rdl files read");
      log.info(`${files.length} .rdl file(s): ${screens} screen(s) read from SSRS report definitions`);
      ctx.ssrs = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.ssrs?.length) return;
      await ctx.write("SSRS.md", render(ctx.ssrs));
      log.info("SSRS.md written");
    });
  },
};

function render(files) {
  const out = [
    "# SSRS report definitions",
    "",
    "Every `.rdl` file this run read: its parameters, its datasets' fields,",
    "the sections it laid out, and every gap. A computed RDL expression this",
    "reader does not evaluate, a subreport it does not follow, an image whose",
    "source it does not evaluate, and an element with no vocabulary entry are",
    "each named here rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); continue; }
    out.push(`Read as \`${f.lowered.className}\`.`, "");
    out.push(`Parameters: ${f.lowered.parameters.length ? f.lowered.parameters.map((p) => `${p.name} (${p.dataType})`).join(", ") : "none declared"}.`, "");
    if (f.lowered.dataSets.length) {
      for (const ds of f.lowered.dataSets) {
        out.push(`Dataset \`${ds.name}\` fields: ${ds.fields.length ? ds.fields.map((c) => `${c.name} (${c.typeName})`).join(", ") : "none declared"}.`, "");
      }
    } else {
      out.push("Datasets: none declared.", "");
    }
    out.push(`Sections laid out: ${f.lowered.sectionsRendered.length ? f.lowered.sectionsRendered.join(", ") : "none"}.`, "");
    if (f.lowered.notes.length) out.push(...f.lowered.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
