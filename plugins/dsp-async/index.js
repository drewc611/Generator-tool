import { readFile } from "node:fs/promises";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The asynchronous shapes a legacy front end wrote before async and await were
 * common. A callback passed to a call, whose own body passes another callback,
 * whose body passes another, marches to the right until the logic disappears
 * into the punctuation: the pyramid of doom. A promise chain that grows past a
 * few links reads as a sequence a person has to unroll in their head to follow
 * the order things happen in. Both say plainly, in a modern tongue, as a
 * straight run of awaits, and the port is the moment to straighten them while
 * the old order is still in front of you.
 *
 * This measures shape from the source text, not from a parser, so the depth
 * numbers are an approximation and say so: a brace inside a string or a comment
 * counts like any other. It measures; it rewrites nothing. Straightening
 * control flow is a decision the port owner makes on the evidence, and this
 * names where.
 */

// A function used as an argument opens right after a "(" or a "," and takes one
// of two shapes: a classic expression or an arrow with a braced body. Each is
// anchored and non greedy over the parameter list, so the match is a single
// linear scan with nothing to backtrack over.
const CALLBACK_ARG = /([(,])\s*(?:async\s+)?(?:function\s*\*?\s*[A-Za-z_$]*\s*\([^)]*\)|\([^)]*\)\s*=>)\s*\{/g;

// One promise link. Anchored on the dot and the method name, non backtracking.
const PROMISE_LINK = /\.\s*(?:then|catch|finally)\s*\(/g;

// The nesting a pyramid reaches is how many callback argument functions are
// open at the brace where a new one opens. A linear character scan tracks brace
// depth and remembers, on a small stack, the brace depth at which each callback
// body began; a callback still open at the current point is one whose opening
// brace depth has not been closed past. This is the approximation the module
// admits to: braces in strings and comments are counted like any other, which
// biases toward flagging, the safe direction for a report that points a person
// at what to look at.
function pyramids(text, rel) {
  // Mark the opening brace index of every callback argument function.
  const opens = new Map();
  for (const m of text.matchAll(CALLBACK_ARG)) {
    const brace = m.index + m[0].length - 1;
    opens.set(brace, true);
  }

  const findings = [];
  const stack = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{") {
      depth += 1;
      if (opens.has(i)) {
        stack.push(depth);
        // Nesting count is how many callback bodies are now open at once.
        if (stack.length >= 3) {
          findings.push({ kind: "callback-pyramid", line: lineAt(text, i), depth: stack.length, file: rel });
        }
      }
    } else if (c === "}") {
      // A callback body closes when brace depth drops back below where it began.
      while (stack.length && stack[stack.length - 1] > depth) stack.pop();
      depth -= 1;
      while (stack.length && stack[stack.length - 1] > depth) stack.pop();
    }
  }
  return findings;
}

// A run of promise links close together is one chain. Walk the links in order
// and group any that sit within a small character window of the previous one,
// so `.then(...).then(...).catch(...)` across a few lines reads as one chain of
// four rather than four unrelated calls.
const CHAIN_GAP = 400;

function chains(text, rel) {
  const links = [...text.matchAll(PROMISE_LINK)].map((m) => m.index);
  const findings = [];
  let start = 0;
  while (start < links.length) {
    let end = start;
    while (end + 1 < links.length && links[end + 1] - links[end] <= CHAIN_GAP) end += 1;
    const count = end - start + 1;
    if (count >= 3) {
      findings.push({ kind: "promise-chain", line: lineAt(text, links[start]), depth: count, file: rel });
    }
    start = end + 1;
  }
  return findings;
}

export function readAsync(text, rel) {
  return [...pyramids(text, rel), ...chains(text, rel)].sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-async",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter(
        (f) => /\.(js|jsx|ts|tsx|mjs)$/i.test(f.rel) && !/\.min\./.test(f.rel) && !/\.(spec|test)\./.test(f.rel)
      );
      const findings = [];
      const byKind = {};
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        for (const finding of readAsync(text, file.rel)) {
          findings.push(finding);
          byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
        }
      }
      ctx.async = { findings, byKind };
      if (!findings.length) return log.debug("no callback pyramid or long promise chain in the scripts");

      const pyr = byKind["callback-pyramid"] ?? 0;
      const chn = byKind["promise-chain"] ?? 0;
      log.info(`${pyr} callback pyramid(s) and ${chn} promise chain(s) across ${new Set(findings.map((f) => f.file)).size} file(s)`);
      ctx.unverified(
        `ASYNC.md names ${pyr} callback pyramid(s) and ${chn} long promise chain(s) the old front end wrote before async and ` +
        `await were common. Both read more clearly as a straight run of awaits, and the port is the moment to straighten them. ` +
        `Nothing was rewritten. The depth numbers are a text based approximation, not a parser's.`
      );
    });

    on("emit", async (ctx) => {
      // A run whose scripts carried neither shape writes no report: an empty
      // ASYNC.md in every clean port is noise.
      if (!ctx.async?.findings?.length) return;
      await ctx.write("ASYNC.md", render(ctx.async));
    });
  },
};

function render({ findings }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items
        .sort((a, b) => a.line - b.line)
        .map((f) => `- line ${f.line}: ${f.kind} (depth ${f.depth})`);
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  return `# The asynchronous shapes to straighten during the port

Each entry is a callback pyramid or a long promise chain found in the source. A
callback nested inside a callback inside a callback marches to the right until
the order things happen in disappears into the punctuation, and a promise chain
past a few links reads as a sequence a person has to unroll to follow. Both read
more clearly as a straight run of async and await, and the port is the moment to
straighten them, while the old order is still in front of you.

The depth numbers are a text based approximation, read from the source without a
parser: braces inside strings and comments are counted like any other, and links
are grouped by how close together they sit. Treat them as a place to look, not a
compiler's metric.

${groups.join("\n\n")}

---

Nothing was rewritten. Straightening control flow changes how the code reads and
sometimes how it runs, so which of these to unroll into async and await is the
port owner's call, and this names where.
`;
}
