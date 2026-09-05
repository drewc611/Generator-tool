import { readFile } from "node:fs/promises";

/**
 * What each page told a machine: the title and description a search engine
 * shows, the canonical that resolves duplicates, the language a screen reader
 * announces, the structured data a rich result is built from. A port that
 * rebuilds the markup and forgets these silently loses ranking and identity
 * the old site had earned, and the loss is invisible in a screenshot.
 *
 * This reads them and reports them, and names the gaps a person would want to
 * close. It measures; it does not invent a description a page never wrote.
 */

const between = (html, re) => re.exec(html)?.[1]?.trim() ?? null;

export function readSeo(html, rel) {
  const title = between(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = between(html, /<meta[^>]+name\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i)
    ?? between(html, /<meta[^>]+\bcontent\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i);
  const canonical = /<link[^>]+rel\s*=\s*["']canonical["']/i.test(html);
  const robots = between(html, /<meta[^>]+name\s*=\s*["']robots["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i);
  const lang = between(html, /<html[^>]+\blang\s*=\s*["']([^"']+)["']/i);
  const viewport = /<meta[^>]+name\s*=\s*["']viewport["']/i.test(html);
  const og = (html.match(/<meta[^>]+property\s*=\s*["']og:[^"']+["']/gi) ?? []).length;
  const twitter = (html.match(/<meta[^>]+name\s*=\s*["']twitter:[^"']+["']/gi) ?? []).length;

  const jsonLd = new Set();
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const t of m[1].matchAll(/["']@type["']\s*:\s*["']([^"']+)["']/g)) jsonLd.add(t[1]);
  }

  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  const h1 = levels.filter((l) => l === 1).length;
  // A heading level that jumps more than one down from the last is a skip:
  // h1 then h3 leaves a hole a screen reader announces as a missing section.
  let skipped = false;
  for (let i = 1; i < levels.length; i += 1) if (levels[i] - levels[i - 1] > 1) skipped = true;

  const issues = [];
  if (!title) issues.push("no <title>");
  else if (title.length > 60) issues.push(`title is ${title.length} chars (over 60, search results truncate it)`);
  if (!description) issues.push("no meta description");
  else if (description.length > 160) issues.push(`description is ${description.length} chars (over 160)`);
  if (!canonical) issues.push("no canonical link");
  if (!lang) issues.push("no lang on <html>");
  if (!viewport) issues.push("no viewport meta");
  if (h1 === 0) issues.push("no <h1>");
  else if (h1 > 1) issues.push(`${h1} <h1> elements (one per page is the convention)`);
  if (skipped) issues.push("a heading level is skipped");

  return { rel, title, description, canonical, robots, lang, viewport, og, twitter, jsonLd: [...jsonLd], h1, issues };
}

export default {
  name: "dsp-seo",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|shtml|php|jsp|asp)$/i.test(f.rel));
      const pages = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/<html|<head|<title|<meta/i.test(text)) continue;
        pages.push(readSeo(text, file.rel));
      }
      ctx.seo = pages;
      if (!pages.length) return log.debug("no HTML pages to read for SEO");

      const withIssues = pages.filter((p) => p.issues.length);
      log.info(`${pages.length} page(s) read for SEO, ${withIssues.length} with a gap`);
      if (withIssues.length) {
        ctx.unverified(
          `SEO.md audits ${pages.length} page(s) for the signals search engines and readers use; ${withIssues.length} ` +
          `have a gap (missing title or description, no canonical, a skipped heading, and the like). The port should carry ` +
          `these forward on purpose; none was invented here.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.seo?.length) return;
      await ctx.write("SEO.md", render(ctx.seo));
    });
  },
};

function render(pages) {
  const yes = (b) => (b ? "yes" : "—");
  const rows = pages.map((p) =>
    `| \`${p.rel}\` | ${p.title ? `${p.title.length}c` : "—"} | ${p.description ? `${p.description.length}c` : "—"} | ${yes(p.canonical)} | ${p.lang ?? "—"} | ${p.h1} | ${p.og || "—"}/${p.twitter || "—"} | ${p.jsonLd.length ? p.jsonLd.join(", ") : "—"} |`);

  const gaps = pages.filter((p) => p.issues.length).map((p) =>
    `### \`${p.rel}\`\n\n${p.issues.map((i) => `- ${i}`).join("\n")}`);

  return `# What each page told a machine

The title and description a search result shows, the canonical that resolves
duplicate URLs, the language a screen reader announces, the Open Graph and
Twitter cards a share unfurls, and the structured data a rich result is built
from. A port that forgets these loses ranking and identity the old site
earned, invisibly. This is what was there, and where it was thin.

| page | title | desc | canonical | lang | h1 | og/tw | structured data |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

${gaps.length ? `## Gaps to close on purpose\n\n${gaps.join("\n\n")}\n` : "No gaps found. The pages carried their signals.\n"}
---

Nothing here was invented. A page with no description is reported with none,
not given one a person never wrote.
`;
}
