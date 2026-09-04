/**
 * Screens that are nearly the same screen. Legacy apps grow by copy and
 * paste, and the copies drift; a port is the one moment the duplicates can
 * become one component with two configurations. Similarity is measured on
 * the markup's skeleton, tags and attribute names with the text stripped,
 * so two lists that differ only in their words still match.
 *
 * Proposals, never results: two screens can look identical and mean
 * different things, and only a person knows which.
 */

export function skeleton(html) {
  const shingles = [];
  // The tag boundary is one linear [^>]*, never a nested repetition: a
  // hostile template must not be able to make similarity scoring quadratic.
  for (const m of String(html ?? "").matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
    // The value is consumed with the name so a word inside it is never
    // mistaken for an attribute of its own.
    const attrs = [...m[2].matchAll(/([\w:.()\[\]@*#-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g)].map((a) => a[1]).sort();
    shingles.push(`${m[1].toLowerCase()}[${attrs.join(",")}]`);
  }
  return shingles;
}

export function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const grams = (list) => {
    const set = new Set();
    for (let i = 0; i < list.length - 1; i += 1) set.add(`${list[i]}→${list[i + 1]}`);
    if (list.length === 1) set.add(list[0]);
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared += 1;
  const union = ga.size + gb.size - shared;
  return union ? Math.round((shared / union) * 100) / 100 : 0;
}

export default {
  name: "dsp-duplication",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", (ctx) => {
      const screens = ctx.screens.filter((s) => s.template);
      if (screens.length < 2) return log.debug("nothing to compare");

      const skeletons = screens.map((s) => ({ screen: s, bones: skeleton(s.template) }));
      const pairs = [];
      for (let i = 0; i < skeletons.length; i += 1) {
        for (let j = i + 1; j < skeletons.length; j += 1) {
          const score = similarity(skeletons[i].bones, skeletons[j].bones);
          if (score >= 0.6) pairs.push({ a: skeletons[i].screen, b: skeletons[j].screen, score });
        }
      }
      if (!pairs.length) return log.debug("no near duplicates");
      ctx.duplication = pairs.sort((x, y) => y.score - x.score);
      log.info(`${pairs.length} near duplicate pair(s)`);
    });

    on("emit", async (ctx) => {
      if (!ctx.duplication?.length) return;
      const lines = [
        "# Screens that are nearly the same screen",
        "",
        "Similarity of the markup's skeleton: tags and attribute names, text",
        "stripped. These are consolidation proposals and not results; a person",
        "decides whether two lookalikes mean the same thing.",
        "",
      ];
      for (const { a, b, score } of ctx.duplication) {
        lines.push(`- \`${a.selector}\` and \`${b.selector}\`: ${Math.round(score * 100)}% shared structure.`);
        lines.push(`  - From \`${a.file}\` and \`${b.file}\`. If they are one component, port it once and pass the difference in as props.`);
      }
      lines.push("");
      await ctx.write("DUPLICATION.md", lines.join("\n"));
    });
  },
};
