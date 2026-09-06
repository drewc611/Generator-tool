import { readFile } from "node:fs/promises";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * A click handler on an element the keyboard cannot reach. A <div> or <span>
 * with onclick, ng-click, @click, (click) or onClick looks like a button and
 * works like one for a mouse, and for a keyboard user it does not exist: it is
 * not in the tab order, a screen reader does not announce it as anything, and
 * Enter and Space do nothing. WCAG 2.1.1 is the rule and the fix is three
 * attributes (tabindex, a role, a key handler) or the element it should have
 * been, a <button>.
 *
 * This reads every opening tag that carries a click handler in any dialect the
 * readers know, skips the elements that are interactive by nature (a with an
 * href, button, input, select, textarea, summary, option, label) and names the
 * rest by tag, file and line with which of the three it lacks. The handler's
 * expression is never captured: it is source, and a value in it is not for a
 * report. Nothing is rewritten; which of these should become a real button is
 * a change to the markup a person makes on purpose.
 */

const CLICK = /\s(?:on[cC]lick|(?:data-)?ng-click|@click(?:\.[\w.]+)?|v-on:click(?:\.[\w.]+)?|\(click\)|on-click|x-on:click(?:\.[\w.]+)?|on:click)\s*(?:=|\()/;
const KEY = /\s(?:on[kK]ey(?:down|up|press)|(?:data-)?ng-key(?:down|up|press)|@key(?:down|up|press)(?:\.[\w.]+)?|v-on:key(?:down|up|press)|\(key(?:down|up|press)\)|on-key(?:down|up|press)|x-on:key(?:down|up|press)(?:\.[\w.]+)?|on:key(?:down|up|press))\s*(?:=|\()/;
const NATIVE = new Set(["a", "button", "input", "select", "textarea", "summary", "details", "option", "label", "area", "audio", "video"]);
const TAG = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^>"'{])*)>/g;

/** Every click target the keyboard cannot reach, with what it lacks. */
export function readKeyboard(text, rel) {
  const findings = [];
  for (const m of text.matchAll(TAG)) {
    const tag = m[1].toLowerCase();
    const attrs = ` ${m[2]}`;
    if (!CLICK.test(attrs)) continue;
    if (NATIVE.has(tag) && !(tag === "a" && !/\s(?:href|ng-href|:href|\[href\]|routerLink|\[routerLink\]|to|asp-action|asp-page)\s*=/.test(attrs))) continue;
    const lacks = [];
    if (!/\stabindex\s*=/i.test(attrs)) lacks.push("tabindex");
    if (!/\srole\s*=/i.test(attrs)) lacks.push("role");
    if (!KEY.test(attrs)) lacks.push("key handler");
    if (!lacks.length) continue;
    findings.push({ tag: tag === "a" ? "a (no href)" : tag, lacks, line: lineAt(text, m.index), file: rel });
  }
  return findings;
}

export default {
  name: "dsp-keyboard",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|shtml|php|jsp|asp|inc|hbs|handlebars|vue|svelte|jsx|tsx|marko|liquid|twig|riot|tag|xhtml)$/i.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) findings.push(...readKeyboard(text, file.rel));
      }
      const byTag = {};
      for (const f of findings) byTag[f.tag] = (byTag[f.tag] ?? 0) + 1;
      ctx.keyboard = { findings, byTag };
      if (!findings.length) return log.debug("every click target is reachable by keyboard");
      log.info(`${findings.length} click target(s) the keyboard cannot reach`);
      ctx.unverified(
        `KEYBOARD.md names ${findings.length} element(s) with a click handler that a keyboard user cannot reach or operate ` +
        `(no tabindex, no role or no key handler). Each should become a <button> or gain the three attributes; none was rewritten.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.keyboard?.findings?.length) return;
      await ctx.write("KEYBOARD.md", render(ctx.keyboard));
    });
  },
};

function render({ findings, byTag }) {
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const groups = [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([file, items]) =>
    `### \`${file}\`\n\n${items.map((f) => `- line ${f.line}: <${f.tag}> with a click handler lacks ${f.lacks.join(", ")}`).join("\n")}`);
  return `# Click targets the keyboard cannot reach

Each element below carries a click handler and is not interactive by nature,
so for a mouse it is a button and for a keyboard user it does not exist: not in
the tab order without a tabindex, announced as nothing without a role, and
deaf to Enter and Space without a key handler. WCAG 2.1.1 (Keyboard) is the
rule. The fix is the element it should have been, a \`<button>\`, or all three
attributes; a handler on a \`<div>\` is never the cheaper option once a keyboard
user arrives.

The handler's expression is not shown: it is source, and a value in it is not
for a report.

Counted by tag: ${Object.entries(byTag).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<${t}> ${n}`).join(", ")}.

${groups.join("\n\n")}

---

Nothing was rewritten. Which of these becomes a real button and which gains
the three attributes is a change to the markup a person makes on purpose.
`;
}
