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

test("the twenty first review pass: a malformed table, frame or scan is a named reason, a cut file never a picture, and the edges of the format decode", () => {
  const src = picture(24, 16);
  const whole = encodeJpeg(src);
  const { segments } = readSegments(whole);
  const seg = (m) => segments.find((s) => s.marker === m);
  // The same file with one marker segment's body swapped for another, its length rewritten.
  const replace = (m, body) => { const s = seg(m); return Buffer.concat([whole.subarray(0, s.at - s.data.length - 2), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 255]), Buffer.from(body), whole.subarray(s.at)]); };
  const body = (m) => Array.from(seg(m).data);
  const zeros = () => new Array(16).fill(0);
  // The edges the format allows: one pixel, a strip twenty thousand wide, chroma sampled down only vertically, every code sixteen bits long.
  assert.equal(decodeJpeg(encodeJpeg(picture(1, 1))).pixels.length, 4);
  const row = picture(20000, 1);
  const strip = decodeJpeg(encodeJpeg(row));
  assert.equal(strip.width, 20000); assert.equal(strip.height, 1); assert.ok(meanError(row, strip) < 6, "a strip twenty thousand wide decodes to its end");
  assert.ok(meanError(src, decodeJpeg(encodeJpeg(src, { subsample: { h: 1, v: 2 } }))) < 8, "vertical only subsampling");
  for (const options of [{ longCodes: true }, { longCodes: true, gray: true, restart: 2 }, { longCodes: true, subsample: { h: 2, v: 2 } }]) {
    const long = decodeJpeg(encodeJpeg(src, options));
    assert.equal(long.error, undefined, JSON.stringify(options));
    assert.deepEqual(long.pixels, decodeJpeg(encodeJpeg(src, { ...options, longCodes: false })).pixels, `sixteen bit codes decode to the same pixels ${JSON.stringify(options)}`);
  }
  // Tables that break the format are refused by name rather than decoded into a picture that looks right.
  const dqt = body(0xdb); dqt[0] = 5;
  assert.equal(decodeJpeg(replace(0xdb, dqt)).error, "quantization table 5 with precision 0 is not one the format allows");
  assert.equal(decodeJpeg(replace(0xdb, body(0xdb).slice(0, 30))).error, "quantization table 0 runs past its segment");
  const c300 = zeros(); c300[15] = 255; c300[14] = 45;
  assert.equal(decodeJpeg(replace(0xc4, [0x00, ...c300, ...new Array(300).fill(1), ...body(0xc4)])).error, "Huffman table 0/0 declares 300 symbols and its segment may hold at most 256");
  const c200 = zeros(); c200[15] = 200;
  assert.equal(decodeJpeg(replace(0xc4, [0x00, ...c200, 1, 2, 3])).error, "Huffman table 0/0 declares 200 symbols and its segment carries fewer");
  const full = zeros(); full[0] = 3; full[1] = 1;
  assert.equal(decodeJpeg(replace(0xc4, [0x00, ...full, 0, 1, 2, 3, ...body(0xc4)])).error, "Huffman table 0/0 has more codes than its lengths allow");
  // A frame or scan that names its components wrongly is a reason, never a flat colour dressed as a picture.
  const twice = body(0xc0); twice[9] = twice[6];
  assert.equal(decodeJpeg(replace(0xc0, twice)).error, "the frame declares one component id twice");
  assert.equal(decodeJpeg(replace(0xc0, [])).error, "the frame header is cut short");
  assert.equal(decodeJpeg(replace(0xc0, [8, 0, 16])).error, "the frame header is cut short");
  assert.equal(decodeJpeg(replace(0xda, [0, 0, 63, 0])).error, "a scan naming 0 components is not one the format allows");
  assert.equal(decodeJpeg(replace(0xda, [])).error, "a scan naming 0 components is not one the format allows");
  assert.equal(decodeJpeg(replace(0xda, [1, 1, 0, 0, 63, 0])).error, "component 2 is declared by the frame and never scanned");
  // A restart interval with no restart markers to find, and a file cut between a stuffed ff 00 pair, each end as a reason.
  const dht = seg(0xc4);
  assert.match(decodeJpeg(Buffer.concat([whole.subarray(0, dht.at), Buffer.from([0xff, 0xdd, 0, 4, 0, 2]), whole.subarray(dht.at)])).error, /the scan ends at MCU \d of 6/);
  assert.match(decodeJpeg(Buffer.concat([whole.subarray(0, seg(0xda).at + 10), Buffer.from([0xff])])).error, /the scan ends at MCU 1 of 6/, "the data ran out; the rest is not grey");
  assert.equal(decodeJpeg(Buffer.concat([whole.subarray(0, dht.at), Buffer.from([0xff, 0xdd, 0, 3, 5]), whole.subarray(dht.at)])).error, undefined, "a restart segment one byte long declares no interval and is not read past its end");
  // A real file cut at every hundredth byte, and at every byte inside its scan, is a reason or a picture and never a throw; inside the scan it is a reason until the last MCU.
  const big = encodeJpeg(picture(200, 120), { subsample: { h: 2, v: 2 }, restart: 4, orientation: 6 });
  const sos = readSegments(big).segments.find((s) => s.marker === 0xda);
  for (let cut = 1; cut < big.length; cut += 100) { const r = decodeJpeg(big.subarray(0, cut)); assert.ok(r.error || r.pixels, `cut at ${cut}`); }
  let pictures = 0;
  for (let cut = sos.at + 1; cut < sos.at + sos.scan.length - 60; cut += 1) if (!decodeJpeg(big.subarray(0, cut)).error) pictures += 1;
  assert.equal(pictures, 0, "no cut short of the last MCU passes as a picture");
  // An Exif block whose tag count or directory offset points past its own bytes is upright, not a read past the end.
  assert.equal(exifOrientation(Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0xff, 0xff, 0, 0, 0, 0])), 1);
  assert.equal(exifOrientation(Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 42, 0x7f, 0xff, 0xff, 0xf0, 0, 1, 0, 0, 0, 0])), 1);
  assert.equal(exifOrientation(Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 42, 0, 0xf0, 0xff, 0xff, 0xff, 0, 1, 0, 0, 0, 0])), 1);
});
