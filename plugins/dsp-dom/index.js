import { buildIr, DIALECTS } from "../dsp-ir/ir.js";

/**
 * The size of the tree each screen renders. A page with thousands of nodes,
 * a parent with sixty children, or markup nested thirty levels deep costs
 * memory, style recalculation and layout on every change, and a port carries
 * the shape forward unless someone sees it. This reads each screen's IR and
 * measures the elements it renders once, how deep they nest, the widest
 * parent, and how many loops multiply the count at runtime, then holds the
 * numbers against the three thresholds Lighthouse publishes for its DOM size
 * audit: more than 1,500 nodes in total, a depth over 32, a parent with more
 * than 60 children.
 *
 * The static element count is a floor, not the runtime number: a loop over a
 * list of unknown length renders its body once per row, and the report says
 * how many loops there are and how deep they nest rather than guessing a
 * length. It measures and restructures nothing, because splitting a screen is
 * a decision about the product.
 */

// Lighthouse's published thresholds for "Avoids an excessive DOM size".
export const LIMITS = { nodes: 1500, depth: 32, children: 60 };

/** Elements rendered once, nesting depth, widest parent, loops and loop nesting, from one IR root. */
export function measure(root) {
  const out = { elements: 0, depth: 0, widest: 0, widestTag: null, loops: 0, loopDepth: 0 };
  const walk = (node, depth, inLoops) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const n of node) walk(n, depth, inLoops); return; }
    if (node.kind === "element") {
      out.elements += 1;
      if (depth + 1 > out.depth) out.depth = depth + 1;
      const kids = (node.children ?? []).filter((c) => c.kind === "element" || c.kind === "each" || c.kind === "when");
      if (kids.length > out.widest) { out.widest = kids.length; out.widestTag = node.tag; }
      walk(node.children, depth + 1, inLoops);
      return;
    }
    if (node.kind === "each") {
      out.loops += 1;
      if (inLoops + 1 > out.loopDepth) out.loopDepth = inLoops + 1;
      walk(node.children, depth, inLoops + 1);
      return;
    }
    for (const key of ["children", "branches", "then", "otherwise", "cases", "fallback", "body"]) if (node[key]) walk(node[key], depth, inLoops);
  };
  walk(root, 0, 0);
  return out;
}

export const over = (m) => [
  m.elements > LIMITS.nodes ? `${m.elements} elements rendered once, over ${LIMITS.nodes}` : null,
  m.depth > LIMITS.depth ? `nested ${m.depth} deep, over ${LIMITS.depth}` : null,
  m.widest > LIMITS.children ? `<${m.widestTag}> has ${m.widest} children, over ${LIMITS.children}` : null,
].filter(Boolean);

export default {
  name: "dsp-dom",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const screens = [];
      for (const screen of ctx.screens.filter((s) => s.template)) {
        let ir;
        try { ir = screen.ir ?? buildIr(screen.template, { dialect: DIALECTS[screen.dialect] }); } catch { continue; }
        const m = measure(ir.root);
        screens.push({ selector: screen.selector, file: screen.file, ...m, over: over(m) });
      }
      if (!screens.length) return log.debug("no screen to measure");
      const flagged = screens.filter((s) => s.over.length);
      const nested = screens.filter((s) => s.loopDepth > 1);
      ctx.dom = { screens: screens.sort((a, b) => b.elements - a.elements), flagged, nested };
      log.info(`${screens.length} screen(s) measured, ${flagged.length} over a DOM size threshold`);
      if (flagged.length) {
        ctx.unverified(
          `DOM.md names ${flagged.length} screen(s) whose rendered tree is over one of Lighthouse's DOM size thresholds ` +
          `(${flagged.map((s) => s.selector).join(", ")}); the port carries the same shape forward until someone splits it.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.dom?.flagged?.length && !ctx.dom?.nested?.length) return;
      await ctx.write("DOM.md", render(ctx.dom));
    });
  },
};

function render({ screens, flagged, nested }) {
  const rows = screens.map((s) =>
    `| \`${s.selector}\` | ${s.elements} | ${s.depth} | ${s.widest}${s.widestTag ? ` (<${s.widestTag}>)` : ""} | ${s.loops}${s.loopDepth > 1 ? ` (${s.loopDepth} deep)` : ""} | ${s.over.length ? s.over.join("; ") : "within"} |`);
  return `# The size of the tree each screen renders

Each row is one screen's markup measured from its structure: the elements it
renders once, how deep they nest, the widest parent, and the loops that
multiply the count at runtime. The thresholds are the three Lighthouse
publishes for its DOM size audit: more than ${LIMITS.nodes} nodes in total, a depth over
${LIMITS.depth}, a parent with more than ${LIMITS.children} children. The element count is a floor: a
loop renders its body once per row, and nothing here guesses how many rows.

| screen | elements (once) | depth | widest parent | loops | against the thresholds |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## Over a threshold

${flagged.length
    ? flagged.map((s) => `- \`${s.selector}\` (${s.file}): ${s.over.join("; ")}.`).join("\n")
    : "No screen renders past a threshold before its loops run."}

## Loops inside loops

${nested.length
    ? nested.map((s) => `- \`${s.selector}\`: ${s.loopDepth} loops deep, so the inner body renders once per row of every enclosing list.`).join("\n")
    : "No loop nests inside another."}

---

Nothing was restructured. Where a screen should split is a decision about the
product; this says which screens the decision is about and how large they are.
`;
}
