/**
 * A proposal for where state should live in the port, argued from what each
 * screen actually reads and writes. The rule is the boring one: state stays
 * local until a second screen needs it. Every promotion in this report names
 * the screens that force it, so the premise can be argued with.
 */

import { readFile } from "node:fs/promises";
import { translate } from "../output-react/template.js";

/**
 * The state that survives a reload: every localStorage and sessionStorage
 * key the scripts touch, and whether cookies are written by hand. A port
 * that renames a key silently logs everybody out or forgets every draft, so
 * the keys are a contract and this lists them. Key names only; no value is
 * ever read or reproduced here.
 */
export function persistedKeys(text, rel) {
  const found = [];
  for (const m of text.matchAll(/(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    found.push({ store: m[1], op: m[2], key: m[3], file: rel });
  }
  for (const m of text.matchAll(/(localStorage|sessionStorage)\s*\[\s*['"`]([^'"`]+)['"`]\s*\]/g)) {
    found.push({ store: m[1], op: "indexed", key: m[2], file: rel });
  }
  if (/document\.cookie\s*=/.test(text)) found.push({ store: "cookie", op: "setItem", key: "(written by hand)", file: rel });
  return found;
}

export default {
  name: "dsp-state",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const persisted = [];
      for (const file of ctx.sources.files.filter((f) => /\.(js|ts|vue|html?)$/.test(f.rel) && !/\.min\./.test(f.rel))) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) persisted.push(...persistedKeys(text, file.rel));
      }
      if (persisted.length) {
        const keys = new Map();
        for (const p of persisted) {
          const id = `${p.store}:${p.key}`;
          if (!keys.has(id)) keys.set(id, { ...p, ops: new Set(), files: new Set() });
          keys.get(id).ops.add(p.op);
          keys.get(id).files.add(p.file);
        }
        ctx.persistedState = [...keys.values()].map((k) => ({ ...k, ops: [...k.ops], files: [...k.files] }));
        ctx.unverified(
          `${ctx.persistedState.length} storage key(s) survive a reload (${ctx.persistedState.slice(0, 3).map((k) => `\`${k.key}\``).join(", ")}${ctx.persistedState.length > 3 ? ", …" : ""}). ` +
          `Users' browsers hold these under exactly these names; a port that renames one silently drops whatever it held. STATE.md lists them.`
        );
        log.info(`${ctx.persistedState.length} persisted key(s)`);
      }
      const screens = ctx.screens.filter((s) => s.template);
      if (!screens.length) return log.debug("no screens to read");

      const perScreen = [];
      for (const s of screens) {
        try {
          const result = translate(s.template, { indent: 0 });
          perScreen.push({ screen: s.selector, reads: result.reads, models: result.models, collections: result.collections });
        } catch {
          perScreen.push({ screen: s.selector, reads: [], models: [], collections: [], unreadable: true });
        }
      }

      const usedBy = new Map();
      for (const p of perScreen) {
        for (const name of new Set([...p.reads, ...p.collections.map((c) => c.split(".")[0])])) {
          usedBy.set(name, [...(usedBy.get(name) ?? []), p.screen]);
        }
      }

      const shared = [...usedBy.entries()].filter(([, screens]) => new Set(screens).size > 1);
      const local = [...usedBy.entries()].filter(([, screens]) => new Set(screens).size === 1);
      ctx.stateShape = { perScreen, shared, local };
      log.info(`${shared.length} shared name(s), ${local.length} local`);
    });

    on("emit", async (ctx) => {
      if (!ctx.stateShape && !ctx.persistedState) return;
      const { perScreen = [], shared = [], local = [] } = ctx.stateShape ?? {};
      const lines = [
        "# Where state should live",
        "",
        "Proposed from what each screen reads. The rule: local until a second",
        "screen needs it. A name two screens read is not proof they share the",
        "value, so every promotion below names its evidence.",
        "",
        "## Shared candidates",
        "",
      ];
      if (shared.length) {
        for (const [name, screens] of shared) {
          lines.push(`- \`${name}\`: read by ${[...new Set(screens)].map((s) => `\`${s}\``).join(" and ")}. Promote only if it is the same value on both; a coincidence of naming stays local twice.`);
        }
      } else {
        lines.push("- None. No name is read by more than one screen, so nothing earns a store.");
      }
      lines.push("", "## Local state, per screen", "");
      for (const p of perScreen) {
        const owned = [
          ...p.models.map((m) => `\`${m}\` (form state)`),
          ...local.filter(([, screens]) => screens.includes(p.screen)).map(([n]) => `\`${n}\``),
        ];
        lines.push(`- \`${p.screen}\`: ${owned.length ? owned.join(", ") : "nothing readable"}${p.unreadable ? " (template could not be read)" : ""}`);
      }
      if (ctx.persistedState?.length) {
        lines.push("", "## State that survives a reload", "");
        lines.push("Users' browsers hold these keys today, under exactly these names. Rename");
        lines.push("one and the port silently drops whatever it held: a session, a draft, a");
        lines.push("preference. Keep the name, or write the migration on first load.", "");
        lines.push("| store | key | operations seen | where |");
        lines.push("| --- | --- | --- | --- |");
        for (const k of ctx.persistedState) {
          lines.push(`| ${k.store} | \`${k.key}\` | ${k.ops.join(", ")} | ${k.files.join(", ")} |`);
        }
      }
      lines.push(
        "",
        "Loading, error and empty are per fetch and always local. Nothing in this",
        "report proposes a global store; with this few shared names, a prop or a",
        "URL parameter is usually the honest container.",
        ""
      );
      await ctx.write("STATE.md", lines.join("\n"));
    });
  },
};
