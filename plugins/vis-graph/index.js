import { pascal } from "../dsp-ir/emit.js";

/**
 * The shape of the port, drawn.
 *
 * A run knows which screens it found, which screens compose which others, and
 * which endpoints each screen calls. Held as prose across a dozen reports,
 * that structure is hard to see; as one graph it is a glance. This draws it in
 * Mermaid, which needs no dependency and renders where the reports are read,
 * so the port's architecture is a picture, not a paragraph.
 */

const nodeId = (prefix, name) => `${prefix}_${String(name).replace(/[^\w]/g, "_")}`;
const label = (text) => String(text).replace(/"/g, "'").replace(/\s+/g, " ").trim();

export function buildGraph(screens, calls) {
  const known = new Map(screens.map((s) => [s.selector.toLowerCase(), s]));
  const composition = [];
  const endpoints = new Map();
  const screenEndpoints = [];

  for (const screen of screens) {
    // A tag in the template naming another screen is a composition edge, the
    // same reference every emitter resolves to a child component.
    if (screen.template) {
      for (const other of screens) {
        if (other === screen) continue;
        if (new RegExp(`<${other.selector}(?=[\\s>/])`, "i").test(screen.template)) {
          composition.push([screen.selector, other.selector]);
        }
      }
    }
  }

  // A screen calls an endpoint when a recorded call came from the same file.
  for (const call of calls ?? []) {
    const path = call.path;
    if (!path) continue;
    if (!endpoints.has(path)) endpoints.set(path, `E${endpoints.size + 1}`);
    const owner = screens.find((s) => s.file && s.file === call.file);
    if (owner) screenEndpoints.push([owner.selector, path]);
  }

  return { known, composition, endpoints, screenEndpoints };
}

export function toMermaid(screens, calls) {
  const { composition, endpoints, screenEndpoints } = buildGraph(screens, calls);
  const lines = ["flowchart LR"];

  if (screens.length) {
    lines.push("  subgraph screens");
    for (const s of screens) lines.push(`    ${nodeId("S", s.selector)}["${label(s.selector)}"]`);
    lines.push("  end");
  }
  if (endpoints.size) {
    lines.push("  subgraph endpoints");
    for (const [path, id] of endpoints) lines.push(`    ${id}(["${label(path)}"])`);
    lines.push("  end");
  }
  const seen = new Set();
  for (const [from, to] of composition) {
    const edge = `${nodeId("S", from)} --> ${nodeId("S", to)}`;
    if (!seen.has(edge)) { seen.add(edge); lines.push(`  ${edge}`); }
  }
  for (const [from, path] of screenEndpoints) {
    const edge = `${nodeId("S", from)} -.-> ${endpoints.get(path)}`;
    if (!seen.has(edge)) { seen.add(edge); lines.push(`  ${edge}`); }
  }
  return lines.join("\n");
}

export default {
  name: "vis-graph",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (!ctx.screens.length) return log.debug("no screens to graph");
      const mermaid = toMermaid(ctx.screens, ctx.api?.calls ?? []);
      ctx.graph = mermaid;
      const comps = (mermaid.match(/ --> /g) ?? []).length;
      const wires = (mermaid.match(/ -\.-> /g) ?? []).length;

      await ctx.write("GRAPH.md", [
        "# The shape of the port",
        "",
        "Every screen the run found, which screens compose which others (a solid",
        "arrow), and which endpoints each screen calls (a dotted one). This is",
        "the architecture the reports describe in prose, drawn once.",
        "",
        "```mermaid",
        mermaid,
        "```",
        "",
        `Screens: ${ctx.screens.length}. Composition edges: ${comps}. Endpoint calls: ${wires}.`,
        "",
        "A composition edge is a tag in one screen naming another, the same",
        "reference every target resolves to a child component. An endpoint edge",
        "is a call recorded from the screen's own file; a call the reader could",
        "not attribute to a screen is in the endpoint map, not on an arrow here.",
        "",
      ].join("\n"));
      log.info(`graph drawn: ${ctx.screens.length} screen(s), ${comps} composition edge(s), ${wires} endpoint edge(s)`);
    });
  },
};
