/**
 * A proposal for where state should live in the port, argued from what each
 * screen actually reads and writes. The rule is the boring one: state stays
 * local until a second screen needs it. Every promotion in this report names
 * the screens that force it, so the premise can be argued with.
 */

import { translate } from "../output-react/template.js";

export default {
  name: "dsp-state",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", (ctx) => {
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
      if (!ctx.stateShape) return;
      const { perScreen, shared, local } = ctx.stateShape;
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
