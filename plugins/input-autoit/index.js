import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseAutoit } from "./parse.js";
import { lowerAutoit } from "./lower.js";

/**
 * Reads AutoIt `.au3` scripts for their `GUICreate`/`GUICtrlCreate*` calls: a
 * Windows automation/scripting language whose GUI is built entirely by
 * ordinary executable statements, one call at a time, with no separate
 * declarative designer file at all, the same "screen built one statement in
 * source" pattern input-xbase reads from `@ SAY/GET`. `GUICreate` opens the
 * one window this reader turns into a screen, so a whole `.au3` file is one
 * screen; a second `GUICreate` call is named as an existing second window
 * this reader does not read rather than an attempt to split the file.
 *
 * A control's own field name comes from the variable its return value was
 * assigned to, since AutoIt gives no `GUICtrlCreate*` call a "bind to this
 * name" argument of its own. A button wires nothing on its own creation
 * call either: its action lives entirely in the event loop, so this reader's
 * second pass reads whichever single, clean function call stands inside the
 * `Case $var`/`If $msg = $var Then` block matching a button's own variable.
 * What has no honest equivalent, an unassigned field, an unrecognised
 * control, a button whose wiring is not one clean call or is never
 * referenced at all, is named through `ctx.unverified` rather than
 * invented; AUTOIT.md gathers every file's own screen and gaps.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-autoit",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.au3$/i.test(f.rel));
      if (!files.length) return log.debug("no AutoIt .au3 files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "autoit-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screenCount = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, read: null, lowered: null }); continue; }

        const read = parseAutoit(text);
        for (const p of read.problems) ctx.unverified(`${rel}: ${p}`);
        if (!read.controls.length) { ctx.unverified(`${rel}: no GUICtrlCreate* calls found; nothing was read.`); seen.push({ rel, read, lowered: null }); continue; }

        const lowered = lowerAutoit(read);
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);

        const selector = unique(kebab(lowered.stem || "autoit-screen"));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field is the screen's own state, bound with ng-model, not something the port hands it.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `an AutoIt GUI control creation call, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "autoit",
          title: lowered.title || pascal(selector),
        });
        screenCount += 1;
        seen.push({ rel, read, lowered });
      }

      if (!seen.length) return log.debug("no AutoIt .au3 files read");
      log.info(`${files.length} AutoIt .au3 file(s): ${screenCount} screen(s) read from GUICtrlCreate* calls`);
      ctx.autoit = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.autoit?.length) return;
      await ctx.write("AUTOIT.md", render(ctx.autoit));
      log.info("AUTOIT.md written");
    });
  },
};

function render(files) {
  const out = [
    "# AutoIt GUICtrlCreate* screens",
    "",
    "Every `.au3` file this run read: the one window its `GUICreate` call",
    "opens, populated in declaration order by its own `GUICtrlCreate*`",
    "calls. A field's name comes from the variable its return value was",
    "assigned to, since AutoIt binds no control to a name any other way; a",
    "button's wiring comes from the single clean function call, if any,",
    "inside the `Case`/`If` block against `$msg` that names its own",
    "variable elsewhere in the file. An unassigned field, an unrecognised",
    "control, and a button wired to more than one statement or to nothing",
    "at all are each named rather than guessed.",
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
