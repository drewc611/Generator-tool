import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseUi } from "./parse.js";
import { lowerUi } from "./lower.js";

/**
 * Reads Qt Designer's `.ui` files, the declarative XML form format Qt's C++
 * and PySide/PyQt Python apps have shared since Qt 4. A `<widget>` tree is a
 * real component boundary somebody drew with the Designer, so this reader
 * produces a screen the way input-winforms and input-delphi do from a form,
 * laid out in the document order the file's own layouts already recorded.
 * Qt's signal/slot wiring in `<connections>` is the event wiring every other
 * reader already names a handler for, so a button's `clicked()` connection
 * becomes an output named after the slot it called.
 *
 * What has no honest equivalent, a property whose value this reader does not
 * interpret, a promoted widget's real behaviour, a combo box filled from
 * code, a button with no connection wired, is named through ctx.unverified
 * rather than invented; QT.md gathers every file's own gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A Qt class name's humps as hyphens: LoginDialog is login-dialog, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-qt",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.ui$/i.test(f.rel));
      if (!files.length) return log.debug("no Qt Designer .ui files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "qt-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const uiEl = parseUi(text);
        if (!uiEl) { ctx.unverified(`${rel}: no <ui> root element; nothing was read.`); seen.push({ rel, lowered: null }); continue; }

        const lowered = lowerUi(uiEl, rel, (n) => ctx.unverified(n));
        if (!lowered) { seen.push({ rel, lowered: null }); continue; }

        const selector = unique(kebabClass(lowered.className));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field is the screen's own state, not something it is handed.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `a Qt Designer .ui file, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "qt",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no Qt Designer .ui files read");
      log.info(`${files.length} .ui file(s): ${screens} screen(s) read from Qt Designer forms`);
      ctx.qt = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.qt?.length) return;
      await ctx.write("QT.md", render(ctx.qt));
      log.info("QT.md written");
    });
  },
};

function render(files) {
  const out = [
    "# Qt Designer forms",
    "",
    "Every `.ui` file this run read, the widget tree Qt Designer wrote for it,",
    "and what became a screen. A widget class not in Qt's own set, a promoted",
    "widget, a property whose value this reader does not interpret, and a",
    "signal with no connection wired are each named here rather than guessed.",
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
