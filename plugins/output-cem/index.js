import { translate } from "../output-react/template.js";

/**
 * A custom elements manifest for the elements the run can emit. Editors and
 * catalogs read this format; writing it makes the ported elements show up in
 * autocomplete with their attributes and events instead of as unknown tags.
 * Everything in it is read from the same translation the printers use, so it
 * can only claim what the port actually has.
 */

const pascal = (sel) =>
  String(sel).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

export function manifestFor(screens) {
  const modules = [];
  for (const screen of screens) {
    const name = pascal(screen.selector) || "Screen";
    const tag = screen.selector.includes("-") ? screen.selector : `ported-${screen.selector}`;
    const result = screen.template ? (() => { try { return translate(screen.template, { indent: 0 }); } catch { return null; } })() : null;
    const attributes = [...new Set([...screen.inputs, ...(result?.reads ?? []), "loading", "error"])].map((prop) => ({
      name: prop.replace(/([A-Z])/g, "-$1").toLowerCase(),
      fieldName: prop,
    }));
    const events = [...new Set([...screen.outputs, "retry"])].map((e) => ({
      name: e,
      type: { text: "CustomEvent" },
    }));
    modules.push({
      kind: "javascript-module",
      path: `src/elements/${name}.element.js`,
      declarations: [
        {
          kind: "class",
          name: `${name}Element`,
          tagName: tag,
          customElement: true,
          summary: `Ported from ${screen.file} by portamp.`,
          attributes,
          events,
          members: (result?.models ?? []).map((m) => ({
            kind: "field",
            name: m.split(".").pop().replace(/[^\w$]/g, ""),
            description: "form state carried by the element",
          })),
        },
      ],
      exports: [{ kind: "custom-element-definition", name: tag }],
    });
  }
  return { schemaVersion: "1.0.0", readme: "", modules };
}

export default {
  name: "output-cem",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.cem) return log.debug("not requested");
      if (!ctx.screens.length) return log.debug("no screens");
      const manifest = manifestFor(ctx.screens);
      await ctx.write("custom-elements.json", JSON.stringify(manifest, null, 2) + "\n");
      log.info(`${manifest.modules.length} element(s) described`);
    });
  },
};
