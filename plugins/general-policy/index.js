import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
      for (const f of ctx.sources.files) {
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
        (f) => (f.startsWith("src/features/") || f.startsWith("src/elements/")) && /\.(jsx|tsx|vue|svelte|js)$/.test(f)
      );
      for (const rel of components) {
        const text = await readFile(join(ctx.config.out, rel), "utf8").catch(() => "");
        policy.assertNoEndpointLiteral(text, rel, paths);
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
