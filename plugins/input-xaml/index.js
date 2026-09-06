import { readFile } from "node:fs/promises";
import { readInputs } from "../dsp-ir/text.js";
import { lowerXaml } from "./lower.js";

/**
 * Reads WPF, UWP, Xamarin.Forms and .NET MAUI XAML as the legacy desktop
 * front end it is. Every Window, Page, UserControl and ContentPage becomes a
 * screen on the shared dialect through ./lower.js, so a desktop app from 2008
 * comes out as the same React, Vue and Svelte every other reader produces; a
 * ResourceDictionary or an App.xaml is named as not a screen. Code behind is
 * never read: a Click or a Command is an output event, every other handler is
 * a behaviour named for the port to supply, and a value is never printed
 * except as the caption a person saw. LAYOUT.md carries the panel tree with
 * each Grid's rows and columns, the cell each control sat in and every
 * binding as written, so the layout the port does not reproduce is on record.
 */

export default {
  name: "input-xaml",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const layouts = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.xaml$/i.test(f.rel));
      if (!files.length) return log.debug("no XAML");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };
      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); continue; }
        const notes = [];
        const { screen, layout } = lowerXaml(text, rel, (n) => { if (!notes.includes(n)) notes.push(n); });
        for (const n of notes) ctx.unverified(n);
        layouts.push(...layout);
        if (!screen) continue;
        const { fields, ...rest } = screen;
        // A field is the screen's own state, not something it is handed; a dotted model path names the view model the port is handed.
        ctx.screens.push({ ...rest, selector: unique(screen.selector), inputs: readInputs(screen.template, { skip: fields }) });
        screens += 1;
      }
      log.info(`${files.length} XAML file(s): ${screens} screen(s) read`);
    });

    on("emit", async (ctx) => {
      if (!layouts.length) return;
      const head = [
        "# Layout", "",
        "Every XAML file read, as the panel tree it declares: each panel with its kind (a Grid with its rows and columns), each control with its name, the cell it sat in and the bindings it carries as written. The port lays the controls out in document order, a Grid's by row then column and a Canvas's by top then left; this is the layout the original drew.", "",
      ];
      await ctx.write("LAYOUT.md", [...head, ...layouts].join("\n"));
      log.info("LAYOUT.md written");
    });
  },
};
