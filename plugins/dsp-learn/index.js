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
 * It is honest about being small. The corpus holds two exemplars per class, so a
 * leave one out cross validation is defined and the report carries that real held
 * out accuracy alongside a reproducible robustness figure; every reading is a
 * proposal marked unverified. No network, no dependency, deterministic: the same
 * app reads the same way every run.
 */

import { buildIr } from "../dsp-ir/ir.js";
import { mergeShapes, shapeOf } from "../dsp-archetype/shape.js";
import { readApi } from "../dsp-archetype/classify.js";
import { vectorFromParts } from "./features.js";
import { train, classifyVector, robustness, crossValidate } from "./model.js";
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

export function renderLearned({ reading, robustnessCurve, cv, perScreen = [], top }) {
  const rows = reading.ranked
    .map((r, i) => `| ${i + 1} | ${r.label} | ${r.distance.toFixed(2)} | ${pct(r.confidence)} |`)
    .join("\n");
  const topFeatures = top.length ? top.map((t) => `\`${t.name}\` (${t.value})`).join(", ") : "nothing stood out";
  const curve = robustnessCurve.map((c) => `| ${c.sigma.toFixed(1)} | ${pct(c.accuracy)} |`).join("\n");
  const missed = cv.misses.length
    ? cv.misses.map((m) => `\`${m.label}\` read as \`${m.predicted}\``).join(", ")
    : "none";

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

${perScreen.length ? `## Each screen on its own

The reading above weighs the whole app, endpoints included. Each screen also
reads on its own markup shape alone, so a multi screen app is not flattened to
one label:

| screen | archetype | confidence |
| --- | --- | --- |
${perScreen.map((s) => `| \`${s.selector}\` | ${s.label}${s.contested ? ` (contested with ${s.runnerUp})` : ""} | ${pct(s.confidence)} |`).join("\n")}

A per screen reading rests on shape without the traffic, so it is weaker than
the whole app reading and can differ from it; where they disagree, the screen is
one whose markup pulls one way and whose endpoints pull another.

` : ""}## Every archetype, by distance

| rank | archetype | distance | confidence |
| --- | --- | --- | --- |
${rows}

Distance is Euclidean in the standardized feature space; nearer is a better fit.
Confidence is a softmax over the negative distances, so a screen far from every
exemplar reads as low confidence rather than being forced into the nearest class.

## How much this can be trusted

The corpus holds two labelled exemplars per archetype, so a real held out
accuracy is defined: each exemplar is left out in turn, the model is retrained on
the rest (its class still represented by its sibling), and the held out one is
classified against it. Leave one out cross validation over ${cv.n} exemplars
scores **${pct(cv.accuracy)}** (${Math.round(cv.accuracy * cv.n)} of ${cv.n}
correct). The exemplars it missed when unseen: ${missed}. This is the honest
number: how often the model gets a screen right that it never trained on.

Robustness is the companion measure, how far a screen can be jittered by seeded
noise and still keep its label:

| noise (σ, in feature spreads) | kept its label |
| --- | --- |
${curve}

Cross validation says how often an unseen exemplar lands right; robustness says
how far one can move before it stops. Two exemplars per class is still a small
corpus, so both numbers are a floor to raise, not a ceiling to trust.

---

This is a proposal from a model, not a fact. It is trained on twenty two human
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

      // Each screen placed on its own shape, so a multi screen app gets a
      // breakdown rather than one label for everything. The endpoints are an app
      // level signal, so a per screen reading rests on markup shape alone and the
      // whole app reading above is the one that also weighs the traffic.
      const emptyApi = readApi([]);
      const perScreen = screens
        .filter((s) => s.template)
        .map((s) => {
          const sVector = vectorFromParts({ shape: shapeOf(s.ir ?? buildIr(s.template)), api: emptyApi, widgets: 0, components: 1 });
          const r = classifyVector(model, sVector);
          return { selector: s.selector, label: r.label, confidence: r.confidence, contested: r.contested, runnerUp: r.ranked[1]?.label ?? null };
        });

      const cv = crossValidate(CORPUS);
      ctx.learned = { reading, robustnessCurve, cv, perScreen, model: "nearest-prototype", top };

      log.info(
        `learned reading: ${reading.label} (${pct(reading.confidence)}${reading.contested ? ", contested" : ""}), leave one out ${pct(cv.accuracy)} over ${cv.n} exemplars`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.learned) return;
      await ctx.write("LEARNED.md", renderLearned(ctx.learned));
      ctx.unverified(
        `LEARNED.md is a learned archetype reading from a model trained on twenty two labelled miniatures, two per class, and cross validated at leave one out. ` +
          `It read this app as ${ctx.learned.reading.label} at ${pct(ctx.learned.reading.confidence)}; that is a proposal for a ` +
          "person to confirm against ARCHITECTURE.md, not a measured fact, and the model can be confidently wrong."
      );
    });
  },
};
