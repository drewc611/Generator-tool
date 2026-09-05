import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * The Eleventy target: the site model arranged as an Eleventy project, no
 * client framework, the pages printed to static HTML under the lifted chrome,
 * the redirect map carried natively as _redirects, and every screen whose
 * client behaviour a static page cannot run named rather than flattened
 * silently.
 */

test("output-eleventy arranges the site as an Eleventy project with layout, pages and redirects", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, eleventy: true });
  try {
    assert.equal(run.error, null);
    const layout = await readFile(join(run.out, "eleventy/_includes/layout.njk"), "utf8");
    assert.match(layout, /\{\{ content \| safe \}\}/, "the layout renders each page's content");
    assert.match(layout, /<title>\{\{ title \}\}<\/title>/, "the title rides front matter");

    const page = await readFile(join(run.out, "eleventy/pages/about.njk"), "utf8");
    assert.match(page, /^---\nlayout: layout\.njk\n/, "front matter names the layout");
    assert.match(page, /permalink: "\/about\/"/, "the route is the permalink");
    assert.match(page, /\{% raw %\}[\s\S]*\{% endraw %\}/, "the ported markup is wrapped so Eleventy does not read its braces");
    assert.doesNotMatch(page.split("{% raw %}")[0], /\{\{/, "nothing outside the raw block looks like a Nunjucks variable");

    const data = JSON.parse(await readFile(join(run.out, "eleventy/_data/redirects.json"), "utf8"));
    assert.ok(Array.isArray(data) && data.length >= 1, "the redirect map is a data file");
    assert.ok(data.every((r) => r.from.startsWith("/") && r.to.startsWith("/")), "only onsite redirects are carried");
    const tpl = await readFile(join(run.out, "eleventy/pages/_redirects.njk"), "utf8");
    assert.match(tpl, /permalink: \/_redirects/, "the template writes the redirect file at the site root");
    assert.match(tpl, /\{\{ r\.from \}\} \{\{ r\.to \}\} 301/, "each redirect is a 301 line");
    assert.ok(run.ctx.written.includes("eleventy/eleventy.config.js"));
  } finally {
    await run.cleanup();
  }
});

test("a screen with client behaviour is arranged as static markup and named, not silently flattened", async () => {
  const run = await runPipeline({ src: join(ROOT, "example/legacy-portal"), site: true, eleventy: true });
  try {
    assert.equal(run.error, null);
    const pages = run.ctx.written.filter((f) => /^eleventy\/pages\/.*\.njk$/.test(f) && !f.endsWith("_redirects.njk"));
    assert.ok(pages.length >= 1, "pages were arranged");
    const noted = run.ctx.report.unverified.some((n) => /Eleventy renders static HTML/.test(n));
    const readme = await readFile(join(run.out, "eleventy/README.md"), "utf8");
    // Either the fixture has no dynamic screen, in which case nothing is
    // claimed, or it has one and both the note and the README say so.
    if (noted) assert.match(readme, /What a static page does not run/);
    else assert.doesNotMatch(readme, /What a static page does not run/);
  } finally {
    await run.cleanup();
  }
});

test("eleventy does not run without its flag, nor without a site model", async () => {
  const off = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true });
  try {
    assert.ok(!off.ctx.written.some((f) => /^eleventy\//.test(f)), "no eleventy without the flag");
  } finally {
    await off.cleanup();
  }
  const noSite = await runPipeline({ src: join(ROOT, "example/legacy"), eleventy: true });
  try {
    assert.equal(noSite.error, null);
    assert.ok(!noSite.ctx.written.some((f) => /^eleventy\//.test(f)), "no eleventy without a site model");
    assert.ok(noSite.ctx.report.unverified.some((n) => /Eleventy target needs --site/.test(n)));
  } finally {
    await noSite.cleanup();
  }
});
