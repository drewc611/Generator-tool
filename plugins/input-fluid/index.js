import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseFluid } from "./parse.js";
import { lowerFluid } from "./lower.js";

/**
 * Reads FLTK's own FLUID `.fl` designer files, the declarative brace nested
 * format that has shipped FLTK's desktop and embedded C++ front ends since
 * the 1990s and is still actively used. A top level `Function {}` block is
 * FLUID's own wrapper for the code a window generates, and each root window
 * inside one is a real component boundary somebody placed with the
 * designer, so this reader produces a screen the way input-qt and
 * input-glade do, one per root window rather than one per file: a file with
 * more than one `Function {}` block, each opening its own window, produces
 * more than one screen, the same rule input-storyboard already gives a
 * multi scene storyboard.
 *
 * FLUID has no radio grouping keyword; an `Fl_Round_Button`'s own siblings
 * inside a shared parent are the group, FLTK's own runtime rule, so this
 * reader groups by shared immediate parent rather than a consecutive
 * siblings guess. A callback is raw C++, so only a clean `functionName(...)`
 * call resolves to a wired output; anything else, an unrecognised widget
 * class, and a combo box filled from code are each named through
 * ctx.unverified rather than invented. FLUID.md gathers every file's own
 * screens and gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-fluid",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.fl$/i.test(f.rel));
      if (!files.length) return log.debug("no FLUID .fl files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "fluid-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, screens: [] }); continue; }

        const { functions, problems } = parseFluid(text);
        for (const p of problems) ctx.unverified(`${rel}: ${p}`);
        if (!functions.length) { ctx.unverified(`${rel}: no Function {} block found; nothing was read.`); seen.push({ rel, screens: [] }); continue; }

        const fileScreens = [];
        for (const fn of functions) {
          const windows = (fn.children ?? []).filter((n) => /Window$/.test(n.class));
          if (!windows.length) { ctx.unverified(`${rel}: a Function {} block declares no root window; nothing was read from it.`); continue; }
          for (const win of windows) {
            const lowered = lowerFluid(win);
            const base = lowered.stem || kebab(win.name || "fluid-window");
            const selector = unique(base);
            ctx.screens.push({
              selector,
              className: pascal(selector),
              file: rel,
              // A field is the screen's own state, bound with ng-model, not something the port hands it.
              inputs: readInputs(lowered.template, { skip: lowered.fields }),
              outputs: lowered.outputs,
              template: lowered.template,
              templateOrigin: `a FLUID .fl designer file, read structurally from ${rel}`,
              usesNgIf: false,
              usesNgFor: lowered.usesNgFor,
              usesTwoWay: lowered.usesTwoWay,
              rxjs: [],
              readBy: "fluid",
              title: lowered.title || pascal(selector),
            });
            screens += 1;
            for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
            fileScreens.push(lowered);
          }
        }
        seen.push({ rel, screens: fileScreens });
      }

      if (!seen.length) return log.debug("no FLUID .fl files read");
      log.info(`${files.length} FLUID .fl file(s): ${screens} screen(s) read from FLUID designer files`);
      ctx.fluid = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.fluid?.length) return;
      await ctx.write("FLUID.md", render(ctx.fluid));
      log.info("FLUID.md written");
    });
  },
};

function render(files) {
  const out = [
    "# FLUID designer files",
    "",
    "Every `.fl` file this run read: each top level Function block's own root",
    "window, one screen per window, and every gap. Radio buttons group by",
    "shared immediate parent, FLTK's own runtime rule; a callback that is not",
    "a clean `functionName(...)` call, an unrecognised widget class and a",
    "choice filled from code are each named here rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.screens.length) { out.push("Not read as a screen.", ""); continue; }
    for (const s of f.screens) {
      out.push(`### ${s.title}`, "");
      out.push(`${s.fields.length} field(s), ${s.outputs.length} output(s).`, "");
      if (s.notes.length) out.push(...s.notes.map((n) => `- ${n}`), "");
    }
  }
  return out.join("\n") + "\n";
}
