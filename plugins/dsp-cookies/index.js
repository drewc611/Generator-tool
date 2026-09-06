import { readFile } from "node:fs/promises";

/**
 * The cookies the front end set, and whether it ever asked.
 *
 * A cookie the client writes is a porting decision with a legal shadow: under
 * a consent regime a tracking cookie set before the user agrees is a
 * violation, and a port that copies the write forward inherits it. This finds
 * where the client sets cookies and which consent mechanism, if any, was in
 * play, and names them. A cookie's value is never printed, the same caution
 * the secret gate keeps.
 */

const CONSENT = [
  { name: "Cookiebot", re: /cookiebot/i },
  { name: "OneTrust", re: /onetrust|optanon/i },
  { name: "Osano / Cookie Consent", re: /cookieconsent|osano/i },
  { name: "Quantcast", re: /quantcast|__cmp\b/i },
  { name: "Google Consent Mode", re: /gtag\(\s*['"]consent['"]/i },
  { name: "TrustArc", re: /trustarc|truste/i },
];

export function readCookies(text, rel) {
  const sets = [];
  // document.cookie = "name=..." and js-cookie's Cookies.set("name", ...).
  for (const m of text.matchAll(/document\.cookie\s*=\s*(['"`])([\w.-]+)=/g)) sets.push({ name: m[2], via: "document.cookie", file: rel });
  for (const m of text.matchAll(/Cookies\.set\s*\(\s*(['"`])([\w.-]+)\1/g)) sets.push({ name: m[2], via: "js-cookie", file: rel });
  for (const m of text.matchAll(/\$\.cookie\s*\(\s*(['"`])([\w.-]+)\1\s*,/g)) sets.push({ name: m[2], via: "jquery.cookie", file: rel });
  const consent = CONSENT.filter((c) => c.re.test(text)).map((c) => c.name);
  return { sets, consent };
}

export default {
  name: "dsp-cookies",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|html?|php|jsp)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const byName = new Map();
      const consent = new Set();
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/document\.cookie|Cookies\.set|\$\.cookie|cookieconsent|onetrust|cookiebot|gtag\(\s*['"]consent/i.test(text)) continue;
        const read = readCookies(text, file.rel);
        for (const s of read.sets) {
          if (!byName.has(s.name)) byName.set(s.name, { name: s.name, via: new Set(), files: new Set() });
          byName.get(s.name).via.add(s.via);
          byName.get(s.name).files.add(s.file);
        }
        for (const c of read.consent) consent.add(c);
      }
      const cookies = [...byName.values()].map((c) => ({ name: c.name, via: [...c.via], files: [...c.files].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name));
      ctx.cookies = { cookies, consent: [...consent] };
      if (!cookies.length && !consent.size) return log.debug("no client set cookies or consent tooling");

      log.info(`${cookies.length} client set cookie(s), ${consent.size} consent mechanism(s)`);
      if (cookies.length) {
        ctx.unverified(
          `COOKIES.md names ${cookies.length} cookie(s) the client sets${consent.size ? `, with consent handled by ${[...consent].join(", ")}` : " and no consent mechanism found"}. ` +
          `A tracking cookie set before consent is a violation the port would inherit; carry each forward on purpose. Values are not printed.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.cookies || (!ctx.cookies.cookies.length && !ctx.cookies.consent.length)) return;
      await ctx.write("COOKIES.md", render(ctx.cookies));
    });
  },
};

function render({ cookies, consent }) {
  const rows = cookies.map((c) =>
    `| \`${c.name}\` | ${c.via.join(", ")} | ${c.files.map((f) => `\`${f}\``).join(", ")} |`);

  return `# The cookies the front end set, and whether it asked

Each row is a cookie the client writes. A cookie's value is never printed;
the report proves the write exists, not what it stores. Consent handling, if
any, is named below: under a consent regime, a tracking cookie set before the
user agrees is a violation, and a port that copies the write forward inherits
it.

Consent: ${consent.length ? consent.map((c) => `**${c}**`).join(", ") : "**none found**"}.

| cookie | set via | in |
| --- | --- | --- |
${rows.length ? rows.join("\n") : "| — | (none set by the client) | — |"}

---

Carry each cookie forward on purpose, behind the consent the law now
requires. A cookie nobody can name a reason for is one the port is better
without.
`;
}
