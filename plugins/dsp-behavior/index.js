import { readFile } from "node:fs/promises";
import { buildModel } from "./model.js";

const slug = (text) =>
  String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "screen";

/**
 * The races the legacy code already fought and won. A debounce or a
 * cancellation in the source is a bug somebody hit, fixed, and never wrote
 * down; a port that drops it reintroduces the bug with no history to warn
 * anyone. Named where they stand so the port keeps them on purpose.
 */
const RACE_SIGNS = [
  { kind: "debounce", re: /debounceTime\s*\(\s*(\d+)/, means: (m) => `input debounced ${m[1]}ms with debounceTime; typing faster than that must not fire requests` },
  { kind: "debounce", re: /clearTimeout\s*\([\s\S]{0,160}?setTimeout\s*\(/, means: () => "a hand rolled debounce (clearTimeout, then setTimeout); the port needs the same restraint" },
  { kind: "cancellation", re: /\bswitchMap\s*\(/, means: () => "switchMap drops the stale request when a new one starts; without it, answers can arrive out of order" },
  { kind: "cancellation", re: /\bexhaustMap\s*\(/, means: () => "exhaustMap ignores triggers while a request is in flight; a port without it double submits" },
  { kind: "cancellation", re: /\bAbortController\b/, means: () => "an AbortController cancels in flight fetches; the generated client accepts a signal for the same reason" },
  { kind: "teardown", re: /\btakeUntil\s*\(/, means: () => "takeUntil tears streams down on destroy; the port's effects need the same cleanup" },
];

export function readRaces(text, rel) {
  const out = [];
  for (const sign of RACE_SIGNS) {
    const m = sign.re.exec(text);
    if (m) out.push({ kind: sign.kind, file: rel, means: sign.means(m) });
  }
  return out;
}

/**
 * Turns an exploration into the same shape the source readers produce, so
 * everything downstream treats a system that was used and a system that was
 * read identically. That is the whole reason the context is flat and boring.
 *
 * Runs at extract, before dsp-apimap plans, so the endpoints it recovered are
 * in the inventory by the time the endpoint map is built.
 */
export default {
  name: "dsp-behavior",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const exploration = ctx.sources.exploration;
      if (!exploration) return log.debug("nothing was explored");

      const model = buildModel(exploration);
      ctx.model = model;

      for (const endpoint of model.endpoints) {
        ctx.api.calls.push({
          method: endpoint.method,
          path: endpoint.path,
          file: "observed",
          headers: null,
          body: endpoint.observedBody ? JSON.stringify(endpoint.observedBody) : null,
          observed: true,
        });
      }

      for (const screen of model.screens) {
        ctx.screens.push({
          selector: slug(screen.name),
          className: null,
          file: `observed:${screen.id}`,
          inputs: screen.fields.map((f) => f.name),
          outputs: [],
          template: null,
          templateOrigin: null,
          usesNgIf: false,
          usesNgFor: Boolean(screen.collection),
          usesTwoWay: screen.fields.length > 0,
          rxjs: [],
          readBy: "observation",
          observed: screen,
        });
      }

      log.info(
        `${model.screens.length} screen(s), ${model.transitions.length} transition(s), ` +
          `${model.endpoints.length} endpoint(s) recovered from use`
      );
      for (const screen of model.screens) {
        const missing = ["loading", "empty", "error"].filter((s) => !screen.states[s]);
        if (screen.kind === "list" && missing.length) {
          ctx.unverified(
            `"${screen.name}" was never seen in: ${missing.join(", ")}. Those states are designed, not matched.`
          );
        }
      }
    });

    on("plan", async (ctx) => {
      const races = [];
      for (const f of ctx.sources.files.filter((f) => /\.(js|ts|jsx|tsx|vue)$/i.test(f.rel) && !/\.min\.|\.spec\.|\.test\./.test(f.rel))) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        if (text) races.push(...readRaces(text, f.rel));
      }
      if (!races.length) return;
      ctx.races = races;
      for (const r of races) {
        ctx.unverified(`${r.file}: ${r.means}. A race the legacy code already fought; the port must keep the pattern.`);
      }
      log.info(`${races.length} race pattern(s) the port must keep`);
    });

    on("emit", async (ctx) => {
      if (ctx.races?.length) {
        await ctx.write("RACES.md", [
          "# The races the legacy code already fought",
          "",
          "Each pattern below is a bug somebody hit, fixed, and never wrote",
          "down. The port keeps the pattern or reintroduces the bug with no",
          "history to warn anyone.",
          "",
          ...ctx.races.map((r) => `- **${r.kind}** in \`${r.file}\`: ${r.means}.`),
          "",
        ].join("\n"));
      }
      if (!ctx.model) return;
      await ctx.write("BEHAVIOR_MODEL.md", render(ctx.model));
    });
  },
};

function render(model) {
  const lines = [
    "# Behavior model",
    "",
    `Recovered by using ${model.baseUrl}. No source was read. Everything below is`,
    "something the app did when it was operated, and nothing below is assumed.",
    "",
    "## Screens",
    "",
  ];

  for (const screen of model.screens) {
    lines.push(`### ${screen.name}  \`${screen.id}\``, "");
    lines.push(`- Kind: ${screen.kind}`);
    if (screen.collection) {
      lines.push(`- Collection of ${screen.collection.rows} row(s): ${screen.collection.columns.join(", ")}`);
    }
    const seen = ["loading", "empty", "error", "body"].filter((s) => screen.states[s]);
    const unseen = ["loading", "empty", "error"].filter((s) => !screen.states[s]);
    lines.push(`- Seen in: ${seen.join(", ") || "nothing"}${unseen.length ? `. Never seen in: ${unseen.join(", ")}` : ""}`);
    if (screen.fields.length) {
      lines.push("", "| field | type | required | rule the app stated |", "| --- | --- | --- | --- |");
      for (const f of screen.fields) {
        lines.push(`| \`${f.name}\` | ${f.type} | ${f.required ? "yes" : "not shown"} | ${f.validation ?? "none observed"} |`);
      }
    }
    if (screen.actions.length) lines.push("", `- Controls: ${screen.actions.map((a) => `\`${a}\``).join(", ")}`);
    lines.push("");
  }

  lines.push("## Flow", "", "```");
  for (const t of model.transitions) lines.push(`${t.from} --[ ${t.via} ]--> ${t.to}`);
  lines.push("```", "", "## Endpoints", "");
  lines.push("| method | path | query | status | body shape | screen |", "| --- | --- | --- | --- | --- | --- |");
  for (const e of model.endpoints) {
    const from = model.wiring.filter((w) => w.endpoint === `${e.method} ${e.path}`).map((w) => w.via);
    lines.push(
      `| ${e.method} | \`${e.path}\` | ${e.query.join(", ") || "none"} | ${e.statuses.join(", ") || "?"} | ` +
        `${e.observedBody ? "`" + JSON.stringify(e.observedBody) + "`" : "none"} | ${from.join(", ") || "not attributed"} |`
    );
  }
  lines.push("");
  lines.push(
    "Body shapes are types, not values. What somebody typed during the exploration",
    "is not written down anywhere.",
    ""
  );

  if (model.skipped.length) {
    lines.push("## Not exercised", "");
    for (const s of model.skipped) lines.push(`- \`${s.selector}\` ${s.name ? `(${s.name}) ` : ""}: ${s.reason}`);
    lines.push("", "None of these is described above. They were left alone on purpose.", "");
  }
  return lines.join("\n");
}
