import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseIspf } from "./parse.js";
import { lowerIspf } from "./lower.js";

/**
 * Reads IBM ISPF Dialog Manager `.panel` definitions, the format that has
 * defined every full screen TSO/ISPF dialog on IBM mainframes since the
 * 1980s and still drives mainframe administration tooling today. On a real
 * mainframe a panel is a PDS member with no filename extension at all; the
 * `.panel` extension is the conventional one a fetch to a filesystem gives
 * it, the same convention this tool already reads `.bms` and `.per` under.
 *
 * A file conventionally holds exactly one `)BODY`, one screen; a file that
 * carries more than one becomes one screen per `)BODY`, the same "each
 * structural unit is its own screen" precedent input-storyboard and
 * input-cics already keep for their own multi-unit files.
 *
 * ISPF names no button, no event and no navigation anywhere in a panel
 * body: a screen is driven by PF-keys and the `)PROC` section's own
 * Dialog Manager validation logic, which this reader never reads for
 * meaning, so no screen this reader produces ever carries an output. A
 * `)ATTR` character with no resolvable TYPE(...) and a body run that
 * introduces no variable name are each named through ctx.unverified rather
 * than guessed. ISPF.md gathers every file's own panels and gaps.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-ispf",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.panel$/i.test(f.rel));
      if (!files.length) return log.debug("no ISPF .panel definitions");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "ispf-panel"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, panels: [] }); continue; }

        const panels = parseIspf(text);
        if (!panels.length) { ctx.unverified(`${rel}: no )BODY section; nothing was read.`); seen.push({ rel, panels: [] }); continue; }

        const stemBase = kebab(rel.replace(/\.panel$/i, "").split("/").pop()) || "ispf-panel";
        const filePanels = [];
        panels.forEach((panel, i) => {
          const lowered = lowerIspf(panel, stemBase, i + 1);
          const selector = unique(kebab(lowered.className));
          ctx.screens.push({
            selector,
            className: pascal(selector),
            file: rel,
            // An INPUT/OUTPUT field is the screen's own state, bound with ng-model or read from {{ }}; not
            // something the port hands in as a prop the way a value with no on-screen binding would be.
            inputs: readInputs(lowered.template, { skip: lowered.fields }),
            outputs: [],
            template: lowered.template,
            templateOrigin: `an IBM ISPF Dialog Manager .panel definition, read structurally from ${rel}`,
            usesNgIf: false,
            usesNgFor: lowered.usesNgFor,
            usesTwoWay: lowered.usesTwoWay,
            rxjs: [],
            readBy: "ispf",
            title: lowered.title || pascal(selector),
          });
          screens += 1;
          for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
          filePanels.push(lowered);
        });
        seen.push({ rel, panels: filePanels });
      }

      if (!seen.length) return log.debug("no ISPF .panel definitions read");
      log.info(`${files.length} ISPF .panel file(s): ${screens} screen(s) read from ISPF panel definitions`);
      ctx.ispf = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.ispf?.length) return;
      await ctx.write("ISPF.md", render(ctx.ispf));
      log.info("ISPF.md written");
    });
  },
};

function render(files) {
  const out = [
    "# ISPF Dialog Manager panels",
    "",
    "Every `.panel` file this run read: each panel's own captions and",
    "fields, read in reading order (top to bottom, left to right) exactly",
    "as the terminal laid them out, and every gap. ISPF names no button, no",
    "event and no navigation anywhere in a panel body, since a screen is",
    "driven by PF-keys and the panel's own dialog logic, which this reader",
    "never reads for meaning, so no output is ever produced here. An",
    "attribute character with no resolvable kind, and a field position",
    "that introduces no variable name, are each named rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.panels.length) { out.push("Not read as a screen.", ""); continue; }
    for (const p of f.panels) {
      out.push(`### ${p.title}`, "");
      out.push(`${p.fields.length} field(s), 0 output(s).`, "");
      if (p.notes.length) out.push(...p.notes.map((n) => `- ${n}`), "");
    }
  }
  return out.join("\n") + "\n";
}
