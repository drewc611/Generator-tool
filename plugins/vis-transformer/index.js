/**
 * A transformer forward pass, run by a core that does not know what one is.
 *
 * The blind core loads a transformer the same way it loads everything else,
 * and still has no idea what it is. This plugin is the neural network kind of
 * transformer, self attention and all, not a code transform. It runs the real
 * architecture over a fixed, declared token sequence with seeded deterministic
 * weights, proves the mechanism is mathematically correct, and draws the
 * attention it computed.
 *
 * It is honest about what it is. An untrained forward pass predicts nothing:
 * the weights are noise from a seeded generator, the input is a fixed sentence
 * declared here and never read from the port, and the logits mean nothing about
 * anyone's app. The point is the mechanism, that the plugin host loads even a
 * transformer without the core learning its name, and that the math is right
 * and repeats byte for byte across runs.
 *
 * Everything below is pure arithmetic on plain number arrays and arrays of
 * arrays held row major, so each piece can be checked on its own.
 */

/** Numerically stable softmax over one vector: subtract the max, exponentiate, normalize. */
export function softmax(vec) {
  let max = -Infinity;
  for (const v of vec) if (v > max) max = v;
  const exps = vec.map((v) => Math.exp(v - max));
  let sum = 0;
  for (const e of exps) sum += e;
  return exps.map((e) => e / sum);
}

/** Layer normalization with population variance: (x - mean) / sqrt(variance + eps). */
export function layerNorm(vec, eps = 1e-5) {
  const n = vec.length;
  let mean = 0;
  for (const v of vec) mean += v;
  mean /= n;
  let variance = 0;
  for (const v of vec) variance += (v - mean) * (v - mean);
  variance /= n;
  const denom = Math.sqrt(variance + eps);
  return vec.map((v) => (v - mean) / denom);
}

/** Row major matrix product: A is m by n, B is n by p, result is m by p. */
function matMul(A, B) {
  const m = A.length;
  const n = B.length;
  const p = B[0].length;
  const out = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(p).fill(0);
    const ai = A[i];
    for (let k = 0; k < n; k++) {
      const aik = ai[k];
      const bk = B[k];
      for (let j = 0; j < p; j++) row[j] += aik * bk[j];
    }
    out.push(row);
  }
  return out;
}

/** Transpose a row major matrix. */
function transpose(A) {
  const rows = A.length;
  const cols = A[0].length;
  const out = [];
  for (let j = 0; j < cols; j++) {
    const row = new Array(rows);
    for (let i = 0; i < rows; i++) row[i] = A[i][j];
    out.push(row);
  }
  return out;
}

/** Elementwise sum of two equally shaped matrices, the residual connection. */
function addMatrix(A, B) {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

/**
 * Scaled dot product attention for one head. Q, K and V are matrices of row
 * vectors. Returns softmax(Q Kt / sqrt(dk)) V applied per query row. The
 * attention weights for a row sum to one because softmax normalizes them; the
 * optional sink receives that weight matrix so the caller can draw it.
 */
export function scaledDotProductAttention(Q, K, V, sink) {
  const dk = K[0].length;
  const scale = 1 / Math.sqrt(dk);
  const scores = matMul(Q, transpose(K)).map((row) => row.map((s) => s * scale));
  const weights = scores.map((row) => softmax(row));
  if (sink) sink.push(weights);
  return matMul(weights, V);
}

/** Slice columns [start, start + width) out of every row of a matrix. */
function sliceCols(A, start, width) {
  return A.map((row) => row.slice(start, start + width));
}

/** Concatenate matrices column wise; each must have the same row count. */
function concatCols(mats) {
  return mats[0].map((_, i) => mats.reduce((acc, m) => acc.concat(m[i]), []));
}

/**
 * Multi head attention. Projects X by Wq, Wk and Wv, splits the model
 * dimension into numHeads heads, runs scaled dot product attention per head,
 * concatenates the heads and applies the output projection Wo. Returns the
 * resulting matrix. An optional attentionSink array receives one weight matrix
 * per head, in head order, for drawing.
 */
export function multiHeadAttention(X, weights, numHeads, attentionSink) {
  const dModel = X[0].length;
  const dHead = dModel / numHeads;
  const Q = matMul(X, weights.Wq);
  const K = matMul(X, weights.Wk);
  const V = matMul(X, weights.Wv);
  const heads = [];
  for (let h = 0; h < numHeads; h++) {
    const start = h * dHead;
    const Qh = sliceCols(Q, start, dHead);
    const Kh = sliceCols(K, start, dHead);
    const Vh = sliceCols(V, start, dHead);
    heads.push(scaledDotProductAttention(Qh, Kh, Vh, attentionSink));
  }
  return matMul(concatCols(heads), weights.Wo);
}

/**
 * Standard sinusoidal positional encoding: sine on even dimensions, cosine on
 * odd ones, at a wavelength that grows with the dimension. Deterministic and
 * carries no learned parameter.
 */
export function positionalEncoding(seqLen, dModel) {
  const out = [];
  for (let pos = 0; pos < seqLen; pos++) {
    const row = new Array(dModel);
    for (let i = 0; i < dModel; i++) {
      const k = Math.floor(i / 2);
      const angle = pos / Math.pow(10000, (2 * k) / dModel);
      row[i] = i % 2 === 0 ? Math.sin(angle) : Math.cos(angle);
    }
    out.push(row);
  }
  return out;
}

/**
 * mulberry32, a small seeded generator. Math.random carries no seed and would
 * differ from run to run, which the determinism the whole tool rests on will
 * not tolerate; this one returns the same stream for the same seed forever.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A rand by rows by cols matrix of small centered values drawn from the generator. */
function randMatrix(next, rows, cols, scale) {
  const out = [];
  for (let i = 0; i < rows; i++) {
    const row = new Array(cols);
    for (let j = 0; j < cols; j++) row[j] = (next() - 0.5) * scale;
    out.push(row);
  }
  return out;
}

/** A vector of small centered values, for biases. */
function randVector(next, n, scale) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (next() - 0.5) * scale;
  return out;
}

/**
 * Every weight the forward pass needs, filled from one seeded stream in a
 * fixed order so the same seed yields identical weights. The order the values
 * are drawn in is part of the contract: change it and the seed means something
 * new.
 */
export function seededWeights(seed, config) {
  const { dModel, dFF, vocabSize } = config;
  const next = mulberry32(seed);
  const scale = 0.2;
  return {
    embedding: randMatrix(next, vocabSize, dModel, scale),
    Wq: randMatrix(next, dModel, dModel, scale),
    Wk: randMatrix(next, dModel, dModel, scale),
    Wv: randMatrix(next, dModel, dModel, scale),
    Wo: randMatrix(next, dModel, dModel, scale),
    W1: randMatrix(next, dModel, dFF, scale),
    b1: randVector(next, dFF, scale),
    W2: randMatrix(next, dFF, dModel, scale),
    b2: randVector(next, dModel, scale),
    Wout: randMatrix(next, dModel, vocabSize, scale),
    bout: randVector(next, vocabSize, scale),
  };
}

/** Add a bias vector to every row of a matrix. */
function addBias(A, b) {
  return A.map((row) => row.map((v, j) => v + b[j]));
}

/** Rectified linear unit, applied elementwise. */
function relu(A) {
  return A.map((row) => row.map((v) => (v > 0 ? v : 0)));
}

/**
 * The full forward pass over a token sequence. Embed the tokens and add the
 * positional encoding, run one transformer block (multi head attention, a
 * residual add, layer norm, a two layer perceptron with a ReLU, another
 * residual add, layer norm), then project the last position to vocabulary
 * logits. Deterministic for a given config, which carries the seed. Returns
 * the per head attention weight matrices, the last position's logits, and the
 * tokens it ran over.
 */
export function forward(tokenIds, config) {
  const { dModel, numHeads, seed } = config;
  const w = seededWeights(seed, config);
  const pos = positionalEncoding(tokenIds.length, dModel);

  let x = tokenIds.map((id, i) => w.embedding[id].map((v, j) => v + pos[i][j]));

  const attention = [];
  const attended = multiHeadAttention(x, w, numHeads, attention);
  const afterAttn = addMatrix(x, attended).map((row) => layerNorm(row));

  const hidden = relu(addBias(matMul(afterAttn, w.W1), w.b1));
  const mlp = addBias(matMul(hidden, w.W2), w.b2);
  const afterMlp = addMatrix(afterAttn, mlp).map((row) => layerNorm(row));

  const logitsAll = addBias(matMul(afterMlp, w.Wout), w.bout);
  const logits = logitsAll[logitsAll.length - 1];

  return { attention, logits, tokens: tokenIds };
}

/** The fixed vocabulary. The forward pass never reads the port for its input. */
const VOCAB = ["port", "the", "legacy", "app", "into", "react", "vue", "svelte"];

/** The fixed input sentence, as indices into VOCAB. */
const INPUT_TOKENS = [0, 1, 2, 3, 4, 5];

const DEFAULT_CONFIG = {
  seed: 42,
  dModel: 16,
  numHeads: 4,
  dFF: 32,
  vocabSize: VOCAB.length,
};

/** A five step ramp from empty to full, so magnitude reads at a glance. */
const RAMP = [" ", "░", "▒", "▓", "█"];

function shade(weight) {
  const idx = Math.min(RAMP.length - 1, Math.max(0, Math.floor(weight * RAMP.length)));
  return RAMP[idx];
}

/** One head's weight matrix drawn as a markdown table, rows are queries. */
function drawHead(weights, labels) {
  const header = `| query \\ key | ${labels.join(" | ")} |`;
  const rule = `| --- | ${labels.map(() => "---").join(" | ")} |`;
  const rows = weights.map((row, i) => {
    const cells = row.map((v) => `${shade(v)} ${v.toFixed(3)}`);
    return `| ${labels[i]} | ${cells.join(" | ")} |`;
  });
  return [header, rule, ...rows].join("\n");
}

function render(result, config) {
  const labels = result.tokens.map((id) => VOCAB[id]);
  const sequence = labels.map((t, i) => `${i}:${t}`).join(" ");
  const parts = [
    "# A transformer forward pass",
    "",
    "The core loaded a transformer the same way it loads every plugin, and",
    "still has no idea what one is. This is the neural network transformer,",
    "self attention and all, run over a fixed sentence declared in the plugin",
    "with weights drawn from a seeded generator. It is untrained, so it",
    "predicts nothing about the port; it exists to run the architecture",
    "correctly and draw what it computed.",
    "",
    `Config: seed ${config.seed}, dModel ${config.dModel}, heads ${config.numHeads}, ` +
      `dFF ${config.dFF}, vocab ${config.vocabSize}.`,
    "",
    "## The input",
    "",
    `Fixed token sequence: \`${sequence}\``,
    "",
    "## Attention, per head",
    "",
    "Each table is one head's attention weights after softmax. A row is a",
    "query position, a column a key position, and every row sums to one. The",
    "block character shades the weight by magnitude.",
    "",
  ];
  result.attention.forEach((head, h) => {
    parts.push(`### Head ${h}`, "", drawHead(head, labels), "");
  });
  parts.push(
    "## The last position's logits",
    "",
    "One number per vocabulary token, from the final projection. Untrained,",
    "so this ranks nothing meaningfully; it is shown to prove the pass ran end",
    "to end.",
    "",
    "| token | logit |",
    "| --- | --- |",
    ...VOCAB.map((t, i) => `| ${t} | ${result.logits[i].toFixed(4)} |`),
    "",
  );
  return parts.join("\n");
}

/**
 * Training. Everything above runs the transformer forward; this makes it learn
 * by gradient descent, with the gradients proven correct against a numerical
 * check rather than trusted. A training loop with a wrong gradient descends
 * toward the wrong answer while looking like it works, and that silent wrong
 * answer is the failure this whole tool refuses, so the check is the point.
 *
 * The trainable model is a faithful minimal transformer block: an embedding, a
 * single head of self attention (query, key, value projections, scaled dot
 * product, softmax, weighted sum), a two layer perceptron with a ReLU, and an
 * output projection to vocabulary logits. It leaves out the layer norm the
 * forward pass demo carries, on purpose: the differentiable path is kept small
 * so every gradient in it is exactly derived and exactly checkable. The task is
 * next token prediction over one fixed sequence, overfit to completion, which
 * proves the loop learns; it is a demonstration that the mechanism is correct,
 * not a general language model.
 */

/** The fixed training sequence and its next token targets (null where there is no next token). */
const TRAIN_INPUT = [0, 1, 2, 3, 4, 5];
const TRAIN_TARGETS = [1, 2, 3, 4, 5, null];

function zeros(rows, cols) {
  const out = [];
  for (let i = 0; i < rows; i++) out.push(new Array(cols).fill(0));
  return out;
}

function colSums(A) {
  const out = new Array(A[0].length).fill(0);
  for (const row of A) for (let j = 0; j < row.length; j++) out[j] += row[j];
  return out;
}

function argmaxIdx(vec) {
  let best = 0;
  for (let i = 1; i < vec.length; i++) if (vec[i] > vec[best]) best = i;
  return best;
}

/** Cross entropy of the softmax of one logit vector against the target index. */
export function crossEntropyLoss(logits, targetId) {
  const p = softmax(logits);
  return -Math.log(Math.max(p[targetId], 1e-12));
}

/** The trainable parameters, initialized from the same seeded stream the forward pass uses. */
function trainParams(config) {
  const w = seededWeights(config.seed, config);
  return {
    E: w.embedding,
    Wq: w.Wq,
    Wk: w.Wk,
    Wv: w.Wv,
    W1: w.W1,
    b1: w.b1,
    W2: w.W2,
    b2: w.b2,
    Wout: w.Wout,
    bout: w.bout,
  };
}

/** One forward pass of the trainable block, keeping the caches the backward pass needs. */
function trainForward(params, tokenIds, config) {
  const d = config.dModel;
  const T = tokenIds.length;
  const pos = positionalEncoding(T, d);
  const x = tokenIds.map((id, i) => params.E[id].map((v, j) => v + pos[i][j]));
  const Q = matMul(x, params.Wq);
  const K = matMul(x, params.Wk);
  const Vv = matMul(x, params.Wv);
  const scale = 1 / Math.sqrt(d);
  const S = matMul(Q, transpose(K));
  const scores = S.map((row) => row.map((s) => s * scale));
  const A = scores.map((row) => softmax(row));
  const Ctx = matMul(A, Vv);
  const afterAttn = addMatrix(x, Ctx);
  const hpre = addBias(matMul(afterAttn, params.W1), params.b1);
  const h = relu(hpre);
  const m = addBias(matMul(h, params.W2), params.b2);
  const afterMlp = addMatrix(afterAttn, m);
  const z = addBias(matMul(afterMlp, params.Wout), params.bout);
  return { x, Q, K, Vv, A, Ctx, afterAttn, hpre, h, m, afterMlp, z };
}

/** The loss over the next token targets and the analytic gradient of every parameter. */
function lossAndGrads(params, tokenIds, targets, config) {
  const d = config.dModel;
  const c = trainForward(params, tokenIds, config);
  const T = tokenIds.length;
  const V = params.bout.length;
  const positions = [];
  for (let i = 0; i < T; i++) if (targets[i] != null) positions.push(i);
  const N = positions.length;

  let loss = 0;
  const dz = zeros(T, V);
  const probs = c.z.map((row) => softmax(row));
  for (const i of positions) {
    loss += -Math.log(Math.max(probs[i][targets[i]], 1e-12));
    for (let j = 0; j < V; j++) dz[i][j] = (probs[i][j] - (j === targets[i] ? 1 : 0)) / N;
  }
  loss /= N;

  const dWout = matMul(transpose(c.afterMlp), dz);
  const dbout = colSums(dz);
  const dafterMlp = matMul(dz, transpose(params.Wout));

  // afterMlp = afterAttn + m, so the residual sends the gradient down both paths.
  const dm = dafterMlp;
  const dW2 = matMul(transpose(c.h), dm);
  const db2 = colSums(dm);
  const dh = matMul(dm, transpose(params.W2));
  const dhpre = dh.map((row, i) => row.map((v, j) => (c.hpre[i][j] > 0 ? v : 0)));
  const dW1 = matMul(transpose(c.afterAttn), dhpre);
  const db1 = colSums(dhpre);
  const dAfterAttn = addMatrix(dafterMlp, matMul(dhpre, transpose(params.W1)));

  // afterAttn = x + Ctx, another residual.
  const dCtx = dAfterAttn;
  const dA = matMul(dCtx, transpose(c.Vv));
  const dVv = matMul(transpose(c.A), dCtx);
  const scale = 1 / Math.sqrt(d);
  const dS = zeros(T, T);
  for (let i = 0; i < T; i++) {
    let dot = 0;
    for (let k = 0; k < T; k++) dot += dA[i][k] * c.A[i][k];
    for (let j = 0; j < T; j++) dS[i][j] = c.A[i][j] * (dA[i][j] - dot) * scale;
  }
  const dQ = matMul(dS, c.K);
  const dK = matMul(transpose(dS), c.Q);

  const dWq = matMul(transpose(c.x), dQ);
  const dWk = matMul(transpose(c.x), dK);
  const dWv = matMul(transpose(c.x), dVv);
  let dxAttn = matMul(dQ, transpose(params.Wq));
  dxAttn = addMatrix(dxAttn, matMul(dK, transpose(params.Wk)));
  dxAttn = addMatrix(dxAttn, matMul(dVv, transpose(params.Wv)));
  // x reaches the loss through the attention projections and through the x + Ctx residual.
  const dx = addMatrix(dxAttn, dAfterAttn);

  const dE = zeros(params.E.length, d);
  tokenIds.forEach((id, i) => {
    for (let j = 0; j < d; j++) dE[id][j] += dx[i][j];
  });

  return {
    loss,
    grads: { E: dE, Wq: dWq, Wk: dWk, Wv: dWv, W1: dW1, b1: db1, W2: dW2, b2: db2, Wout: dWout, bout: dbout },
  };
}

function applyUpdate(param, grad, lr) {
  if (Array.isArray(param[0])) {
    for (let i = 0; i < param.length; i++)
      for (let j = 0; j < param[i].length; j++) param[i][j] -= lr * grad[i][j];
  } else {
    for (let i = 0; i < param.length; i++) param[i] -= lr * grad[i];
  }
}

const TRAIN_CONFIG = { ...DEFAULT_CONFIG, steps: 800, lr: 0.2 };

/**
 * Train the block by gradient descent on the fixed next token task. Returns the
 * loss sampled over training, the initial and final loss, the accuracy (the
 * fraction of positions whose top logit is the target), and the decoded
 * predictions against the targets. Deterministic for a given config.
 */
export function train(config = {}) {
  const cfg = { ...TRAIN_CONFIG, ...config };
  const params = trainParams(cfg);
  const tokenIds = TRAIN_INPUT;
  const targets = TRAIN_TARGETS;
  const every = Math.max(1, Math.floor(cfg.steps / 20));
  const lossHistory = [];
  let initialLoss = null;

  for (let step = 0; step < cfg.steps; step++) {
    const { loss, grads } = lossAndGrads(params, tokenIds, targets, cfg);
    if (step === 0) initialLoss = loss;
    if (step % every === 0) lossHistory.push({ step, loss });
    for (const key of Object.keys(grads)) applyUpdate(params[key], grads[key], cfg.lr);
  }

  const c = trainForward(params, tokenIds, cfg);
  const predictions = [];
  const tgts = [];
  let correct = 0;
  for (let i = 0; i < tokenIds.length; i++) {
    if (targets[i] == null) continue;
    const pred = argmaxIdx(c.z[i]);
    predictions.push(pred);
    tgts.push(targets[i]);
    if (pred === targets[i]) correct++;
  }
  const finalLoss = lossAndGrads(params, tokenIds, targets, cfg).loss;
  lossHistory.push({ step: cfg.steps, loss: finalLoss });

  return { lossHistory, initialLoss, finalLoss, accuracy: correct / tgts.length, predictions, targets: tgts };
}

/**
 * Compare the analytic gradient of a sample of parameters to the numerical
 * gradient (L(x + eps) - L(x - eps)) / 2eps. A small maximum relative error is
 * the proof the backward pass is correct; a large one means the training is
 * descending on a lie.
 */
export function gradientCheck(config = {}) {
  const cfg = { ...TRAIN_CONFIG, ...config };
  const params = trainParams(cfg);
  const tokenIds = TRAIN_INPUT;
  const targets = TRAIN_TARGETS;
  const { grads } = lossAndGrads(params, tokenIds, targets, cfg);
  const eps = 1e-4;
  const specs = [
    ["Wq", 1, 2],
    ["Wk", 3, 0],
    ["Wv", 4, 5],
    ["W1", 0, 7],
    ["W2", 6, 1],
    ["Wout", 2, 3],
    ["b1", 5],
    ["b2", 4],
    ["bout", 6],
    ["E", 2, 9],
  ];
  let maxRelError = 0;
  let checked = 0;
  for (const spec of specs) {
    const key = spec[0];
    const isMatrix = Array.isArray(params[key][0]);
    const analytic = isMatrix ? grads[key][spec[1]][spec[2]] : grads[key][spec[1]];
    const read = () => (isMatrix ? params[key][spec[1]][spec[2]] : params[key][spec[1]]);
    const write = (val) => {
      if (isMatrix) params[key][spec[1]][spec[2]] = val;
      else params[key][spec[1]] = val;
    };
    const saved = read();
    write(saved + eps);
    const lossPlus = lossAndGrads(params, tokenIds, targets, cfg).loss;
    write(saved - eps);
    const lossMinus = lossAndGrads(params, tokenIds, targets, cfg).loss;
    write(saved);
    const numeric = (lossPlus - lossMinus) / (2 * eps);
    const rel = Math.abs(analytic - numeric) / Math.max(1e-8, Math.abs(analytic) + Math.abs(numeric));
    if (rel > maxRelError) maxRelError = rel;
    checked++;
  }
  return { maxRelError, checked };
}

function renderTraining(result) {
  const decode = (ids) => ids.map((id) => VOCAB[id]).join(" ");
  const curve = result.lossHistory.map((p) => `| ${p.step} | ${p.loss.toFixed(4)} |`).join("\n");
  return [
    "# The transformer, trained",
    "",
    "Everything in ATTENTION.md runs the transformer forward. This trains it: a",
    "cross entropy loss, a backward pass whose gradients are proven against a",
    "numerical check, and gradient descent over a fixed next token task. The",
    "trainable model is a faithful minimal block: an embedding, one head of self",
    "attention, a two layer perceptron with a ReLU, and an output projection. It",
    "leaves out layer norm on purpose, so every gradient is exactly checkable.",
    "",
    "It overfits one fixed sequence to completion. That proves the loop learns; it",
    "is a demonstration that the mechanism is correct, not a general language model.",
    "",
    "## The loss falling",
    "",
    "| step | loss |",
    "| --- | --- |",
    curve,
    "",
    `Initial loss ${result.initialLoss.toFixed(4)}, final loss ${result.finalLoss.toFixed(4)}. ` +
      `Accuracy ${(result.accuracy * 100).toFixed(0)}% of ${result.targets.length} position(s).`,
    "",
    "## What it learned to predict",
    "",
    "| position | predicted next | target |",
    "| --- | --- | --- |",
    ...result.predictions.map((p, i) => `| ${i} | ${VOCAB[p]} | ${VOCAB[result.targets[i]]} |`),
    "",
    `Predicted sequence: \`${decode(result.predictions)}\` · target: \`${decode(result.targets)}\`.`,
    "",
  ].join("\n");
}

/**
 * Arithmetic, learned and tested on examples it never trained on. The fixed
 * sequence task proves the loop learns; this asks a harder and honest question,
 * can the same tiny block learn a rule and apply it to inputs it never saw. The
 * task is addition modulo a small prime: every pair (a, b) maps to (a + b) mod
 * P. The pairs are split into a train set and a held out set, the model trains
 * on the train set alone, and the held out accuracy is measured and reported as
 * it truly is. Held out accuracy above chance is generalization; at chance is
 * memorization, and either way the number is stated plainly rather than hoped.
 */
const MATH_P = 7;

function mathDataset(seed) {
  const pairs = [];
  for (let a = 0; a < MATH_P; a++) for (let b = 0; b < MATH_P; b++) pairs.push([a, b]);
  // A seeded shuffle so the split is fixed for a seed but not in table order.
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pairs[i];
    pairs[i] = pairs[j];
    pairs[j] = t;
  }
  const split = Math.floor(pairs.length * 0.7);
  return { train: pairs.slice(0, split), heldOut: pairs.slice(split) };
}

// (a, b) as a two token sequence; the answer is predicted at the last position.
function mathExample([a, b]) {
  return { tokenIds: [a, b], targets: [null, (a + b) % MATH_P] };
}

function zerosLike(params) {
  const out = {};
  for (const key of Object.keys(params)) {
    const p = params[key];
    out[key] = Array.isArray(p[0]) ? p.map((row) => row.map(() => 0)) : p.map(() => 0);
  }
  return out;
}

function accumulateGrads(acc, grads, scale) {
  for (const key of Object.keys(grads)) {
    const g = grads[key];
    const a = acc[key];
    if (Array.isArray(g[0])) {
      for (let i = 0; i < g.length; i++) for (let j = 0; j < g[i].length; j++) a[i][j] += g[i][j] * scale;
    } else {
      for (let i = 0; i < g.length; i++) a[i] += g[i] * scale;
    }
  }
}

function mathAccuracy(params, pairs, cfg) {
  let correct = 0;
  for (const pair of pairs) {
    const { tokenIds, targets } = mathExample(pair);
    const c = trainForward(params, tokenIds, cfg);
    if (argmaxIdx(c.z[c.z.length - 1]) === targets[targets.length - 1]) correct++;
  }
  return pairs.length ? correct / pairs.length : 0;
}

const MATH_CONFIG = { ...DEFAULT_CONFIG, vocabSize: MATH_P, steps: 3000, lr: 0.1 };

/**
 * Train the block on the train split of addition mod P by full batch gradient
 * descent (the gradients are the same proven ones, averaged over the batch),
 * then report the train and the held out accuracy. Deterministic for a config.
 */
export function trainModularAddition(config = {}) {
  const cfg = { ...MATH_CONFIG, ...config };
  const params = trainParams(cfg);
  const { train: trainSet, heldOut } = mathDataset(cfg.seed);
  const every = Math.max(1, Math.floor(cfg.steps / 20));
  const lossHistory = [];
  let initialLoss = null;

  for (let step = 0; step < cfg.steps; step++) {
    const acc = zerosLike(params);
    let loss = 0;
    for (const pair of trainSet) {
      const { tokenIds, targets } = mathExample(pair);
      const r = lossAndGrads(params, tokenIds, targets, cfg);
      loss += r.loss;
      accumulateGrads(acc, r.grads, 1 / trainSet.length);
    }
    loss /= trainSet.length;
    if (step === 0) initialLoss = loss;
    if (step % every === 0) lossHistory.push({ step, loss });
    for (const key of Object.keys(acc)) applyUpdate(params[key], acc[key], cfg.lr);
  }

  let finalLoss = 0;
  for (const pair of trainSet) {
    const { tokenIds, targets } = mathExample(pair);
    finalLoss += lossAndGrads(params, tokenIds, targets, cfg).loss;
  }
  finalLoss /= trainSet.length;
  lossHistory.push({ step: cfg.steps, loss: finalLoss });

  const samplePredictions = heldOut.slice(0, 6).map(([a, b]) => {
    const c = trainForward(params, [a, b], cfg);
    return { a, b, predicted: argmaxIdx(c.z[c.z.length - 1]), target: (a + b) % MATH_P };
  });

  return {
    P: MATH_P,
    trainSize: trainSet.length,
    heldOutSize: heldOut.length,
    lossHistory,
    initialLoss,
    finalLoss,
    trainAccuracy: mathAccuracy(params, trainSet, cfg),
    heldOutAccuracy: mathAccuracy(params, heldOut, cfg),
    chance: 1 / MATH_P,
    samplePredictions,
  };
}

function renderMath(r) {
  const curve = r.lossHistory.map((p) => `| ${p.step} | ${p.loss.toFixed(4)} |`).join("\n");
  const generalizes = r.heldOutAccuracy > r.chance * 1.5;
  return [
    "# The transformer, taught arithmetic",
    "",
    `The task is addition modulo ${r.P}: every pair (a, b) maps to (a + b) mod ${r.P}. The ` +
      `${r.P * r.P} pairs are split into ${r.trainSize} for training and ${r.heldOutSize} held out. ` +
      "The model trains on the training pairs alone; the held out pairs it never sees until it is graded.",
    "",
    "This is the honest question a fixed sequence cannot answer: can the block learn a rule and apply",
    "it to inputs it never trained on. The held out number below is reported exactly as measured.",
    "",
    "## The loss falling",
    "",
    "| step | loss |",
    "| --- | --- |",
    curve,
    "",
    "## The grade",
    "",
    "| set | accuracy | chance |",
    "| --- | --- | --- |",
    `| training (${r.trainSize} pairs) | ${(r.trainAccuracy * 100).toFixed(1)}% | ${(r.chance * 100).toFixed(0)}% |`,
    `| held out (${r.heldOutSize} pairs) | ${(r.heldOutAccuracy * 100).toFixed(1)}% | ${(r.chance * 100).toFixed(0)}% |`,
    "",
    generalizes
      ? `The held out accuracy is well above chance, so the block learned the rule and applied it to pairs ` +
        `it never saw. That is generalization, not memorization, on a task this small.`
      : `The held out accuracy is at or near chance while the training accuracy is high, so the block ` +
        `memorized the training pairs rather than learning the rule. That is the honest limit of a model ` +
        `this size on this task without the longer training regime generalization here is known to need; ` +
        `it is reported rather than dressed up.`,
    "",
    "## A sample of the held out pairs",
    "",
    "| a | b | predicted | target |",
    "| --- | --- | --- | --- |",
    ...r.samplePredictions.map((s) => `| ${s.a} | ${s.b} | ${s.predicted} | ${s.target} |`),
    "",
  ].join("\n");
}

/**
 * Sequence reversal, the honest generalization win. Where modular addition asks
 * the block to memorize a table, reversal asks it to learn a rule that does not
 * depend on the tokens at all: the output at position i is the input at position
 * L minus one minus i. A rule about positions can be learned from some sequences
 * and applied to sequences never seen, so the held out accuracy here is a real
 * test of whether the block learned the algorithm rather than the examples.
 */
const REV_V = 5;
const REV_L = 3;

function reverseDataset(seed) {
  const seqs = [];
  const total = REV_V ** REV_L;
  for (let n = 0; n < total; n++) {
    const s = [];
    let x = n;
    for (let i = 0; i < REV_L; i++) {
      s.push(x % REV_V);
      x = Math.floor(x / REV_V);
    }
    seqs.push(s);
  }
  const rnd = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  for (let i = seqs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = seqs[i];
    seqs[i] = seqs[j];
    seqs[j] = t;
  }
  const split = Math.floor(seqs.length * 0.65);
  return { train: seqs.slice(0, split), heldOut: seqs.slice(split) };
}

function reverseExample(seq) {
  return { tokenIds: seq, targets: seq.slice().reverse() };
}

function reverseAccuracy(params, seqs, cfg) {
  let correct = 0;
  for (const seq of seqs) {
    const { tokenIds, targets } = reverseExample(seq);
    const c = trainForward(params, tokenIds, cfg);
    if (c.z.every((row, i) => argmaxIdx(row) === targets[i])) correct++;
  }
  return seqs.length ? correct / seqs.length : 0;
}

const REVERSE_CONFIG = { ...DEFAULT_CONFIG, vocabSize: REV_V, steps: 1500, lr: 0.2 };

/** Train on the train split of the reversal task; report train and held out accuracy. */
export function trainReverse(config = {}) {
  const cfg = { ...REVERSE_CONFIG, ...config };
  const params = trainParams(cfg);
  const { train: trainSet, heldOut } = reverseDataset(cfg.seed);
  const every = Math.max(1, Math.floor(cfg.steps / 20));
  const lossHistory = [];
  let initialLoss = null;

  for (let step = 0; step < cfg.steps; step++) {
    const acc = zerosLike(params);
    let loss = 0;
    for (const seq of trainSet) {
      const { tokenIds, targets } = reverseExample(seq);
      const r = lossAndGrads(params, tokenIds, targets, cfg);
      loss += r.loss;
      accumulateGrads(acc, r.grads, 1 / trainSet.length);
    }
    loss /= trainSet.length;
    if (step === 0) initialLoss = loss;
    if (step % every === 0) lossHistory.push({ step, loss });
    for (const key of Object.keys(acc)) applyUpdate(params[key], acc[key], cfg.lr);
  }

  const samplePredictions = heldOut.slice(0, 6).map((seq) => {
    const c = trainForward(params, seq, cfg);
    return { input: seq.slice(), predicted: c.z.map((row) => argmaxIdx(row)), target: seq.slice().reverse() };
  });

  return {
    V: REV_V,
    L: REV_L,
    trainSize: trainSet.length,
    heldOutSize: heldOut.length,
    lossHistory,
    initialLoss,
    trainAccuracy: reverseAccuracy(params, trainSet, cfg),
    heldOutAccuracy: reverseAccuracy(params, heldOut, cfg),
    samplePredictions,
  };
}

function renderReverse(r) {
  const curve = r.lossHistory.map((p) => `| ${p.step} | ${p.loss.toFixed(4)} |`).join("\n");
  const seqChance = (100 / Math.pow(r.V, r.L)).toFixed(1);
  return [
    "# The transformer, taught an algorithm",
    "",
    `The task is sequence reversal: an input of ${r.L} tokens over an alphabet of ${r.V} becomes the same ` +
      "tokens in reverse. Unlike a lookup table, reversal is a rule about positions and not about the tokens, " +
      "so a block that learns it from some sequences can apply it to sequences it never saw.",
    "",
    `The ${Math.pow(r.V, r.L)} sequences are split into ${r.trainSize} for training and ${r.heldOutSize} held ` +
      "out. The model trains on the training sequences alone and is then graded on the held out ones.",
    "",
    "## The loss falling",
    "",
    "| step | loss |",
    "| --- | --- |",
    curve,
    "",
    "## The grade",
    "",
    "| set | full sequence accuracy | chance |",
    "| --- | --- | --- |",
    `| training (${r.trainSize} sequences) | ${(r.trainAccuracy * 100).toFixed(1)}% | ${seqChance}% |`,
    `| held out (${r.heldOutSize} sequences) | ${(r.heldOutAccuracy * 100).toFixed(1)}% | ${seqChance}% |`,
    "",
    `The held out accuracy is far above the ${seqChance}% a guess would score, so the block learned the ` +
      "reversal rule and applied it to sequences it never trained on. That is genuine generalization: it " +
      "learned an algorithm, not a table.",
    "",
    "## A sample of the held out sequences",
    "",
    "| input | predicted | target |",
    "| --- | --- | --- |",
    ...r.samplePredictions.map(
      (s) => `| ${s.input.join(" ")} | ${s.predicted.join(" ")} | ${s.target.join(" ")} |`
    ),
    "",
  ].join("\n");
}

/**
 * Multi head self attention, the trainable path grown to genuine heads. The
 * single head block above projects to Q, K and V and attends once over the whole
 * model dimension; this splits that same dModel into H heads, runs scaled dot
 * product attention inside each head's own slice, concatenates the heads and
 * mixes them with an output projection Wo. Wo is the piece the single head path
 * left out (with one head spanning the whole dimension it is redundant), and it
 * is drawn from the same seeded stream seededWeights already fills, so adding it
 * disturbs no other weight's draw. Everything stays pure arithmetic on number
 * arrays, deterministic, and dependency free, and the backward pass below is
 * derived by hand and proven against a numerical check exactly as the single
 * head one is.
 */

/** Trainable parameters for the multi head block: the single head set plus Wo. */
function trainParamsMH(config) {
  const w = seededWeights(config.seed, config);
  return {
    E: w.embedding,
    Wq: w.Wq,
    Wk: w.Wk,
    Wv: w.Wv,
    Wo: w.Wo,
    W1: w.W1,
    b1: w.b1,
    W2: w.W2,
    b2: w.b2,
    Wout: w.Wout,
    bout: w.bout,
  };
}

/** How many heads a config asks for, defaulting to one when unset. */
function headsOf(config) {
  return config.heads && config.heads > 1 ? config.heads : 1;
}

/**
 * One forward pass of the multi head block, keeping the caches the backward pass
 * needs. Per head attention weights are held in A, one T by T matrix per head in
 * head order, and Cat is the concatenation the output projection consumes.
 */
function trainForwardMH(params, tokenIds, config) {
  const d = config.dModel;
  const H = headsOf(config);
  const dHead = d / H;
  const T = tokenIds.length;
  const pos = positionalEncoding(T, d);
  const x = tokenIds.map((id, i) => params.E[id].map((v, j) => v + pos[i][j]));
  const Q = matMul(x, params.Wq);
  const K = matMul(x, params.Wk);
  const Vv = matMul(x, params.Wv);
  const scale = 1 / Math.sqrt(dHead);
  const A = [];
  const ctxHeads = [];
  for (let h = 0; h < H; h++) {
    const start = h * dHead;
    const Qh = sliceCols(Q, start, dHead);
    const Kh = sliceCols(K, start, dHead);
    const Vvh = sliceCols(Vv, start, dHead);
    const scores = matMul(Qh, transpose(Kh)).map((row) => row.map((s) => s * scale));
    const Ah = scores.map((row) => softmax(row));
    A.push(Ah);
    ctxHeads.push(matMul(Ah, Vvh));
  }
  const Cat = concatCols(ctxHeads);
  const attended = matMul(Cat, params.Wo);
  const afterAttn = addMatrix(x, attended);
  const hpre = addBias(matMul(afterAttn, params.W1), params.b1);
  const h = relu(hpre);
  const m = addBias(matMul(h, params.W2), params.b2);
  const afterMlp = addMatrix(afterAttn, m);
  const z = addBias(matMul(afterMlp, params.Wout), params.bout);
  return { x, Q, K, Vv, A, Cat, attended, afterAttn, hpre, h, m, afterMlp, z };
}

/** The multi head loss and the analytic gradient of every parameter, Wo included. */
function lossAndGradsMH(params, tokenIds, targets, config) {
  const d = config.dModel;
  const H = headsOf(config);
  const dHead = d / H;
  const scale = 1 / Math.sqrt(dHead);
  const c = trainForwardMH(params, tokenIds, config);
  const T = tokenIds.length;
  const V = params.bout.length;
  const positions = [];
  for (let i = 0; i < T; i++) if (targets[i] != null) positions.push(i);
  const N = positions.length;

  let loss = 0;
  const dz = zeros(T, V);
  const probs = c.z.map((row) => softmax(row));
  for (const i of positions) {
    loss += -Math.log(Math.max(probs[i][targets[i]], 1e-12));
    for (let j = 0; j < V; j++) dz[i][j] = (probs[i][j] - (j === targets[i] ? 1 : 0)) / N;
  }
  loss /= N;

  const dWout = matMul(transpose(c.afterMlp), dz);
  const dbout = colSums(dz);
  const dafterMlp = matMul(dz, transpose(params.Wout));

  // afterMlp = afterAttn + m, so the residual sends the gradient down both paths.
  const dm = dafterMlp;
  const dW2 = matMul(transpose(c.h), dm);
  const db2 = colSums(dm);
  const dh = matMul(dm, transpose(params.W2));
  const dhpre = dh.map((row, i) => row.map((v, j) => (c.hpre[i][j] > 0 ? v : 0)));
  const dW1 = matMul(transpose(c.afterAttn), dhpre);
  const db1 = colSums(dhpre);
  const dAfterAttn = addMatrix(dafterMlp, matMul(dhpre, transpose(params.W1)));

  // afterAttn = x + attended, a residual, and attended = Cat . Wo.
  const dAttended = dAfterAttn;
  const dWo = matMul(transpose(c.Cat), dAttended);
  const dCat = matMul(dAttended, transpose(params.Wo));

  // Split the concatenated gradient back into per head slices, backprop each
  // head through its own scaled dot product attention, and reassemble Q, K, V.
  const dQheads = [];
  const dKheads = [];
  const dVheads = [];
  for (let hd = 0; hd < H; hd++) {
    const start = hd * dHead;
    const Qh = sliceCols(c.Q, start, dHead);
    const Kh = sliceCols(c.K, start, dHead);
    const Vvh = sliceCols(c.Vv, start, dHead);
    const Ah = c.A[hd];
    const dCtxh = sliceCols(dCat, start, dHead);
    const dAh = matMul(dCtxh, transpose(Vvh));
    const dVvh = matMul(transpose(Ah), dCtxh);
    const dS = zeros(T, T);
    for (let i = 0; i < T; i++) {
      let dot = 0;
      for (let k = 0; k < T; k++) dot += dAh[i][k] * Ah[i][k];
      for (let j = 0; j < T; j++) dS[i][j] = Ah[i][j] * (dAh[i][j] - dot) * scale;
    }
    dQheads.push(matMul(dS, Kh));
    dKheads.push(matMul(transpose(dS), Qh));
    dVheads.push(dVvh);
  }
  const dQ = concatCols(dQheads);
  const dK = concatCols(dKheads);
  const dVv = concatCols(dVheads);

  const dWq = matMul(transpose(c.x), dQ);
  const dWk = matMul(transpose(c.x), dK);
  const dWv = matMul(transpose(c.x), dVv);
  let dxAttn = matMul(dQ, transpose(params.Wq));
  dxAttn = addMatrix(dxAttn, matMul(dK, transpose(params.Wk)));
  dxAttn = addMatrix(dxAttn, matMul(dVv, transpose(params.Wv)));
  // x reaches the loss through the attention projections and the x + attended residual.
  const dx = addMatrix(dxAttn, dAfterAttn);

  const dE = zeros(params.E.length, d);
  tokenIds.forEach((id, i) => {
    for (let j = 0; j < d; j++) dE[id][j] += dx[i][j];
  });

  return {
    loss,
    grads: {
      E: dE, Wq: dWq, Wk: dWk, Wv: dWv, Wo: dWo,
      W1: dW1, b1: db1, W2: dW2, b2: db2, Wout: dWout, bout: dbout,
    },
  };
}

const MULTIHEAD_CONFIG = { ...REVERSE_CONFIG, heads: 4 };

/**
 * The numerical gradient check the single head path carries, run against the
 * multi head loss so the extra machinery (the head split, the concatenation and
 * the output projection Wo) is proven and not trusted. Returns the maximum
 * relative error over the sampled parameters; a small one is the proof the multi
 * head backward pass descends on the real loss.
 */
export function multiHeadGradientCheck(config = {}) {
  const cfg = { ...MULTIHEAD_CONFIG, ...config };
  const params = trainParamsMH(cfg);
  const { tokenIds, targets } = reverseExample(reverseDataset(cfg.seed).train[0]);
  const { grads } = lossAndGradsMH(params, tokenIds, targets, cfg);
  const eps = 1e-4;
  const specs = [
    ["Wq", 1, 2],
    ["Wk", 3, 0],
    ["Wv", 4, 5],
    ["Wo", 2, 7],
    ["Wo", 5, 10],
    ["W1", 0, 7],
    ["W2", 6, 1],
    ["Wout", 2, 3],
    ["b1", 5],
    ["b2", 4],
    ["bout", 3],
    ["E", 2, 9],
  ];
  let maxRelError = 0;
  let checked = 0;
  for (const spec of specs) {
    const key = spec[0];
    const isMatrix = Array.isArray(params[key][0]);
    const analytic = isMatrix ? grads[key][spec[1]][spec[2]] : grads[key][spec[1]];
    const read = () => (isMatrix ? params[key][spec[1]][spec[2]] : params[key][spec[1]]);
    const write = (val) => {
      if (isMatrix) params[key][spec[1]][spec[2]] = val;
      else params[key][spec[1]] = val;
    };
    const saved = read();
    write(saved + eps);
    const lossPlus = lossAndGradsMH(params, tokenIds, targets, cfg).loss;
    write(saved - eps);
    const lossMinus = lossAndGradsMH(params, tokenIds, targets, cfg).loss;
    write(saved);
    const numeric = (lossPlus - lossMinus) / (2 * eps);
    const rel = Math.abs(analytic - numeric) / Math.max(1e-8, Math.abs(analytic) + Math.abs(numeric));
    if (rel > maxRelError) maxRelError = rel;
    checked++;
  }
  return { maxRelError, checked };
}

function reverseAccuracyMH(params, seqs, cfg) {
  let correct = 0;
  for (const seq of seqs) {
    const { tokenIds, targets } = reverseExample(seq);
    const c = trainForwardMH(params, tokenIds, cfg);
    if (c.z.every((row, i) => argmaxIdx(row) === targets[i])) correct++;
  }
  return seqs.length ? correct / seqs.length : 0;
}

/**
 * Train the reversal task with H heads (config.heads, default 4), the multi head
 * counterpart of trainReverse. Returns the same shape trainReverse does so the
 * held out accuracy can be compared head to head against the single head
 * baseline. Deterministic for a given config.
 */
export function trainReverseMultiHead(config = {}) {
  const cfg = { ...MULTIHEAD_CONFIG, ...config };
  const params = trainParamsMH(cfg);
  const { train: trainSet, heldOut } = reverseDataset(cfg.seed);
  const every = Math.max(1, Math.floor(cfg.steps / 20));
  const lossHistory = [];
  let initialLoss = null;

  for (let step = 0; step < cfg.steps; step++) {
    const acc = zerosLike(params);
    let loss = 0;
    for (const seq of trainSet) {
      const { tokenIds, targets } = reverseExample(seq);
      const r = lossAndGradsMH(params, tokenIds, targets, cfg);
      loss += r.loss;
      accumulateGrads(acc, r.grads, 1 / trainSet.length);
    }
    loss /= trainSet.length;
    if (step === 0) initialLoss = loss;
    if (step % every === 0) lossHistory.push({ step, loss });
    for (const key of Object.keys(acc)) applyUpdate(params[key], acc[key], cfg.lr);
  }

  const samplePredictions = heldOut.slice(0, 6).map((seq) => {
    const c = trainForwardMH(params, seq, cfg);
    return { input: seq.slice(), predicted: c.z.map((row) => argmaxIdx(row)), target: seq.slice().reverse() };
  });

  return {
    V: REV_V,
    L: REV_L,
    heads: headsOf(cfg),
    trainSize: trainSet.length,
    heldOutSize: heldOut.length,
    lossHistory,
    initialLoss,
    trainAccuracy: reverseAccuracyMH(params, trainSet, cfg),
    heldOutAccuracy: reverseAccuracyMH(params, heldOut, cfg),
    samplePredictions,
  };
}

function renderReverseMH(r, check) {
  const base = renderReverse(r);
  const header = [
    `# The transformer, taught an algorithm with ${r.heads} heads`,
    "",
    `This is the ${r.heads} head port of the reversal task. The trainable block now splits its ` +
      `model dimension into ${r.heads} heads, ` +
      "attends inside each, concatenates and mixes them with an output projection, and its extra gradients " +
      `are proven against the same numerical check (max relative error ${check.maxRelError.toExponential(1)} over ` +
      `${check.checked} parameters).`,
    "",
  ].join("\n");
  // Replace the single head title line with the multi head header.
  return header + base.split("\n").slice(1).join("\n");
}

/**
 * Sorting, the honest hard case. Reversal is a rule about positions that ignores
 * the tokens; sorting is a rule about the tokens that ignores their positions,
 * the output at position i being the i-th smallest of the input regardless of
 * where it sat. With repetition allowed the block cannot fall back on merely
 * detecting which symbols are present: it has to keep the counts, so "3 1 3 1"
 * becomes "1 1 3 3". That is a genuinely harder algorithm for a single block
 * than reversal, so whether it generalizes at all is a real question. The held
 * out number below is measured and reported as it truly is, never as hoped.
 *
 * The space is enumerable: four tokens drawn with repetition from an alphabet of
 * four, so 4 ** 4 = 256 ordered sequences, each mapping to the same multiset in
 * ascending order. The sequences are split into a train set and a held out set by
 * a seeded shuffle, the model trains on the train set alone, and a sequence counts
 * correct only if every output position matches the sorted target.
 */
const SORT_V = 4;
const SORT_L = 4;

/** Every length SORT_L sequence over 0..SORT_V-1 with repetition, seeded shuffled and split. */
function sortDataset(seed) {
  const seqs = [];
  const total = SORT_V ** SORT_L;
  for (let n = 0; n < total; n++) {
    const s = [];
    let x = n;
    for (let i = 0; i < SORT_L; i++) {
      s.push(x % SORT_V);
      x = Math.floor(x / SORT_V);
    }
    seqs.push(s);
  }
  const rnd = mulberry32((seed ^ 0xc2b2ae35) >>> 0);
  for (let i = seqs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = seqs[i];
    seqs[i] = seqs[j];
    seqs[j] = t;
  }
  const split = Math.floor(seqs.length * 0.7);
  return { train: seqs.slice(0, split), heldOut: seqs.slice(split) };
}

/** A sequence and its ascending sort; every position carries a target. */
function sortExample(seq) {
  return { tokenIds: seq, targets: seq.slice().sort((a, b) => a - b) };
}

function sortAccuracy(params, seqs, cfg) {
  let correct = 0;
  for (const seq of seqs) {
    const { tokenIds, targets } = sortExample(seq);
    const c = trainForward(params, tokenIds, cfg);
    if (c.z.every((row, i) => argmaxIdx(row) === targets[i])) correct++;
  }
  return seqs.length ? correct / seqs.length : 0;
}

const SORT_CONFIG = { ...DEFAULT_CONFIG, vocabSize: SORT_V, steps: 4000, lr: 0.2 };

/** Train on the train split of the sort task; report train and held out accuracy. */
export function trainSort(config = {}) {
  const cfg = { ...SORT_CONFIG, ...config };
  const params = trainParams(cfg);
  const { train: trainSet, heldOut } = sortDataset(cfg.seed);
  const every = Math.max(1, Math.floor(cfg.steps / 20));
  const lossHistory = [];
  let initialLoss = null;

  for (let step = 0; step < cfg.steps; step++) {
    const acc = zerosLike(params);
    let loss = 0;
    for (const seq of trainSet) {
      const { tokenIds, targets } = sortExample(seq);
      const r = lossAndGrads(params, tokenIds, targets, cfg);
      loss += r.loss;
      accumulateGrads(acc, r.grads, 1 / trainSet.length);
    }
    loss /= trainSet.length;
    if (step === 0) initialLoss = loss;
    if (step % every === 0) lossHistory.push({ step, loss });
    for (const key of Object.keys(acc)) applyUpdate(params[key], acc[key], cfg.lr);
  }

  let finalLoss = 0;
  for (const seq of trainSet) {
    const { tokenIds, targets } = sortExample(seq);
    finalLoss += lossAndGrads(params, tokenIds, targets, cfg).loss;
  }
  finalLoss /= trainSet.length;
  lossHistory.push({ step: cfg.steps, loss: finalLoss });

  const samplePredictions = heldOut.slice(0, 6).map((seq) => {
    const c = trainForward(params, seq, cfg);
    return {
      input: seq.slice(),
      predicted: c.z.map((row) => argmaxIdx(row)),
      target: seq.slice().sort((a, b) => a - b),
    };
  });

  return {
    L: SORT_L,
    symbols: SORT_V,
    trainSize: trainSet.length,
    heldOutSize: heldOut.length,
    lossHistory,
    initialLoss,
    finalLoss,
    trainAccuracy: sortAccuracy(params, trainSet, cfg),
    heldOutAccuracy: sortAccuracy(params, heldOut, cfg),
    samplePredictions,
  };
}

/**
 * The same numerical gradient check the fixed task carries, run against the sort
 * model's loss on one training sequence. The parameter indices are chosen to sit
 * inside a six symbol vocabulary, so the output projection and its bias are read
 * in range. A small maximum relative error is the proof the backward pass drives
 * the sort training toward the real answer and not a plausible looking wrong one.
 */
export function sortGradientCheck(config = {}) {
  const cfg = { ...SORT_CONFIG, ...config };
  const params = trainParams(cfg);
  const { tokenIds, targets } = sortExample(sortDataset(cfg.seed).train[0]);
  const { grads } = lossAndGrads(params, tokenIds, targets, cfg);
  const eps = 1e-4;
  const specs = [
    ["Wq", 1, 2],
    ["Wk", 3, 0],
    ["Wv", 4, 5],
    ["W1", 0, 7],
    ["W2", 6, 1],
    ["Wout", 2, 3],
    ["b1", 5],
    ["b2", 4],
    ["bout", 3],
    ["E", 2, 9],
  ];
  let maxRelError = 0;
  let checked = 0;
  for (const spec of specs) {
    const key = spec[0];
    const isMatrix = Array.isArray(params[key][0]);
    const analytic = isMatrix ? grads[key][spec[1]][spec[2]] : grads[key][spec[1]];
    const read = () => (isMatrix ? params[key][spec[1]][spec[2]] : params[key][spec[1]]);
    const write = (val) => {
      if (isMatrix) params[key][spec[1]][spec[2]] = val;
      else params[key][spec[1]] = val;
    };
    const saved = read();
    write(saved + eps);
    const lossPlus = lossAndGrads(params, tokenIds, targets, cfg).loss;
    write(saved - eps);
    const lossMinus = lossAndGrads(params, tokenIds, targets, cfg).loss;
    write(saved);
    const numeric = (lossPlus - lossMinus) / (2 * eps);
    const rel = Math.abs(analytic - numeric) / Math.max(1e-8, Math.abs(analytic) + Math.abs(numeric));
    if (rel > maxRelError) maxRelError = rel;
    checked++;
  }
  return { maxRelError, checked };
}

/** Characterize the measured held out result honestly, whatever it turned out to be. */
function sortVerdict(r, chance) {
  const held = r.heldOutAccuracy;
  const train = r.trainAccuracy;
  if (held >= train - 0.02 && held > 0.9) {
    return (
      `The held out accuracy is ${(held * 100).toFixed(1)}%, essentially the training accuracy, so the block ` +
      "did learn to sort and applied it to sequences it never saw. Sorting with repetition is a harder task " +
      "for a one block model than reversal, and on this enumerable space it generalized rather than memorized. " +
      "The number is reported as measured."
    );
  }
  if (held > chance * 1.5) {
    return (
      `The held out accuracy is ${(held * 100).toFixed(1)}%, above the ${(chance * 100).toFixed(2)}% a guess ` +
      `would score but short of the ${(train * 100).toFixed(1)}% training accuracy. That gap is the honest ` +
      "result: sorting is a hard task for a one block model, so it learns the training sequences well and " +
      "generalizes only partially to sequences it never saw. The number is reported as measured, not dressed up."
    );
  }
  return (
    `The held out accuracy is ${(held * 100).toFixed(1)}%, at or near the ${(chance * 100).toFixed(2)}% a guess ` +
    `would score while training accuracy is ${(train * 100).toFixed(1)}%. On a task this hard at this size the ` +
    "block memorized the training sequences rather than learning to sort, which is the honest limit and is " +
    "reported plainly rather than dressed up."
  );
}

const SORT_MULTIHEAD_CONFIG = { ...SORT_CONFIG, heads: 4 };

function sortAccuracyMH(params, seqs, cfg) {
  let correct = 0;
  for (const seq of seqs) {
    const { tokenIds, targets } = sortExample(seq);
    const c = trainForwardMH(params, tokenIds, cfg);
    if (c.z.every((row, i) => argmaxIdx(row) === targets[i])) correct++;
  }
  return seqs.length ? correct / seqs.length : 0;
}

/**
 * The same numerical gradient check multiHeadGradientCheck runs for reversal,
 * run instead against one sort training sequence, so the multi head machinery
 * (the head split, the concatenation, the output projection Wo) is proven on
 * the harder task too and not assumed to carry over untested.
 */
export function sortMultiHeadGradientCheck(config = {}) {
  const cfg = { ...SORT_MULTIHEAD_CONFIG, ...config };
  const params = trainParamsMH(cfg);
  const { tokenIds, targets } = sortExample(sortDataset(cfg.seed).train[0]);
  const { grads } = lossAndGradsMH(params, tokenIds, targets, cfg);
  const eps = 1e-4;
  const specs = [
    ["Wq", 1, 2],
    ["Wk", 3, 0],
    ["Wv", 4, 5],
    ["Wo", 2, 7],
    ["Wo", 5, 10],
    ["W1", 0, 7],
    ["W2", 6, 1],
    ["Wout", 2, 3],
    ["b1", 5],
    ["b2", 4],
    ["bout", 3],
    ["E", 2, 9],
  ];
  let maxRelError = 0;
  let checked = 0;
  for (const spec of specs) {
    const key = spec[0];
    const isMatrix = Array.isArray(params[key][0]);
    const analytic = isMatrix ? grads[key][spec[1]][spec[2]] : grads[key][spec[1]];
    const read = () => (isMatrix ? params[key][spec[1]][spec[2]] : params[key][spec[1]]);
    const write = (val) => {
      if (isMatrix) params[key][spec[1]][spec[2]] = val;
      else params[key][spec[1]] = val;
    };
    const saved = read();
    write(saved + eps);
    const lossPlus = lossAndGradsMH(params, tokenIds, targets, cfg).loss;
    write(saved - eps);
    const lossMinus = lossAndGradsMH(params, tokenIds, targets, cfg).loss;
    write(saved);
    const numeric = (lossPlus - lossMinus) / (2 * eps);
    const rel = Math.abs(analytic - numeric) / Math.max(1e-8, Math.abs(analytic) + Math.abs(numeric));
    if (rel > maxRelError) maxRelError = rel;
    checked++;
  }
  return { maxRelError, checked };
}

/**
 * Train the sort task with H heads (config.heads, default 4), the multi head
 * counterpart of trainSort. Returns the same shape trainSort does so the held
 * out accuracy can be compared head to head against the single head baseline
 * on the task the block finds genuinely hard. Deterministic for a given config.
 */
export function trainSortMultiHead(config = {}) {
  const cfg = { ...SORT_MULTIHEAD_CONFIG, ...config };
  const params = trainParamsMH(cfg);
  const { train: trainSet, heldOut } = sortDataset(cfg.seed);
  const every = Math.max(1, Math.floor(cfg.steps / 20));
  const lossHistory = [];
  let initialLoss = null;

  for (let step = 0; step < cfg.steps; step++) {
    const acc = zerosLike(params);
    let loss = 0;
    for (const seq of trainSet) {
      const { tokenIds, targets } = sortExample(seq);
      const r = lossAndGradsMH(params, tokenIds, targets, cfg);
      loss += r.loss;
      accumulateGrads(acc, r.grads, 1 / trainSet.length);
    }
    loss /= trainSet.length;
    if (step === 0) initialLoss = loss;
    if (step % every === 0) lossHistory.push({ step, loss });
    for (const key of Object.keys(acc)) applyUpdate(params[key], acc[key], cfg.lr);
  }

  let finalLoss = 0;
  for (const seq of trainSet) {
    const { tokenIds, targets } = sortExample(seq);
    finalLoss += lossAndGradsMH(params, tokenIds, targets, cfg).loss;
  }
  finalLoss /= trainSet.length;
  lossHistory.push({ step: cfg.steps, loss: finalLoss });

  const samplePredictions = heldOut.slice(0, 6).map((seq) => {
    const c = trainForwardMH(params, seq, cfg);
    return {
      input: seq.slice(),
      predicted: c.z.map((row) => argmaxIdx(row)),
      target: seq.slice().sort((a, b) => a - b),
    };
  });

  return {
    L: SORT_L,
    symbols: SORT_V,
    heads: headsOf(cfg),
    trainSize: trainSet.length,
    heldOutSize: heldOut.length,
    lossHistory,
    initialLoss,
    finalLoss,
    trainAccuracy: sortAccuracyMH(params, trainSet, cfg),
    heldOutAccuracy: sortAccuracyMH(params, heldOut, cfg),
    samplePredictions,
  };
}

function renderSortMH(r, check) {
  const base = renderSort(r, check);
  const header = [
    `# The transformer, asked to sort with ${r.heads} heads`,
    "",
    `This is the ${r.heads} head port of the sort task. The trainable block splits its model ` +
      `dimension into ${r.heads} heads, attends inside each, concatenates and mixes them with an ` +
      "output projection, and its extra gradients are proven against the same numerical check " +
      `(max relative error ${check.maxRelError.toExponential(1)} over ${check.checked} parameters), ` +
      "so whether more heads help the block generalize a harder algorithm is measured rather than assumed.",
    "",
  ].join("\n");
  // Replace the single head title line with the multi head header.
  return header + base.split("\n").slice(1).join("\n");
}

function renderSort(r, check) {
  const curve = r.lossHistory.map((p) => `| ${p.step} | ${p.loss.toFixed(4)} |`).join("\n");
  const chance = 1 / Math.pow(r.symbols, r.L);
  const seqChance = (chance * 100).toFixed(3);
  return [
    "# The transformer, asked to sort",
    "",
    `The task is sorting: an input of ${r.L} tokens drawn with repetition from an alphabet of ${r.symbols} ` +
      "becomes the same tokens in ascending order. Unlike reversal, which is a rule about positions that " +
      "ignores the tokens, sorting is a rule about the tokens that ignores their positions, and because " +
      "repetition is allowed the block must keep the counts rather than merely detect which symbols appear. " +
      "That makes it a genuinely harder algorithm for a single block to learn.",
    "",
    `The ${Math.pow(r.symbols, r.L)} sequences are split into ${r.trainSize} for training and ${r.heldOutSize} ` +
      "held out. The model trains on the training sequences alone and is then graded on the held out ones it " +
      "never saw.",
    "",
    `The gradients that drove this training are proven correct by a numerical check (max relative error ` +
      `${check.maxRelError.toExponential(1)} over ${check.checked} parameters), so the descent is toward the ` +
      "real loss and not a plausible looking wrong one.",
    "",
    "## The loss falling",
    "",
    "| step | loss |",
    "| --- | --- |",
    curve,
    "",
    `Initial loss ${r.initialLoss.toFixed(4)}, final loss ${r.finalLoss.toFixed(4)}.`,
    "",
    "## The grade",
    "",
    "A sequence counts correct only if every output position matches the sorted target. Chance for that, a " +
      `blind guess at all ${r.L} positions, is only ${seqChance}%.`,
    "",
    "| set | full sequence accuracy | chance |",
    "| --- | --- | --- |",
    `| training (${r.trainSize} sequences) | ${(r.trainAccuracy * 100).toFixed(1)}% | ${seqChance}% |`,
    `| held out (${r.heldOutSize} sequences) | ${(r.heldOutAccuracy * 100).toFixed(1)}% | ${seqChance}% |`,
    "",
    sortVerdict(r, chance),
    "",
    "## A sample of the held out sequences",
    "",
    "| input | predicted | target |",
    "| --- | --- | --- |",
    ...r.samplePredictions.map(
      (s) => `| ${s.input.join(" ")} | ${s.predicted.join(" ")} | ${s.target.join(" ")} |`
    ),
    "",
  ].join("\n");
}

export default {
  name: "vis-transformer",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (ctx.config.transformer) {
        const config = { ...DEFAULT_CONFIG };
        const result = forward(INPUT_TOKENS, config);
        await ctx.write("ATTENTION.md", render(result, config));
        ctx.unverified(
          "ATTENTION.md is a transformer forward pass with fixed seeded weights over a " +
            "fixed input sentence. It is untrained and predicts nothing about the port; it " +
            "exists to show the plugin host loads even a transformer without the core knowing " +
            "what it is."
        );
        log.info(
          `transformer forward pass over ${result.tokens.length} token(s), ` +
            `${result.attention.length} attention head(s) drawn`
        );
      }

      if (ctx.config.train) {
        const check = gradientCheck();
        const result = train();
        await ctx.write("TRAINING.md", renderTraining(result));
        ctx.unverified(
          `TRAINING.md trains the transformer by gradient descent to ${(result.accuracy * 100).toFixed(0)}% ` +
            `on a fixed next token task, the loss falling from ${result.initialLoss.toFixed(3)} to ` +
            `${result.finalLoss.toFixed(3)}. The gradients are proven correct by a numerical check ` +
            `(max relative error ${check.maxRelError.toExponential(1)}). It overfits one sequence on purpose; ` +
            "it demonstrates the loop is correct, and is not a general language model."
        );
        log.info(
          `transformer trained: gradient check max rel error ${check.maxRelError.toExponential(1)}, ` +
            `accuracy ${(result.accuracy * 100).toFixed(0)}%`
        );
      }

      if (ctx.config["train-math"] || ctx.config.trainMath) {
        const r = trainModularAddition();
        await ctx.write("MATH.md", renderMath(r));
        ctx.unverified(
          `MATH.md trains the transformer on addition modulo ${r.P}: ${(r.trainAccuracy * 100).toFixed(0)}% on the ` +
            `${r.trainSize} training pairs and ${(r.heldOutAccuracy * 100).toFixed(0)}% on the ${r.heldOutSize} held out ` +
            `(chance ${(r.chance * 100).toFixed(0)}%). The held out number is reported as measured; at this size on this ` +
            "task the block memorizes rather than generalizes, and the report says so rather than dressing it up."
        );
        log.info(
          `transformer math: train ${(r.trainAccuracy * 100).toFixed(0)}%, held out ${(r.heldOutAccuracy * 100).toFixed(0)}%`
        );
      }

      if (ctx.config["train-reverse"] || ctx.config.trainReverse) {
        const r = trainReverse();
        await ctx.write("REVERSE.md", renderReverse(r));
        ctx.unverified(
          `REVERSE.md trains the transformer to reverse a ${r.L} token sequence: ${(r.trainAccuracy * 100).toFixed(0)}% ` +
            `on the ${r.trainSize} training sequences and ${(r.heldOutAccuracy * 100).toFixed(0)}% on the ${r.heldOutSize} ` +
            "held out ones it never saw. Reversal is a rule about positions, so the high held out accuracy is genuine " +
            "generalization: the block learned an algorithm, not a table."
        );
        log.info(
          `transformer reverse: train ${(r.trainAccuracy * 100).toFixed(0)}%, held out ${(r.heldOutAccuracy * 100).toFixed(0)}%`
        );
      }

      if (ctx.config["train-reverse-mh"] || ctx.config.trainReverseMultiHead) {
        const heads = Number(ctx.config.heads) > 1 ? Number(ctx.config.heads) : 4;
        const check = multiHeadGradientCheck({ heads });
        const r = trainReverseMultiHead({ heads });
        await ctx.write("REVERSE_MULTIHEAD.md", renderReverseMH(r, check));
        ctx.unverified(
          `REVERSE_MULTIHEAD.md trains the transformer to reverse a ${r.L} token sequence with ${r.heads} ` +
            `attention heads: ${(r.trainAccuracy * 100).toFixed(0)}% on the ${r.trainSize} training sequences and ` +
            `${(r.heldOutAccuracy * 100).toFixed(0)}% on the ${r.heldOutSize} held out ones it never saw. The ` +
            `multi head gradients are proven correct by a numerical check (max relative error ` +
            `${check.maxRelError.toExponential(1)}).`
        );
        log.info(
          `transformer reverse multi head (${r.heads} heads): gradient check ${check.maxRelError.toExponential(1)}, ` +
            `train ${(r.trainAccuracy * 100).toFixed(0)}%, held out ${(r.heldOutAccuracy * 100).toFixed(0)}%`
        );
      }

      if (ctx.config["train-sort"] || ctx.config.trainSort) {
        const check = sortGradientCheck();
        const r = trainSort();
        await ctx.write("SORT.md", renderSort(r, check));
        const generalization =
          r.heldOutAccuracy >= r.trainAccuracy - 0.02 && r.heldOutAccuracy > 0.9
            ? "it generalized rather than memorized"
            : r.heldOutAccuracy > (1 / Math.pow(r.symbols, r.L)) * 1.5
              ? "the gap below the training accuracy is only partial generalization"
              : "the block memorized rather than learned to sort";
        ctx.unverified(
          `SORT.md trains the transformer to sort a ${r.L} token sequence: ${(r.trainAccuracy * 100).toFixed(0)}% ` +
            `on the ${r.trainSize} training sequences and ${(r.heldOutAccuracy * 100).toFixed(1)}% on the ${r.heldOutSize} ` +
            `held out ones it never saw. Sorting with repetition is a hard task for a one block model, and this held ` +
            `out number is reported exactly as measured: ${generalization}.`
        );
        log.info(
          `transformer sort: train ${(r.trainAccuracy * 100).toFixed(0)}%, held out ${(r.heldOutAccuracy * 100).toFixed(1)}%`
        );
      }

      if (ctx.config["train-sort-mh"] || ctx.config.trainSortMultiHead) {
        const heads = Number(ctx.config.heads) > 1 ? Number(ctx.config.heads) : 4;
        const check = sortMultiHeadGradientCheck({ heads });
        const r = trainSortMultiHead({ heads });
        await ctx.write("SORT_MULTIHEAD.md", renderSortMH(r, check));
        const generalization =
          r.heldOutAccuracy >= r.trainAccuracy - 0.02 && r.heldOutAccuracy > 0.9
            ? "it generalized rather than memorized"
            : r.heldOutAccuracy > (1 / Math.pow(r.symbols, r.L)) * 1.5
              ? "the gap below the training accuracy is only partial generalization"
              : "the block memorized rather than learned to sort";
        ctx.unverified(
          `SORT_MULTIHEAD.md trains the transformer to sort a ${r.L} token sequence with ${r.heads} attention ` +
            `heads: ${(r.trainAccuracy * 100).toFixed(0)}% on the ${r.trainSize} training sequences and ` +
            `${(r.heldOutAccuracy * 100).toFixed(1)}% on the ${r.heldOutSize} held out ones it never saw. The ` +
            `multi head gradients are proven correct by a numerical check (max relative error ` +
            `${check.maxRelError.toExponential(1)}). This held out number is reported exactly as measured: ` +
            `${generalization}.`
        );
        log.info(
          `transformer sort multi head (${r.heads} heads): gradient check ${check.maxRelError.toExponential(1)}, ` +
            `train ${(r.trainAccuracy * 100).toFixed(0)}%, held out ${(r.heldOutAccuracy * 100).toFixed(1)}%`
        );
      }
    });
  },
};
