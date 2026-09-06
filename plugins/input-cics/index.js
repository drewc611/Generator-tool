import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseCics } from "./parse.js";
import { lowerCics } from "./lower.js";

/**
 * Reads IBM CICS BMS (Basic Mapping Support) `.bms` map definitions, the
 * assembler macro source that has laid out mainframe 3270 "green screen"
 * terminal screens since the 1970s. A `DFHMSD` mapset can open more than one
 * `DFHMDI` map, and each map is its own physical screen, so it becomes its
 * own screen here the way input-storyboard's own multi-scene storyboards do,
 * one per `DFHMDI` rather than one per file.
 *
 * BMS names no button, no event and no navigation at all: a 3270 screen is
 * driven by whichever program processes the AID key that terminated the
 * operator's input, which this format never states, so no screen this
 * reader produces ever carries an output. An unlabeled UNPROT field, a
 * GRPNAME grouping and an INITIAL value that is not a clean quoted literal
 * are each named through ctx.unverified rather than guessed. CICS.md
 * gathers every file's own maps and gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-cics",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.bms$/i.test(f.rel));
      if (!files.length) return log.debug("no CICS BMS .bms files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "cics-map"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, maps: [] }); continue; }

        const { mapsets, problems } = parseCics(text);
        for (const p of problems) ctx.unverified(`${rel}: ${p}`);
        if (!mapsets.length) { ctx.unverified(`${rel}: no DFHMSD mapset found; nothing was read.`); seen.push({ rel, maps: [] }); continue; }

        const fileMaps = [];
        for (const mapset of mapsets) {
          if (!mapset.maps.length) { ctx.unverified(`${rel}: mapset \`${mapset.label ?? "(unlabeled)"}\` declares no DFHMDI map; nothing was read from it.`); continue; }
          let index = 0;
          for (const map of mapset.maps) {
            index += 1;
            const lowered = lowerCics(map, mapset.label);
            const base = lowered.stem || kebab(mapset.label ? `${mapset.label}-map-${index}` : `cics-map-${index}`);
            const selector = unique(base);
            ctx.screens.push({
              selector,
              className: pascal(selector),
              file: rel,
              // A field is the screen's own state, bound with ng-model, not something the port hands it.
              inputs: readInputs(lowered.template, { skip: lowered.fields }),
              outputs: [],
              template: lowered.template,
              templateOrigin: `a CICS BMS .bms map definition, read structurally from ${rel}`,
              usesNgIf: false,
              usesNgFor: lowered.usesNgFor,
              usesTwoWay: lowered.usesTwoWay,
              rxjs: [],
              readBy: "cics",
              title: lowered.title || pascal(selector),
            });
            screens += 1;
            for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
            fileMaps.push({ mapsetLabel: mapset.label, lowered });
          }
        }
        seen.push({ rel, maps: fileMaps });
      }

      if (!seen.length) return log.debug("no CICS BMS .bms files read");
      log.info(`${files.length} CICS BMS .bms file(s): ${screens} screen(s) read from BMS map definitions`);
      ctx.cics = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.cics?.length) return;
      await ctx.write("CICS.md", render(ctx.cics));
      log.info("CICS.md written");
    });
  },
};

function render(files) {
  const out = [
    "# CICS BMS maps",
    "",
    "Every `.bms` file this run read: each mapset's own maps, one screen per",
    "map, and every gap. BMS names no button, no event and no navigation at",
    "all, since a 3270 screen is driven by whichever program processes the",
    "key that terminated the operator's input, which this format never",
    "states, so no output is ever produced here. An unlabeled field left open",
    "for typing, a grouping tag CICS itself uses, and an initial value that",
    "is not a clean quoted literal are each named rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.maps.length) { out.push("Not read as a screen.", ""); continue; }
    for (const m of f.maps) {
      out.push(`### ${m.lowered.title}`, "");
      out.push(`${m.lowered.fields.length} field(s), 0 output(s).`, "");
      if (m.lowered.notes.length) out.push(...m.lowered.notes.map((n) => `- ${n}`), "");
    }
  }
  return out.join("\n") + "\n";
}
