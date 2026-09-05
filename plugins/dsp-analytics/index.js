import { readFile } from "node:fs/promises";

/**
 * The trackers the old front end loaded, found in its source. A port that
 * copies them forward re-enables surveillance a person may never have chosen
 * again, and often violates a consent regime that did not exist when the
 * markup was written. So this names the vendor and where it was loaded, and
 * treats re-adding each one as a decision owed rather than a default.
 *
 * The identifier a tag carries is not printed in full: it is evidence that a
 * property exists, not a value the report needs, and the same caution the
 * secret gate keeps applies to anything that names an account.
 */

const VENDORS = [
  { vendor: "Google Analytics (Universal)", re: /\bga\s*\(\s*['"]create|google-analytics\.com\/analytics\.js|\bUA-\d{4,}-\d+/, id: /\bUA-\d{4,}-\d+/ },
  { vendor: "Google Analytics 4 / gtag", re: /\bgtag\s*\(|googletagmanager\.com\/gtag\/js|\bG-[A-Z0-9]{6,}/, id: /\bG-[A-Z0-9]{6,}/ },
  { vendor: "Google Tag Manager", re: /googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]{4,}/, id: /\bGTM-[A-Z0-9]{4,}/ },
  { vendor: "Facebook Pixel", re: /\bfbq\s*\(|connect\.facebook\.net\/[^"']*fbevents\.js/, id: /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{6,})['"]/ },
  { vendor: "Segment", re: /analytics\.(track|identify|page)\s*\(|cdn\.segment\.com/, id: null },
  { vendor: "Mixpanel", re: /mixpanel\.(init|track)\b/, id: /mixpanel\.init\s*\(\s*['"]([\w]{8,})['"]/ },
  { vendor: "Hotjar", re: /\bhj\s*\(|static\.hotjar\.com/, id: /hjid\s*[:=]\s*(\d{4,})/ },
  { vendor: "Amplitude", re: /amplitude\.(getInstance|init)\b/, id: null },
  { vendor: "Adobe Analytics (Omniture)", re: /s_code\.js|omniture|\bs\.t\(\)|s_account/, id: null },
  { vendor: "Matomo / Piwik", re: /_paq\.push|matomo\.js|piwik\.js/, id: null },
  { vendor: "LinkedIn Insight", re: /_linkedin_partner_id|snap\.licdn\.com/, id: /_linkedin_partner_id\s*=\s*['"](\d+)['"]/ },
  { vendor: "Twitter / X Pixel", re: /\btwq\s*\(|static\.ads-twitter\.com/, id: null },
  { vendor: "Intercom", re: /\bIntercom\s*\(|widget\.intercom\.io/, id: /app_id\s*:\s*['"]([\w]{6,})['"]/ },
  { vendor: "Plausible", re: /plausible\.io\/js|\bplausible\s*\(/, id: null },
  { vendor: "Fathom", re: /cdn\.usefathom\.com|fathom\.trackPageview/, id: null },
];

/** Redact an identifier to its prefix, so the report proves it without naming it. */
const redact = (id) => {
  if (!id) return null;
  const head = id.slice(0, Math.min(id.length, id.indexOf("-") + 1 || 3));
  return `${head}${"*".repeat(Math.max(3, id.length - head.length))}`;
};

export function readTrackers(text, rel) {
  const found = [];
  for (const v of VENDORS) {
    if (!v.re.test(text)) continue;
    const idMatch = v.id ? v.id.exec(text) : null;
    const raw = idMatch ? (idMatch[1] ?? idMatch[0]) : null;
    found.push({ vendor: v.vendor, file: rel, id: redact(raw) });
  }
  return found;
}

export default {
  name: "dsp-analytics",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|js|jsx|ts|tsx|vue|php|jsp|asp|shtml)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const byVendor = new Map();
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        for (const t of readTrackers(text, file.rel)) {
          if (!byVendor.has(t.vendor)) byVendor.set(t.vendor, { vendor: t.vendor, files: new Set(), id: null });
          const entry = byVendor.get(t.vendor);
          entry.files.add(t.file);
          if (t.id && !entry.id) entry.id = t.id;
        }
      }
      const trackers = [...byVendor.values()].map((t) => ({ ...t, files: [...t.files].sort() }))
        .sort((a, b) => a.vendor.localeCompare(b.vendor));
      ctx.analytics = trackers;
      if (!trackers.length) return log.debug("no analytics or tracking found");

      log.info(`${trackers.length} tracker(s) found; each is a consent decision, not a default`);
      ctx.unverified(
        `ANALYTICS.md names ${trackers.length} tracker(s) the old front end loaded (${trackers.map((t) => t.vendor).join(", ")}). ` +
        `Re-adding any of them is a decision about consent and privacy, not a port default; none was carried into the output.`
      );
    });

    on("emit", async (ctx) => {
      // A run that loaded no tracker writes no report: an empty ANALYTICS.md
      // in every port is noise, and the absence is itself the good news.
      if (!ctx.analytics?.length) return;
      await ctx.write("ANALYTICS.md", render(ctx.analytics));
    });
  },
};

function render(trackers) {
  const head = `# The trackers the old front end loaded

Each row is a tracking vendor found in the source. The port did not carry any
of them forward: re-enabling a tracker is a decision about consent and
privacy that a person has to make on purpose, especially under a consent
regime that may not have existed when this markup was written.

Identifiers are shown by their prefix only. The report's job is to prove a
tracker was present, not to reprint the account it names.
`;
  if (!trackers.length) return head + "\nNothing was found. The old front end loaded no analytics this reader recognises.\n";

  const rows = trackers.map((t) =>
    `| ${t.vendor} | ${t.id ? `\`${t.id}\`` : "—"} | ${t.files.map((f) => `\`${f}\``).join(", ")} |`);
  return `${head}
| vendor | id (prefix only) | seen in |
| --- | --- | --- |
${rows.join("\n")}

---

Add back only what the product still needs, behind the consent the law now
requires. A tracker that nobody can name a reason for is one the port is
better without.
`;
}
