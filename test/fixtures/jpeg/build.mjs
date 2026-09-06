/**
 * A baseline JPEG encoder for the suite, so the decoder is held to the format
 * and not to one camera's habits: the standard's own quantization and Huffman
 * tables (Annex K), a chosen chroma subsampling, a restart interval, an Exif
 * orientation block, and a switch that relabels the frame progressive so the
 * refusal can be tested. Nothing is committed; a test draws what it needs.
 */

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

const Q_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const Q_CHROMA = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99];

const DC_LUMA = { counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const DC_CHROMA = { counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], symbols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const AC_LUMA = { counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], symbols: [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };
const AC_CHROMA = { counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], symbols: [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };

/** Canonical codes for a table: symbol → { code, length }. */
function codes({ counts, symbols }) {
  const out = new Map();
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    for (let i = 0; i < counts[len - 1]; i += 1) { out.set(symbols[k], { code, length: len }); code += 1; k += 1; }
    code <<= 1;
  }
  return out;
}

const scaled = (table, quality) => {
  const q = quality < 50 ? 5000 / quality : 200 - quality * 2;
  return table.map((v) => Math.min(255, Math.max(1, Math.floor((v * q + 50) / 100))));
};

const COS = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x += 1) for (let u = 0; u < 8; u += 1) t[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return t;
})();

function fdct(block) {
  const out = new Float64Array(64);
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y += 1) for (let u = 0; u < 8; u += 1) { let s = 0; for (let x = 0; x < 8; x += 1) s += block[y * 8 + x] * COS[x * 8 + u]; tmp[y * 8 + u] = s; }
  for (let u = 0; u < 8; u += 1) for (let v = 0; v < 8; v += 1) { let s = 0; for (let y = 0; y < 8; y += 1) s += tmp[y * 8 + u] * COS[y * 8 + v]; out[v * 8 + u] = s / 4; }
  return out;
}

const u16 = (n) => [(n >> 8) & 255, n & 255];
const segment = (marker, body) => [0xff, marker, ...u16(body.length + 2), ...body];

/** An Exif APP1 block carrying one orientation tag, big endian. */
export function exifBlock(orientation) {
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  return segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
}

/**
 * Encode RGBA pixels as a baseline JPEG.
 * options: quality (1..100), gray (one component), subsample ({h, v} for chroma, 1 or 2), restart (MCUs per
 * interval), orientation (Exif 1..8), progressive (label the frame SOF2 so the reader must refuse it).
 */
export function encodeJpeg({ width, height, pixels }, { quality = 90, gray = false, subsample = { h: 1, v: 1 }, restart = 0, orientation = 0, progressive = false } = {}) {
  const qL = scaled(Q_LUMA, quality);
  const qC = scaled(Q_CHROMA, quality);
  const comps = gray
    ? [{ id: 1, h: 1, v: 1, q: qL, tq: 0, dc: codes(DC_LUMA), ac: codes(AC_LUMA), td: 0, ta: 0, pred: 0 }]
    : [
        { id: 1, h: subsample.h, v: subsample.v, q: qL, tq: 0, dc: codes(DC_LUMA), ac: codes(AC_LUMA), td: 0, ta: 0, pred: 0 },
        { id: 2, h: 1, v: 1, q: qC, tq: 1, dc: codes(DC_CHROMA), ac: codes(AC_CHROMA), td: 1, ta: 1, pred: 0 },
        { id: 3, h: 1, v: 1, q: qC, tq: 1, dc: codes(DC_CHROMA), ac: codes(AC_CHROMA), td: 1, ta: 1, pred: 0 },
      ];
  const hmax = Math.max(...comps.map((c) => c.h));
  const vmax = Math.max(...comps.map((c) => c.v));
  // Full resolution planes; a subsampled chroma plane averages the pixels each sample covers.
  const plane = (fn) => { const p = new Float64Array(width * height); for (let i = 0; i < width * height; i += 1) p[i] = fn(pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]); return p; };
  const planes = gray
    ? [plane((r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b)]
    : [plane((r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b), plane((r, g, b) => 128 - 0.168736 * r - 0.331264 * g + 0.5 * b), plane((r, g, b) => 128 + 0.5 * r - 0.418688 * g - 0.081312 * b)];
  const sampleAt = (c, i, px, py) => {
    const sx = hmax / c.h; const sy = vmax / c.v;
    let s = 0; let n = 0;
    for (let dy = 0; dy < sy; dy += 1) for (let dx = 0; dx < sx; dx += 1) {
      const x = Math.min(width - 1, px * sx + dx); const y = Math.min(height - 1, py * sy + dy);
      s += planes[i][y * width + x]; n += 1;
    }
    return s / n;
  };
  let acc = 0; let nbits = 0;
  const out = [];
  const put = (code, length) => { for (let i = length - 1; i >= 0; i -= 1) { acc = (acc << 1) | ((code >> i) & 1); nbits += 1; if (nbits === 8) { out.push(acc); if (acc === 0xff) out.push(0); acc = 0; nbits = 0; } } };
  const flush = () => { while (nbits) put(1, 1); };
  const magnitude = (v) => { const a = Math.abs(v); let n = 0; while (a >> n) n += 1; return n; };
  const putValue = (v, n) => put(v < 0 ? v + (1 << n) - 1 : v, n);
  const encodeBlock = (c, i, bx, by) => {
    const block = new Float64Array(64);
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) block[y * 8 + x] = sampleAt(c, i, Math.min(Math.ceil((width * c.h) / hmax) - 1, bx * 8 + x), Math.min(Math.ceil((height * c.v) / vmax) - 1, by * 8 + y)) - 128;
    const coef = fdct(block);
    const q = new Int32Array(64);
    for (let k = 0; k < 64; k += 1) q[k] = Math.round(coef[ZIGZAG[k]] / c.q[ZIGZAG[k]]);
    const diff = q[0] - c.pred; c.pred = q[0];
    const dn = magnitude(diff); const dcode = c.dc.get(dn); put(dcode.code, dcode.length); if (dn) putValue(diff, dn);
    let run = 0;
    for (let k = 1; k < 64; k += 1) {
      if (q[k] === 0) { run += 1; continue; }
      while (run > 15) { const z = c.ac.get(0xf0); put(z.code, z.length); run -= 16; }
      const n = magnitude(q[k]); const s = c.ac.get((run << 4) | n); put(s.code, s.length); putValue(q[k], n); run = 0;
    }
    if (run) { const e = c.ac.get(0); put(e.code, e.length); }
  };
  const mcux = Math.ceil(width / (8 * hmax)); const mcuy = Math.ceil(height / (8 * vmax));
  let n = 0; let rst = 0;
  for (let my = 0; my < mcuy; my += 1) for (let mx = 0; mx < mcux; mx += 1) {
    if (restart && n && n % restart === 0) { flush(); out.push(0xff, 0xd0 + (rst & 7)); rst += 1; for (const c of comps) c.pred = 0; }
    comps.forEach((c, i) => { for (let v = 0; v < c.v; v += 1) for (let h = 0; h < c.h; h += 1) encodeBlock(c, i, mx * c.h + h, my * c.v + v); });
    n += 1;
  }
  flush();
  const zz = (t) => ZIGZAG.map((k) => t[k]);
  const dht = (cls, id, t) => [(cls << 4) | id, ...t.counts, ...t.symbols];
  const file = [0xff, 0xd8, ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])];
  if (orientation) file.push(...exifBlock(orientation));
  file.push(...segment(0xdb, [0, ...zz(qL), ...(gray ? [] : [1, ...zz(qC)])]));
  file.push(...segment(progressive ? 0xc2 : 0xc0, [8, ...u16(height), ...u16(width), comps.length, ...comps.flatMap((c) => [c.id, (c.h << 4) | c.v, c.tq])]));
  file.push(...segment(0xc4, [...dht(0, 0, DC_LUMA), ...dht(1, 0, AC_LUMA), ...(gray ? [] : [...dht(0, 1, DC_CHROMA), ...dht(1, 1, AC_CHROMA)])]));
  if (restart) file.push(...segment(0xdd, u16(restart)));
  file.push(...segment(0xda, [comps.length, ...comps.flatMap((c) => [c.id, (c.td << 4) | c.ta]), 0, 63, 0]));
  // The scan is concatenated, not spread: a photograph's worth of bytes overflows a spread's arguments.
  return Buffer.concat([Buffer.from(file), Buffer.from(out), Buffer.from([0xff, 0xd9])]);
}
