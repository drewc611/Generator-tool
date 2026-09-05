/**
 * A learned second opinion on what the app is.
 *
 * dsp-archetype names the app with hand written rules. This names it with a
 * model trained on the labelled corpus: the same screen, turned into a vector
 * and placed by the nearest exemplar rather than by which rules fired. The two
 * are meant to be read together. When the learned reading and the rule based one
 * agree, that is worth more than either alone; when they disagree, the
 * disagreement is the finding, and LEARNED.md says so.
 *
 * It is honest about being small. The corpus is one exemplar per class, so the
 * report carries a reproducible robustness figure, not a held out accuracy it
 * cannot compute, and every reading is a proposal marked unverified. No network,
 * no dependency, deterministic: the same app reads the same way every run.
 */

import { buildIr } from "../dsp-ir/ir.js";
import { mergeShapes, shapeOf } from "../dsp-archetype/shape.js";
import { readApi } from "../dsp-archetype/classify.js";
import { vectorFromParts } from "./features.js";
import { train, classifyVector, robustness } from "./model.js";
import { CORPUS } from "./corpus.js";

/** Merge every screen's shape into one, the way dsp-archetype describes a whole app. */
function runShape(ctx) {
  const screens = ctx.screens ?? [];
  const withTemplates = screens.filter((s) => s.template);
  const shape = mergeShapes(withTemplates.map((s) => shapeOf(s.ir ?? buildIr(s.template))));
  // With no markup, an exploration's screens still describe a shape.
  if (!withTemplates.length && ctx.model?.screens?.length) {
    for (const s of ctx.model.screens) {
      if (s.kind === "list") shape.loops += 1;
      if (s.kind === "form") { shape.inputs += (s.fields ?? []).length; shape.submits += 1; shape.forms += 1; }
      if (s.collection?.columns?.length) shape.tables += 1;
      shape.headings += 1;
    }
  }
  return { shape, screens };
}

const pct = (x) => `${Math.round(x * 100)}%`;

export function renderLearned({ reading, robustnessCurve, top }) {
  const rows = reading.ranked
    .map((r, i) => `| ${i + 1} | ${r.label} | ${r.distance.toFixed(2)} | ${pct(r.confidence)} |`)
    .join("\n");
  const topFeatures = top.length ? top.map((t) => `\`${t.name}\` (${t.value})`).join(", ") : "nothing stood out";
  const curve = robustnessCurve.map((c) => `| ${c.sigma.toFixed(1)} | ${pct(c.accuracy)} |`).join("\n");

  return `# What this app is, learned

A model trained on the labelled archetype corpus placed this app's screens among
its exemplars. This is a **learned** reading, a companion to the rule based one in
ARCHITECTURE.md, not a replacement: read the two together.

## The reading

**${reading.label}**, at ${pct(reading.confidence)} confidence, ${
    reading.contested
      ? `contested with \`${reading.ranked[1].label}\` (they sit ${reading.margin.toFixed(2)} apart in the standardized space, close enough that the model cannot separate them)`
      : `clear of the runner up \`${reading.ranked[1]?.label ?? "none"}\` by ${Number.isFinite(reading.margin) ? reading.margin.toFixed(2) : "the full field"}`
  }.

The features that carried the most signal for this screen: ${topFeatures}.

## Every archetype, by distance

| rank | archetype | distance | confidence |
| --- | --- | --- | --- |
${rows}

Distance is Euclidean in the standardized feature space; nearer is a better fit.
Confidence is a softmax over the negative distances, so a screen far from every
exemplar reads as low confidence rather than being forced into the nearest class.

## How much this can be trusted

The corpus is one exemplar per archetype. A true held out accuracy is undefined
here: removing a class's only exemplar leaves that class unrepresentable. So the
honest measure is robustness: each exemplar is jittered by seeded Gaussian noise
scaled to each feature's own spread, and scored on whether it kept its label. The
curve below is how that decays as the noise grows, which is a stability property
this method really has, not a promise about a screen the model has never seen.

| noise (σ, in feature spreads) | kept its label |
| --- | --- |
${curve}

A screen that sits within a spread or so of its exemplar is recognised almost
always; one pushed two spreads out starts to be confused with its neighbours,
which is exactly the app whose shape is genuinely ambiguous.

---

This is a proposal from a model, not a fact. It is trained on eleven human
labelled miniatures and it can be confidently wrong, most easily on an app whose
shape sits between two archetypes. Where it disagrees with ARCHITECTURE.md, treat
the disagreement as the thing to look at, not as one reading to pick.
`;
}

export default {
  name: "dsp-learn",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const { shape, screens } = runShape(ctx);
      const api = readApi(ctx.api?.calls ?? [], ctx.model ?? null);

      // Nothing to place: no markup, no traffic, no explored screens.
      if (!shape.elements && !(ctx.api?.calls ?? []).length && !ctx.model?.screens?.length) {
        return log.debug("no screen shape to classify");
      }

      const model = train(CORPUS);
      const vector = vectorFromParts({
        shape,
        api,
        widgets: (ctx.widgets ?? []).length,
        components: screens.length,
      });
      const reading = classifyVector(model, vector);
      const robustnessCurve = [0.5, 1.0, 1.5, 2.0].map((sigma) => ({
        sigma,
        accuracy: robustness(model, { seed: 1, trials: 40, sigma }),
      }));

      // The features worth naming are the ones this screen actually has, biggest first.
      const top = model.features
        .map((name, j) => ({ name, value: vector[j] }))
        .filter((f) => f.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);

      ctx.learned = { reading, robustnessCurve, model: "nearest-prototype", top };

      log.info(
        `learned reading: ${reading.label} (${pct(reading.confidence)}${reading.contested ? ", contested" : ""}), robustness ${pct(robustnessCurve[0].accuracy)} at low noise`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.learned) return;
      await ctx.write("LEARNED.md", renderLearned(ctx.learned));
      ctx.unverified(
        `LEARNED.md is a learned archetype reading from a model trained on eleven labelled miniatures, one per class. ` +
          `It read this app as ${ctx.learned.reading.label} at ${pct(ctx.learned.reading.confidence)}; that is a proposal for a ` +
          "person to confirm against ARCHITECTURE.md, not a measured fact, and the model can be confidently wrong."
      );
    });
  },
};
