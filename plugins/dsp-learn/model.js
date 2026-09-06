/**
 * A nearest prototype classifier over the labelled archetype corpus.
 *
 * The training is real and small: the corpus is one exemplar per archetype, and
 * what is learned from it is the standardization, a mean and a spread per
 * feature, so that a feature counted in tens (elements) and one that is zero or
 * one (a word flag) carry the same weight in the distance. A screen is then
 * classified by the nearest standardized prototype, and the confidence is a
 * softmax over the negative distances, so a screen far from everything and one
 * sitting exactly between two prototypes both read as low confidence rather than
 * being forced into a class.
 *
 * It is honest about its size. One exemplar per class means a true held out
 * accuracy is undefined: removing a class's only exemplar leaves that class
 * unrepresentable. So instead of a cross validation number it cannot compute, it
 * reports a reproducible robustness figure, how far a screen can be jittered and
 * still land on its own label, which is a stability property this method really
 * has and can be measured without a person.
 */

import { softmax } from "../vis-transformer/index.js";
import { FEATURES, vectorFromEntry } from "./features.js";

/** Learn a per feature mean and spread from the corpus rows. A feature that never varies gets a spread of one and so contributes nothing to any distance. */
export function standardizer(matrix) {
  const n = matrix.length;
  const d = matrix[0].length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of matrix) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  for (const row of matrix) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

export function standardize(vector, { mean, std }) {
  return vector.map((x, j) => (x - mean[j]) / std[j]);
}

/** Turn the labelled corpus into standardized prototypes. The learned parameters are the standardization; the prototypes are the class exemplars in that space. */
export function train(corpus) {
  const labels = corpus.map((e) => e.label);
  const raw = corpus.map(vectorFromEntry);
  const norm = standardizer(raw);
  const prototypes = raw.map((v, i) => ({ label: labels[i], z: standardize(v, norm) }));
  return { features: FEATURES, mean: norm.mean, std: norm.std, prototypes, labels };
}

function distance(a, b) {
  let sum = 0;
  for (let j = 0; j < a.length; j++) {
    const d = a[j] - b[j];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Classify a raw feature vector by the nearest standardized prototype. Returns
 * the label, the confidence (softmax over negative distances), the margin to the
 * runner up, and every candidate ranked, so the reading can show its work.
 */
export function classifyVector(model, raw) {
  const z = standardize(raw, model);
  const scored = model.prototypes
    .map((p) => ({ label: p.label, distance: distance(z, p.z) }))
    .sort((a, b) => a.distance - b.distance);
  const probs = softmax(scored.map((s) => -s.distance));
  scored.forEach((s, i) => (s.confidence = probs[i]));
  const best = scored[0];
  const runnerUp = scored[1] ?? null;
  const margin = runnerUp ? runnerUp.distance - best.distance : Infinity;
  return { label: best.label, confidence: best.confidence, margin, contested: margin < 0.5, ranked: scored };
}

// splitmix32: a small seeded generator, distinct from the transformer's, so a
// jitter is reproducible without Math.random's unseeded state.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

// Box Muller: two uniforms to one standard normal, so the jitter is Gaussian.
function gaussian(draw) {
  const u = Math.max(draw(), 1e-12);
  const v = draw();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Leave one out cross validation: a real held out accuracy. Each example is held
 * out in turn, a model is trained on the rest, and the held out example is
 * classified against it. With two examples per class, holding one out still
 * leaves its class represented by its sibling, so the question "would the model
 * have got this right if it had never seen it" is well posed. Deterministic; the
 * same corpus always gives the same number, and a per class breakdown besides.
 */
export function crossValidate(corpus) {
  let correct = 0;
  const perClass = {};
  const misses = [];
  for (let i = 0; i < corpus.length; i += 1) {
    const held = corpus[i];
    const rest = corpus.filter((_, j) => j !== i);
    const reading = classifyVector(train(rest), vectorFromEntry(held));
    const right = reading.label === held.label;
    perClass[held.label] = perClass[held.label] ?? { correct: 0, total: 0 };
    perClass[held.label].total += 1;
    if (right) { correct += 1; perClass[held.label].correct += 1; }
    else misses.push({ label: held.label, predicted: reading.label });
  }
  return { accuracy: correct / corpus.length, n: corpus.length, perClass, misses };
}

/**
 * How far a screen can drift and still be recognised. Each prototype is jittered
 * by seeded Gaussian noise scaled to each feature's own spread, classified, and
 * scored on whether it kept its label. Deterministic given the seed. A companion
 * to the held out accuracy: cross validation says how often an unseen exemplar
 * lands right, robustness says how far one can move before it stops.
 */
export function robustness(model, { seed = 1, trials = 40, sigma = 0.5 } = {}) {
  const draw = makeRng(seed);
  let correct = 0;
  let total = 0;
  for (const p of model.prototypes) {
    const raw = p.z.map((zj, j) => zj * model.std[j] + model.mean[j]);
    for (let t = 0; t < trials; t++) {
      const noisy = raw.map((x, j) => x + gaussian(draw) * sigma * model.std[j]);
      if (classifyVector(model, noisy).label === p.label) correct += 1;
      total += 1;
    }
  }
  return correct / total;
}
