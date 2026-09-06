import { readFile } from "node:fs/promises";
import { readInputs } from "../dsp-ir/text.js";
import { lowerMxml } from "./lower.js";

/**
 * Reads Adobe Flex, the MXML based rich internet application framework that
 * ran a large share of enterprise dashboards and internal tools from roughly
 * 2005 to 2012. An Application or WindowedApplication is a real screen the
 * way a XAML window is, so it is lowered through ./lower.js the same way, an
 * mx or spark widget tree read structurally onto the AngularJS attribute
 * dialect every other reader lowers onto. What sets MXML apart from XAML is
 * that the code lives in the same file, an mx:Script or fx:Script block held
 * as CDATA, the way a Vue single file component holds its script beside its
 * template; the block is scanned only for the functions it declares and the
 * properties it marks [Bindable], never read for what a function does. A
 * {expression} data binding is recognised and named, never printed as if it
 * were the literal text a person saw. FLEX.md carries what each file read,
 * what lowered, and every gap named along the way.
 */

export default {
  name: "input-flex",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const files_read = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.mxml$/i.test(f.rel));
      if (!files.length) return log.debug("no MXML");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };
      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); continue; }
        const notes = [];
        const { screen } = lowerMxml(text, rel, (n) => notes.push(n));
        for (const n of notes) ctx.unverified(n);
        files_read.push({ rel, lowered: Boolean(screen), notes });
        if (!screen) continue;
        const { fields, ...rest } = screen;
        ctx.screens.push({ ...rest, selector: unique(screen.selector), inputs: readInputs(screen.template, { skip: fields }) });
        screens += 1;
      }
      log.info(`${files.length} MXML file(s): ${screens} screen(s) read`);
    });

    on("emit", async (ctx) => {
      if (!files_read.length) return;
      await ctx.write("FLEX.md", render(files_read));
      log.info("FLEX.md written");
    });
  },
};

function render(files) {
  const out = [
    "# Flex components", "",
    "Every MXML file this run read: whether its Application or WindowedApplication",
    "lowered to a screen, and what could not be, named rather than guessed at. A",
    "click wired to a function the script block does not declare, a dataProvider",
    "bound to a variable, a {expression} binding, a custom component and an",
    "mx:Style block are each named here and never approximated.", "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    out.push(f.lowered ? "Lowered to a screen." : "Not lowered; its root was not an Application or a WindowedApplication.", "");
    if (f.notes.length) out.push(...f.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
