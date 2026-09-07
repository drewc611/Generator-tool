import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseTk } from "./parse.js";
import { lowerTk } from "./lower.js";

/**
 * Reads Tcl/Tk scripts, the still-current, decades-stable cross platform
 * GUI toolkit whose front end is built by ordinary executable Tcl
 * statements, one widget creation command at a time, with no separate
 * declarative designer file at all: the same "screen built one executable
 * statement at a time" pattern input-xbase already reads for dBase/
 * Clipper's `@ SAY/GET`. A widget's own dotted path (`.custNo`, or `.` for
 * the root window itself) is Tk's real, load-bearing identity for it, and
 * `pack`, `grid` and `place`, the layout manager calls that arrange those
 * widgets, are recognised only well enough to be skipped, never
 * reproduced. There is no window boundary this format draws clearly (no
 * `READ` the way xBase gives one, no `<scene>` the way a storyboard gives
 * one), so the whole file is read as one screen, the ordinary shape of the
 * legacy code this reader targets: one dialog or window built per file.
 *
 * `radiobutton`'s own `-variable` is Tk's real grouping mechanism: every
 * radio button sharing one variable name is one group, however far apart
 * in the file, resolved through lower.js's own `Map`. An `entry` or
 * `checkbutton` with no bound variable, a `radiobutton` with no
 * `-variable` at all, a `button` whose `-command` is not a clean bare proc
 * name, and any widget command outside this reader's short vocabulary
 * (`menu`, `menubutton`, `scale`, `scrollbar`, `canvas`) are each named
 * through ctx.unverified rather than guessed. TK.md gathers every file's
 * own screen and gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-tk",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.tcl$/i.test(f.rel));
      if (!files.length) return log.debug("no Tcl/Tk .tcl files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "tk-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const { widgets } = parseTk(text);
        if (!widgets.length) { ctx.unverified(`${rel}: no widget-creation commands found; nothing was read.`); seen.push({ rel, lowered: null }); continue; }

        const stem = kebab(basename(rel).replace(/\.tcl$/i, ""));
        const lowered = lowerTk(widgets, stem || "screen");

        const selector = unique(lowered.stem);
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field is the screen's own state, bound by name, not something the port hands it.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `a Tcl/Tk widget-creation command, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "tk",
          title: lowered.title || pascal(selector),
        });
        screens += 1;
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no Tcl/Tk .tcl files read");
      log.info(`${files.length} Tcl/Tk .tcl file(s): ${screens} screen(s) read from widget-creation commands`);
      ctx.tk = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.tk?.length) return;
      await ctx.write("TK.md", render(ctx.tk));
      log.info("TK.md written");
    });
  },
};

function render(files) {
  const out = [
    "# Tcl/Tk widget-creation commands",
    "",
    "Every `.tcl` file this run read, its own widget-creation commands in",
    "declaration order, and what became a screen. A whole file is one",
    "screen: Tk draws no window boundary this reader can trust the way",
    "xBase's own `READ` or a storyboard's own `<scene>` does. `pack`,",
    "`grid` and `place` are recognised only well enough to be skipped, never",
    "reproduced. An entry or checkbutton with no bound variable, a radio",
    "button with no `-variable` at all, a button whose `-command` is not a",
    "clean bare proc name, and a widget command outside this reader's short",
    "vocabulary are each named here rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); continue; }
    out.push(`Read as \`${f.lowered.className}\`, ${f.lowered.fields.length} field(s), ${f.lowered.outputs.length} output(s).`, "");
    if (f.lowered.notes.length) out.push(...f.lowered.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
