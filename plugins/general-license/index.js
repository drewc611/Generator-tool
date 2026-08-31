import { readFile } from "node:fs/promises";

/**
 * A font or an icon set licensed to the old app is not automatically licensed
 * to the new one. The licence usually names a product, a domain or a seat
 * count, and a port is a new product on a new domain.
 *
 * This finds what the old app used and says what has to be checked. It cannot
 * read a licence agreement, so it never claims something is or is not allowed.
 */

const FOUNDRY = [
  [/\b(Helvetica Neue|Neue Haas|Akzidenz)\b/i, "a licensed grotesque"],
  [/\b(Proxima Nova|Gotham|Avenir|Futura|Frutiger|Univers|Gill Sans|Trade Gothic)\b/i, "a commercial typeface"],
  [/\b(Circular|Graphik|Tiempos|Founders Grotesk|GT [A-Z]\w+|Söhne|Suisse)\b/i, "an independent foundry typeface"],
  [/\b(Myriad|Minion|Adobe Garamond|Source Han)\b/i, "an Adobe typeface"],
  [/\b(Segoe UI|Calibri|Cambria|Corbel|Consolas)\b/i, "a Microsoft typeface bundled with Windows"],
  [/\b(SF Pro|San Francisco|Helvetica)\b/i, "an Apple system typeface"],
];

// Names that are safe to keep and worth not warning about.
const OPEN = /\b(Inter|Roboto|Open Sans|Lato|Montserrat|Source Sans|Noto|IBM Plex|Work Sans|Nunito|Fira|JetBrains Mono|system-ui|sans-serif|serif|monospace|ui-monospace|-apple-system|BlinkMacSystemFont|Arial|Times New Roman|Courier New|Verdana|Tahoma|Georgia)\b/i;

const ICONS = [
  [/font ?awesome|fa-[a-z]/i, "Font Awesome", "the free tiers and Pro differ; Pro is per seat and not transferable"],
  [/material-icons|material symbols/i, "Material Icons", "Apache 2.0, so it travels, but check the exact package"],
  [/\bglyphicons?\b/i, "Glyphicons", "bundled with old Bootstrap under a separate licence"],
  [/\bfontello|icomoon\b/i, "a bundled icon build", "these are assembled from mixed sources, so the licence is per icon"],
  [/\bnucleo|streamline|iconjar\b/i, "a commercial icon set", "usually per seat or per product"],
];

const FACE = /@font-face[\s\S]{0,400}?src\s*:\s*([^;]+);/gi;
const FAMILY = /font-family\s*:\s*([^;{}]+)[;}]/gi;

export function inspect(text, file) {
  const findings = [];
  const seen = new Set();
  const add = (f) => {
    const key = `${f.kind}:${f.subject}`;
    if (!seen.has(key)) { seen.add(key); findings.push({ ...f, file }); }
  };

  for (const m of text.matchAll(FAMILY)) {
    for (const raw of m[1].split(",")) {
      const family = raw.trim().replace(/^['"]|['"]$/g, "");
      if (!family || OPEN.test(family)) continue;
      const hit = FOUNDRY.find(([re]) => re.test(family));
      if (hit) add({ kind: "font", subject: family, note: `${hit[1]}. Confirm the licence covers the new product and its domain.` });
      else add({ kind: "font", subject: family, note: "Not a name this plugin recognises. Find out what it is licensed under before shipping it." });
    }
  }

  for (const m of text.matchAll(FACE)) {
    if (/\.(woff2?|otf|ttf|eot)/i.test(m[1])) {
      add({ kind: "font-file", subject: "a self hosted font file", note: "Self hosting is a licence term of its own. Check it permits the new domain." });
    }
  }

  for (const [re, name, note] of ICONS) {
    if (re.test(text)) add({ kind: "icons", subject: name, note });
  }

  return findings;
}

export default {
  name: "general-license",
  version: "0.1.0",
  class: "general",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(css|scss|less|html|ts|js|vue)$/.test(f.rel));
      const findings = [];
      for (const file of files) {
        findings.push(...inspect(await readFile(file.path, "utf8").catch(() => ""), file.rel));
      }
      // Anything the running app actually rendered in, which is the most
      // reliable statement of what it uses.
      for (const observed of ctx.sources.observedStyles) {
        if (observed.font) findings.push(...inspect(`font-family: ${observed.font};`, "observed"));
      }

      ctx.licensing = findings;
      if (!findings.length) return log.info("no font or icon set needing a licence check");

      log.info(`${findings.length} asset(s) whose licence does not travel automatically`);
      for (const finding of findings) {
        ctx.unverified(`Licence for ${finding.subject} (${finding.kind}, ${finding.file}): ${finding.note}`);
      }
    });
  },
};
