import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { parseForm } from "./parse.js";
import { lowerForm } from "./lower.js";

/**
 * Reads NetBeans' own Matisse GUI Builder `.form` files: the structured XML
 * sidecar NetBeans writes beside every JFrame, JDialog or JPanel subclass
 * whose GUI it built, and edits directly whenever a person drags a control
 * or changes a property in the builder. It is a more reliable source than
 * input-swing's own read of the generated `initComponents()` method in the
 * paired `.java` file: a property value, a layout constraint and an event
 * handler's real method name are each an explicit XML attribute here, never
 * reverse engineered from imperative statements a person never wrote by
 * hand. A `<Component class="...">` under `<SubComponents>` is a real
 * component boundary somebody drew with the builder, so this reader
 * produces a screen the way input-qt and input-swing already do, laid out
 * in document order.
 *
 * What has no honest equivalent, a property whose value this reader does
 * not interpret, a combo box with no inline `<StringArray>` model, a button
 * with no `actionPerformed` wired, a widget class not in this reader's
 * vocabulary, is named through ctx.unverified rather than guessed at.
 * NETBEANSFORM.md gathers every file's own gaps in one place.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A class name's humps as hyphens: LoginForm is login-form, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

export default {
  name: "input-netbeansform",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.form$/i.test(f.rel));
      if (!files.length) return log.debug("no NetBeans .form files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base || "netbeansform-screen"; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };

      let screens = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const text = await readFile(file.path, "utf8").catch(() => null);
        if (text === null) { ctx.unverified(`${rel}: unreadable; nothing was read from it.`); seen.push({ rel, lowered: null, className: null, notes: [] }); continue; }

        const formEl = parseForm(text);
        if (!formEl) { ctx.unverified(`${rel}: no <Form> root element; nothing was read.`); seen.push({ rel, lowered: null, className: null, notes: [] }); continue; }

        const structural = [];
        const lowered = lowerForm(formEl, (n) => structural.push(n));
        if (!lowered) {
          for (const n of structural) ctx.unverified(`${rel}: ${n}`);
          seen.push({ rel, lowered: null, className: null, notes: structural });
          continue;
        }

        // A .form file is always named identically to the .java class it sits beside.
        const stem = rel.replace(/^.*\//, "").replace(/\.form$/i, "");
        const selector = unique(kebabClass(stem));
        const className = pascal(selector);
        ctx.screens.push({
          selector,
          className,
          file: rel,
          // A field is the screen's own state, not something it is handed.
          inputs: readInputs(lowered.template, { skip: lowered.fields }),
          outputs: lowered.outputs,
          template: lowered.template,
          templateOrigin: `a NetBeans GUI Builder .form file, read structurally from ${rel}`,
          usesNgIf: false,
          usesNgFor: lowered.usesNgFor,
          usesTwoWay: lowered.usesTwoWay,
          rxjs: [],
          readBy: "netbeansform",
          title: stem,
        });
        screens += 1;
        for (const n of lowered.notes) ctx.unverified(`${rel}: ${n}`);
        seen.push({ rel, lowered, className, notes: lowered.notes });
      }

      if (!seen.length) return log.debug("no NetBeans .form files read");
      log.info(`${files.length} .form file(s): ${screens} screen(s) read from NetBeans GUI Builder forms`);
      ctx.netbeansform = seen;
    });

    on("emit", async (ctx) => {
      if (!ctx.netbeansform?.length) return;
      await ctx.write("NETBEANSFORM.md", render(ctx.netbeansform));
      log.info("NETBEANSFORM.md written");
    });
  },
};

function render(files) {
  const out = [
    "# NetBeans GUI Builder forms",
    "",
    "Every `.form` file this run read: NetBeans' own structured XML sidecar for a Matisse-built JFrame, JDialog or JPanel, more reliable to read than the generated Java beside it because a property value, a layout constraint and an event handler's real method name are explicit XML here rather than buried in imperative code. An opaque property, a combo box with no inline StringArray model, a button with no actionPerformed wired and a widget class not in this reader's vocabulary are each named here rather than guessed.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    if (!f.lowered) { out.push("Not read as a screen.", ""); if (f.notes.length) out.push(...f.notes.map((n) => `- ${n}`), ""); continue; }
    out.push(`Read as \`${f.className}\`, ${f.lowered.fields.length} field(s), ${f.lowered.outputs.length} output(s).`, "");
    if (f.notes.length) out.push(...f.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}
