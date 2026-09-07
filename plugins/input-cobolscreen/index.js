import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseCobolScreen } from "./parse.js";
import { lowerCobolScreen } from "./lower.js";

/**
 * Reads a standard ANSI/ISO COBOL program's `SCREEN SECTION`, the DATA
 * DIVISION section that has declared a character-cell terminal screen
 * directly in COBOL source since the COBOL-85 standard and is still
 * written today in mainframe and Micro Focus/GnuCOBOL shops. An `01` level
 * entry is one physical screen, so it becomes its own screen here the way
 * input-cics's own `DFHMDI` maps do, one per `01` rather than one per file.
 * A `.cbl`/`.cob` file with no `SCREEN SECTION.` at all produces no screen
 * from this reader, which is normal, not a gap.
 *
 * The SCREEN SECTION names no button, no submit and no event anywhere: the
 * PROCEDURE DIVISION's own ACCEPT/DISPLAY statements and whatever it does
 * with a function key live entirely outside this section, in code this
 * reader does not read, so this reader produces zero outputs, the same
 * honest zero input-jasperreports, input-birt, input-cics and
 * input-informix already establish for a format with nothing to wire. A PIC
 * clause with none of USING/FROM/TO, a relative LINE PLUS/COLUMN PLUS
 * position, and a VALUE that is not a clean quoted literal are each named
 * through ctx.unverified rather than guessed. COBOLSCREEN.md gathers every
 * file's own screens and gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-cobolscreen",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(cbl|cob)$/i.test(f.rel));
      if (!files.length) return log.debug("no COBOL .cbl/.cob files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "cobol-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, found: false, screens: [] }); continue; }

        const { found, screens: parsedScreens, problems } = parseCobolScreen(text);
        for (const p of problems) ctx.unverified(`${rel}: ${p}`);
        if (!found) { seen.push({ rel, found: false, screens: [] }); continue; }

        const fileScreens = [];
        let index = 0;
        for (const screen of parsedScreens) {
          index += 1;
          const lowered = lowerCobolScreen(screen);
          const base = lowered.stem || kebab(`cobol-screen-${index}`);
          const selector = unique(base);
          ctx.screens.push({
            selector,
            className: pascal(selector),
            file: rel,
            // A field bound by USING/TO is this screen's own editable state, skipped from the inputs it is handed
            // the same way every other reader skips its own two-way bound fields; a FROM field's bare {{ name }}
            // interpolation is not, since the program writes it, the port must supply it.
            inputs: readInputs(lowered.template, { skip: lowered.fields }),
            outputs: [],
            template: lowered.template,
            templateOrigin: `a COBOL program's terminal screen declaration, read structurally from ${rel}`,
            usesNgIf: false,
            usesNgFor: lowered.usesNgFor,
            usesTwoWay: lowered.usesTwoWay,
            rxjs: [],
            readBy: "cobolscreen",
            title: lowered.title || pascal(selector),
          });
          screens += 1;
          for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
          fileScreens.push(lowered);
        }
        seen.push({ rel, found: true, screens: fileScreens });
      }

      if (!seen.length) return log.debug("no COBOL .cbl/.cob files read");
      log.info(`${files.length} COBOL .cbl/.cob file(s): ${screens} screen(s) read from SCREEN SECTION entries`);
      ctx.cobolscreen = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.cobolscreen?.length) return;
      await ctx.write("COBOLSCREEN.md", render(ctx.cobolscreen));
      log.info("COBOLSCREEN.md written");
    });
  },
};

function render(files) {
  const out = [
    "# COBOL screen declarations",
    "",
    "Every `.cbl`/`.cob` file this run read: each program's own character-cell",
    "screen declaration, one screen per top level entry, and every gap. A",
    "COBOL screen declaration names no button, no submit and no event",
    "anywhere, since the program's own statements for reading and writing to",
    "the terminal, and whatever they do with a function key, live entirely",
    "outside it, so no output is ever produced here. A bound field whose",
    "direction is unclear, a relative position this reader does not compute,",
    "and a caption that is not a clean quoted literal are each named rather",
    "than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.found) { out.push("No screen declaration found.", ""); continue; }
    if (!f.screens.length) { out.push("A screen declaration was found but declared no top level screen.", ""); continue; }
    for (const s of f.screens) {
      out.push(`### ${s.title}`, "");
      out.push(`${s.fields.length} field(s), 0 output(s).`, "");
      if (s.notes.length) out.push(...s.notes.map((n) => `- ${n}`), "");
    }
  }
  return out.join("\n") + "\n";
}
