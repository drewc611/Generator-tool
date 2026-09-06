import { buildIr } from "../dsp-ir/ir.js";
import { translate } from "../output-react/template.js";
import { lowerBody } from "../input-react/index.js";
import { toSvelte } from "../output-svelte/print.js";
import { lowerSvelte } from "../input-svelte/index.js";
import { toLit } from "../output-lit/index.js";
import { lowerLit } from "../input-lit/index.js";

/**
 * The port read back and held against itself, now through three targets.
 *
 * Each emitter turns a screen's template into its target; the reader for that
 * target reads it back onto the dialect. Running one after the other should
 * return the same structure it started with: the same real elements, the same
 * conditionals, loops and models. React, Svelte and Lit each have a reader that
 * is the inverse of their emitter, so each closes the loop, and where a screen
 * drifts through one target but not another the difference is named.
 *
 * This is the honest form of "portamp reads what it writes": not a claim, a
 * comparison that fails out loud. A round trip that holds is not proof the
 * values are right, only that the shape survived; that is what can be checked
 * without a person, so it is.
 */

/** Each target and the round trip that closes its loop: emit, then read back. */
const TARGETS = [
  { name: "React", trip: (tpl) => lowerBody(translate(tpl, { indent: 0 }).jsx, () => {}) },
  { name: "Svelte", trip: (tpl) => lowerSvelte(toSvelte(tpl).markup, () => {}) },
  { name: "Lit", trip: (tpl) => lowerLit(toLit(tpl).markup, () => {}) },
];

/**
 * The structural facts that must survive a round trip, whitespace aside. Only
 * real (tagged) elements count: a reader may wrap a block in a transparent
 * container, which the IR sees through and which is not structure of its own.
 */
export function summarize(html) {
  const counts = { elements: 0, conditionals: 0, loops: 0, models: 0 };
  const tags = [];
  const walk = (node) => {
    if (!node) return;
    switch (node.kind) {
      case "element":
        if (node.tag) {
          counts.elements += 1;
          tags.push(node.tag);
          if (node.model) counts.models += 1;
        }
        break;
      case "when": counts.conditionals += 1; break;
      case "each": counts.loops += 1; break;
      default: break;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(buildIr(html).root);
  return { ...counts, tags: tags.sort() };
}

function compare(original, back, error) {
  const diffs = [];
  if (error) { diffs.push(`the round trip threw: ${error}`); return diffs; }
  for (const key of ["elements", "conditionals", "loops", "models"]) {
    if (original[key] !== back[key]) diffs.push(`${key}: ${original[key]} became ${back[key]}`);
  }
  if (original.tags.join(",") !== back.tags.join(",")) diffs.push("the set of element tags changed");
  return diffs;
}

/** The round trip for one template through every target: original structure versus each read-back. */
export function roundTrip(template) {
  const original = summarize(template);
  const targets = TARGETS.map((t) => {
    let back = null;
    let error = null;
    try { back = summarize(t.trip(template)); } catch (e) { error = e.message; }
    const diffs = compare(original, back, error);
    return { name: t.name, back, diffs, held: diffs.length === 0 };
  });
  return { original, targets, held: targets.every((t) => t.held) };
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
      log.info(`${results.length} screen(s) round tripped through ${TARGETS.map((t) => t.name).join(", ")}, ${drifted.length} drifted`);
      if (drifted.length) {
        const perTarget = TARGETS.map((t) => `${t.name}: ${results.filter((r) => !r.targets.find((x) => x.name === t.name).held).length}`).join(", ");
        ctx.unverified(
          `ROUNDTRIP.md read ${results.length} emitted component(s) back onto the dialect through ${TARGETS.length} targets; ` +
          `${drifted.length} screen(s) drifted through at least one (${perTarget}). A drift is a place an emitter and its reader disagree; see the file.`
        );
      }
    });
  },
};

function render(results) {
  const mark = (r, name) => {
    const t = r.targets.find((x) => x.name === name);
    return t.held ? "held" : "**drifted**";
  };
  const rows = results.map((r) =>
    `| \`${r.selector}\` | ${r.original.elements} | ${r.original.conditionals} | ${r.original.loops} | ${r.original.models} | ${TARGETS.map((t) => mark(r, t.name)).join(" | ")} |`);

  const drift = results.flatMap((r) =>
    r.targets.filter((t) => !t.held).map((t) => `### \`${r.selector}\` through ${t.name}\n\n${t.diffs.map((d) => `- ${d}`).join("\n")}`));

  return `# The port, read back and held against itself

Each screen's template was emitted to React, Svelte and Lit, and each was read
back onto the dialect by that target's reader. The structure that came out is
compared to the structure that went in: the real (tagged) elements, the
conditionals, the loops and the models, with whitespace and transparent wrappers
set aside. Where they match, the round trip held and the port provably kept the
shape it was given through that target.

| screen | elements | conditionals | loops | models | ${TARGETS.map((t) => t.name).join(" | ")} |
| --- | --- | --- | --- | --- | ${TARGETS.map(() => "---").join(" | ")} |
${rows.join("\n")}

${drift.length ? `## Where it drifted\n\n${drift.join("\n\n")}\n` : "Every screen held through every target. What went in came back.\n"}
---

A round trip that holds is not proof the values are right, only that the
shape survived the trip. It is the structure this tool can check without a
person, so it checks it.
`;
}
