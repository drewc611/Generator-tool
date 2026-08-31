import { readFile } from "node:fs/promises";
import { buildIr, DIALECTS } from "../dsp-ir/ir.js";

/**
 * The visibility rules, collected into the table nobody has ever seen whole.
 *
 * Role checks in a legacy front end are scattered: an ngIf here, a hidden
 * class there, a controller branch somewhere else. Each was added for a
 * reason and the sum is the app's actual permission model, which exists in
 * full nowhere, including in whoever owns it. A port is the one time all of
 * it passes through one place, so this writes it down.
 *
 * Front end checks are UX, not security, and the report says so: anything
 * these conditions hide is still one devtools away.
 */

const ROLE = /\b(?:is|has|can)(?:[A-Z][\w$]*)?(?:Admin|Role|Permission|Access|Manager|Owner|Editor|Viewer)\b|\brole\s*(?:===?|!==?|\.includes|\.indexOf)|\bpermissions?\s*[.[]|\bcan[A-Z][\w$]*\b|\bisAdmin\b|\bhasRole\b|\bacl\b/;

export function conditionsOf(ir) {
  const found = [];
  const walk = (node) => {
    if (!node) return;
    if (node.kind === "when" && ROLE.test(node.test)) {
      const summary = node.children.map(describe).filter(Boolean).slice(0, 2).join(", ");
      found.push({ condition: node.test, guards: summary || "a region of the screen" });
    }
    (node.children ?? []).forEach(walk);
  };
  walk(ir.root);
  return found;
}

function describe(node) {
  if (!node) return null;
  if (node.kind === "element" && node.tag) {
    const text = (node.children ?? []).map((c) => c.kind === "text" ? c.parts.map((p) => p.literal ?? "").join("") : "").join(" ").trim();
    return text ? `<${node.tag}> "${text.slice(0, 30)}"` : `<${node.tag}>`;
  }
  return null;
}

export function conditionsInSource(text, rel) {
  const found = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/\bif\b|\?|&&/.test(line) && ROLE.test(line)) {
      found.push({ condition: line.trim().slice(0, 90), guards: `${rel}:${i + 1}` });
    }
  });
  return found;
}

export default {
  name: "dsp-permissions",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const inTemplates = [];
      for (const screen of ctx.screens.filter((s) => s.template)) {
        const ir = screen.ir ?? buildIr(screen.template, { dialect: DIALECTS[screen.dialect] });
        for (const c of conditionsOf(ir)) inTemplates.push({ ...c, screen: screen.selector });
      }
      const inSource = [];
      for (const file of ctx.sources.files.filter((f) => /\.(js|ts|vue)$/.test(f.rel) && !/\.min\./.test(f.rel))) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) inSource.push(...conditionsInSource(text, file.rel));
      }
      if (!inTemplates.length && !inSource.length) return log.debug("no role checks found");
      ctx.permissions = { inTemplates, inSource };
      log.info(`${inTemplates.length} template check(s), ${inSource.length} in code`);
    });

    on("emit", async (ctx) => {
      if (!ctx.permissions) return;
      const { inTemplates, inSource } = ctx.permissions;
      await ctx.write("PERMISSIONS.md", `# The permission model, assembled

Role checks in the old app are scattered across templates and code. Each was
added for a reason, and the sum below is the app's actual permission model,
which has never existed in one place until now, including for whoever owns it.

## What the templates hide and show

| screen | when | it controls |
| --- | --- | --- |
${inTemplates.map((c) => `| \`<${c.screen}>\` | \`${c.condition}\` | ${c.guards} |`).join("\n") || "| — | — | nothing found |"}

## Checks in code

${inSource.map((c) => `- \`${c.guards}\`: \`${c.condition}\``).join("\n") || "None found."}

---

Two things to hold while reading. Every check here is front end, which is UX
and not security: anything these conditions hide is one devtools away, and the
server has to be enforcing the real rule. And a check this list does not have
is not proven absent; this is what the given source shows, whole.
`);
    });
  },
};
