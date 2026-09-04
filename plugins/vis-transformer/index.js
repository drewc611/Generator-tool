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

export default {
  name: "vis-transformer",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (!ctx.config.transformer) return log.debug("not requested");

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
    });
  },
};
