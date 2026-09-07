import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseFbp } from "./parse.js";
import { lowerFbp } from "./lower.js";

/**
 * Reads wxFormBuilder's `.fbp` project files, the visual designer XML for
 * wxWidgets, the cross platform C++ toolkit whose dialogs wxFormBuilder built
 * by hand through the 2000s and 2010s, generating C++, Python, PHP and Lua
 * code from the one project file. An `<object class="...">` tree is a real
 * component boundary somebody drew with the designer, so this reader
 * produces a screen the way input-qt does from a Qt Designer form, laid out
 * in the document order the sizers already recorded: a `sizeritem` wrapper
 * unwrapped to the widget it holds, a `spacer` skipped outright, a plain
 * sizer recursed through transparently, and a `wxStaticBoxSizer`'s own label
 * kept as a heading the way a Qt QGroupBox's title is. A button's
 * `<event name="OnButtonClick">` names the handler wxFormBuilder wired,
 * the same wiring `<connections>` names for Qt.
 *
 * What has no honest equivalent, a property this reader does not interpret,
 * a widget class with no vocabulary entry, a combo box or radio box filled
 * from code, a button with no event wired, is named through ctx.unverified
 * rather than invented; FBP.md gathers every file's own gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A widget's own name's humps as hyphens: LoginDialog is login-dialog, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-fbp",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.fbp$/i.test(f.rel));
      if (!files.length) return log.debug("no wxFormBuilder .fbp files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "fbp-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null }); continue; }

        const projectEl = parseFbp(text);
        if (!projectEl) { ctx.unverified(`${rel}: no <wxFormBuilder_Project> root element; nothing was read.`); seen.push({ rel, lowered: null }); continue; }

        const lowered = lowerFbp(projectEl, rel, (n) => ctx.unverified(n));
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
          templateOrigin: `a wxFormBuilder .fbp file, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "fbp",
          title: lowered.title || lowered.className,
        });
        screens += 1;
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered });
      }

      if (!seen.length) return log.debug("no wxFormBuilder .fbp files read");
      log.info(`${files.length} .fbp file(s): ${screens} screen(s) read from wxFormBuilder projects`);
      ctx.fbp = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.fbp?.length) return;
      await ctx.write("FBP.md", render(ctx.fbp));
      log.info("FBP.md written");
    });
  },
};

function render(files) {
  const out = [
    "# wxFormBuilder projects",
    "",
    "Every `.fbp` file this run read, the widget tree wxFormBuilder wrote for",
    "it, and what became a screen. A sizer item and a spacer are unwrapped to",
    "the widget each holds, a wxStaticBoxSizer's own label becomes a heading,",
    "and a widget class with no vocabulary entry, a property this reader does",
    "not interpret, and a button with no OnButtonClick event wired are each",
    "named here rather than guessed.",
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
