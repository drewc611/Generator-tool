import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseXbase } from "./parse.js";
import { lowerXbase } from "./lower.js";

/**
 * Reads dBase/Clipper/FoxPro (the "xBase" family) `.prg` program source for
 * its `@ row, col SAY ... GET ...` full-screen statements: a character-cell
 * terminal screen built directly in executable procedural source, with no
 * separate declarative designer file at all, the way input-cics reads a
 * `.bms` map and input-cobolscreen reads a `SCREEN SECTION`. A `READ`
 * statement is the real, load-bearing boundary that closes the run of
 * statements since the previous one (or the start of the file) into one
 * screen, so a file with more than one `READ` becomes more than one screen,
 * named `Screen1`, `Screen2`, ... since xBase gives a screen no name of its
 * own.
 *
 * `@ SAY/GET` states no button, no event and no navigation at all: which key
 * ended a `READ` and what to do next live in the calling code around the
 * statements, which this format never states inside them, so no screen this
 * reader produces ever carries an output. A `SAY` expression that is not a
 * plain literal, a `GET` clause that does not name a plain field, and a
 * present `VALID`, `WHEN`, `RANGE` or `DEFAULT` clause are each named through
 * ctx.unverified rather than guessed. XBASE.md gathers every file's own
 * screens and gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-xbase",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.prg$/i.test(f.rel));
      if (!files.length) return log.debug("no xBase .prg files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "xbase-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screenCount = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, screens: [] }); continue; }

        const { screens, problems } = parseXbase(text);
        for (const p of problems) ctx.unverified(`${rel}: ${p}`);
        if (!screens.length) { ctx.unverified(`${rel}: no @ row, col SAY/GET statements found; nothing was read.`); seen.push({ rel, screens: [] }); continue; }

        const fileScreens = [];
        let index = 0;
        for (const statements of screens) {
          index += 1;
          const lowered = lowerXbase(statements, index);
          const selector = unique(kebab(lowered.stem || `screen-${index}`));
          ctx.screens.push({
            selector,
            className: pascal(selector),
            file: rel,
            // A field is the screen's own state, bound with ng-model, not something the port hands it.
            inputs: readInputs(lowered.template, { skip: lowered.fields }),
            outputs: [],
            template: lowered.template,
            templateOrigin: `an xBase full-screen statement, read structurally from ${rel}`,
            usesNgIf: false,
            usesNgFor: lowered.usesNgFor,
            usesTwoWay: lowered.usesTwoWay,
            rxjs: [],
            readBy: "xbase",
            title: lowered.title || pascal(selector),
          });
          screenCount += 1;
          for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
          fileScreens.push({ lowered });
        }
        seen.push({ rel, screens: fileScreens });
      }

      if (!seen.length) return log.debug("no xBase .prg files read");
      log.info(`${files.length} xBase .prg file(s): ${screenCount} screen(s) read from @ row, col SAY/GET statements`);
      ctx.xbase = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.xbase?.length) return;
      await ctx.write("XBASE.md", render(ctx.xbase));
      log.info("XBASE.md written");
    });
  },
};

function render(files) {
  const out = [
    "# xBase @ SAY/GET screens",
    "",
    "Every `.prg` file this run read: each `READ`-delimited run of `@ row, col",
    "SAY/GET` statements as one screen, and every gap. `@ SAY/GET` states no",
    "button, no event and no navigation at all, since which key ended a READ",
    "and what to do next live in the calling code around the statements,",
    "which this format never states inside them, so no output is ever",
    "produced here. A SAY expression or a GET target that is not a plain",
    "literal or identifier, and a VALID, WHEN, RANGE or DEFAULT clause, are",
    "each named rather than guessed or evaluated.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.screens.length) { out.push("Not read as a screen.", ""); continue; }
    for (const s of f.screens) {
      out.push(`### ${s.lowered.title}`, "");
      out.push(`${s.lowered.fields.length} field(s), 0 output(s).`, "");
      if (s.lowered.notes.length) out.push(...s.lowered.notes.map((n) => `- ${n}`), "");
    }
  }
  return out.join("\n") + "\n";
}
