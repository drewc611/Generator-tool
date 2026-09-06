import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { decodePicture, lowerPhoto, picturesFor } from "../plugins/input-photo/index.js";
import { segment } from "../plugins/input-photo/regions.js";
import { RERUN_FLAGS, rerunOptions } from "../plugins/vis-ui/lib.js";
import { encodeJpeg } from "./fixtures/jpeg/build.mjs";
import { encodePng } from "./fixtures/png/build.mjs";
import { canvas, fillRect, loginScreen, strokeRect, text } from "./fixtures/photo/draw.mjs";
import { runPipeline } from "./helpers.js";

/**
 * A picture of a screen becomes a component: the regions are read by shape,
 * the same on a clean render and on a lit, speckled photograph of it; each is
 * lowered onto the shared dialect where the picture had it; the words are
 * inputs and never invented; and the console reads a photograph taken on the
 * spot. The pictures are drawn by the suite; none is committed.
 */

const kinds = (regions) => regions.map((r) => r.kind);

test("the regions of a screen read the same from a render and from a photograph of it", () => {
  const clean = segment(loginScreen());
  const photo = segment(loginScreen({ photo: true }));
  assert.deepEqual(kinds(clean.regions), ["bar", "text", "field", "text", "field", "check", "text", "button", "text"]);
  assert.deepEqual(kinds(photo.regions), kinds(clean.regions), "uneven light and speckle change no reading");
  const [bar, label1, field1, , field2, check, , button, footer] = clean.regions;
  assert.equal(bar.label.glyphs, 9, "the title's nine marks are counted on the bar, light on dark");
  assert.equal(label1.glyphs, 8); assert.equal(field2.label.glyphs, 12, "the writing inside the second field is its caption"); assert.equal(button.label.glyphs, 6); assert.equal(footer.glyphs, 20);
  assert.ok(Math.abs(field1.x - 60) <= 3 && Math.abs(field1.y - 195) <= 3 && Math.abs(field1.w - 600) <= 4 && Math.abs(field1.h - 60) <= 4, `the field sits where it was drawn: ${field1.x}, ${field1.y}, ${field1.w} × ${field1.h}`);
  assert.ok(Math.abs(check.w - check.h) <= 3 && check.w < 30, "the check box is a small square");
  assert.ok(Math.abs(clean.lineHeight - 22) <= 3, `the writing is about 22 pixels tall, read ${clean.lineHeight}`);
  assert.equal(clean.darkPage, false);
  assert.ok(field1.at.left > 0.08 && field1.at.left < 0.09 && field1.at.width > 0.82 && field1.at.width < 0.85, "positions come as a share of the page too");
});

test("a card holds what sits inside it, a dark page reads its light marks, and an empty picture is empty", () => {
  const img = canvas(400, 300);
  strokeRect(img, 20, 20, 360, 200, [60, 60, 60], 3);
  text(img, 40, 40, 6, 16);
  strokeRect(img, 40, 70, 300, 36, [90, 90, 90], 2);
  fillRect(img, 40, 130, 120, 40, [30, 100, 180]);
  text(img, 70, 142, 4, 16, [255, 255, 255]);
  const { regions } = segment(img);
  assert.deepEqual(kinds(regions), ["card"]);
  assert.deepEqual(kinds(regions[0].children), ["text", "field", "button"], "the card's children in reading order");
  const dark = canvas(400, 300, [20, 22, 30]);
  text(dark, 30, 30, 8, 18, [230, 230, 230]);
  strokeRect(dark, 30, 70, 300, 40, [200, 200, 200], 2);
  const night = segment(dark);
  assert.equal(night.darkPage, true);
  assert.deepEqual(kinds(night.regions), ["text", "field"]);
  assert.deepEqual(segment(canvas(200, 100)).regions, [], "a blank page has no regions");
});

test("the lowering places every region where the picture had it and makes every line of writing an input", () => {
  const img = loginScreen();
  const lowered = lowerPhoto(segment(img), { name: "login", width: 720, height: 1000 });
  const t = lowered.template;
  assert.match(t, /^<div class="photo-screen" style="position:relative;aspect-ratio:720 \/ 1000">/);
  assert.match(t, /<header style="position:absolute;left:0%;top:0%;width:100%;height:9\.01%"><h1>\{\{title1\}\}<\/h1><\/header>/);
  assert.match(t, /<label for="f-field1" [^>]*>\{\{label1\}\}<\/label>\n\s*<input id="f-field1" type="text" ng-model="field1" style=/, "writing above a field labels it");
  assert.match(t, /<input id="f-field2" type="text" ng-model="field2" placeholder="\{\{placeholder1\}\}"/, "writing inside a field is its placeholder, an input too");
  assert.match(t, /<label [^>]*><input type="checkbox" ng-model="check1"> \{\{caption1\}\}<\/label>/);
  assert.match(t, /<button type="button" ng-click="onAction1\(\)" [^>]*>\{\{caption2\}\}<\/button>/);
  assert.match(t, /<p [^>]*>\{\{line1\}\}<\/p>\n<\/div>$/);
  assert.deepEqual(lowered.words.map((w) => w.name), ["title1", "label1", "label2", "placeholder1", "caption1", "caption2", "line1"]);
  assert.deepEqual(lowered.fields, ["field1", "field2", "check1"]); assert.deepEqual(lowered.outputs, ["action1"]);
  // No word the picture held reaches the template: the only letters are markup, names and units.
  assert.equal((t.match(/>[^<{]*[A-Za-z][^<{]*</g) ?? []).length, 0, "no invented text between tags");
  assert.deepEqual(lowerPhoto(segment(canvas(100, 100)), { name: "blank", width: 100, height: 100 }).notes, ["nothing in the picture stood out from its background, so the screen is empty; a picture with more contrast would read"]);
});

test("a photograph off a phone, turned as the camera held it, runs through the pipeline to a component and PHOTO.md", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-photo-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const shots = join(dir, "shots");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(shots);
  // The camera held sideways: the bytes are the picture on its side and Exif says so.
  const img = loginScreen({ photo: true });
  const sideways = { width: img.height, height: img.width, pixels: new Uint8Array(img.pixels.length) };
  for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) {
    const s = (y * img.width + x) * 4; const d = ((img.width - 1 - x) * img.height + y) * 4;
    sideways.pixels.set(img.pixels.subarray(s, s + 4), d);
  }
  await writeFile(join(shots, "IMG_0042.jpg"), encodeJpeg(sideways, { orientation: 6, subsample: { h: 2, v: 2 } }));
  await writeFile(join(shots, "notes.txt"), "not a picture");
  const src = join(dir, "src");
  await mkdir(src);
  assert.deepEqual(await picturesFor({ photo: true, shots }), [join(shots, "IMG_0042.jpg")]);
  assert.deepEqual(await picturesFor({ photo: join(shots, "IMG_0042.jpg"), shots: "/nowhere" }), [join(shots, "IMG_0042.jpg")], "the flag may name one file");
  assert.deepEqual(await picturesFor({ shots }), [], "no flag, no pictures read as screens");
  const decoded = decodePicture(await readFile(join(shots, "IMG_0042.jpg")));
  assert.equal(decoded.width, 720, "the orientation is applied before anything is read");
  const run = await runPipeline({ src, shots, photo: true });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const screen = run.ctx.screens.find((s) => s.readBy === "photo");
  assert.equal(screen.selector, "photo-img-0042");
  assert.deepEqual(screen.outputs, ["action1"]);
  assert.deepEqual(screen.inputs.map((i) => i.name ?? i).sort(), ["caption1", "caption2", "label1", "label2", "line1", "placeholder1", "title1"]);
  const jsx = await readFile(join(run.out, "src/features/PhotoImg0042/PhotoImg0042.jsx"), "utf8").catch(() => null);
  assert.ok(jsx, "the React component exists");
  assert.match(jsx, /onAction1/); assert.match(jsx, /\{title1\}/); assert.match(jsx, /aspectRatio/);
  const report = await readFile(join(run.out, "PHOTO.md"), "utf8");
  assert.match(report, /## IMG_0042\.jpg\n\n720 × 1000 pixels, a light page with dark marks; the writing is about 2\d pixels tall\. Component `photo-img-0042`\./);
  assert.match(report, /\| button \| 6\d, 5\d\d \| 60\d × 7\d \| 6 mark\(s\) of writing on it, not read \|/);
  assert.match(report, /\| caption2 \| caption \| \d+, \d+ \| 6 \| the caption on the button that raises action1 \|/);
  assert.match(report, /Fields \(the component's own state\): field1, field2, check1\./);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /IMG_0042\.jpg: 7 line\(s\) of writing were placed and not read, because no words are read from a picture/);
  assert.match(notes, /read from shape alone \(1 bar, 4 text, 2 field, 1 check, 1 button\)/);
  const palette = await readFile(join(run.out, "PALETTE.md"), "utf8");
  assert.match(palette, /## IMG_0042\.jpg/, "the JPEG's colours are counted too, now that it decodes");
});

test("the console takes a photograph: a capture input, a photo key, and the flag rides the rerun", async () => {
  const html = await readFile(new URL("../plugins/vis-ui/app.html", import.meta.url), "utf8");
  assert.match(html, /<input type="file" id="camera" accept="image\/\*" capture="environment"/, "a phone opens its camera");
  assert.match(html, /id="camera-key"/); assert.match(html, /data-flag="photo"/);
  assert.match(html, /onlyPictures \? \{ photo: true, \.\.\.flags \} : flags/, "pictures dropped alone are read as screens");
  assert.ok(RERUN_FLAGS.includes("photo"));
  assert.deepEqual(rerunOptions({ source: "intake", flags: { photo: 1 } }).flags, { photo: true });
});

test("a PNG and a JPEG decode by their first bytes, and anything else is a reason", () => {
  const img = canvas(16, 16);
  assert.equal(decodePicture(encodePng({ width: 16, height: 16, colorType: 6, depth: 8, pixel: (x, y) => Array.from(img.pixels.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)) })).width, 16);
  assert.equal(decodePicture(encodeJpeg(img)).width, 16);
  assert.equal(decodePicture(Buffer.from("RIFF....WEBP")).error, "neither a PNG nor a JPEG by its first bytes");
});
