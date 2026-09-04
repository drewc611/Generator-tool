import { buildIr } from "../dsp-ir/ir.js";
import { translate } from "../output-react/template.js";
import { lowerBody } from "../input-react/index.js";

/**
 * The port read back and held against itself.
 *
 * output-react turns a screen's template into JSX; input-react reads JSX back
 * onto the dialect. Running one after the other should return the same
 * structure it started with: the same elements, the same conditionals, loops
 * and models. Where it does, the port provably kept the shape it was given.
 * Where it drifts, the drift is named per screen rather than trusted away.
 *
 * This is the honest form of "portamp reads what it writes": not a claim, a
 * comparison that fails out loud.
 */

/** The structural facts that must survive a round trip, whitespace aside. */
export function summarize(html) {
  const counts = { elements: 0, text: 0, conditionals: 0, loops: 0, models: 0 };
  const tags = [];
  const walk = (node) => {
    if (!node) return;
    switch (node.kind) {
      case "element":
        counts.elements += 1;
        if (node.tag) tags.push(node.tag);
        if (node.model) counts.models += 1;
        break;
      case "when": counts.conditionals += 1; break;
      case "each": counts.loops += 1; break;
      case "text": {
        // Whitespace between tags is not structure; only text that carries a
        // word or an interpolation counts, so indentation never reads as drift.
        const meaningful = (node.parts ?? []).some((p) => p.expression !== undefined || /\S/.test(p.literal ?? ""));
        if (meaningful) counts.text += 1;
        break;
      }
      default: break;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(buildIr(html).root);
  return { ...counts, tags: tags.sort() };
}

/** The round trip for one template: original structure versus read-back. */
export function roundTrip(template) {
  const original = summarize(template);
  const react = translate(template, { indent: 0 }).jsx;
  const back = summarize(lowerBody(react, () => {}));
  const diffs = [];
  // Text node count is not a round trip invariant: emitting to JSX and reading
  // back re-splits text around interpolations and whitespace. The structure
  // that must survive is the elements, the conditionals, the loops and the
  // models, and the set of tags.
  for (const key of ["elements", "conditionals", "loops", "models"]) {
    if (original[key] !== back[key]) diffs.push(`${key}: ${original[key]} became ${back[key]}`);
  }
  if (original.tags.join(",") !== back.tags.join(",")) diffs.push("the set of element tags changed");
  return { original, back, diffs, held: diffs.length === 0 };
}

export default {
  name: "vis-roundtrip",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      const screens = ctx.screens.filter((s) => s.template);
      if (!screens.length) return log.debug("no templates to round trip");

      const results = screens.map((s) => ({ selector: s.selector, ...roundTrip(s.template) }));
      ctx.roundtrip = results;
      const drifted = results.filter((r) => !r.held);

      await ctx.write("ROUNDTRIP.md", render(results));
      log.info(`${results.length} screen(s) round tripped through React, ${drifted.length} drifted`);
      if (drifted.length) {
        ctx.unverified(
          `ROUNDTRIP.md read ${results.length} emitted React component(s) back onto the dialect; ${drifted.length} ` +
          `did not return the structure they came from. A drift is a place the port and its reader disagree; see the file.`
        );
      }
    });
  },
};

function render(results) {
  const rows = results.map((r) =>
    `| \`${r.selector}\` | ${r.held ? "held" : "**drifted**"} | ${r.original.elements} | ${r.original.conditionals} | ${r.original.loops} | ${r.original.models} |`);
  const drift = results.filter((r) => !r.held).map((r) =>
    `### \`${r.selector}\`\n\n${r.diffs.map((d) => `- ${d}`).join("\n")}`);

  return `# The port, read back and held against itself

Each screen's template was emitted to React and read back onto the dialect.
The structure that came out is compared to the structure that went in: the
elements, the conditionals, the loops and the models, with whitespace set
aside. Where they match, the round trip held and the port provably kept the
shape it was given.

| screen | round trip | elements | conditionals | loops | models |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

${drift.length ? `## Where it drifted\n\n${drift.join("\n\n")}\n` : "Every screen held. What went in came back.\n"}
---

A round trip that holds is not proof the values are right, only that the
shape survived the trip. It is the structure this tool can check without a
person, so it checks it.
`;
}
