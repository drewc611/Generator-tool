import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  softmax,
  layerNorm,
  forward,
  train,
  gradientCheck,
  crossEntropyLoss,
  trainModularAddition,
  trainReverse,
  trainSort,
  sortGradientCheck,
  trainReverseMultiHead,
  multiHeadGradientCheck,
} from "../plugins/vis-transformer/index.js";
import { transformCjsToEsm } from "../plugins/output-codemod/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The transformer, in both senses. The neural one is held to known answer math
 * and proven deterministic; it predicts nothing, because an untrained forward
 * pass is a demonstration of the mechanism, not a claim about the port. The
 * code one moves only the CommonJS forms it can prove to ES modules and
 * refuses the rest out loud, because a wrong rewrite that looks right is the
 * failure this tool exists to avoid.
 */

const close = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

test("softmax and layernorm match their known answers", () => {
  const s = softmax([1, 2, 3]);
  assert.ok(close(s[0], 0.09003057, 1e-6));
  assert.ok(close(s[1], 0.24472847, 1e-6));
  assert.ok(close(s[2], 0.66524096, 1e-6));
  assert.ok(close(s.reduce((x, y) => x + y, 0), 1, 1e-9), "softmax sums to one");

  const n = layerNorm([1, 2, 3]);
  assert.ok(close(n[0], -1.22474));
  assert.ok(close(n[1], 0));
  assert.ok(close(n[2], 1.22474));
});

test("the backward pass is correct: analytic gradients match the numerical check", () => {
  const { maxRelError, checked } = gradientCheck();
  assert.ok(checked >= 8, "several parameters are checked");
  assert.ok(maxRelError < 1e-3, `analytic and numerical gradients agree (max rel error ${maxRelError})`);
});

test("training learns the fixed task to completion, deterministically", () => {
  const r = train();
  assert.ok(r.finalLoss < r.initialLoss * 0.05, "the loss falls by more than twenty fold");
  assert.equal(r.accuracy, 1, "every position's top logit is its target");
  assert.deepEqual(r.predictions, r.targets, "the learned sequence is the target sequence");

  const again = train();
  assert.equal(
    JSON.stringify(r.lossHistory),
    JSON.stringify(again.lossHistory),
    "two trainings are byte identical"
  );
});

test("reversal is learned as a rule and generalizes to sequences it never saw", () => {
  const r = trainReverse({ steps: 600 });
  assert.ok(r.trainAccuracy >= 0.95, "it fits the training sequences");
  const chance = 1 / Math.pow(r.V, r.L);
  assert.ok(r.heldOutAccuracy > 0.5, `held out accuracy ${r.heldOutAccuracy} is far above chance ${chance}`);
  const sample = r.samplePredictions[0];
  assert.deepEqual(sample.predicted, sample.target, "a held out sequence is reversed correctly");

  const again = trainReverse({ steps: 200 });
  const once = trainReverse({ steps: 200 });
  assert.equal(JSON.stringify(again.lossHistory), JSON.stringify(once.lossHistory), "training is deterministic");
});

test("sorting is learned and generalizes far above chance, gradients proven", () => {
  const check = sortGradientCheck();
  assert.ok(check.maxRelError < 1e-3, `the sort model's backprop is correct (${check.maxRelError})`);

  const r = trainSort();
  assert.ok(r.trainAccuracy >= 0.95, "it fits the training sequences");
  const chance = 1 / Math.pow(r.symbols, r.L);
  assert.ok(
    r.heldOutAccuracy > 0.5 && r.heldOutAccuracy > chance * 10,
    `held out ${r.heldOutAccuracy} is far above chance ${chance}`
  );
  assert.ok(r.heldOutAccuracy <= r.trainAccuracy, "held out is not overstated past the training set");

  const a = trainSort({ steps: 200 });
  const b = trainSort({ steps: 200 });
  assert.equal(JSON.stringify(a.lossHistory), JSON.stringify(b.lossHistory), "training is deterministic");
});

test("multi head attention is gradient checked and trains, deterministically", () => {
  for (const heads of [2, 4]) {
    const check = multiHeadGradientCheck({ heads });
    assert.ok(check.maxRelError < 1e-3, `H=${heads} multi head backprop is correct (${check.maxRelError})`);
  }

  const r = trainReverseMultiHead({ heads: 4 });
  assert.equal(r.heads, 4);
  assert.ok(r.trainAccuracy >= 0.95, "it fits the training sequences with multiple heads");
  assert.ok(r.heldOutAccuracy > 0.5, `held out ${r.heldOutAccuracy} is well above chance`);

  const a = trainReverseMultiHead({ heads: 4, steps: 200 });
  const b = trainReverseMultiHead({ heads: 4, steps: 200 });
  assert.equal(JSON.stringify(a.lossHistory), JSON.stringify(b.lossHistory), "multi head training is deterministic");
});

test("modular addition is memorized, and the held out gap is reported honestly", () => {
  const r = trainModularAddition({ steps: 1500 });
  assert.ok(r.trainAccuracy >= 0.9, "it fits the training table");
  assert.ok(
    Number.isFinite(r.heldOutAccuracy) && r.heldOutAccuracy >= 0 && r.heldOutAccuracy <= 1,
    "the held out accuracy is a real measured number"
  );
  // At this size the block memorizes rather than generalizes; the point of the
  // test is that the honest gap between train and held out is measured, not hidden.
  assert.ok(r.heldOutAccuracy <= r.trainAccuracy, "held out never beats train here");
});

test("cross entropy rewards the confident right answer over the wrong one", () => {
  const right = crossEntropyLoss([0, 0, 5], 2);
  const wrong = crossEntropyLoss([0, 0, 5], 0);
  assert.ok(right < wrong, "loss is lower when the mass is on the target");
});

test("the forward pass is deterministic: same config, byte identical logits", () => {
  const config = { seed: 42, dModel: 16, numHeads: 4, dFF: 32, vocabSize: 8 };
  const a = forward([0, 1, 2, 3], config);
  const b = forward([0, 1, 2, 3], config);
  assert.equal(JSON.stringify(a.logits), JSON.stringify(b.logits), "two runs agree exactly");
  assert.ok(Array.isArray(a.attention) && a.attention.length >= 1, "attention is produced");
});

test("the codemod lifts the provable forms and refuses the dynamic require", () => {
  const { code, changes, refusals } = transformCjsToEsm(
    `const total = require("./total.js");\n` +
      `const { format } = require("./util.js");\n` +
      `exports.total = total;\n` +
      `const plugin = require(config.name);`
  );
  assert.match(code, /import total from "\.\/total\.js"/);
  assert.match(code, /import \{ format \} from "\.\/util\.js"/);
  // A bare identifier export re-exports the existing binding; it must not be
  // `export const total = total`, which would redeclare the imported `total`.
  assert.match(code, /export \{ total \}/);
  assert.doesNotMatch(code, /export const total = total/, "no redeclaration of an imported binding");
  assert.ok(changes.length >= 3, "the three provable forms are rewritten");
  assert.ok(
    refusals.some((r) => r.kind === "dynamic-require"),
    "the computed require is refused, not guessed"
  );
  assert.match(code, /require\(config\.name\)/, "the refused line is left verbatim");
});

test("a fully provable module transforms to source node parses as ES modules", () => {
  const { code, refusals } = transformCjsToEsm(
    `const total = require("./total.js");\n` +
      `const { format } = require("./util.js");\n` +
      `function subtotal(items) { return items.length; }\n` +
      `exports.subtotal = subtotal;\n` +
      `exports.total = total;\n` +
      `module.exports.format = format;`
  );
  assert.equal(refusals.length, 0, "every form here is provable");
  // A fresh unique directory, not a predictable name in the shared temp dir,
  // so nothing else can read or race the file.
  const dir = mkdtempSync(join(tmpdir(), "codemod-"));
  const file = join(dir, "out.mjs");
  writeFileSync(file, code);
  try {
    // node --check parses the file as ES modules (the .mjs extension) and exits
    // non zero on any syntax error, so a redeclaration would fail this outright.
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run writes ATTENTION.md and codemod output only when asked", async () => {
  const src = join(ROOT, "test/fixtures/codemod-site");

  const off = await runPipeline({ src });
  try {
    assert.equal(off.error, null);
    assert.ok(!off.ctx.written.includes("ATTENTION.md"), "the transformer is opt in");
    assert.ok(!off.ctx.written.some((f) => f.startsWith("codemod/")), "the codemod is opt in");
  } finally {
    await off.cleanup();
  }

  const on = await runPipeline({ src, transformer: true, codemod: true });
  try {
    assert.equal(on.error, null);
    assert.ok(on.ctx.written.includes("ATTENTION.md"));
    assert.ok(on.ctx.written.includes("CODEMOD.md"));
    assert.ok(on.ctx.written.includes("codemod/cart.js"));

    const attention = await readFile(join(on.out, "ATTENTION.md"), "utf8");
    assert.match(attention, /attention/i);
    assert.match(attention, /predicts nothing|untrained|no claim/i, "it disclaims prediction");

    const lifted = await readFile(join(on.out, "codemod/cart.js"), "utf8");
    assert.match(lifted, /import/);

    const report = await readFile(join(on.out, "CODEMOD.md"), "utf8");
    assert.match(report, /dynamic|refus/i);
  } finally {
    await on.cleanup();
  }
});
