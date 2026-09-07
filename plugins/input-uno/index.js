import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseXdl } from "./parse.js";
import { lowerXdl } from "./lower.js";

/**
 * Reads LibreOffice/OpenOffice Basic's `.xdl` files, the UNO dialog XML
 * format the Dialog Editor in the Basic IDE has written since the early
 * 2000s and still ships in every LibreOffice install. A `<dlg:window>` with
 * its `<dlg:bulletinboard>` is a real component boundary somebody drew with
 * the Dialog Editor, so this reader produces a screen the way input-qt does
 * from a Qt Designer form and input-glade from a GTK Builder one, laid out
 * in the document order the bulletinboard's own children already record; a
 * UNO dialog has no layout manager to speak of, every control placed by
 * absolute position, so there is no row/column arrangement to reproduce or
 * lose. A button's `<script:event script:event-name="on-performaction"
 * script:macro-name="...">` child is the event wiring every other reader
 * already names a handler for, so it becomes an output named after the
 * macro method it calls.
 *
 * What has no honest equivalent, a menulist with no inline items, a button
 * with no on-performaction event wired, a checkbox whose dlg:value could be
 * a caption or a checked-state default and cannot be told apart, an element
 * outside this reader's own vocabulary, is named through ctx.unverified
 * rather than invented; UNO.md gathers every file's own gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-uno",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.xdl$/i.test(f.rel));
      if (!files.length) return log.debug("no UNO dialog .xdl files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "uno-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const windowEl = parseXdl(text);
        if (!windowEl) { ctx.unverified(`${rel}: no <dlg:window> root element; nothing was read.`); seen.push({ rel, lowered: null }); continue; }

        const lowered = lowerXdl(windowEl, rel, (n) => ctx.unverified(n));
        if (!lowered) { seen.push({ rel, lowered: null }); continue; }

        const selector = unique(kebab(lowered.stem));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field is the screen's own state, not something it is handed.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `a LibreOffice/OpenOffice UNO dialog .xdl file, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "uno",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no UNO dialog .xdl files read");
      log.info(`${files.length} .xdl file(s): ${screens} screen(s) read from UNO dialogs`);
      ctx.uno = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.uno?.length) return;
      await ctx.write("UNO.md", render(ctx.uno));
      log.info("UNO.md written");
    });
  },
};

function render(files) {
  const out = [
    "# UNO dialogs",
    "",
    "Every `.xdl` file this run read, the control tree the LibreOffice/OpenOffice",
    "Basic Dialog Editor wrote for it, and what became a screen. An element with",
    "no vocabulary entry, a menulist with no inline items, a button with no",
    "on-performaction event wired, and a checkbox whose caption could not be",
    "told apart from a checked-state default are each named here rather than",
    "guessed.",
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
