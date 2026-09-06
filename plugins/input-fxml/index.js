import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseFxml } from "./parse.js";
import { lowerFxml } from "./lower.js";

/**
 * Reads JavaFX's `.fxml` files, the declarative XML UI format desktop Java
 * apps have shared since JavaFX's introduction and still write internal
 * tools, kiosks and utilities in today. A container or control tree is a
 * real component boundary somebody drew with Scene Builder or by hand, so
 * this reader produces a screen the way input-qt and input-glade already do
 * from a desktop form, laid out in the document order the file's own
 * nesting already recorded. FXML wires a control's own event straight onto
 * it, an `onAction="#method"` attribute, which becomes an output named after
 * the controller method it calls.
 *
 * What has no honest equivalent, layout positioning this reader does not
 * reproduce, a combo box filled from code, a button whose handler is a
 * binding expression rather than a controller method, an element outside
 * JavaFX's own control set, is named through ctx.unverified rather than
 * invented; FXML.md gathers every file's own gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A PascalCase class name's humps as hyphens, `kebab`'s own blind lowercasing done first would collapse a run
 * like `LoginController` into one word with no boundary left to split on: the selector spelling every other reader
 * uses (input-qt's `kebabClass` keeps its own copy the same way, one small helper each reader owns rather than a
 * fifth shared home for it). */
const kebabClass = (name) => kebab(String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-fxml",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.fxml$/i.test(f.rel));
      if (!files.length) return log.debug("no JavaFX .fxml files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "fxml-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const root = parseFxml(text);
        const lowered = lowerFxml(root, rel, (n) => ctx.unverified(n));
        if (!lowered) { seen.push({ rel, lowered: null }); continue; }

        const stem = basename(rel).replace(/\.fxml$/i, "");
        const className = lowered.className || pascal(kebabClass(stem)) || "Screen";
        lowered.className = className;
        const selector = unique(kebabClass(className));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field is the screen's own state, not something it is handed.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `a JavaFX .fxml file, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "fxml",
          title: className,
        });
        screens += 1;
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no JavaFX .fxml files read");
      log.info(`${files.length} .fxml file(s): ${screens} screen(s) read from JavaFX forms`);
      ctx.fxml = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.fxml?.length) return;
      await ctx.write("FXML.md", render(ctx.fxml));
      log.info("FXML.md written");
    });
  },
};

function render(files) {
  const out = [
    "# JavaFX FXML forms",
    "",
    "Every `.fxml` file this run read, the container and control tree it",
    "declared, and what became a screen. An attached property (layout",
    "positioning a parent container assigns a child) is not reproduced and",
    "is dropped with no per-control note; an element with no vocabulary",
    "entry, a combo box with no plain inline items and a button with no",
    "`#method` wired are each named here rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); continue; }
    out.push(`Read as \`${f.lowered.className ?? basename(f.rel)}\`, ${f.lowered.fields.length} field(s), ${f.lowered.outputs.length} output(s).`, "");
    if (f.lowered.notes.length) out.push(...f.lowered.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
