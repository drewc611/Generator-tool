import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseJrxml } from "./parse.js";
import { lowerJrxml } from "./lower.js";

/**
 * JasperReports' `.jrxml` report definitions: the band layout format the
 * Java enterprise back office wrote invoices, statements and printed reports
 * in from the mid 2000s onward, designed in iReport or Jaspersoft Studio.
 * A report is a document layout, not an interactive form: no input, no
 * button, no event, so it becomes a read only screen the way input-pdf's
 * documents do, one section per band in the order the page prints them.
 *
 * A `$F{name}`/`$P{name}`/`$V{name}` reference is the one shape read for
 * real, lowered onto the dialect's own interpolation; anything a textField
 * expression does beyond that bare reference, a subreport, an image's
 * source expression, and an element with no vocabulary entry are each named
 * through ctx.unverified rather than guessed. JASPERREPORTS.md gathers
 * every file's parameters, fields, bands and gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A PascalCase class name's humps as hyphens, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-jasperreports",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.jrxml$/i.test(f.rel));
      if (!files.length) return log.debug("no JasperReports .jrxml files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "report-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const reportEl = parseJrxml(text);
        if (!reportEl) { ctx.unverified(`${rel}: no <jasperReport> root element; nothing was read.`); seen.push({ rel, lowered: null }); continue; }

        const notes = [];
        const lowered = lowerJrxml(reportEl, (n) => notes.push(n));
        lowered.notes = notes;

        const selector = unique(kebabClass(lowered.className));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field or a parameter read as $F{}/$P{} is a value the report is handed, so it reads as an input; a
          // variable read as $V{} is a running total JasperReports would compute, which this reader does not, so
          // it is handed in the same honest way rather than invented. There is nothing this screen holds as its
          // own state, so nothing is skipped on purpose the way a form's own fields are.
          inputs: readInputs(lowered.template),
          outputs: [],
          template: lowered.template,
          templateOrigin: `a JasperReports .jrxml report definition, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: false,
          usesTwoWay: false,
          rxjs: [],
          readBy: "jasperreports",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        for (const n of notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no JasperReports .jrxml files read");
      log.info(`${files.length} .jrxml file(s): ${screens} screen(s) read from JasperReports report definitions`);
      ctx.jasperreports = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.jasperreports?.length) return;
      await ctx.write("JASPERREPORTS.md", render(ctx.jasperreports));
      log.info("JASPERREPORTS.md written");
    });
  },
};

function render(files) {
  const out = [
    "# JasperReports report definitions",
    "",
    "Every `.jrxml` file this run read: its parameters and fields, the bands",
    "it laid out, and every gap. A computed textField expression this reader",
    "does not evaluate, a subreport it does not follow, an image whose source",
    "it does not evaluate, and an element with no vocabulary entry are each",
    "named here rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); continue; }
    out.push(`Read as \`${f.lowered.className}\`.`, "");
    out.push(`Parameters: ${f.lowered.parameters.length ? f.lowered.parameters.map((p) => `${p.name} (${p.class})`).join(", ") : "none declared"}.`, "");
    out.push(`Fields: ${f.lowered.fields.length ? f.lowered.fields.map((p) => `${p.name} (${p.class})`).join(", ") : "none declared"}.`, "");
    out.push(`Bands laid out: ${f.lowered.bandsRendered.length ? f.lowered.bandsRendered.join(", ") : "none"}.`, "");
    if (f.lowered.notes.length) out.push(...f.lowered.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
