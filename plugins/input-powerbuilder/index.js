import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { readSrw } from "./parse.js";
import { lowerSrw } from "./lower.js";

/**
 * Reads Sybase/Appeon PowerBuilder's exported `.srw` window source files,
 * PowerBuilder's own plain text format for a Window object ("File > Export
 * Object", or a version control integration). A `w_<name>` window with its
 * controls is a real component boundary somebody drew in the PowerBuilder
 * IDE, so this reader produces a screen the way input-qt does from a Qt
 * Designer form and input-uno from a UNO dialog. What has no honest
 * equivalent, a control class with no vocabulary entry, an opaque property,
 * an empty dropdownlistbox, a commandbutton with no `clicked` event wired,
 * and a DataWindow's rows, is named through `ctx.unverified` rather than
 * invented; POWERBUILDER.md gathers every file's own gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-powerbuilder",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.srw$/i.test(f.rel));
      if (!files.length) return log.debug("no PowerBuilder .srw window files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "powerbuilder-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, read: null, lowered: null }); continue; }

        const read = readSrw(text);
        for (const p of read.problems) ctx.unverified(`${rel}: ${p}.`);
        if (!read.window) { ctx.unverified(`${rel}: no \`global type ... from window\` block; nothing was read.`); seen.push({ rel, read, lowered: null }); continue; }

        const lowered = lowerSrw(read);
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);

        const selector = unique(`window-${kebab(lowered.stem) || "window"}`);
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field is the window's own state, not something it is handed.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `a PowerBuilder .srw window export, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.fields.length > 0,
          rxjs: [],
          readBy: "powerbuilder",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        seen.push({ rel, read, lowered });
      }

      if (!seen.length) return log.debug("no PowerBuilder .srw window files read");
      log.info(`${files.length} .srw file(s): ${screens} window(s) read`);
      ctx.powerbuilder = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.powerbuilder?.length) return;
      await ctx.write("POWERBUILDER.md", render(ctx.powerbuilder));
      log.info("POWERBUILDER.md written");
    });
  },
};

function render(files) {
  const out = [
    "# PowerBuilder windows",
    "",
    "Every `.srw` window export this run read: the window's own container",
    "definition, and for each control the file forward declares, the real,",
    "non-forward `type ... end type` block that carries its actual property",
    "values, rendered in the order the window's own declaration lines name",
    "them. A control class with no vocabulary entry, an opaque property (its",
    "type keyword is not `integer`, `string` or `boolean`), a dropdownlistbox",
    "with no inline `item[]` array, a commandbutton with no `clicked` event",
    "block, and a DataWindow (defined in a separate `.srd`/`.pbl` artifact",
    "this reader does not have access to) are each named here rather than",
    "guessed. No opaque property's value and no PowerScript event body is",
    "ever printed, only a property's name and, for an event, how many lines",
    "it runs.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); continue; }
    out.push(`Read as \`${f.lowered.className}\`, ${f.read.controls.size} control(s), ${f.lowered.fields.length} field(s), ${f.lowered.outputs.length} output(s).`, "");
    if (f.lowered.notes.length) out.push(...f.lowered.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
