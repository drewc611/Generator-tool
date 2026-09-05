import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readImages } from "../plugins/dsp-images/index.js";
import { readFonts } from "../plugins/dsp-fonts/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The asset weight the port should not inherit: images shipped at one fixed
 * size, and fonts declared in formats no target needs. Both measured, both
 * proposed, neither applied.
 */

test("an image with no srcset, dimensions or lazy loading is flagged; a complete one is not", () => {
  const images = readImages(
    `<img src="hero.jpg">
     <img src="logo.webp" srcset="a 1x" sizes="120px" loading="lazy" width="1" height="1" alt="ok">`,
    "p.html"
  );
  const hero = images.find((i) => i.src === "hero.jpg");
  assert.ok(hero.wants.some((w) => /srcset/.test(w)));
  assert.ok(hero.wants.some((w) => /width and height/.test(w)));
  assert.ok(hero.wants.some((w) => /WebP|AVIF/.test(w)), "a jpg is proposed a modern format");
  assert.ok(hero.wants.some((w) => /alt/.test(w)));
  const logo = images.find((i) => i.src === "logo.webp");
  assert.equal(logo.wants.length, 0, "a complete image needs nothing");
});

test("a font face is read for its formats and display strategy", () => {
  const { faces } = readFonts(
    `@font-face { font-family: "Brand"; src: url("b.woff2") format("woff2"), url("b.ttf"); }
     @font-face { font-family: "Old"; src: url("o.eot"); src: url("o.woff") format("woff"); }`,
    "s.css"
  );
  const brand = faces.find((f) => f.family === "Brand");
  assert.deepEqual(brand.formats.sort(), ["ttf", "woff2"]);
  assert.equal(brand.display, null, "no font-display declared");
  const old = faces.find((f) => f.family === "Old");
  assert.ok(old.formats.includes("eot") && !old.formats.includes("woff2"));
});

test("a run writes IMAGES.md and FONTS.md, proposing and applying nothing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/assets-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("IMAGES.md"));
    assert.ok(run.ctx.written.includes("FONTS.md"));

    const images = await readFile(join(run.out, "IMAGES.md"), "utf8");
    assert.match(images, /hero\.jpg/);
    assert.match(images, /loading="lazy"/, "the lazy loading proposal is named");

    const fonts = await readFile(join(run.out, "FONTS.md"), "utf8");
    assert.match(fonts, /Brand Sans/);
    assert.match(fonts, /Legacy Serif/);
    assert.match(fonts, /googleapis|Google/i, "the hosted font link is noted");
    assert.match(fonts, /no woff2|dropped|invisible/, "a font gap is named");
  } finally {
    await run.cleanup();
  }
});
