import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { fieldTypes, handlerMethods, initComponentsBody, isGenerated } from "./parse.js";
import { lowerForm } from "./lower.js";

/**
 * Reads Java Swing as a NetBeans style GUI builder leaves it: a form has no
 * separate declarative file, so the builder writes a `private void
 * initComponents() { ... }` method straight into the `.java` file, generated,
 * deterministic and bracketed by its own GEN-BEGIN/GEN-END or editor fold
 * comments, which is exactly the boundary this reader uses to find the
 * method rather than guessing where it starts and ends. Every widget is
 * declared as a class level field, instantiated in the method, configured
 * one property setter at a time, and wired to a real handler method through
 * an anonymous ActionListener, the same generation philosophy input-winforms
 * already reads from a designer file, so a form and a dialog with the same
 * controls come out as the same React.
 *
 * The GEN markers are also this reader's claim on a file: an ordinary
 * `.java` file with an initComponents method nobody's builder wrote is left
 * to whatever else reads Java, and a marked file this reader cannot lower
 * from names what it could not, rather than guessing at a handler's body or
 * a caption assembled at runtime.
 */

const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A class name's humps as hyphens: LoginForm is form-login-form, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name).replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

function swingReport(files) {
  const out = [
    "# Java Swing forms",
    "",
    "Every initComponents method a NetBeans style GUI builder wrote, found by its GEN-BEGIN/GEN-END or editor fold markers. Each widget is read from its field declaration and its instantiation in the method; a caption, an item or a column header is read only where it is a plain string literal, and a handler wired through an anonymous ActionListener is kept as existing and how long it runs, never its body.",
    "",
  ];
  for (const f of files) {
    out.push(`## ${f.className} (${f.rel})`, "");
    out.push(`${f.controlCount} widget(s) read, ${f.statementCount} statement(s) in initComponents${f.closed ? "" : " (the method never closed; what was read before the end of the file is kept)"}.`, "");
    if (f.notes.length) out.push(...f.notes.map((n) => `- ${n}`), "");
  }
  return out.join("\n") + "\n";
}

export default {
  name: "input-swing",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.java$/i.test(f.rel));
      if (!files.length) return log.debug("no Java files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };
      let skipped = 0;
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        const rel = file.rel.replace(/^\.\//, "");
        // A file with no GEN markers never had a builder write it; a plain
        // Java class with a hand rolled initComponents is not this reader's,
        // and it never claims the file away from whatever else reads Java.
        if (!text || !isGenerated(text)) { skipped += 1; continue; }
        const body = initComponentsBody(text);
        if (!body) { skipped += 1; continue; }

        const notes = [];
        const read = { statements: body.statements, fieldTypes: fieldTypes(text), handlers: handlerMethods(text) };
        const lowered = lowerForm(read, (n) => notes.push(n));
        if (!body.closed) notes.unshift("initComponents never closes; what was read before the end of the file is kept.");

        const classMatch = /\bclass\s+(\w+)/.exec(text);
        const className = classMatch?.[1] ?? rel.replace(/^.*\//, "").replace(/\.java$/i, "");
        const selector = unique(`swing-${kebabClass(className)}`);
        ctx.screens.push({
          selector, className: pascal(selector), file: rel,
          inputs: readInputs(lowered.template, { skip: lowered.fields }), outputs: lowered.outputs, template: lowered.template,
          templateOrigin: `initComponents in ${rel} (line ${body.line}), read from the generated form code`,
          usesNgIf: lowered.usesNgIf, usesNgFor: lowered.usesNgFor, usesTwoWay: lowered.usesTwoWay, rxjs: [],
          readBy: "swing", title: lowered.title || className,
        });
        for (const n of notes) ctx.unverified(`${rel}, form ${className}: ${n}`);
        seen.push({ rel, className, controlCount: lowered.controlCount, statementCount: body.statements.length, closed: body.closed, notes });
      }
      if (!seen.length) return log.debug(`${skipped} Java file(s), none a generated Swing form`);
      log.info(`${seen.length} Swing form(s) read from initComponents as screens, ${skipped} other Java file(s) left to the code`);
    });

    on("emit", async (ctx) => {
      if (!seen.length) return;
      await ctx.write("SWING.md", swingReport(seen));
      log.info("SWING.md written");
    });
  },
};
