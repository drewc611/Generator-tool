import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseOpenEdge } from "./parse.js";
import { lowerOpenEdge } from "./lower.js";

/**
 * Reads Progress OpenEdge ABL (4GL) `.p` source for its `DEFINE VARIABLE`,
 * `DEFINE BUTTON` and `FORM ... WITH FRAME` screen declarations: a business
 * application language still running ERP, banking and logistics back offices
 * today, whose screens are declared directly in ordinary procedure source
 * with no separate designer file at all, the way input-xbase reads xBase's
 * `@ row, col SAY/GET` and input-cobolscreen reads a COBOL `SCREEN SECTION`.
 * `WITH FRAME framename` is the one real, load-bearing screen boundary this
 * format gives, so each one becomes its own screen, the same "each structural
 * top level unit is its own screen" rule input-storyboard and input-cics
 * already establish; a file can hold more than one.
 *
 * `ON CHOOSE OF buttonname DO: RUN procedurename. END.` is the one real
 * wiring signal ABL gives at this level: a clean bare RUN becomes a real
 * output, and anything else, or nothing at all, is named through
 * ctx.unverified rather than guessed. A FORM entry with no matching DEFINE
 * is named the same way. OPENEDGE.md gathers every file's own screens and
 * gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-openedge",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.p$/i.test(f.rel));
      if (!files.length) return log.debug("no OpenEdge .p files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "openedge-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screenCount = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, screens: [] }); continue; }

        const { declarations, frames, onChoose, problems } = parseOpenEdge(text);
        for (const p of problems) ctx.unverified(`${rel}: ${p}`);
        if (!frames.length) { ctx.unverified(`${rel}: no FORM screen declaration found; nothing was read.`); seen.push({ rel, screens: [] }); continue; }

        const fileScreens = [];
        for (const frame of frames) {
          const lowered = lowerOpenEdge(frame, declarations, onChoose);
          const selector = unique(kebab(lowered.stem || frame.frame));
          ctx.screens.push({
            selector,
            className: pascal(selector),
            file: rel,
            inputs: readInputs(lowered.template, { skip: lowered.fields }),
            outputs: lowered.outputs,
            template: lowered.template,
            templateOrigin: `an OpenEdge ABL screen declaration, read structurally from ${rel}`,
            usesNgIf: false,
            usesNgFor: lowered.usesNgFor,
            usesTwoWay: lowered.usesTwoWay,
            rxjs: [],
            readBy: "openedge",
            title: lowered.title || pascal(selector),
          });
          screenCount += 1;
          for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
          fileScreens.push(lowered);
        }
        seen.push({ rel, screens: fileScreens });
      }

      if (!seen.length) return log.debug("no OpenEdge .p files read");
      log.info(`${files.length} OpenEdge .p file(s): ${screenCount} screen(s) read from FORM screen declarations`);
      ctx.openedge = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.openedge?.length) return;
      await ctx.write("OPENEDGE.md", render(ctx.openedge));
      log.info("OPENEDGE.md written");
    });
  },
};

function render(files) {
  const out = [
    "# OpenEdge ABL screen declarations",
    "",
    "Every `.p` file this run read: each FORM declaration as one screen, in",
    "the order its own field and button list gave them, and every gap. A",
    "button's ON CHOOSE handler becomes a real output only when its body is",
    "exactly one clean bare RUN statement; anything else, or no wiring at",
    "all, is named rather than guessed. A FORM entry with no matching",
    "declaration is named the same way.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.screens.length) { out.push("No FORM screen declaration found.", ""); continue; }
    for (const s of f.screens) {
      out.push(`### ${s.title}`, "");
      out.push(`${s.fields.length} field(s), ${s.outputs.length} output(s).`, "");
      if (s.notes.length) out.push(...s.notes.map((n) => `- ${n}`), "");
    }
  }
  return out.join("\n") + "\n";
}
