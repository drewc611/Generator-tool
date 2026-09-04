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
      // The pseudo locale finds the strings i18n missed before a translator
      // does: hardcoded copy stays plain on screen while everything routed
      // through the catalogue arrives bracketed, accented and a third longer.
      const pseudo = {};
      for (const [key, value] of Object.entries(messages)) pseudo[key] = pseudoLocalize(value);
      await ctx.write("src/i18n/en-XA.icu.json", JSON.stringify(pseudo, null, 2) + "\n");
      log.info(`${Object.keys(messages).length} ICU message(s), pseudo locale beside them`);

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

const ACCENTED = {
  a: "á", e: "é", i: "í", o: "ó", u: "ú", y: "ý", c: "ç", n: "ñ",
  A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú", Y: "Ý", C: "Ç", N: "Ñ",
};

/**
 * en-XA in the usual shape: accents to catch encoding bugs, brackets to catch
 * clipping, one third expansion to catch layouts sized to English. ICU
 * placeholders and their braces pass through untouched, because a translator
 * tool that receives a mangled placeholder silently drops the message.
 */
export function pseudoLocalize(message) {
  const parts = String(message).split(/(\{[^}]*\})/);
  const accented = parts
    .map((part, i) => (i % 2 ? part : part.replace(/[A-Za-z]/g, (ch) => ACCENTED[ch] ?? ch)))
    .join("");
  const letters = accented.replace(/\{[^}]*\}/g, "").length;
  const padding = "·".repeat(Math.ceil(letters / 3));
  return `⟦${accented}${padding}⟧`;
}
