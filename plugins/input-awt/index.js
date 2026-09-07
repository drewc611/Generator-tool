import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { isGenerated, parseAwt } from "./parse.js";
import { lowerAwt } from "./lower.js";

/**
 * Reads raw Java AWT/Swing UI construction: legacy front ends built entirely
 * through `new ClassName(...)` constructor calls and `add(...)` calls, from
 * before GUI builders were common or written by hand deliberately avoiding
 * one, with no separate declarative designer file and no builder-generated
 * initComponents method at all. Claims the same `.java` extension
 * input-swing and input-gwt already scan; a file input-swing's own
 * GEN-BEGIN/GEN-END or editor-fold markers bracket was written by a
 * builder, not by hand, and is left entirely to input-swing, the identical
 * courtesy input-swing already extends to a plain `.java` file with no
 * builder markers of its own. A file with neither those markers nor any
 * recognised construction is simply not a screen, the ordinary "produces
 * nothing" case every reader has.
 *
 * A whole `.java` file is one screen, the same "no separate boundary
 * marker" choice input-tk makes for a Tcl script. A control's own field
 * name is read from the variable its constructor call was assigned to; a
 * button's caption from its own constructor literal or a same-variable
 * `.setText(...)` call, and its wiring from a clean, single, zero-argument
 * method call lambda passed to `.addActionListener(...)`. What has no
 * honest equivalent, a non-literal caption, an unassigned field, a
 * JComboBox/Choice's own inline options, a button wired to anything else or
 * wired to nothing at all, is named through `ctx.unverified` rather than
 * invented; AWT.md gathers every file's own screen and gaps.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const kebabClass = (name) => kebab(String(name).replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-awt",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.java$/i.test(f.rel));
      if (!files.length) return log.debug("no Java files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "awt-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screenCount = 0;
      let skipped = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { skipped += 1; continue; }

        // A GEN-marked file was written by a GUI builder, not by hand; it
        // belongs entirely to input-swing and is never claimed away from it.
        if (isGenerated(text)) { skipped += 1; continue; }

        const read = parseAwt(text);
        for (const p of read.problems) ctx.unverified(`${rel}: ${p}`);
        if (!read.constructions.some((c) => c.kind)) { skipped += 1; seen.push({ rel, className: null, lowered: null }); continue; }

        const classMatch = /\bclass\s+(\w+)/.exec(text);
        const rawClassName = classMatch?.[1] ?? rel.replace(/^.*\//, "").replace(/\.java$/i, "");
        const lowered = lowerAwt(read, rawClassName);
        for (const n of lowered.notes) ctx.unverified(`${rel}, ${rawClassName}: ${n}`);

        const selector = unique(`awt-${kebabClass(rawClassName)}`);
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `new ClassName(...) construction, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "awt",
          title: rawClassName,
        });
        screenCount += 1;
        seen.push({ rel, className: rawClassName, lowered });
      }

      if (!seen.length) return log.debug(`${skipped} Java file(s), none a hand written AWT/Swing screen`);
      log.info(`${screenCount} AWT/Swing screen(s) read from raw construction, ${skipped} other Java file(s) left to the code`);
      ctx.awt = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.awt?.length) return;
      await ctx.write("AWT.md", render(ctx.awt));
      log.info("AWT.md written");
    });
  },
};

function render(files) {
  const out = [
    "# Raw AWT/Swing screens",
    "",
    "Every `.java` file this run read for hand written `new ClassName(...)`",
    "construction: no separate designer file, no generated initComponents,",
    "one screen per file, controls in the order their own construction",
    "statement appears. A field's name comes from the variable a",
    "TextField/TextArea/Checkbox construction was assigned to; a button's",
    "caption and wiring come from its own literal, a same-variable",
    "setText call, and a clean addActionListener lambda. A file already",
    "carrying input-swing's own generated-code markers is left to it",
    "entirely and never appears here.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); continue; }
    out.push(`Read as \`${f.lowered.className}\` (${f.className}), ${f.lowered.fields.length} field(s), ${f.lowered.outputs.length} output(s).`, "");
    if (f.lowered.notes.length) out.push(...f.lowered.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
