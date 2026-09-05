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

      // An exploration is expensive and it is a recording. Replaying one lets a
      // port be re run, reviewed and tested without driving the app again.
      const explored = await readFile(join(ctx.config.shots, "exploration.json"), "utf8").catch(() => null);
      if (explored && !ctx.sources.exploration) {
        try {
          const parsed = JSON.parse(explored);
          ctx.sources.exploration = parsed;
          ctx.sources.observedStyles.push(
            ...(parsed.screens ?? []).map((sc) => ({
              route: sc.id,
              font: sc.font,
              pageBackground: sc.pageBackground,
              sample: sc.sample,
              rowHeights: sc.rowHeights,
            }))
          );
          log.info(`replayed an exploration of ${parsed.baseUrl}: ${(parsed.screens ?? []).length} screen(s)`);
          ctx.unverified(
            `The model was replayed from a recording of ${parsed.baseUrl}, taken ${parsed.recordedAt ?? "at an unknown time"}. ` +
              "If the app has changed since, this describes what it used to do."
          );
        } catch (err) {
          log.warn(`exploration.json is not readable json, ignoring it: ${err.message}`);
        }
      }

      // Several sessions of the same app measure more than one: every
      // exploration*.json in the directory joins ctx.sources.explorations,
      // and downstream merges report agreement instead of averaging.
      const sessionFiles = entries.filter((e) => /^exploration.*\.json$/i.test(e)).sort();
      if (sessionFiles.length > 1 || (sessionFiles.length === 1 && !ctx.sources.exploration)) {
        const sessions = [];
        for (const name of sessionFiles) {
          const raw = await readFile(join(ctx.config.shots, name), "utf8").catch(() => null);
          if (!raw) continue;
          try { sessions.push(JSON.parse(raw)); } catch { log.warn(`${name} is not readable json, ignoring it`); }
        }
        if (sessions.length > 1) {
          ctx.sources.explorations = sessions;
          log.info(`${sessions.length} recorded session(s); measurements merge with disagreement kept`);
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
