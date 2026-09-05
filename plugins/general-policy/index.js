import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { securityTotal } from "../vis-security/index.js";
import { perfTotal } from "../vis-perf/index.js";

/**
 * Two gates, at the two moments they can still do something.
 *
 * At extract, before anything is emitted: credentials in the legacy source stop
 * the run. At verify, after the port is written: an endpoint that reached a
 * component stops it too. The second one is enforced here rather than by a
 * check in CI, because a rule that only exists in CI only holds for the
 * example, and only after somebody pushes.
 */
export default {
  name: "general-policy",
  version: "0.1.0",
  class: "general",
  setup({ on, log, policy }) {
    on("extract", async (ctx) => {
      // Binary formats cannot carry a secret these patterns could name, and
      // scanning their bytes decoded as text invents matches. Every format
      // that is text, however obscure, still goes through the gate.
      const binary = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav|pdf|zip)$/i;
      for (const f of ctx.sources.files) {
        if (binary.test(f.rel)) continue;
        const text = await readFile(f.path, "utf8").catch(() => "");
        policy.scanForSecrets(text, f.rel);
      }
      const n = policy.findings.length;
      if (n) log.warn(`${n} possible credential(s) in the legacy source`);
      policy.assertNoSecrets();
      log.debug("no credentials found in source");
    });

    on("verify", async (ctx) => {
      const paths = [...new Set(ctx.api.calls.map((c) => c.path).filter(Boolean))];
      // Every emitted component, whichever target wrote it. src/api is the
      // one place endpoints belong, so it is exactly the tree not checked.
      const components = ctx.written.filter(
        (f) => (f.startsWith("src/features/") || f.startsWith("src/elements/") || f.startsWith("src/app/")) && /\.(jsx|tsx|vue|svelte|js)$/.test(f)
          // The site shell's data modules hold destinations by construction:
          // the redirect map, the nav model and the head table are routes and
          // titles, and a route may spell the same path an API answers. The
          // shell's code files stay gated like any component.
          && !/^src\/app\/(redirects|nav|head|breadcrumbs|search-index)\.js$/.test(f)
      );
      // The routes this run itself serves. A navigation attribute naming one
      // of these is a place to go, whatever an API thinks of the same string.
      const routes = [...new Set([
        ...(ctx.site?.pages ?? []).map((p) => p.route),
        ...(ctx.routes?.table ?? []).map((r) => r.path).filter(Boolean),
      ])];
      for (const rel of components) {
        const text = await readFile(join(ctx.config.out, rel), "utf8").catch(() => "");
        policy.assertNoEndpointLiteral(text, rel, paths, routes);
      }
      log.info(`no endpoint in ${components.length} component(s), ${paths.length} path(s) checked`);

      // The second net for secrets: the source gate stops the run before
      // anything is written; this one catches a value a plugin copied out of
      // an artifact into the port. Like the endpoint gate it can only fail
      // the run once the file exists on disk to look at.
      if (!ctx.config.dryRun) {
        for (const rel of ctx.written.filter((f) => /\.(jsx?|tsx?|vue|svelte|json|md|css|html|yml)$/i.test(f))) {
          const text = await readFile(join(ctx.config.out, rel), "utf8").catch(() => "");
          policy.scanForSecrets(text, `${rel} (emitted)`);
        }
        policy.assertNoSecrets();
        log.debug("nothing secret shaped in the emitted files");
      }

      // An opt in ceiling for CI: --max-unverified N fails the run when the
      // gaps exceed it. It only ever adds a gate; there is no flag that
      // relaxes one. The count is as it stood when this check ran; the late
      // reporters list, they do not add.
      // The same shape for dead links: a ceiling only ever adds a gate.
      const deadCeiling = ctx.config.maxDeadLinks ?? ctx.config["max-dead-links"];
      if (deadCeiling !== undefined && deadCeiling !== null && deadCeiling !== false) {
        const max = Number(deadCeiling);
        if (!Number.isFinite(max)) throw new Error(`--max-dead-links needs a number, got "${deadCeiling}".`);
        const dead = ctx.site?.deadLinks?.length ?? 0;
        if (dead > max) {
          throw new Error(`${dead} dead link(s) against a ceiling of ${max}. SITE.md names each one; fix them or raise the ceiling knowingly.`);
        }
        log.info(`${dead} dead link(s), under the ceiling of ${max}`);
      }

      // And once more for accessibility: the measured findings, capped.
      const a11yCeiling = ctx.config.maxA11y ?? ctx.config["max-a11y"];
      if (a11yCeiling !== undefined && a11yCeiling !== null && a11yCeiling !== false) {
        const max = Number(a11yCeiling);
        if (!Number.isFinite(max)) throw new Error(`--max-a11y needs a number, got "${a11yCeiling}".`);
        const found = (ctx.a11y?.length ?? 0) + (ctx.a11yStructure?.length ?? 0);
        if (found > max) {
          throw new Error(`${found} accessibility finding(s) against a ceiling of ${max}. A11Y.md names each one; fix them or raise the ceiling knowingly.`);
        }
        log.info(`${found} accessibility finding(s), under the ceiling of ${max}`);
      }

      // And once more for the trust surface: the security scorecard's count,
      // capped. The total is reckoned through vis-security's own function from
      // what the analyzers left at plan, so the gate agrees with the scorecard
      // and does not depend on which verify handler ran first.
      const securityCeiling = ctx.config.maxSecurity ?? ctx.config["max-security"];
      if (securityCeiling !== undefined && securityCeiling !== null && securityCeiling !== false) {
        const max = Number(securityCeiling);
        if (!Number.isFinite(max)) throw new Error(`--max-security needs a number, got "${securityCeiling}".`);
        const found = securityTotal(ctx);
        if (found > max) {
          throw new Error(`${found} security item(s) against a ceiling of ${max}. SECURITY_SCORECARD.md names each concern; fix them or raise the ceiling knowingly.`);
        }
        log.info(`${found} security item(s), under the ceiling of ${max}`);
      }

      // And once more for weight and first paint: the performance scorecard's
      // count, capped, reckoned the same way through vis-perf's own function.
      // The port's size is not in the count; a byte is not a defect, and
      // --max-kb already budgets it.
      const perfCeiling = ctx.config.maxPerf ?? ctx.config["max-perf"];
      if (perfCeiling !== undefined && perfCeiling !== null && perfCeiling !== false) {
        const max = Number(perfCeiling);
        if (!Number.isFinite(max)) throw new Error(`--max-perf needs a number, got "${perfCeiling}".`);
        const found = perfTotal(ctx);
        if (found > max) {
          throw new Error(`${found} performance item(s) against a ceiling of ${max}. PERFORMANCE.md names each concern; fix them or raise the ceiling knowingly.`);
        }
        log.info(`${found} performance item(s), under the ceiling of ${max}`);
      }

      const ceiling = ctx.config.maxUnverified ?? ctx.config["max-unverified"];
      if (ceiling !== undefined && ceiling !== null && ceiling !== false) {
        const max = Number(ceiling);
        if (!Number.isFinite(max)) throw new Error(`--max-unverified needs a number, got "${ceiling}".`);
        if (ctx.report.unverified.length > max) {
          throw new Error(
            `${ctx.report.unverified.length} unverified item(s) against a ceiling of ${max}. ` +
              `The items are in PORT_NOTES.md; resolve them or raise the ceiling knowingly.`
          );
        }
        log.info(`${ctx.report.unverified.length} unverified, under the ceiling of ${max}`);
      }
    });
  },
};
