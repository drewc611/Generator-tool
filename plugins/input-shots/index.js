import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";

const IMG = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const STATES = ["empty", "error", "loading", "disabled", "denied", "long", "mobile"];

/**
 * Catalogs screenshots and infers which state each one shows from its name.
 * Also replays the computed styles input-record wrote beside them, so a
 * recording taken once can feed the token measurement on a machine with no
 * browser, and in CI.
 */
export default {
  name: "input-shots",
  version: "0.1.0",
  class: "input",
  setup({ on, log, policy }) {
    on("scan", async (ctx) => {
      let entries = [];
      try { entries = await readdir(ctx.config.shots); } catch {
        log.warn(`no screenshots at ${ctx.config.shots}`);
        ctx.unverified("No screenshots provided. Every visual decision is inferred from source only.");
        return;
      }
      for (const e of entries) {
        if (!IMG.has(extname(e))) continue;
        const p = join(ctx.config.shots, e);
        const s = await stat(p);
        const name = basename(e, extname(e));
        ctx.sources.screenshots.push({
          path: p,
          name,
          bytes: s.size,
          state: STATES.find((st) => name.toLowerCase().includes(st)) || "default",
        });
      }
      const observed = await readFile(join(ctx.config.shots, "observed.json"), "utf8").catch(() => null);
      if (observed) {
        try {
          const parsed = JSON.parse(observed);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          ctx.sources.observedStyles.push(...list);
          log.info(`replayed computed styles for ${list.length} route(s)`);
        } catch (err) {
          log.warn(`observed.json is not readable json, ignoring it: ${err.message}`);
          ctx.unverified("observed.json could not be parsed, so no styles were measured from the recording.");
        }
      }

      const covered = new Set(ctx.sources.screenshots.map((s) => s.state));
      const missing = ["empty", "error", "loading"].filter((s) => !covered.has(s));
      log.info(`${ctx.sources.screenshots.length} screenshot(s), states: ${[...covered].join(", ") || "none"}`);
      if (missing.length)
        ctx.unverified(`No screenshot for: ${missing.join(", ")}. Those states are designed, not matched.`);
      policy.warnOnFixtureData(ctx.sources.screenshots.map((s) => s.name).join(" "), "screenshot filenames");
    });
  },
};
