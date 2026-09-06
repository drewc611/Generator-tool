import { deflateSync } from "node:zlib";

/**
 * A PNG encoder for the suite: any colour type and bit depth the decoder
 * claims to read, with a chosen scanline filter per row, so the reader is held
 * to the format rather than to one encoder's habits. Nothing is committed; a
 * test draws what it needs.
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type, data) => {
  const body = [...type].map((c) => c.charCodeAt(0)).concat([...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
};

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Pack samples of `depth` bits into a row of bytes. */
function packRow(samples, depth) {
  if (depth === 8) return samples;
  if (depth === 16) return samples.flatMap((v) => [v, 0]);
  const out = [];
  const perByte = 8 / depth;
  for (let i = 0; i < samples.length; i += perByte) {
    let byte = 0;
    for (let k = 0; k < perByte; k += 1) byte |= (samples[i + k] ?? 0) << (8 - depth * (k + 1));
    out.push(byte);
  }
  return out;
}

/**
 * Encode an image. `pixel(x, y)` returns the samples for one pixel: [r,g,b] for
 * type 2, [r,g,b,a] for 6, [g] for 0, [g,a] for 4, [index] for 3. Filters are
 * applied per row from the `filters` list, cycling, so every filter is exercised.
 */
export function encodePng({ width, height, colorType = 2, depth = 8, pixel, palette = null, trns = null, filters = [0], interlaced = false }) {
  const channels = CHANNELS[colorType];
  const bpp = Math.max(1, Math.ceil((channels * depth) / 8));
  const rows = [];
  let previous = null;
  for (let y = 0; y < height; y += 1) {
    const samples = [];
    for (let x = 0; x < width; x += 1) samples.push(...pixel(x, y));
    const raw = packRow(samples, depth);
    const filter = filters[y % filters.length];
    const line = [filter];
    for (let x = 0; x < raw.length; x += 1) {
      const a = x >= bpp ? raw[x - bpp] : 0;
      const b = previous ? previous[x] : 0;
      const c = x >= bpp && previous ? previous[x - bpp] : 0;
      let v = raw[x];
      if (filter === 1) v -= a;
      else if (filter === 2) v -= b;
      else if (filter === 3) v -= (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        v -= pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line.push(v & 255);
    }
    rows.push(...line);
    previous = raw;
  }
  const ihdr = [...u32(width), ...u32(height), depth, colorType, 0, 0, interlaced ? 1 : 0];
  const out = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", ihdr)];
  if (palette) out.push(...chunk("PLTE", palette.flat()));
  if (trns) out.push(...chunk("tRNS", trns));
  out.push(...chunk("IDAT", deflateSync(Buffer.from(rows))));
  out.push(...chunk("IEND", []));
  return Buffer.from(out);
}

/** A screenshot shaped image: a page background, a header bar, a body of text coloured pixels, and a button. */
export function screenshot({ width = 120, height = 80, bg = [251, 250, 248], bar = [0, 75, 135], ink = [28, 27, 25] } = {}) {
  return encodePng({
    width, height, colorType: 2, filters: [0, 1, 2, 3, 4],
    pixel: (x, y) => {
      if (y < 12) return bar;
      // Text as runs of ink on every fourth row, with an antialiased edge pixel beside each run.
      if (y % 4 === 0 && y > 20 && y < height - 16 && x > 8 && x < width - 8) return x % 7 === 0 ? [140, 139, 137] : ink;
      if (y > height - 14 && x > width - 40 && x < width - 8) return bar;
      return bg;
    },
  });
}
