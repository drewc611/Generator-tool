import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseInformix } from "./parse.js";
import { lowerInformix } from "./lower.js";

/**
 * Informix 4GL/ESQL's `.per` screen form files, the character-cell terminal
 * screen format Informix products have used since the 1980s. A SCREEN
 * section's `{ ... }` block is literal ASCII art: row and column position is
 * the layout itself, no container tree to build, so this reader keeps
 * reading order and drops exact column alignment, which a browser never
 * needed to reproduce anyway. A `[tag]` placeholder's ATTRIBUTES statement
 * says whether it takes typed input; NOENTRY becomes a read only dialect
 * interpolation, everything else an ng-model input. DATABASE, TABLES and
 * INSTRUCTIONS are named as present and never read for meaning.
 *
 * Like BMS, a `.per` file names no button, no submit, no event: the 4GL
 * program's own INPUT/CONSTRUCT statements drive the form and this format
 * never writes them down, so this reader produces zero outputs, the same
 * honest zero input-jasperreports and input-birt already establish. A SCREEN
 * placeholder with no ATTRIBUTES statement, an ATTRIBUTES statement whose
 * tag never appears on screen, and a modifier this reader does not
 * recognise are each named through ctx.unverified rather than guessed;
 * INFORMIX.md gathers every file's own gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-informix",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.per$/i.test(f.rel));
      if (!files.length) return log.debug("no Informix .per screen forms");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "informix-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const parsed = parseInformix(text);
        const lowered = lowerInformix(parsed, rel, (n) => ctx.unverified(n));
        if (!lowered) { seen.push({ rel, lowered: null, present: parsed.present }); continue; }

        const selector = unique(kebab(lowered.className));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // NOENTRY fields read as {{ name }}, a value this screen is handed, never invented; an ng-model field is
          // this screen's own editable state and skipped from the inputs it is handed the same way every other
          // reader skips its own two-way bound fields.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: [],
          template: lowered.template,
          templateOrigin: `an Informix 4GL/ESQL .per screen form, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: false,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "informix",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered, present: parsed.present });
      }

      if (!seen.length) return log.debug("no Informix .per screen forms read");
      log.info(`${files.length} .per file(s): ${screens} screen(s) read from Informix screen forms`);
      ctx.informix = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.informix?.length) return;
      await ctx.write("INFORMIX.md", render(ctx.informix));
      log.info("INFORMIX.md written");
    });
  },
};

function render(files) {
  const out = [
    "# Informix 4GL/ESQL screen forms",
    "",
    "Every `.per` file this run read: its SCREEN block's fields and captions,",
    "read left to right and top to bottom exactly as the terminal laid them",
    "out, and every gap. A field on screen with no declared binding, a declared",
    "binding whose field never appears on screen, and a modifier this reader",
    "does not recognise are each named here rather than guessed. DATABASE,",
    "TABLES and INSTRUCTIONS are named as present; their own content is never",
    "read for meaning.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); continue; }
    out.push(`Read as \`${f.lowered.className}\`, ${f.lowered.fields.length} enterable field(s).`, "");
    const present = [...(f.present ?? [])].filter((k) => k !== "SCREEN" && k !== "ATTRIBUTES");
    if (present.length) out.push(`Also present, not read for meaning: ${present.join(", ")}.`, "");
    if (f.lowered.notes.length) out.push(...f.lowered.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
