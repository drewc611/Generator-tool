import { readFile } from "node:fs/promises";

/**
 * High entropy strings the exact pattern gate cannot name. general-policy
 * stops the run when it recognises a credential's shape; this pass reports
 * the strings that merely look random enough to be one. Candidates, never
 * verdicts, and the value itself is never printed, never quoted, never
 * excerpted: a report that leaks the secret it found has done the damage it
 * warned about.
 */

const CANDIDATE = /["'`]([A-Za-z0-9+/_=-]{24,})["'`]/g;

// Strings that are long and random looking but harmless by construction.
const HARMLESS = /^[0-9a-f-]{32,}$|^[A-Za-z0-9+/]*={1,2}$|^(?:[A-Z][a-z]+){4,}$|^[a-z-]+$|integrity|sha(?:256|384|512)-/;

export function shannon(value) {
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return Math.round(bits * 100) / 100;
}

export function findCandidates(text, rel) {
  const found = [];
  for (const m of text.matchAll(CANDIDATE)) {
    const value = m[1];
    if (HARMLESS.test(value)) continue;
    const entropy = shannon(value);
    // Below 4 bits per character, long identifiers and camelCase phrases
    // dominate; above it, almost everything is generated.
    if (entropy < 4.2) continue;
    const line = text.slice(0, m.index).split("\n").length;
    found.push({ file: rel, line, length: value.length, entropy });
  }
  return found;
}

export default {
  name: "dsp-entropy",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter(
        (f) => /\.(js|ts|jsx|tsx|vue|json|html?|env|cfg|ini|ya?ml|properties)$/i.test(f.rel) && !/\.min\.|package-lock|yarn\.lock/.test(f.rel)
      );
      const candidates = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) candidates.push(...findCandidates(text, file.rel));
      }
      if (!candidates.length) return log.debug("nothing looks generated");

      ctx.entropyCandidates = candidates;
      log.info(`${candidates.length} high entropy string(s), values withheld`);
      ctx.unverified(
        `${candidates.length} string(s) in the source are random enough to be credentials. SECRET_CANDIDATES.md names the file and line and never the value; check each before the source leaves your hands.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.entropyCandidates?.length) return;
      const lines = [
        "# Strings that look generated",
        "",
        "Candidates by entropy, not verdicts, and the values are deliberately not",
        "in this file. A hash, a build id, or a design token can score like a key;",
        "a key scores like nothing else. Open each location and decide.",
        "",
        "| where | length | bits per character |",
        "| --- | ---: | ---: |",
        ...ctx.entropyCandidates.map((c) => `| \`${c.file}:${c.line}\` | ${c.length} | ${c.entropy} |`),
        "",
        "The exact pattern gate in general-policy already stops the run for a",
        "credential it can name. This list is what that gate cannot prove.",
        "",
      ];
      await ctx.write("SECRET_CANDIDATES.md", lines.join("\n"));
    });
  },
};
