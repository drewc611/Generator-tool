import { readFile } from "node:fs/promises";

/**
 * The conditions that read like feature flags, collected.
 *
 * Every long lived app grows them: enableNewCheckout, useLegacyGrid,
 * betaSearch. Some gate features that shipped years ago and some gate the
 * only path that still runs, and nobody can say which without this list. A
 * port that carries them all forward carries the archaeology; a port that
 * drops them all breaks the one that mattered.
 */

const FLAG_NAME = /\b((?:is|use|show|has)?[A-Za-z0-9_$]*(?:[Ee]nable[ds]?|[Dd]isable[ds]?|[Ff]lag|[Ff]eature|[Tt]oggle|[Bb]eta|[Ee]xperiment|[Ll]egacy|[Nn]ew(?=[A-Z]))[A-Za-z0-9_$]*)\b/g;
const IN_CONDITION = /\b(if|ngIf|ng-if|v-if|ko-if|\?|&&|\|\|)\b/;

export function auditFlags(text, rel) {
  const found = new Map();
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (!IN_CONDITION.test(line)) return;
    for (const m of line.matchAll(FLAG_NAME)) {
      const name = m[1];
      if (/^(enabled?|disabled?|toggle|feature|flag)$/i.test(name)) continue;
      if (!found.has(name)) found.set(name, []);
      if (found.get(name).length < 4) found.get(name).push(`${rel}:${i + 1}`);
    }
  });
  return found;
}

export default {
  name: "dsp-flags",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const flags = new Map();
      for (const file of ctx.sources.files.filter((f) => /\.(js|ts|html?|vue)$/.test(f.rel) && !/\.min\./.test(f.rel))) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        for (const [name, sites] of auditFlags(text, file.rel)) {
          flags.set(name, [...(flags.get(name) ?? []), ...sites]);
        }
      }
      if (!flags.size) return log.debug("nothing reads like a flag");
      ctx.flags = [...flags.entries()].map(([name, sites]) => ({ name, sites })).sort((a, b) => b.sites.length - a.sites.length);

      // A flag no template ever mentions gates logic, not pixels; one only
      // the templates mention is set somewhere this run cannot see. Both
      // readings are marked, and both stay candidates.
      const templates = ctx.screens.map((s) => s.template).filter(Boolean).join("\n");
      for (const flag of ctx.flags) {
        const inTemplates = new RegExp(`\\b${flag.name}\\b`).test(templates);
        const inScripts = flag.sites.some((s) => /\.(js|ts|vue)/.test(s));
        if (!inTemplates && inScripts) flag.reading = "gates logic only; nothing visible changes with it, which is how a shipped flag looks years later";
        else if (inTemplates && !inScripts) flag.reading = "only the templates check it; whatever sets it lives outside this run";
      }
      const invisible = ctx.flags.filter((f) => f.reading?.startsWith("gates logic"));
      if (invisible.length) {
        ctx.unverified(
          `${invisible.length} flag candidate(s) (${invisible.slice(0, 4).map((f) => `\`${f.name}\``).join(", ")}${invisible.length > 4 ? ", …" : ""}) appear in no template. ` +
          `A flag that changes nothing visible is the strongest stale candidate this scan can produce, and still a candidate.`
        );
      }
      log.info(`${ctx.flags.length} name(s) read like flags`);
      ctx.unverified(
        `${ctx.flags.length} condition(s) read like feature flags and are listed in FLAGS.md. Which gate a live ` +
        `path and which gate archaeology is not decidable from source; decide each before the port carries it forward.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.flags) return;
      await ctx.write("FLAGS.md", `# The conditions that read like flags

Some gate features that shipped years ago and some gate the only path that
still runs. Nothing in the source says which, so each row below is a decision
the port owes an answer: keep the flag, keep the winning branch, or keep the
losing one on purpose.

| name | checked at | reading |
| --- | --- | --- |
${ctx.flags.map((f) => `| \`${f.name}\` | ${f.sites.map((s) => `\`${s}\``).join(", ")} | ${f.reading ?? ""} |`).join("\n")}

A name here is a candidate, not a conviction: this list is every identifier
whose name reads like a switch and appears in a condition, and nothing more.
`);
    });
  },
};
