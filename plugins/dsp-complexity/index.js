import { readFile } from "node:fs/promises";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The functions a legacy front end grew too tangled to port cleanly. A screen
 * that hides its logic inside one long function with branches nested five deep
 * does not become clearer when it is rewritten in another framework; the tangle
 * ports across unless a person straightens it, and the best moment to straighten
 * it is before or during the port, while the old behavior is still in front of
 * them. A hundred line function reborn as a hundred line React component is a
 * port that shipped the debt.
 *
 * This measures shape from the source text, not from a compiler, so the numbers
 * are an approximation and say so: line count, the deepest brace nesting, and a
 * rough branch count standing in for cyclomatic complexity. It measures; it
 * rewrites nothing. Which of these to split, and how, is a design decision the
 * port owner makes, and this names where to look.
 */

// Each anchored on a word boundary or an assignment, so every match is a single
// linear scan with nothing for the engine to backtrack over.
const FUNC_DECL = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g;
const FUNC_EXPR = /\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?function\s*\*?\s*\([^)]*\)\s*\{/g;
const ARROW = /\b([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;
const METHOD = /(?:^|[\s,{;])([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;

// Words that begin a control branch, counted as a linear cyclomatic proxy. The
// short circuit operators and the ternary are counted separately below because
// they are punctuation, not words.
const BRANCH_WORD = /\b(if|for|while|case)\b/g;

// Walk from the opening brace to its match with a plain depth counter. This is
// the approximation the module admits to: a brace inside a string or a comment
// is counted like any other, so a function full of literal braces reads deeper
// than it runs. The bias is toward flagging, which is the safe direction for a
// report whose job is to point a person at what to look at.
const matchBrace = (text, open) => {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
};

const countMatches = (body, re) => {
  let n = 0;
  for (const _ of body.matchAll(re)) n += 1;
  return n;
};

const maxBraceDepth = (body) => {
  let depth = 0;
  let max = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "{") {
      depth += 1;
      if (depth > max) max = depth;
    } else if (c === "}") {
      depth -= 1;
    }
  }
  return max;
};

// A control keyword followed by its parenthesised head and a brace looks like
// a method to a text scanner. These are the shapes to refuse so `if (...) {` is
// never reported as a function named if.
const KEYWORD = new Set([
  "if", "for", "while", "switch", "catch", "with", "do", "else",
  "function", "return", "typeof", "await", "case", "try", "finally",
]);

const LINES = 40;
const DEPTH = 4;
const BRANCHES = 10;

export function readComplexity(text, rel) {
  const findings = [];
  const seen = new Set();

  const scan = (re, nameIndex) => {
    for (const m of text.matchAll(re)) {
      // The opening brace is the last character each pattern captures.
      const open = m.index + m[0].length - 1;
      if (seen.has(open)) continue;
      const name = m[nameIndex] || "(anonymous)";
      if (KEYWORD.has(name)) continue;
      seen.add(open);

      const close = matchBrace(text, open);
      const body = text.slice(open, close + 1);
      const start = lineAt(text, m.index);
      const lines = lineAt(text, close) - start + 1;
      const maxDepth = maxBraceDepth(body);
      const branches =
        countMatches(body, BRANCH_WORD) +
        countMatches(body, /&&/g) +
        countMatches(body, /\|\|/g) +
        countMatches(body, /\?/g);

      if (lines > LINES || maxDepth >= DEPTH || branches >= BRANCHES) {
        findings.push({
          name,
          line: start,
          lines,
          maxDepth,
          branches,
          file: rel,
        });
      }
    }
  };

  scan(FUNC_DECL, 1);
  scan(FUNC_EXPR, 1);
  scan(ARROW, 1);
  scan(METHOD, 1);

  return findings.sort((a, b) => a.line - b.line);
}

const worst = (a, b) =>
  b.lines + b.maxDepth * 10 + b.branches - (a.lines + a.maxDepth * 10 + a.branches);

export default {
  name: "dsp-complexity",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter(
        (f) => /\.(js|jsx|ts|tsx|mjs)$/i.test(f.rel) && !/\.min\./.test(f.rel) && !/\.(spec|test)\./.test(f.rel)
      );
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        for (const finding of readComplexity(text, file.rel)) findings.push(finding);
      }
      ctx.complexity = { findings };
      if (!findings.length) return log.debug("no function tangled past the thresholds");

      log.info(`${findings.length} tangled function(s) across ${new Set(findings.map((f) => f.file)).size} file(s)`);
      ctx.unverified(
        `COMPLEXITY.md names ${findings.length} function(s) the old front end grew too tangled to port cleanly (over ` +
        `${LINES} lines, or nested ${DEPTH} deep, or ${BRANCHES} branches). Ported unchanged the tangle carries across; ` +
        `straighten these before or during the port. The numbers are a text based approximation, not a compiler's metric.`
      );
    });

    on("emit", async (ctx) => {
      // A run whose functions all stayed under the thresholds writes no report:
      // an empty COMPLEXITY.md in every clean port is noise.
      if (!ctx.complexity?.findings?.length) return;
      await ctx.write("COMPLEXITY.md", render(ctx.complexity));
    });
  },
};

function render({ findings }) {
  const rows = [...findings]
    .sort(worst)
    .map((f) => `| \`${f.name}\` | \`${f.file}:${f.line}\` | ${f.lines} | ${f.maxDepth} | ${f.branches} |`);

  return `# The functions to straighten before the port carries the tangle across

Each row is a function the old front end grew tangled enough that porting it
unchanged ships the debt: a long function reborn in another framework is still
a long function. Straighten these before or during the port, while the old
behavior is still in front of you, rather than after, inside code you rewrote
but did not simplify.

A function is listed when it runs over ${LINES} lines, or nests ${DEPTH} braces deep, or
carries ${BRANCHES} or more branches (if, for, while, case, &&, ||, and the ternary).
The numbers are a text based approximation, read from the source without a
parser: braces inside strings and comments are counted like any other, so the
depth reads high before it reads low. Treat them as a place to look, not a
compiler's metric.

| function | file:line | lines | depth | branches |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

---

Nothing was rewritten. Which of these to split, and how, is a design decision
about the code, and this names where to make it.
`;
}
