import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parsePbwin } from "./parse.js";
import { lowerPbwin } from "./lower.js";

/**
 * Reads PowerBASIC for Windows (PB/Win) source for its own DDT (Dynamic
 * Dialog Tools) `DIALOG NEW`/`CONTROL ADD` statements: a still-used Windows
 * BASIC compiler whose dialogs are built entirely through ordinary
 * executable statements, no separate resource or designer file at all, the
 * same "screen built one executable statement at a time" pattern
 * input-xbase, input-tk and input-autoit already establish for their own
 * languages. `DIALOG NEW ... TO handle` opens one dialog and is this
 * reader's own screen boundary, so a whole `.bas` file with more than one
 * `DIALOG NEW` call produces more than one screen.
 *
 * `.bas` is PowerBASIC's own real source extension, shared in the wild with
 * other BASIC dialects' plain modules that carry no dialog code at all; a
 * file with no `DIALOG NEW` at all produces no screen from this reader,
 * which is normal, not a gap, the same restraint input-cobolscreen keeps
 * over a `.cbl` file with no `SCREEN SECTION`.
 *
 * A control's own field name comes from its plain numeric id, since DDT
 * identifies a control that way rather than by a variable the way every
 * other statement-built reader's own control does. A radio option's own
 * grouping, an unrecognised control type, a button with no `CALL` clause,
 * and a `CONTROL ADD` naming a dialog handle no `DIALOG NEW` in the file
 * ever opened are each named through `ctx.unverified` rather than invented.
 * PBWIN.md gathers every file's own dialogs and gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-pbwin",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.bas$/i.test(f.rel));
      if (!files.length) return log.debug("no PowerBASIC .bas files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "pbwin-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screenCount = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, dialogs: [], orphanNotes: [] }); continue; }

        const read = parsePbwin(text);
        for (const p of read.problems) ctx.unverified(`${rel}: ${p}`);
        if (!read.dialogs.length) { seen.push({ rel, dialogs: [], orphanNotes: [] }); continue; } // no DIALOG NEW: an ordinary .bas module, not a gap

        const orphanNotes = read.orphanControls.map((c) => `a CONTROL ADD call names dialog handle \`${c.dialogVar}\`, which no DIALOG NEW in this file opened; it is not read.`);
        for (const n of orphanNotes) ctx.unverified(`${rel}: ${n}`);

        const lowered = [];
        for (const dialog of read.dialogs) {
          const result = lowerPbwin(dialog);
          lowered.push(result);

          const selector = unique(kebab(result.stem || "pbwin-screen"));
          ctx.screens.push({
            selector,
            className: pascal(selector),
            file: rel,
            // A field is the screen's own state, bound with ng-model, not something the port hands it.
            inputs: readInputs(result.template, { skip: result.fields }),
            outputs: result.outputs,
            template: result.template,
            templateOrigin: `a PowerBASIC DIALOG NEW/CONTROL ADD dialog, read structurally from ${rel}`,
            usesNgIf: false,
            usesNgFor: result.usesNgFor,
            usesTwoWay: result.usesTwoWay,
            rxjs: [],
            readBy: "pbwin",
            title: result.title || pascal(selector),
          });
          screenCount += 1;
          for (const n of result.notes) ctx.unverified(`${rel}: ${n}`);
        }
        seen.push({ rel, dialogs: lowered, orphanNotes });
      }

      if (!seen.length) return log.debug("no PowerBASIC .bas files read");
      log.info(`${files.length} PowerBASIC .bas file(s): ${screenCount} screen(s) read from DIALOG NEW/CONTROL ADD statements`);
      ctx.pbwin = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.pbwin?.length) return;
      await ctx.write("PBWIN.md", render(ctx.pbwin));
      log.info("PBWIN.md written");
    });
  },
};

function render(files) {
  const out = [
    "# PowerBASIC DDT dialogs",
    "",
    "Every `.bas` file this run read: each `DIALOG NEW` it opens as its own",
    "screen, populated in declaration order by its own `CONTROL ADD`",
    "statements. A field's name comes from a control's own numeric id,",
    "since PowerBASIC's DDT binds a control to a name no other way; a",
    "button's wiring comes from the `CALL procname` clause on its own",
    "statement, when one is present. A file with no `DIALOG NEW` at all is",
    "an ordinary PowerBASIC module this reader has nothing to read, not a",
    "gap. An unrecognised control type, a button with no `CALL` clause, and",
    "a `CONTROL ADD` naming a handle no `DIALOG NEW` opened are each named",
    "rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.dialogs.length) { out.push("No `DIALOG NEW` found; not read as a screen.", ""); continue; }
    for (const d of f.dialogs) {
      out.push(`### ${d.className}`, "");
      out.push(`${d.fields.length} field(s), ${d.outputs.length} output(s).`, "");
      if (d.notes.length) out.push(...d.notes.map((n) => `- ${n}`), "");
    }
    if (f.orphanNotes.length) out.push("**Unresolved dialog handles**", "", ...f.orphanNotes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
