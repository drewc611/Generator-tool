/**
 * The string catalogue as ICU messages, split sentences made whole.
 *
 * dsp-i18n found the copy and, for a sentence assembled around a value, kept
 * the whole pattern. This writes it in the format translation tooling actually
 * consumes, so "You have {count} unread messages" arrives as one message that
 * survives any word order, instead of two fragments that only work in English.
 *
 *   icu: true
 */
export default {
  name: "output-i18n",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.icu) return log.debug("not requested");
      if (!ctx.i18n?.length) return log.info("no catalogue to write");

      const messages = {};
      let anonymous = 0;
      for (const entry of ctx.i18n) {
        messages[entry.key] = entry.pattern ?? entry.value;
        if (entry.pattern && /\{value\d/.test(entry.pattern)) anonymous += 1;
      }

      await ctx.write("src/i18n/en.icu.json", JSON.stringify(messages, null, 2) + "\n");
      log.info(`${Object.keys(messages).length} ICU message(s)`);

      if (anonymous) {
        ctx.unverified(
          `${anonymous} ICU message(s) interpolate an expression too complex to name, so their placeholders ` +
          `are numbered (\`{value1}\`). Rename them to what the value means before handing this to a translator; ` +
          `a translator cannot reorder a placeholder they cannot understand.`
        );
      }
    });
  },
};
