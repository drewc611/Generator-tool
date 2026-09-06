import { readFile } from "node:fs/promises";

/**
 * How a screen reader user moves through a page: not top to bottom but by
 * landmark, jumping to the main, the navigation, the search, the banner. A
 * port that rebuilds the markup out of plain divs erases those stops, and the
 * page becomes one undifferentiated blob a keyboard user cannot skip into.
 *
 * This reads the landmark structure each page declared and names the ones a
 * port would want to keep. It measures what the markup proves; it does not
 * guess whether a stray div was meant to be a region.
 */

const has = (html, re) => re.test(html);

export function readLandmarks(html, rel) {
  const counts = {
    main: 0,
    nav: 0,
    banner: 0,
    contentinfo: 0,
    complementary: 0,
    search: 0,
    formLandmark: 0,
  };

  // The body is where a landmark counts. A header nested in a section is not
  // the banner; only a top level header is, but proving nesting from a regex
  // is a guess, so header and footer are counted wherever the element appears
  // and the role forms are counted alongside as the explicit signal.
  counts.main = (html.match(/<main\b/gi) ?? []).length
    + (html.match(/\brole\s*=\s*["']main["']/gi) ?? []).length;
  counts.nav = (html.match(/<nav\b/gi) ?? []).length
    + (html.match(/\brole\s*=\s*["']navigation["']/gi) ?? []).length;
  counts.banner = (html.match(/<header\b/gi) ?? []).length
    + (html.match(/\brole\s*=\s*["']banner["']/gi) ?? []).length;
  counts.contentinfo = (html.match(/<footer\b/gi) ?? []).length
    + (html.match(/\brole\s*=\s*["']contentinfo["']/gi) ?? []).length;
  counts.complementary = (html.match(/<aside\b/gi) ?? []).length
    + (html.match(/\brole\s*=\s*["']complementary["']/gi) ?? []).length;
  counts.search = (html.match(/\brole\s*=\s*["']search["']/gi) ?? []).length;

  // A bare form is not a landmark to a screen reader; only a form with an
  // accessible name or an explicit form role is one it announces as a region.
  for (const m of html.matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (/\baria-label\s*=/i.test(attrs)
      || /\baria-labelledby\s*=/i.test(attrs)
      || /\brole\s*=\s*["']form["']/i.test(attrs)) {
      counts.formLandmark += 1;
    }
  }

  const issues = [];
  if (counts.main === 0) issues.push("no main landmark");
  else if (counts.main > 1) issues.push("more than one main landmark");
  if (counts.nav === 0) issues.push("no navigation landmark");

  // A skip link is an anchor to a fragment near the top of the body, the first
  // thing a keyboard user reaches so they can jump past the chrome into the
  // content. The rough check looks only at the opening slice of the body.
  const bodyStart = html.search(/<body\b[^>]*>/i);
  if (bodyStart !== -1) {
    const opening = html.slice(bodyStart, bodyStart + 1200);
    if (!/<a\b[^>]*\bhref\s*=\s*["']#[^"']+["']/i.test(opening)) {
      issues.push("no skip link");
    }
  } else {
    issues.push("no skip link");
  }

  return { rel, counts, issues };
}

export default {
  name: "dsp-landmarks",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|shtml|php|jsp)$/i.test(f.rel));
      const pages = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        // Only a full page has a landmark structure to audit. A fragment
        // meant for injection carries no body and no honest verdict.
        if (!/<html|<!doctype html/i.test(text) || !/<body\b/i.test(text)) continue;
        pages.push(readLandmarks(text, file.rel));
      }
      ctx.landmarks = pages;
      if (!pages.length) return log.debug("no HTML pages to read for landmarks");

      const withIssues = pages.filter((p) => p.issues.length);
      log.info(`${pages.length} page(s) read for landmarks, ${withIssues.length} with a gap`);
      if (withIssues.length) {
        ctx.unverified(
          `LANDMARKS.md audits the ARIA landmark structure of ${pages.length} page(s); ${withIssues.length} have a gap ` +
          `(no main, no navigation, more than one main, or no skip link). A screen reader user navigates by landmarks, so ` +
          `the port should carry these regions forward on purpose; none was invented here.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.landmarks?.length) return;
      await ctx.write("LANDMARKS.md", render(ctx.landmarks));
    });
  },
};

function render(pages) {
  const cell = (n) => (n ? String(n) : "—");
  const rows = pages.map((p) => {
    const c = p.counts;
    return `| \`${p.rel}\` | ${cell(c.main)} | ${cell(c.nav)} | ${cell(c.banner)} | ${cell(c.contentinfo)} | ${cell(c.complementary)} | ${cell(c.search)} | ${cell(c.formLandmark)} |`;
  });

  const gaps = pages.filter((p) => p.issues.length).map((p) =>
    `### \`${p.rel}\`\n\n${p.issues.map((i) => `- ${i}`).join("\n")}`);

  return `# The landmark structure of each page

A screen reader user does not read a page top to bottom. They jump between
landmarks: to the main, to the navigation, to the search. A port that rebuilds
the markup out of plain divs erases those stops, and a page with no main is one
the user cannot skip into at all, so they wade through the chrome every time.

This is the landmark structure each page declared, and where a region is
missing. Nothing here was invented; a page with no main is reported with none.

| page | main | nav | banner | contentinfo | complementary | search | form |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

${gaps.length ? `## Gaps to close on purpose\n\n${gaps.join("\n\n")}\n` : "No gaps found. Every page carried a main and a navigation landmark.\n"}
---

A landmark is a region a screen reader announces and lets the user jump to. The
port should carry these forward on purpose, because rebuilding the markup
without them is the most invisible way to make a page harder to use.
`;
}
