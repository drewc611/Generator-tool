import { readFile } from "node:fs/promises";

/**
 * What the old app ships that the port should not.
 *
 * Candidates, each with the line it lives on. A pattern scan cannot prove a
 * request fires per row, only that a request sits inside a loop; the report
 * says which claim it is making.
 */

const PATTERNS = [
  {
    kind: "sync-xhr",
    re: /async\s*:\s*false|\.open\([^)]*,\s*false\s*\)/g,
    why: "a synchronous request freezes the page for its whole round trip",
    severity: "high",
  },
  {
    kind: "document-write",
    re: /document\.write\s*\(/g,
    why: "document.write blocks parsing and breaks entirely when called late",
    severity: "high",
  },
  {
    kind: "request-in-loop",
    re: /for\s*\([^)]*\)\s*\{[^{}]{0,200}?(?:\$http|\$\.(?:get|post|ajax)|fetch)\(|\.forEach\s*\(\s*(?:function[^{]*|\([^)]*\)\s*=>\s*)\{[^{}]{0,200}?(?:\$http|\$\.(?:get|post|ajax)|fetch)\(/g,
    why: "a request inside a loop is the N+1 shape: one row, one round trip. This scan proves the shape, not the count",
    severity: "medium",
  },
  {
    kind: "interval-poll",
    re: /setInterval\s*\([\s\S]{0,150}?(?:\$http|\$\.(?:get|post|ajax)|fetch)\(/g,
    why: "polling on an interval keeps costing after the answer stops changing",
    severity: "low",
  },
];

export function auditPerf(text, rel) {
  const findings = [];
  for (const { kind, re, why, severity } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split("\n").length;
      findings.push({ kind, severity, where: `${rel}:${line}`, why });
    }
  }
  return findings;
}

/**
 * What each template asks of the renderer: how many nodes it prints, how
 * deep its loops nest, and whether the deepest rows carry handlers. A loop
 * in a loop is rows times columns of DOM every render; the number cannot say
 * the lists are long, and says so.
 */
export function templateWeight(ir, selector) {
  let nodes = 0;
  let maxLoopDepth = 0;
  let handlersInNestedLoop = 0;
  const walk = (node, loopDepth) => {
    if (!node) return;
    nodes += 1;
    if (node.kind === "each") loopDepth += 1;
    maxLoopDepth = Math.max(maxLoopDepth, loopDepth);
    if (node.kind === "element" && loopDepth >= 2 && (node.events.length || node.model)) handlersInNestedLoop += 1;
    for (const child of node.children ?? []) walk(child, loopDepth);
  };
  walk(ir.root, 0);
  return { selector, nodes, maxLoopDepth, handlersInNestedLoop };
}

export default {
  name: "dsp-perf",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const findings = [];
      for (const file of ctx.sources.files.filter((f) => /\.(js|ts|html?|vue)$/.test(f.rel) && !/\.min\./.test(f.rel))) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) findings.push(...auditPerf(text, file.rel));
      }

      const weights = [];
      for (const screen of ctx.screens.filter((s) => s.template)) {
        try {
          const { buildIr } = await import("../dsp-ir/ir.js");
          weights.push(templateWeight(screen.ir ?? buildIr(screen.template), screen.selector));
        } catch { /* a template another pass already reported as unreadable */ }
      }
      ctx.perfWeights = weights.sort((a, b) => b.nodes - a.nodes);
      for (const w of weights.filter((w) => w.maxLoopDepth >= 2)) {
        ctx.unverified(
          `<${w.selector}> nests loops ${w.maxLoopDepth} deep, which renders rows × columns of DOM per pass` +
          (w.handlersInNestedLoop ? `, with ${w.handlersInNestedLoop} handler(s) on the inner rows` : "") +
          `. Whether the lists are long enough to matter, only the data can say.`
        );
      }

      if (!findings.length && !weights.length) return log.debug("nothing flagged");
      ctx.perf = findings;
      log.info(`${findings.length} candidate(s) worth not carrying over, ${weights.length} template(s) weighed`);
    });

    on("emit", async (ctx) => {
      if (!ctx.perf && !ctx.perfWeights?.length) return;
      await ctx.write("PERF.md", `# Worth not carrying over

Candidates found by pattern, each with the line it lives on and the claim the
scan can actually make. A request inside a loop is the N+1 shape; whether it
fires N times needs the HAR, and if input-record captured one, ARCHITECTURE.md
already counted the real traffic.

| severity | kind | where | because |
| --- | --- | --- | --- |
${(ctx.perf ?? []).map((f) => `| ${f.severity} | ${f.kind} | \`${f.where}\` | ${f.why} |`).join("\n") || "| — | — | — | nothing flagged |"}
${ctx.perfWeights?.length ? `
## What each template asks of the renderer

Printed nodes and loop nesting, counted from the IR. A depth of 2 renders
rows × columns per pass; whether that is 12 cells or 40,000 only the data
can say, so the number is a place to look, not a verdict.

| screen | nodes | loop depth | handlers on inner rows |
| --- | --- | --- | --- |
${ctx.perfWeights.map((w) => `| \`${w.selector}\` | ${w.nodes} | ${w.maxLoopDepth} | ${w.handlersInNestedLoop || "—"} |`).join("\n")}
` : ""}`);
    });
  },
};
