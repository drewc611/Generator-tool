import { buildIr } from "../dsp-ir/ir.js";

/**
 * Finds the sentences that are welded into the markup.
 *
 * A port is the one moment somebody reads every template, so it is the cheapest
 * moment this will ever be found. Left alone, hard coded copy is discovered
 * later by whoever is asked to add a second language, at which point it is a
 * project instead of a chore.
 *
 * It reads the IR, so it costs nothing per dialect: a string is a string once
 * the framework has been normalised away. It extracts and catalogues; it does
 * not rewrite the templates, because replacing copy with keys is a decision
 * about the product, not a mechanical transform.
 */

// Attributes a user actually reads. `value` is deliberately absent: on most
// elements it is data, and telling the two apart needs the element's type.
const TRANSLATABLE = new Set(["placeholder", "title", "alt", "aria-label", "aria-placeholder", "aria-description", "label"]);

/**
 * Punctuation, digits, a lone symbol and a bare URL are not copy.
 *
 * The threshold is deliberately low. "OK" on a button is a string somebody has
 * to translate, and a catalogue a person reviews survives an extra row far
 * better than it survives a missing one.
 */
const isCopy = (text) => {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(trimmed)) return false;
  if (/^(https?:)?\/\//.test(trimmed)) return false;
  return true;
};

const slug = (text) =>
  text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").split("_").slice(0, 6).join("_") || "text";

export function extractStrings(ir, selector) {
  const found = [];

  const add = (text, where) => {
    const value = text.replace(/\s+/g, " ").trim();
    if (!isCopy(value)) return;
    found.push({ selector, key: `${selector}.${slug(value)}`, value, where });
  };

  const walk = (node) => {
    if (!node) return;
    switch (node.kind) {
      case "text":
        // Only the literal halves. An interpolation is a value, not copy, and
        // the fragments around it are a sentence somebody split with code.
        if (node.parts.some((p) => p.expression !== undefined)) {
          const literal = node.parts.filter((p) => p.literal !== undefined).map((p) => p.literal).join(" ").replace(/\s+/g, " ").trim();
          if (isCopy(literal)) {
            found.push({
              selector, key: `${selector}.${slug(literal)}`, value: literal, where: "text",
              interpolated: true,
            });
          }
        } else {
          add(node.parts.map((p) => p.literal ?? "").join(""), "text");
        }
        break;

      case "element":
        for (const attr of node.attrs) {
          if (!TRANSLATABLE.has(attr.name.toLowerCase())) continue;
          if (attr.kind === "static") add(attr.value ?? "", `@${attr.name}`);
          else if (attr.kind === "template") {
            const literal = attr.parts.filter((p) => p.literal !== undefined).map((p) => p.literal).join(" ").replace(/\s+/g, " ").trim();
            if (isCopy(literal)) found.push({ selector, key: `${selector}.${slug(literal)}`, value: literal, where: `@${attr.name}`, interpolated: true });
          }
        }
        node.children.forEach(walk);
        break;

      case "when":
      case "each":
      case "fragment":
        node.children.forEach(walk);
        break;

      default:
        break;
    }
  };

  walk(ir.root);
  return found;
}

export default {
  name: "dsp-i18n",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const screens = ctx.screens.filter((s) => s.template);
      if (!screens.length) return log.debug("no templates to read");

      const strings = [];
      for (const screen of screens) {
        // dsp-ir may not have run yet; the IR is cheap enough to build again.
        const ir = screen.ir ?? buildIr(screen.template);
        strings.push(...extractStrings(ir, screen.selector));
      }
      if (!strings.length) return log.info("no hard coded copy found");

      // Two identical sentences are one string to translate, but a key that
      // silently absorbed a different sentence is a mistranslation later.
      const catalogue = new Map();
      for (const s of strings) {
        let key = s.key;
        for (let n = 2; catalogue.has(key) && catalogue.get(key).value !== s.value; n++) key = `${s.key}_${n}`;
        if (!catalogue.has(key)) catalogue.set(key, { ...s, key });
      }

      ctx.i18n = [...catalogue.values()].sort((a, b) => a.key.localeCompare(b.key));
      const split = ctx.i18n.filter((s) => s.interpolated);
      log.info(`${ctx.i18n.length} hard coded string(s) across ${screens.length} template(s)`);

      if (split.length) {
        ctx.unverified(
          `${split.length} string(s) are a sentence with a value in the middle. Splitting a sentence around ` +
          `an interpolation only works in English word order, so these need an interpolated message, not two ` +
          `fragments. They are marked in src/i18n/en.json.`
        );
      }
      ctx.unverified(
        `${ctx.i18n.length} user facing string(s) are welded into the markup. They are catalogued in ` +
        `src/i18n/en.json. portamp did not rewrite the templates: choosing keys is a product decision.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.i18n?.length) return;

      const body = {};
      for (const s of ctx.i18n) body[s.key] = s.value;
      await ctx.write("src/i18n/en.json", JSON.stringify(body, null, 2) + "\n");
      await ctx.write("src/i18n/README.md", README(ctx.i18n));
    });
  },
};

const README = (strings) => {
  const rows = strings.map((s) => `| \`${s.key}\` | ${JSON.stringify(s.value)} | ${s.where} | ${s.interpolated ? "yes" : "no"} |`);
  const split = strings.filter((s) => s.interpolated).length;

  return `# Copy found in the markup

${strings.length} string(s) were written directly into the legacy templates. They
are catalogued here so that adding a second language is a task rather than an
excavation.

portamp did not replace them in the emitted components. A key is a name, and
naming the copy is a decision about the product.

${split ? `## ${split} of these are split around a value

A sentence assembled from fragments only reads correctly in the word order it
was written in. Each one marked below needs a single interpolated message, not
two pieces glued together.
` : ""}
| key | copy | where | split around a value |
| --- | --- | --- | --- |
${rows.join("\n")}
`;
};
