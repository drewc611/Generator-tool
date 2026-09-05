import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readSeo } from "../plugins/dsp-seo/index.js";
import { readTrackers } from "../plugins/dsp-analytics/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * What the old page told machines: the SEO signals a port must carry forward
 * on purpose, and the trackers it must decide about rather than default into.
 */

test("SEO signals are read from a page, and the gaps are named", () => {
  const good = readSeo(
    `<html lang="en"><head><title>A short title</title>
     <meta name="description" content="A description that is well within the sensible length for a search result to show.">
     <link rel="canonical" href="/x"><meta name="viewport" content="width=device-width">
     <meta property="og:title" content="x"></head><body><h1>One</h1><h2>Two</h2></body></html>`,
    "good.html"
  );
  assert.equal(good.canonical, true);
  assert.equal(good.lang, "en");
  assert.equal(good.h1, 1);
  assert.equal(good.issues.length, 0, "a complete page has no gaps");

  const bad = readSeo(`<html><head></head><body><h1>a</h1><h1>b</h1><h1>c</h1></body></html>`, "bad.html");
  assert.ok(bad.issues.includes("no <title>"));
  assert.ok(bad.issues.some((i) => /<h1>/.test(i)), "three h1s is a gap");
  assert.ok(bad.issues.includes("no canonical link"));
  assert.ok(bad.issues.includes("no lang on <html>"));
});

test("a skipped heading level is caught", () => {
  const seo = readSeo(`<html lang="en"><head><title>t</title></head><body><h1>a</h1><h3>c</h3></body></html>`, "skip.html");
  assert.ok(seo.issues.includes("a heading level is skipped"));
});

test("trackers are recognised by vendor, and their ids are not printed in full", () => {
  const found = readTrackers(`gtag('config','G-ABC1234567'); fbq('init','123456789012345');`, "p.html");
  const vendors = found.map((f) => f.vendor);
  assert.ok(vendors.includes("Google Analytics 4 / gtag"));
  assert.ok(vendors.includes("Facebook Pixel"));
  const ga4 = found.find((f) => f.vendor.includes("gtag"));
  assert.ok(ga4.id && ga4.id.startsWith("G-"), "the prefix proves the id");
  assert.doesNotMatch(ga4.id, /ABC1234567/, "the full id is withheld");
});

test("a run writes SEO.md and ANALYTICS.md, and nothing is emitted from either", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/seo-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("SEO.md"));
    assert.ok(run.ctx.written.includes("ANALYTICS.md"));

    const seo = await readFile(join(run.out, "SEO.md"), "utf8");
    assert.match(seo, /index\.html/);
    assert.match(seo, /Organization/, "the structured data type is reported");
    assert.match(seo, /no <title>/, "about.html's missing title is a named gap");

    const analytics = await readFile(join(run.out, "ANALYTICS.md"), "utf8");
    assert.match(analytics, /Google Analytics 4 \/ gtag/);
    assert.match(analytics, /Facebook Pixel/);
    assert.match(analytics, /Google Analytics \(Universal\)/, "the about page's UA tag is found");
    assert.doesNotMatch(analytics, /ABC1234567|123456789012345/, "no full tracking id is printed");
    assert.ok(run.ctx.report.unverified.some((n) => /consent/.test(n)), "re-adding a tracker is a decision owed");
  } finally {
    await run.cleanup();
  }
});
