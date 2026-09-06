import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { colorsFromScreenshots } from "../plugins/dsp-tokens/index.js";
import { contrastHex, decodePng, palette, readChunks } from "../plugins/input-shots/png.js";
import { encodePng, screenshot } from "./fixtures/png/build.mjs";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * A screenshot handed to the port used to be a file name and a byte count:
 * catalogued, matched to a screen by name, measured only when a recording of
 * computed styles sat beside it. input-shots now decodes a PNG with no
 * dependency and counts the colours its pixels are made of, and dsp-tokens
 * takes the two a picture can honestly give, the page background and the ink
 * that reads against it, when nothing declared or observed already answered.
 * Every other colour stays a measurement in PALETTE.md, because which colour is
 * the brand's is a person's call. The PNGs are drawn by the suite; none is
 * committed.
 */

test("the decoder reads every colour type and bit depth, every filter, a palette with transparency, and names what it will not read", () => {
  const cases = [
    { colorType: 0, depth: 1, pixel: (x) => [x % 2], first: [0, 0, 0, 255], fifth: [0, 0, 0, 255], second: [255, 255, 255, 255] },
    { colorType: 0, depth: 2, pixel: (x) => [x % 4], first: [0, 0, 0, 255], fifth: [0, 0, 0, 255] },
    { colorType: 0, depth: 4, pixel: (x) => [x % 16], first: [0, 0, 0, 255], fifth: [68, 68, 68, 255] },
    { colorType: 0, depth: 8, pixel: (x) => [x * 10], first: [0, 0, 0, 255], fifth: [40, 40, 40, 255] },
    { colorType: 0, depth: 16, pixel: (x) => [x], first: [0, 0, 0, 255], fifth: [4, 4, 4, 255] },
    { colorType: 2, depth: 8, pixel: (x, y) => [x, y, 7], first: [0, 0, 7, 255], fifth: [4, 0, 7, 255] },
    { colorType: 2, depth: 16, pixel: (x, y) => [x, y, 1], first: [0, 0, 1, 255], fifth: [4, 0, 1, 255] },
    { colorType: 3, depth: 2, palette: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]], trns: [255, 255, 0], pixel: (x) => [x % 4], first: [255, 0, 0, 255], fifth: [255, 0, 0, 255], third: [0, 0, 255, 0] },
    { colorType: 3, depth: 8, palette: [[1, 2, 3], [4, 5, 6]], pixel: (x) => [x % 2], first: [1, 2, 3, 255], fifth: [1, 2, 3, 255] },
    { colorType: 4, depth: 8, pixel: (x, y) => [x, y * 8], first: [0, 0, 0, 0], fifth: [4, 4, 4, 0] },
    { colorType: 6, depth: 8, pixel: (x, y) => [x, y, 7, 200], first: [0, 0, 7, 200], fifth: [4, 0, 7, 200] },
    { colorType: 6, depth: 16, pixel: (x, y) => [x, y, 7, 200], first: [0, 0, 7, 200], fifth: [4, 0, 7, 200] },
  ];
  for (const c of cases) {
    for (const filters of [[0], [1], [2], [3], [4], [4, 3, 2, 1, 0]]) {
      const image = decodePng(encodePng({ width: 9, height: 5, filters, ...c }));
      assert.equal(image.error, undefined, `type ${c.colorType} depth ${c.depth} filters ${filters}`);
      assert.equal(image.width, 9); assert.equal(image.height, 5);
      const at = (i) => [...image.pixels.subarray(i * 4, i * 4 + 4)];
      assert.deepEqual(at(0), c.first, `type ${c.colorType} depth ${c.depth} filters ${filters}: pixel 0`);
      assert.deepEqual(at(4), c.fifth, `type ${c.colorType} depth ${c.depth} filters ${filters}: pixel 4`);
      if (c.third) assert.deepEqual(at(2), c.third, "a tRNS entry makes its palette index transparent");
      if (c.second) assert.deepEqual(at(1), c.second, "a one bit sample scales to full white");
    }
  }
  assert.equal(decodePng(Buffer.from("not a png")).error, "not a PNG: the signature is missing");
  assert.equal(decodePng(encodePng({ width: 2, height: 2, interlaced: true, pixel: () => [1, 2, 3] })).error, "an interlaced (Adam7) PNG is not decoded; save it non interlaced");
  const whole = screenshot();
  assert.match(decodePng(whole.subarray(0, 60)).error, /runs past the end of the file/);
  assert.equal(readChunks(whole).chunks.map((c) => c.type).join(" "), "IHDR IDAT IEND");
  const bad = Buffer.from(whole);
  bad[8 + 8 + 9] = 7;
  assert.match(decodePng(bad).error, /colour type 7 is not one the format defines/);
});

test("a palette counts the colours a screenshot is made of, most common first, antialiasing binned", () => {
  const image = decodePng(screenshot());
  const colours = palette(image);
  assert.equal(colours[0].hex, "#FBFAF8", "the page background is most of the picture");
  assert.ok(colours[0].share > 0.6 && colours[0].share < 0.8, `${colours[0].share}`);
  assert.equal(colours[1].hex, "#004B87", "the header bar and the button are the same blue");
  assert.equal(colours[2].hex, "#1C1B19", "the ink");
  assert.ok(colours.some((c) => c.hex === "#8C8B89"), "the antialiased edge is its own bin, never blended into the ink");
  assert.ok(Math.abs(colours.reduce((n, c) => n + c.share, 0) - 1) < 1e-9, "the eight bins are the whole opaque picture here");
  assert.deepEqual(palette(decodePng(encodePng({ width: 2, height: 1, colorType: 6, pixel: () => [1, 2, 3, 0] }))), [], "a fully transparent picture has no colours to count");
  assert.equal(contrastHex("#000000", "#FFFFFF").toFixed(0), "21");
  assert.ok(contrastHex("#1C1B19", "#FBFAF8") > 15 && contrastHex("#8C8B89", "#FBFAF8") < 4.5);
});

test("the tokens take the background from the pixels, name the screenshot, and never the ink or the accent", () => {
  const shots = [
    { name: "orders", path: "/x/orders.png", palette: palette(decodePng(screenshot())) },
    { name: "orders-empty", path: "/x/orders-empty.png", palette: palette(decodePng(screenshot({ width: 60, height: 40 }))) },
  ];
  const got = colorsFromScreenshots(shots);
  assert.deepEqual(got.color, { bg: "#FBFAF8" }, "a header bar and the ink are both dark and both read against the page; a share cannot tell them apart, so neither is named");
  assert.match(got.evidence.bg, /^bg from the pixels of orders\.png \(\d+% of it\); 2 other colour\(s\) read against it at 4\.5:1 or better$/);
  assert.equal(colorsFromScreenshots([]), null);
  assert.equal(colorsFromScreenshots([{ name: "a", path: "a.png" }]), null, "a screenshot that was not measured gives nothing");
  const split = colorsFromScreenshots([...shots, { name: "dark", path: "/x/dark.png", palette: [{ hex: "#101010", share: 0.9 }, { hex: "#EEEEEE", share: 0.1 }] }]);
  assert.equal(split.color.bg, "#FBFAF8"); assert.match(split.evidence.bg, /1 screenshot\(s\) disagree; /);
  const busy = colorsFromScreenshots([{ name: "busy", path: "b.png", palette: [{ hex: "#FFFFFF", share: 0.3 }, { hex: "#000000", share: 0.3 }] }]);
  assert.equal(busy, null, "no colour covers four tenths, so nothing is called the background");
});

test("a run over dropped screenshots measures them, writes PALETTE.md and carries the pixels into the tokens with their provenance", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-shots-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const shots = join(dir, "shots");
  await import("node:fs/promises").then((fs) => fs.mkdir(shots));
  await writeFile(join(shots, "orders.png"), screenshot());
  await writeFile(join(shots, "orders-empty.png"), screenshot({ width: 60, height: 40 }));
  await writeFile(join(shots, "broken.png"), Buffer.from("not really a png"));
  await writeFile(join(shots, "photo.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]));
  const run = await runPipeline({ src: join(ROOT, "example/legacy"), shots });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const measured = run.ctx.sources.screenshots.filter((s) => s.palette);
  assert.deepEqual(measured.map((s) => [s.name, s.width, s.height]).sort(), [["orders", 120, 80], ["orders-empty", 60, 40]]);
  assert.ok(run.ctx.sources.screenshots.some((s) => s.name === "photo" && !s.palette), "a JPEG is catalogued, not measured");
  assert.ok(run.ctx.report.unverified.some((n) => /broken\.png could not be decoded \(not a PNG: the signature is missing\); it is catalogued, not measured/.test(n)));
  const md = await readFile(join(run.out, "PALETTE.md"), "utf8");
  assert.match(md, /## orders\.png\n\n120 × 80 pixels\.\n\n\| colour \| share \|\n\| --- \| --- \|\n\| #FBFAF8 \| \d+\.\d% \|/);
  assert.match(md, /which colour is the brand's is a person's call/);
  // The example app declares its palette in a stylesheet, so declared roles win and the pixels fill only what
  // nothing declared: the provenance says which is which.
  const declared = run.ctx.tokens.provenance.filter((e) => /from the pixels of/.test(e));
  for (const e of declared) assert.match(e, /^bg from the pixels of orders(-empty)?\.png/);
  if (declared.length) assert.equal(run.ctx.tokens.color.bg, "#FBFAF8");
  assert.ok(!run.ctx.tokens.provenance.some((e) => /^ink from the pixels/.test(e)), "the ink is never named from pixels");
});
