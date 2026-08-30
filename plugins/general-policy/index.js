import { readFile } from "node:fs/promises";

/**
 * Runs before anything is emitted. It reads nothing itself; it inspects what
 * the input plugins collected and refuses to continue if the legacy tree
 * contains credentials.
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
  },
};
