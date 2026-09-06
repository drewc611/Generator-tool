import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { findCalls } from "./parse.js";
import { isDataClass, lowerClass } from "./lower.js";

/**
 * Reads Sencha ExtJS, the classic `Ext.define`/`Ext.create` API (3 through 6
 * style, not the newer Ext Modern or Bryntum lines). An xtype tree is a real
 * component boundary somebody drew on purpose, the way a Windows Forms
 * designer file or a VB6 form is, so this reader produces screens rather than
 * the inventory input-jquery is left with when a library declares no
 * boundaries at all.
 *
 * Every widget's config is lowered onto the AngularJS attribute dialect the
 * rest of the tool already reads (ng-model, ng-click, ng-if, ng-repeat, the
 * interpolation braces), so detectDialect picks it up and the translator and
 * every emitter treat an ExtJS screen exactly as they treat an Angular one.
 * What has no honest equivalent, a store named elsewhere, a layout other than
 * the default, a handler's own body, is named through ctx.unverified rather
 * than invented.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The last dotted segment of a class name: `MyApp.view.Login` names a screen `Login`. */
const shortName = (className) => String(className ?? "").split(".").pop();

export default {
  name: "input-extjs",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.js$/.test(f.rel) && !/\.min\.js$/.test(f.rel));
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "extjs-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      const seen = [];
      let screens = 0;
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        // A file with neither call is not this reader's; input-jquery and the
        // rest read on regardless, since nothing here claims the file away
        // from them.
        if (!/\bExt\s*\.\s*(define|create)\s*\(/.test(text)) continue;

        const { calls, problems } = findCalls(text);
        for (const p of problems) ctx.unverified(`${file.rel}: ${p}.`);
        if (!calls.length) continue;

        const read = [];
        for (const call of calls) {
          // A model, a store, a proxy: real ExtJS, and never a screen. Left
          // out of the report entirely, because a data definition with no
          // widget in it is not a gap, only a different kind of file.
          if (isDataClass(call.className)) continue;
          const extend = call.config?.kind === "object" ? call.config.entries.find((e) => e.key === "extend")?.value : null;
          if (extend?.kind === "string" && isDataClass(extend.value)) continue;

          if (!call.config) {
            // `Ext.create('MyApp.view.Login')` with nothing else is a plain
            // instantiation; whatever screen it names, its own Ext.define
            // call is where the config tree actually lives.
            continue;
          }

          const className = call.className ?? null;
          const lowered = lowerClass(call.config, shortName(className) || null);
          read.push({ call, className, lowered });
          if (!lowered.template) continue;

          const selector = unique(kebab(shortName(className) || lowered.title || "extjs-screen"));
          ctx.screens.push({
            selector,
            className: pascal(selector),
            file: file.rel,
            inputs: readInputs(lowered.template, { skip: lowered.fields }),
            outputs: lowered.outputs,
            template: lowered.template,
            templateOrigin: `${call.kind === "define" ? "an Ext.define" : "an Ext.create"} call in ${file.rel}, line ${call.line}`,
            usesNgIf: false,
            usesNgFor: lowered.usesNgFor,
            usesTwoWay: lowered.usesTwoWay,
            rxjs: [],
            readBy: "extjs",
            dialect: "angularjs",
            title: lowered.title ?? shortName(className) ?? file.rel,
          });
          screens += 1;
        }
        for (const { call, className, lowered } of read) {
          const subject = className ?? `an inline config at line ${call.line}`;
          for (const n of lowered.notes) ctx.unverified(`${file.rel}, ${subject}: ${n}`);
        }
        if (read.length) seen.push({ rel: file.rel, read });
      }

      if (!seen.length) return log.debug("no ExtJS here");
      log.info(`${seen.length} file(s), ${screens} screen(s) read from Ext.define/Ext.create`);
      ctx.extjs = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.extjs?.length) return;
      await ctx.write("EXTJS.md", render(ctx.extjs));
      log.info("EXTJS.md written");
    });
  },
};

function render(files) {
  const out = [
    "# ExtJS classes",
    "",
    "Every `Ext.define` and `Ext.create` call this run read, the xtype tree",
    "each one declared, and what it became. A tree with no xtype and no",
    "extend this reader recognises is named rather than guessed at; the same",
    "goes for a store named elsewhere, a layout other than the default, and",
    "every handler and listener, which are named as existing and never read",
    "for what they do.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    for (const { call, className, lowered } of f.read) {
      const name = className ?? `an inline config at line ${call.line}`;
      out.push(`### ${name}`, "");
      out.push(`Read from \`Ext.${call.kind}\` at line ${call.line}.`, "");
      if (lowered.template) {
        out.push(`Lowered to a screen with ${lowered.fields.length} field(s) and ${lowered.outputs.length} output(s).`, "");
      } else {
        out.push("Not lowered; nothing in it resolved to a known xtype.", "");
      }
      if (lowered.notes.length) out.push(...lowered.notes.map((n) => `- ${n}`), "");
    }
  }
  return out.join("\n") + "\n";
}
