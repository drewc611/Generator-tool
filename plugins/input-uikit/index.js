import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseUikit } from "./parse.js";
import { lowerUikit } from "./lower.js";

/**
 * Reads raw Objective-C UIKit view construction: pre-Storyboard era iOS code,
 * or code that deliberately avoids Interface Builder, that builds a screen
 * entirely through `[[ClassName alloc] init...]`/`[ClassName classMethod:...]`
 * message sends plus `addSubview:` calls, with no separate declarative
 * designer file at all. This is the code-only sibling of input-storyboard,
 * reading the same kind of screen a developer could equally have built as a
 * `.storyboard`, so a `UILabel`, a `UITextField`, a `UISwitch`, a `UIButton`
 * and a `UITextView` reach the same shared dialect input-storyboard already
 * lowers its own scenes onto.
 *
 * There is no separate boundary marker in raw source the way a `<scene>`
 * element is, so a whole `.m` file is one screen; a file declaring more than
 * one `@implementation` or `viewDidLoad` is read whole rather than split,
 * named rather than guessed at where one screen would end and the next
 * begin. A control's own field name comes from the variable its own
 * construction was assigned to, the same rule input-autoit already keeps
 * over its own `GUICtrlCreate*` return values; a button's wiring comes from
 * `@selector(methodName)` inside its own `addTarget:action:forControlEvents:`
 * call, Objective-C's own clean, unambiguous reference to a method name.
 *
 * What has no honest equivalent, a non-literal caption, a control never
 * assigned to a variable, a button with no wiring found, a `UITextView`'s
 * content, is named through `ctx.unverified` rather than invented. UIKIT.md
 * gathers every file's own screen and gaps.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const basenameStem = (rel) => kebab(rel.replace(/^.*\//, "").replace(/\.m$/i, ""));

export default {
  name: "input-uikit",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.m$/i.test(f.rel));
      if (!files.length) return log.debug("no Objective-C .m files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "uikit-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screenCount = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, read: null, lowered: null }); continue; }

        const read = parseUikit(text);
        if (!read.controls.length) { ctx.unverified(`${rel}: no recognised UIKit control construction found; nothing was read.`); seen.push({ rel, read, lowered: null }); continue; }

        const lowered = lowerUikit(read, basenameStem(rel));
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);

        const selector = unique(kebab(lowered.stem || "uikit-screen"));
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: rel,
          // A field is the screen's own state, bound with ng-model, not something the port hands it.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `raw Objective-C UIKit view construction, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "uikit",
          title: lowered.title || pascal(selector),
        });
        screenCount += 1;
        seen.push({ rel, read, lowered });
      }

      if (!seen.length) return log.debug("no Objective-C .m files read");
      log.info(`${files.length} Objective-C .m file(s): ${screenCount} screen(s) read from raw UIKit view construction`);
      ctx.uikit = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.uikit?.length) return;
      await ctx.write("UIKIT.md", render(ctx.uikit));
      log.info("UIKIT.md written");
    });
  },
};

function render(files) {
  const out = [
    "# Raw UIKit view construction screens",
    "",
    "Every `.m` file this run read: the one screen its `alloc`/`init` and",
    "class factory construction calls build, in construction order, the",
    "code-only sibling of an Interface Builder scene. A field's name comes",
    "from the variable its own construction was assigned to, since nothing",
    "else in raw source binds a control to a name; a button's wiring comes",
    "from the `@selector(methodName)` inside its own `addTarget:action:`",
    "`forControlEvents:` call. A non-literal caption, an unassigned control,",
    "a button with no wiring found and a UITextView's content are each",
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
