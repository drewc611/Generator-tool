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
      const components = ctx.written.filter((f) => /\.(jsx|tsx)$/.test(f));
      for (const rel of components) {
        const text = await readFile(join(ctx.config.out, rel), "utf8").catch(() => "");
        policy.assertNoEndpointLiteral(text, rel, paths);
      }
      log.info(`no endpoint in ${components.length} component(s), ${paths.length} path(s) checked`);
    });
  },
};
