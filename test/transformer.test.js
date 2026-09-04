import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { softmax, layerNorm, forward } from "../plugins/vis-transformer/index.js";
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
  assert.match(code, /export const total = total/);
  assert.ok(changes.length >= 3, "the three provable forms are rewritten");
  assert.ok(
    refusals.some((r) => r.kind === "dynamic-require"),
    "the computed require is refused, not guessed"
  );
  assert.match(code, /require\(config\.name\)/, "the refused line is left verbatim");
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
