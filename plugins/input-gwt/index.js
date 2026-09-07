import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { scanJava } from "./java.js";
import { lowerUiBinder } from "./lower.js";

/**
 * Reads Google Web Toolkit's UiBinder, the declarative XML UI layer GWT apps
 * used from roughly 2007 through the mid 2010s. A view is two files together:
 * a `.ui.xml` widget tree, and a paired `.java` class whose `@UiField`
 * fields bind the widgets and whose `@UiHandler` methods wire behaviour, the
 * same split input-winforms already reads between a designer file and its
 * code behind. The widget tree is lowered onto the AngularJS attribute
 * dialect the rest of the tool already reads (ng-model, ng-click), so
 * detectDialect picks it up and the translator and every emitter treat a
 * UiBinder screen exactly as they treat an Angular one. The paired .java
 * file is read only far enough to say which button has a `@UiHandler` and
 * how long it runs; the method's own body is never read, the same restraint
 * input-vb6 keeps for a wired Sub and input-exe keeps for a dialog button.
 */

const kebab = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default {
  name: "input-gwt",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.ui\.xml$/i.test(f.rel));
      if (!files.length) return log.debug("no GWT UiBinder views");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "gwt-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const xml = await readFile(file.path, "utf8").catch(() => null);
        if (xml === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, hasJava: false, notes: [], screen: null }); continue; }

        // The paired .java file sits beside the .ui.xml under the same base name;
        // it is read directly by that name, the same way input-winforms reaches
        // for the .resx beside a designer file rather than through the scan.
        const javaName = basename(rel).replace(/\.ui\.xml$/i, ".java");
        const javaText = await readFile(join(dirname(file.path), javaName), "utf8").catch(() => null);
        let handlers = new Map();
        if (javaText === null) {
          ctx.unverified(`${rel}: no paired ${javaName} beside it; the screen is still read from the widget tree, but no @UiHandler can be matched to a button.`);
        } else {
          const scanned = scanJava(javaText);
          handlers = new Map(scanned.handlers.map((h) => [h.field, h]));
        }

        const notes = [];
        const { screen } = lowerUiBinder(xml, rel, handlers, (n) => { if (!notes.includes(n)) notes.push(n); });
        for (const n of notes) ctx.unverified(`${rel}: ${n}`);
        if (!screen) { seen.push({ rel, hasJava: javaText !== null, notes, screen: null }); continue; }

        const name = basename(rel).replace(/\.ui\.xml$/i, "");
        const selector = unique(`gwt-${kebab(name)}`);
        ctx.screens.push({
          selector, className: pascal(selector), file: rel,
          // A field is the widget's own state, not something the port is handed.
          inputs: readInputs(screen.template, { skip: screen.fields }),
          outputs: screen.outputs,
          template: screen.template,
          templateOrigin: `a GWT UiBinder view, read structurally from ${rel}`,
          usesNgIf: false, usesNgFor: false, usesTwoWay: screen.fields.length > 0, rxjs: [],
          readBy: "gwt", title: name,
        });
        screens += 1;
        seen.push({ rel, hasJava: javaText !== null, notes, screen });
      }
      if (!seen.length) return;
      log.info(`${seen.length} UiBinder view(s), ${screens} screen(s) read`);
      ctx.gwt = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.gwt?.length) return;
      await ctx.write("GWT.md", render(ctx.gwt));
      log.info("GWT.md written");
    });
  },
};

function render(files) {
  const out = [
    "# GWT UiBinder views", "",
    "Every .ui.xml this run read: the widget tree it declared and what it",
    "became. A template expression in braces, a widget with no vocabulary",
    "entry, and a button whose @UiHandler could not be matched are each",
    "named rather than approximated.", "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.screen) {
      out.push("Not read as a screen.", "");
      if (f.notes.length) out.push(...f.notes.map((n) => `- ${n}`), "");
      continue;
    }
    out.push(`Lowered to a screen with ${f.screen.fields.length} field(s) and ${f.screen.outputs.length} output(s).`, "");
    out.push(f.hasJava ? "Its paired .java file was read for @UiHandler methods and @UiField fields." : "No paired .java file was found beside it.", "");
    if (f.notes.length) out.push(...f.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
