import { readFile } from "node:fs/promises";
import { buildIr } from "../dsp-ir/ir.js";

/**
 * What the legacy app declares and never uses.
 *
 * A port is a chance to carry less across, and it is the only moment anybody
 * has a reason to read every template and every stylesheet at once. Carried
 * blindly, a dead input stays dead for another decade and a dead rule keeps
 * being paid for on every page load.
 *
 * Everything here is a candidate, never a verdict, and nothing is deleted. A
 * class name can be assembled at runtime and a property can be read by
 * something this never sees, so the report says what was searched and what
 * would make the answer wrong. A confident wrong deletion is worse than a list.
 */

const CLASS_RULE = /\.(-?[_a-zA-Z][\w-]*)(?=[^{}]*\{)/g;
const STYLESHEET = /\.(css|scss|sass|less)$/;

/** Class names the templates ask for, by any route the IR can see. */
export function classesUsed(ir) {
  const used = new Set();
  const dynamic = [];

  const walk = (node) => {
    if (!node) return;
    if (node.kind === "element") {
      for (const c of node.classes) {
        if (c.kind === "literal") for (const name of String(c.value).split(/\s+/).filter(Boolean)) used.add(name);
        else if (c.kind === "conditional") used.add(c.name);
        // An expression produces names this cannot read. It is recorded so the
        // report can say the search was incomplete rather than imply it was not.
        else if (c.kind === "expression") dynamic.push(c.expression);
      }
    }
    (node.children ?? []).forEach(walk);
  };

  walk(ir.root);
  return { used, dynamic };
}

export function findDeadClasses(declared, used, extraText) {
  return [...declared]
    .filter((name) => !used.has(name))
    // A name that appears anywhere in the source at all is being built by hand.
    .filter((name) => !new RegExp(`["'\`\\s.]${name}(?=["'\`\\s.]|$)`).test(extraText))
    .sort();
}

export default {
  name: "dsp-deadcode",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const findings = { inputs: [], classes: [], dynamic: [] };

      /* --------------------------------------------- inputs nothing reads */

      for (const screen of ctx.screens) {
        if (!screen.inputs?.length) continue;
        const ir = screen.template ? (screen.ir ?? buildIr(screen.template)) : null;
        const readInTemplate = new Set([...(ir?.reads ?? []), ...(ir?.models ?? []).map((m) => m.split(".")[0])]);

        const file = ctx.sources.files.find((f) => f.rel === screen.file);
        const source = file ? await readFile(file.path, "utf8").catch(() => "") : "";

        for (const input of screen.inputs) {
          if (readInTemplate.has(input)) continue;
          // The declaration itself always matches, so one occurrence is none.
          const uses = (source.match(new RegExp(`\\b${input}\\b`, "g")) ?? []).length;
          if (uses > 1) continue;
          findings.inputs.push({ screen: screen.selector, name: input, file: screen.file });
        }
      }

      /* ----------------------------------------- rules nothing asks for */

      const sheets = ctx.sources.files.filter((f) => STYLESHEET.test(f.rel));
      const declared = new Map();
      for (const sheet of sheets) {
        const text = await readFile(sheet.path, "utf8").catch(() => "");
        for (const m of text.matchAll(CLASS_RULE)) if (!declared.has(m[1])) declared.set(m[1], sheet.rel);
      }

      if (declared.size) {
        const used = new Set();
        for (const screen of ctx.screens) {
          if (!screen.template) continue;
          const found = classesUsed(screen.ir ?? buildIr(screen.template));
          for (const name of found.used) used.add(name);
          findings.dynamic.push(...found.dynamic);
        }

        // Markup and scripts outside a component template can name a class too.
        const others = ctx.sources.files.filter((f) => /\.(html?|js|ts|jsx|tsx|vue)$/.test(f.rel));
        const extra = (await Promise.all(others.map((f) => readFile(f.path, "utf8").catch(() => "")))).join("\n");

        for (const name of findDeadClasses(declared.keys(), used, extra)) {
          findings.classes.push({ name, file: declared.get(name) });
        }
      }

      const total = findings.inputs.length + findings.classes.length;
      if (!total) return log.debug("nothing declared and unused");

      ctx.deadcode = findings;
      log.info(`${findings.inputs.length} unused input(s), ${findings.classes.length} unused rule(s)`);
      ctx.unverified(
        `${total} declaration(s) appear to be unused and are listed in DEAD_CODE.md. They are candidates, ` +
        `not conclusions: portamp searched the templates and the source it was given, and nothing else. ` +
        `Confirm each one before deleting it.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.deadcode) return;
      await ctx.write("DEAD_CODE.md", render(ctx.deadcode));
    });
  },
};

function render({ inputs, classes, dynamic }) {
  const section = (title, rows, head) =>
    rows.length ? `\n## ${title}\n\n| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n${rows.join("\n")}\n` : "";

  return `# Declared and never used

Candidates, not conclusions. Nothing here has been removed.

portamp searched every template it could parse and every source file it was
given. It cannot see a name that is assembled at runtime, referenced from a
system outside this tree, or read by a test. Check each one before acting.
${section(
    "Inputs no template and no class body reads",
    inputs.map((i) => `| \`${i.name}\` | \`<${i.screen}>\` | ${i.file} |`),
    ["input", "component", "file"]
  )}${section(
    "Style rules nothing asks for",
    classes.map((c) => `| \`.${c.name}\` | ${c.file} |`),
    ["rule", "stylesheet"]
  )}${dynamic.length ? `
## Why this list may be short

${dynamic.length} class binding(s) build their names from an expression, so the
rules they reach cannot be read from the markup. Any rule one of these produces
would look unused here and is not:

${[...new Set(dynamic)].map((d) => `- \`${d}\``).join("\n")}
` : ""}`;
}
