import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseGlade } from "./parse.js";
import { lowerGlade } from "./lower.js";

/**
 * Reads GTK Builder's `.glade` files, the declarative XML UI format the
 * Glade Interface Designer has written for GTK2 and GTK3 apps in Python, C,
 * C++ and Vala for roughly two decades. An `<object class="...">` tree is a
 * real component boundary somebody drew with the Designer, so this reader
 * produces a screen the way input-qt already does from a Qt Designer form,
 * laid out in the document order the file's own `<child>` wrappers
 * recorded. GtkBuilder wires an event straight onto the widget that raises
 * it, a `<signal name="clicked" handler="...">` child, so a button's
 * clicked signal becomes an output named after the handler it calls.
 *
 * Qt Designer's own `.ui` files and GTK Builder's `.glade` files are two
 * different XML shapes that can both end up saved with a `.ui` extension in
 * the wild (Glade defaults to `.glade`, but some projects rename their
 * files). To keep this reader from ever claiming a file input-qt already
 * claims, or fighting over one, this reader answers only to the `.glade`
 * extension; a `.ui` file, whichever dialect it holds, is entirely
 * input-qt's file to read.
 *
 * What has no honest equivalent, a property whose value this reader does
 * not interpret, a combo box filled from a GtkTreeModel, a button with no
 * signal wired, a widget class outside GTK's own set, is named through
 * ctx.unverified rather than invented; GLADE.md gathers every file's own
 * gaps in one place.
 */

export default {
  name: "input-glade",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.glade$/i.test(f.rel));
      if (!files.length) return log.debug("no GTK Builder .glade files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "glade-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const interfaceEl = parseGlade(text);
        if (!interfaceEl) { ctx.unverified(`${rel}: no <interface> root element; nothing was read.`); seen.push({ rel, lowered: null }); continue; }

        const lowered = lowerGlade(interfaceEl, rel, (n) => ctx.unverified(n));
        if (!lowered) { seen.push({ rel, lowered: null }); continue; }

        const selector = unique(lowered.stem);
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field is the screen's own state, not something it is handed.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `a GTK Builder .glade file, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "glade",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no GTK Builder .glade files read");
      log.info(`${files.length} .glade file(s): ${screens} screen(s) read from GTK Builder forms`);
      ctx.glade = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.glade?.length) return;
      await ctx.write("GLADE.md", render(ctx.glade));
      log.info("GLADE.md written");
    });
  },
};

function render(files) {
  const out = [
    "# GTK Builder forms",
    "",
    "Every `.glade` file this run read, the widget tree Glade wrote for it,",
    "and what became a screen. A widget class with no vocabulary entry, an",
    "opaque property, a combo box filled from a model and a button with no",
    "signal wired are each named here rather than guessed.",
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
