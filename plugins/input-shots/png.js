import { inflateSync } from "node:zlib";

/**
 * A PNG decoded with no dependency: the chunks, the palette, the five scanline
 * filters, every bit depth and colour type the format defines except
 * interlacing, which is named rather than approximated. The result is RGBA
 * bytes, so a screenshot's colours can be counted rather than assumed.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const u32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** The chunks of a PNG in order, or the reason the bytes are not one. */
export function readChunks(bytes) {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) return { error: "not a PNG: the signature is missing" };
  const chunks = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = u32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (at + 12 + length > bytes.length) return { error: `the ${type} chunk runs past the end of the file`, chunks };
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === "IEND") break;
  }
  return { chunks };
}

function unfilter(data, width, height, bpp, stride) {
  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = data[src];
    src += 1;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = data[src + x];
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b; break;
        case 3: v = raw + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
          v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return { error: `scanline ${y} uses filter ${filter}, which the format does not define` };
      }
      out[row + x] = v & 0xff;
    }
    src += stride;
  }
  return { rows: out };
}

/** One sample of `depth` bits from a row at its full depth, as the file wrote it. */
function rawSample(row, index, depth) {
  if (depth === 8) return row[index];
  if (depth === 16) return (row[index * 2] << 8) | row[index * 2 + 1];
  const perByte = 8 / depth;
  const byte = row[Math.floor(index / perByte)];
  const shift = 8 - depth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

/** One sample scaled to eight bits (a palette index is never scaled). */
function sample(row, index, depth, scale) {
  const v = rawSample(row, index, depth);
  if (!scale || depth === 8) return v;
  if (depth === 16) return v >> 8;
  return Math.round((v * 255) / ((1 << depth) - 1));
}

/** The image as RGBA bytes with its size, or the reason it could not be decoded. */
export function decodePng(bytes) {
  const { chunks, error } = readChunks(bytes);
  if (error) return { error };
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) return { error: "no IHDR chunk" };
  const width = u32(ihdr.data, 0);
  const height = u32(ihdr.data, 4);
  const depth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlaced = ihdr.data[12] === 1;
  const channels = CHANNELS[colorType];
  if (!channels) return { error: `colour type ${colorType} is not one the format defines` };
  if (![1, 2, 4, 8, 16].includes(depth)) return { error: `bit depth ${depth} is not one the format defines` };
  if (interlaced) return { error: "an interlaced (Adam7) PNG is not decoded; save it non interlaced" };
  if (!width || !height || width * height > 64e6) return { error: `${width} × ${height} is not a size this reader decodes` };
  const idat = chunks.filter((c) => c.type === "IDAT");
  if (!idat.length) return { error: "no IDAT chunk" };
  let data;
  try { data = inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c.data)))); } catch (err) { return { error: `the image data does not inflate: ${err.message}` }; }
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  if (data.length < height * (stride + 1)) return { error: `the image data is short: ${data.length} bytes for ${height} rows of ${stride + 1}` };
  const filtered = unfilter(data, width, height, bpp, stride);
  if (filtered.error) return { error: filtered.error };
  const plte = chunks.find((c) => c.type === "PLTE")?.data ?? null;
  const trns = chunks.find((c) => c.type === "tRNS")?.data ?? null;
  if (colorType === 3 && !plte) return { error: "a palette image with no PLTE chunk" };
  // A greyscale or truecolour image may name one colour as transparent in tRNS, two bytes per sample at the
  // image's own depth; a pixel equal to it is transparent and never counted as a colour the picture is made of.
  const key16 = (at) => (trns && trns.length >= at + 2 ? (trns[at] << 8) | trns[at + 1] : null);
  const keyGray = colorType === 0 ? key16(0) : null;
  const keyRgb = colorType === 2 && key16(4) !== null ? [key16(0), key16(2), key16(4)] : null;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = filtered.rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      switch (colorType) {
        case 0: {
          const g = sample(row, x, depth, true);
          pixels[o] = g; pixels[o + 1] = g; pixels[o + 2] = g;
          pixels[o + 3] = keyGray !== null && rawSample(row, x, depth) === keyGray ? 0 : 255;
          break;
        }
        case 2: {
          for (let k = 0; k < 3; k += 1) pixels[o + k] = sample(row, x * 3 + k, depth, true);
          pixels[o + 3] = keyRgb && [0, 1, 2].every((k) => rawSample(row, x * 3 + k, depth) === keyRgb[k]) ? 0 : 255;
          break;
        }
        case 3: {
          const i = sample(row, x, depth, false);
          pixels[o] = plte[i * 3] ?? 0; pixels[o + 1] = plte[i * 3 + 1] ?? 0; pixels[o + 2] = plte[i * 3 + 2] ?? 0;
          pixels[o + 3] = trns && i < trns.length ? trns[i] : 255;
          break;
        }
        case 4: { const g = sample(row, x * 2, depth, true); pixels[o] = g; pixels[o + 1] = g; pixels[o + 2] = g; pixels[o + 3] = sample(row, x * 2 + 1, depth, true); break; }
        case 6: { for (let k = 0; k < 4; k += 1) pixels[o + k] = sample(row, x * 4 + k, depth, true); break; }
        default: break;
      }
    }
  }
  return { width, height, depth, colorType, pixels };
}

const hex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

/**
 * The colours an image is made of, most common first, each with its share of
 * the opaque pixels. Antialiasing makes a screenshot thousands of colours, so
 * they are binned at five bits per channel and each bin is reported as the
 * exact colour seen most inside it, never a blend nobody drew.
 */
export function palette(image, count = 8) {
  const bins = new Map();
  let opaque = 0;
  const { pixels } = image;
  for (let o = 0; o < pixels.length; o += 4) {
    if (pixels[o + 3] < 128) continue;
    opaque += 1;
    const r = pixels[o]; const g = pixels[o + 1]; const b = pixels[o + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const exact = (r << 16) | (g << 8) | b;
    let bin = bins.get(key);
    if (!bin) { bin = { n: 0, exact: new Map() }; bins.set(key, bin); }
    bin.n += 1;
    bin.exact.set(exact, (bin.exact.get(exact) ?? 0) + 1);
  }
  if (!opaque) return [];
  return [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((bin) => {
      const top = [...bin.exact].sort((a, b) => b[1] - a[1])[0][0];
      return { hex: hex((top >> 16) & 255, (top >> 8) & 255, top & 255), share: bin.n / opaque };
    });
}

/** WCAG contrast ratio between two hex colours (dsp-improve's contrastRatio reads rgb() strings; this reads hex). */
export function contrastHex(a, b) {
  const lum = (hexColor) => {
    const n = parseInt(hexColor.slice(1), 16);
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const la = lum(a); const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
