/**
 * Proposes component boundaries for an app that never declared any.
 *
 * input-jquery inventories which selector is listened on and which is written
 * to, and records which selectors each handler's own body reaches for. That
 * second signal is the one that matters: a click handler on #refresh that
 * writes #rows and #count has drawn a component around all three, in
 * everything but name.
 *
 * This clusters on that signal and emits the result as a proposal, never as a
 * result. Drawing the boundaries is a decision about the product; what a tool
 * can honestly contribute is the evidence, grouped.
 */

const pascal = (sel) =>
  String(sel).replace(/^[#.]/, "").split(/[-_\s]/).filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1)).join("") || "Widget";

/** Union find, because a cluster is exactly what handlers connect. */
function clustersOf(widgets, edges) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) { const next = parent.get(x); parent.set(x, root); x = next; }
    return root;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };

  for (const w of widgets) find(w.selector);
  for (const [a, b] of edges) union(a, b);

  const groups = new Map();
  for (const w of widgets) {
    const root = find(w.selector);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(w);
  }
  // A selector reached only from inside a handler may not be in the inventory;
  // it still belongs to the cluster it was touched by.
  for (const [a, b] of edges) {
    for (const selector of [a, b]) {
      const root = find(selector);
      if (!groups.has(root)) groups.set(root, []);
      if (!groups.get(root).some((w) => w.selector === selector)) {
        groups.get(root).push({ selector, events: [], writes: [], file: null, inferred: true });
      }
    }
  }
  return [...groups.values()];
}

export function propose(widgets, edges) {
  return clustersOf(widgets, edges)
    .map((members) => {
      const triggers = members.filter((w) => w.events.length);
      const written = members.filter((w) => w.writes.length);
      // The thing the cluster renders into is what it is *for*, so it names
      // the proposal. A control whose only write is its own value is a control,
      // not a subject.
      const weight = (w) =>
        w.writes.reduce((total, kind) => total + ({ html: 3, append: 3, prepend: 3, text: 2, val: 0 }[kind] ?? 1), 0);
      const namesake = [...written].sort((a, b) => weight(b) - weight(a))[0] ?? triggers[0] ?? members[0];
      return {
        name: pascal(namesake.selector),
        members: members.map((w) => w.selector).sort(),
        triggers: triggers.map((w) => `${w.selector} (${w.events.join(", ")})`),
        written: written.map((w) => `${w.selector} (${w.writes.join(", ")})`),
        connected: members.length > 1,
      };
    })
    .sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
}

export default {
  name: "dsp-boundaries",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      if (!ctx.widgets?.length) return log.debug("no inventory to cluster");

      const proposals = propose(ctx.widgets, ctx.widgetEdges ?? []);
      ctx.boundaries = proposals;

      const grouped = proposals.filter((p) => p.connected);
      log.info(`${proposals.length} boundary proposal(s), ${grouped.length} with more than one selector`);
      ctx.unverified(
        `BOUNDARIES.md proposes ${proposals.length} component boundary(ies) for an app that declared none. ` +
        `They are clustered by which selectors each handler actually touches, which is evidence and not a ` +
        `decision. Nothing was emitted from them; name the ones that are right and portamp can port those.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.boundaries) return;
      await ctx.write("BOUNDARIES.md", render(ctx.boundaries));
    });
  },
};

function render(proposals) {
  const sections = proposals.map((p) => `### ${p.name}${p.connected ? "" : "  (a single selector, possibly part of something larger)"}

| | |
| --- | --- |
| selectors | ${p.members.map((m) => `\`${m}\``).join(", ")} |
| triggered by | ${p.triggers.length ? p.triggers.map((t) => `\`${t}\``).join(", ") : "nothing in the scripts"} |
| writes to | ${p.written.length ? p.written.map((w) => `\`${w}\``).join(", ") : "nothing in the scripts"} |`);

  return `# Proposed component boundaries

This app never declared a component, so these are proposals and not results.
Each cluster below is a set of selectors connected by the handlers that touch
them: when the same function listens on one and writes another, those two are
already inside one component in everything but name.

What this cannot see: a connection made through shared state rather than the
DOM, markup structure (the clustering here is behavioural, not spatial), and
anything a handler does through code this reader could not follow. A cluster
may therefore be too small. It should not be too large.

${sections.join("\n\n")}

---

Nothing here is a component until a person says it is. Agree with a boundary by
naming it; then it is a decision with an owner, which is the thing this app
never had.
`;
}
