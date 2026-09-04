import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { softmax, layerNorm, forward, train, gradientCheck, crossEntropyLoss } from "../plugins/vis-transformer/index.js";
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
