import assert from "node:assert/strict";
import test from "node:test";

import { decodeJpeg, exifOrientation, orient, readSegments } from "../plugins/input-shots/jpeg.js";
import { encodeJpeg, exifBlock } from "./fixtures/jpeg/build.mjs";

/**
 * The JPEG decoder held to the format: a picture the suite draws goes through
 * the encoder and comes back within the loss the quantization allows, at
 * every subsampling and with restart intervals, grayscale, and each of the
 * eight Exif orientations; what the reader does not decode is a named reason.
 */

const picture = (width, height) => {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * 4;
    // Flat fields with hard edges: a white page, a dark bar across the top, a blue box, a red box.
    let [r, g, b] = [250, 250, 250];
    if (y < height / 5) [r, g, b] = [30, 30, 40];
    else if (x > width / 8 && x < width / 2 && y > height / 2 && y < (height * 3) / 4) [r, g, b] = [40, 80, 200];
    else if (x > (width * 5) / 8 && x < (width * 7) / 8 && y > height / 3 && y < height / 2) [r, g, b] = [200, 40, 40];
    pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = 255;
  }
  return { width, height, pixels };
};

const meanError = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.pixels.length; i += 4) s += Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]);
  return s / ((a.pixels.length / 4) * 3);
};

test("a picture survives the encoder and the decoder at every subsampling, with restarts and in grayscale", () => {
  const src = picture(97, 61);
  for (const options of [{}, { subsample: { h: 2, v: 1 } }, { subsample: { h: 2, v: 2 } }, { subsample: { h: 2, v: 2 }, restart: 3 }, { restart: 1 }, { gray: true }, { quality: 40 }]) {
    const decoded = decodeJpeg(encodeJpeg(src, options));
    assert.equal(decoded.error, undefined, JSON.stringify(options));
    assert.equal(decoded.width, 97); assert.equal(decoded.height, 61); assert.equal(decoded.pixels.length, 97 * 61 * 4);
    const err = meanError(src, decoded);
    assert.ok(err < (options.gray ? 12 : options.quality ? 10 : 6), `${JSON.stringify(options)} mean error ${err.toFixed(2)}`);
    // The flat fields come back as the colours they were, within quantization.
    const at = (x, y) => Array.from(decoded.pixels.subarray((y * 97 + x) * 4, (y * 97 + x) * 4 + 3));
    if (!options.gray) { assert.ok(at(30, 40)[2] > 150 && at(30, 40)[0] < 90, `blue box reads ${at(30, 40)}`); assert.ok(at(70, 25)[0] > 150 && at(70, 25)[2] < 90, `red box reads ${at(70, 25)}`); }
    assert.ok(at(5, 3)[0] < 60, `dark bar reads ${at(5, 3)}`); assert.ok(at(90, 58)[0] > 220, `page reads ${at(90, 58)}`);
    assert.equal(decoded.pixels[3], 255);
  }
});

test("the camera's orientation is applied, so the picture is the way up the person saw it", () => {
  const src = picture(40, 24);
  const tag = (o) => exifOrientation(Uint8Array.from(exifBlock(o).slice(4)));
  assert.equal(tag(6), 6); assert.equal(tag(1), 1); assert.equal(exifOrientation(new Uint8Array(3)), 1, "a short block is upright");
  const turned = decodeJpeg(encodeJpeg(src, { orientation: 6 }));
  assert.equal(turned.width, 24); assert.equal(turned.height, 40, "a quarter turn swaps the sides");
  // Rotated 90° clockwise, the dark bar that was across the top runs down the right edge.
  assert.ok(turned.pixels[(20 * 24 + 22) * 4] < 60 && turned.pixels[(20 * 24 + 2) * 4] > 200);
  for (const o of [2, 3, 4, 5, 6, 7, 8]) {
    const once = orient(src, o);
    assert.equal(once.pixels.length, src.pixels.length, `orientation ${o} keeps every pixel`);
    // Each orientation is its own inverse or pairs with one; applying the inverse gives the source back.
    const inverse = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 8, 7: 7, 8: 6 }[o];
    assert.deepEqual(orient(once, inverse).pixels, src.pixels, `orientation ${o} undone by ${inverse}`);
  }
  assert.equal(orient(src, 1), src);
});

test("what the reader does not decode is a reason with the format's own name in it", () => {
  const src = picture(16, 16);
  assert.match(decodeJpeg(encodeJpeg(src, { progressive: true })).error, /progressive JPEG is not decoded; save it baseline/);
  assert.equal(decodeJpeg(Buffer.from("GIF89a not a jpeg")).error, "not a JPEG: the start of image marker is missing");
  const whole = encodeJpeg(src);
  assert.match(decodeJpeg(whole.subarray(0, whole.length - 30)).error ?? "", /ends|runs past/, "a file cut short is a reason");
  const { segments } = readSegments(whole);
  assert.deepEqual(segments.map((s) => s.marker.toString(16)), ["e0", "db", "c0", "c4", "da", "d9"]);
  assert.ok(segments[4].scan.length > 0, "the scan data follows the SOS segment");
  // A frame that names a table never defined is a reason, not a crash.
  const noTables = Buffer.concat([whole.subarray(0, segments[2].at), whole.subarray(segments[3].at)]);
  assert.match(decodeJpeg(noTables).error, /Huffman table .* never defined/);
});
