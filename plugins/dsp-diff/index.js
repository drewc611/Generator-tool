import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Two runs compared, so a port in progress can see what moved underneath it.
 *
 * A migration takes months and the legacy app does not hold still. This reads
 * the run.json a previous run saved and reports what appeared, what vanished
 * and what changed, because the alternative is discovering a new endpoint in
 * production, in the port that never learned it existed.
 *
 *   diff: path/to/previous/out
 */
const key = (e) => `${e.method} ${e.path}`;

export function compare(previous, current) {
  const delta = { screens: { added: [], removed: [] }, endpoints: { added: [], removed: [] }, unverified: { was: 0, is: 0 } };

  const prevScreens = new Set((previous.screens ?? []).map((s) => s.name));
  const currScreens = new Set((current.screens ?? []).map((s) => s.name));
  delta.screens.added = [...currScreens].filter((s) => !prevScreens.has(s));
  delta.screens.removed = [...prevScreens].filter((s) => !currScreens.has(s));

  const prevEndpoints = new Map((previous.endpoints ?? []).map((e) => [key(e), e]));
  const currEndpoints = new Map((current.endpoints ?? []).map((e) => [key(e), e]));
  delta.endpoints.added = [...currEndpoints.keys()].filter((k) => !prevEndpoints.has(k));
  delta.endpoints.removed = [...prevEndpoints.keys()].filter((k) => !currEndpoints.has(k));

  delta.unverified.was = (previous.unverified ?? []).length;
  delta.unverified.is = (current.unverified ?? []).length;

  delta.tokens = [];
  for (const group of ["color", "size"]) {
    const a = previous.tokens?.[group] ?? {};
    const b = current.tokens?.[group] ?? {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) delta.tokens.push(`${group}.${k}: ${a[k] ?? "—"} → ${b[k] ?? "—"}`);
    }
  }
  delta.quiet = !delta.screens.added.length && !delta.screens.removed.length &&
    !delta.endpoints.added.length && !delta.endpoints.removed.length && !delta.tokens.length;
  return delta;
}

export default {
  name: "dsp-diff",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (!ctx.config.diff) return log.debug("no previous run named");
      const path = join(String(ctx.config.diff), ".portamp", "run.json");
      let previous;
      try {
        previous = JSON.parse(await readFile(path, "utf8"));
      } catch {
        ctx.unverified(`--diff pointed at ${ctx.config.diff}, but no readable run.json is there. Nothing was compared.`);
        return log.info("previous run unreadable");
      }

      // The current side comes from the context, not from a file: at verify
      // the console's run.json is not written yet, and the context is the
      // truth it will be written from anyway.
      const current = {
        screens: ctx.screens.map((s) => ({ name: s.selector })),
        endpoints: ctx.api.calls.map((c) => ({ method: c.method, path: c.path })),
        unverified: ctx.report.unverified,
        tokens: ctx.tokens ?? {},
      };

      const delta = compare(previous, current);
      ctx.diff = { previous: previous.ranAt, delta };
      log.info(delta.quiet ? "nothing moved since the last run" : `${delta.screens.added.length + delta.endpoints.added.length} addition(s), ${delta.screens.removed.length + delta.endpoints.removed.length} removal(s)`);

      const lines = [];
      const list = (items) => items.map((i) => `- \`${i}\``).join("\n");
      if (delta.screens.added.length) lines.push(`## Screens that appeared\n\n${list(delta.screens.added)}\n\nThe port does not have these yet.`);
      if (delta.screens.removed.length) lines.push(`## Screens that vanished\n\n${list(delta.screens.removed)}\n\nRemoved upstream, or this run read less. The difference matters; check which.`);
      if (delta.endpoints.added.length) lines.push(`## Endpoints that appeared\n\n${list(delta.endpoints.added)}\n\nEach is a dependency the port has never heard of.`);
      if (delta.endpoints.removed.length) lines.push(`## Endpoints that vanished\n\n${list(delta.endpoints.removed)}\n\nIf the service really dropped them, the port's client is calling ghosts.`);
      if (delta.tokens.length) lines.push(`## Design drift\n\n${list(delta.tokens)}`);

      await ctx.write("DIFF.md", `# What moved since ${delta.quiet ? "the last run" : previous.ranAt}

Compared against the run of ${previous.ranAt}.
${delta.quiet ? "\nNothing. The legacy app this run read is the one the previous run read: same screens, same endpoints, same measured design." : "\n" + lines.join("\n\n")}

Unverified items: ${delta.unverified.was} then, ${delta.unverified.is} now.
`);
    });
  },
};
