/**
 * A JPEG decoded with no dependency, because a photograph off a phone is a
 * JPEG and a reader that only knows PNG cannot look at one. Baseline and
 * extended sequential Huffman coding are read: the quantization and Huffman
 * tables, the frame, every scan with its restart intervals, the coefficients
 * back through the inverse cosine transform, the chroma planes upsampled and
 * turned to RGB, and the orientation a camera recorded in its Exif block
 * applied so the picture is the way up the person saw it. The result is RGBA
 * bytes with the same shape decodePng returns.
 *
 * What the format allows and this reader does not decode is named rather than
 * approximated: a progressive scan, arithmetic coding, a lossless or twelve
 * bit frame, and a four component (CMYK) picture each come back as a reason.
 */

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

// cos((2x + 1) u π / 16) scaled by C(u), the one table the inverse transform needs.
const COS = (() => {
  const t = new Float64Array(64);
  for (let x = 0; x < 8; x += 1) for (let u = 0; u < 8; u += 1) t[x * 8 + u] = (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return t;
})();

const u16 = (b, at) => (b[at] << 8) | b[at + 1];

/** A Huffman table from its sixteen counts and its symbols, as the standard's F.2.2.3 decodes it. */
function huffmanTable(counts, symbols) {
  const maxcode = new Int32Array(18).fill(-1);
  const valptr = new Int32Array(17);
  const mincode = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    valptr[len] = k;
    mincode[len] = code;
    code += counts[len - 1];
    k += counts[len - 1];
    maxcode[len] = counts[len - 1] ? code - 1 : -1;
    code <<= 1;
  }
  return { maxcode, valptr, mincode, symbols };
}

/** The Exif orientation tag out of an APP1 block, or 1 when the block does not carry one. */
export function exifOrientation(seg) {
  if (seg.length < 14 || String.fromCharCode(...seg.subarray(0, 4)) !== "Exif") return 1;
  const t = seg.subarray(6);
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return 1;
  const r16 = (at) => (le ? t[at] | (t[at + 1] << 8) : (t[at] << 8) | t[at + 1]);
  const r32 = (at) => (le ? (t[at] | (t[at + 1] << 8) | (t[at + 2] << 16)) + t[at + 3] * 0x1000000 : ((t[at] << 24) | (t[at + 1] << 16) | (t[at + 2] << 8) | t[at + 3]) >>> 0);
  if (r16(2) !== 42) return 1;
  const ifd = r32(4);
  if (ifd + 2 > t.length) return 1;
  const n = r16(ifd);
  for (let i = 0; i < n; i += 1) {
    const at = ifd + 2 + i * 12;
    if (at + 12 > t.length) return 1;
    if (r16(at) === 0x0112) { const v = r16(at + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}

/** Rotate or flip RGBA pixels the way an Exif orientation says the camera was held. */
export function orient(image, orientation) {
  if (orientation <= 1 || orientation > 8) return image;
  const { width: w, height: h, pixels } = image;
  const swap = orientation >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let X; let Y;
      switch (orientation) {
        case 2: X = w - 1 - x; Y = y; break;
        case 3: X = w - 1 - x; Y = h - 1 - y; break;
        case 4: X = x; Y = h - 1 - y; break;
        case 5: X = y; Y = x; break;
        case 6: X = h - 1 - y; Y = x; break;
        case 7: X = h - 1 - y; Y = w - 1 - x; break;
        default: X = y; Y = w - 1 - x; break;
      }
      const s = (y * w + x) * 4;
      const d = (Y * W + X) * 4;
      out[d] = pixels[s]; out[d + 1] = pixels[s + 1]; out[d + 2] = pixels[s + 2]; out[d + 3] = pixels[s + 3];
    }
  }
  return { ...image, width: W, height: H, pixels: out };
}

/** Every marker segment of a JPEG in order, or the reason the bytes are not one. The scan data follows each SOS. */
export function readSegments(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: "not a JPEG: the start of image marker is missing" };
  const segments = [];
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return { error: `expected a marker at byte ${at}`, segments };
    while (bytes[at] === 0xff) at += 1;
    const marker = bytes[at];
    at += 1;
    if (marker === 0xd9) { segments.push({ marker, data: new Uint8Array(0), at }); break; }
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (at + 2 > bytes.length) return { error: "a marker segment runs past the end of the file", segments };
    const length = u16(bytes, at);
    if (length < 2 || at + length > bytes.length) return { error: `the segment at byte ${at} runs past the end of the file`, segments };
    const seg = { marker, data: bytes.subarray(at + 2, at + length), at: at + length };
    segments.push(seg);
    at += length;
    if (marker === 0xda) {
      // Entropy coded data runs to the next marker that is neither stuffing nor a restart.
      let end = at;
      while (end < bytes.length) {
        if (bytes[end] === 0xff && end + 1 < bytes.length && bytes[end + 1] !== 0 && !(bytes[end + 1] >= 0xd0 && bytes[end + 1] <= 0xd7) && bytes[end + 1] !== 0xff) break;
        end += 1;
      }
      seg.scan = bytes.subarray(at, end);
      at = end;
    }
  }
  return { segments };
}

const FRAME_NAMES = { 0xc2: "a progressive JPEG", 0xc3: "a lossless JPEG", 0xc5: "a differential sequential JPEG", 0xc6: "a differential progressive JPEG", 0xc7: "a differential lossless JPEG", 0xc9: "an arithmetic coded JPEG", 0xca: "an arithmetic coded progressive JPEG", 0xcb: "an arithmetic coded lossless JPEG", 0xcd: "an arithmetic coded differential JPEG", 0xce: "an arithmetic coded differential progressive JPEG", 0xcf: "an arithmetic coded differential lossless JPEG" };

/** RGBA pixels from a baseline or extended sequential JPEG, oriented, or the reason it was not decoded. */
export function decodeJpeg(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { segments, error } = readSegments(b);
  if (error) return { error };
  const qt = [];
  const dc = [];
  const ac = [];
  let frame = null;
  let restart = 0;
  let orientation = 1;
  let adobe = null;
  let scans = 0;
  for (const seg of segments) {
    const d = seg.data;
    if (seg.marker === 0xe1) orientation = Math.max(orientation, exifOrientation(d));
    else if (seg.marker === 0xee && d.length >= 12 && String.fromCharCode(...d.subarray(0, 5)) === "Adobe") adobe = { transform: d[11] };
    else if (seg.marker === 0xdb) {
      let at = 0;
      while (at < d.length) {
        const precision = d[at] >> 4;
        const id = d[at] & 15;
        at += 1;
        const table = new Int32Array(64);
        for (let k = 0; k < 64; k += 1) { table[ZIGZAG[k]] = precision ? u16(d, at) : d[at]; at += precision ? 2 : 1; }
        qt[id] = table;
      }
    } else if (seg.marker === 0xc4) {
      let at = 0;
      while (at + 17 <= d.length) {
        const cls = d[at] >> 4;
        const id = d[at] & 15;
        const counts = Array.from(d.subarray(at + 1, at + 17));
        const total = counts.reduce((s, n) => s + n, 0);
        const symbols = Array.from(d.subarray(at + 17, at + 17 + total));
        at += 17 + total;
        (cls ? ac : dc)[id] = huffmanTable(counts, symbols);
      }
    } else if (seg.marker === 0xdd) restart = u16(d, 0);
    else if (seg.marker >= 0xc0 && seg.marker <= 0xcf && seg.marker !== 0xc4 && seg.marker !== 0xc8 && seg.marker !== 0xcc) {
      if (FRAME_NAMES[seg.marker]) return { error: `${FRAME_NAMES[seg.marker]} is not decoded; save it baseline` };
      if (frame) return { error: "two frames in one file" };
      if (d[0] !== 8) return { error: `a ${d[0]} bit JPEG is not decoded; save it eight bit` };
      const height = u16(d, 1);
      const width = u16(d, 3);
      const n = d[5];
      if (!width || !height || width * height > 64e6) return { error: `${width} × ${height} is not a size this reader decodes` };
      if (n === 4) return { error: "a four component (CMYK) JPEG is not decoded; save it RGB" };
      if (n !== 1 && n !== 3) return { error: `${n} components is not a frame this reader decodes` };
      const components = [];
      for (let i = 0; i < n; i += 1) components.push({ id: d[6 + i * 3], h: d[7 + i * 3] >> 4, v: d[7 + i * 3] & 15, tq: d[8 + i * 3] });
      const hmax = Math.max(...components.map((c) => c.h));
      const vmax = Math.max(...components.map((c) => c.v));
      const mcux = Math.ceil(width / (8 * hmax));
      const mcuy = Math.ceil(height / (8 * vmax));
      for (const c of components) {
        if (!c.h || !c.v || c.h > 4 || c.v > 4) return { error: `component ${c.id} has sampling factors ${c.h}×${c.v}, which the format does not allow` };
        c.blocksPerLine = mcux * c.h;
        c.blocksPerColumn = mcuy * c.v;
        c.plane = new Uint8ClampedArray(c.blocksPerLine * 8 * c.blocksPerColumn * 8);
        c.pred = 0;
      }
      frame = { width, height, components, hmax, vmax, mcux, mcuy };
    } else if (seg.marker === 0xda) {
      if (!frame) return { error: "a scan before any frame" };
      const n = d[0];
      const parts = [];
      for (let i = 0; i < n; i += 1) {
        const c = frame.components.find((k) => k.id === d[1 + i * 2]);
        if (!c) return { error: `the scan names component ${d[1 + i * 2]}, which the frame does not declare` };
        c.dc = dc[d[2 + i * 2] >> 4];
        c.ac = ac[d[2 + i * 2] & 15];
        c.q = qt[c.tq];
        if (!c.dc || !c.ac) return { error: `the scan uses Huffman table ${d[2 + i * 2] >> 4}/${d[2 + i * 2] & 15}, which was never defined` };
        if (!c.q) return { error: `component ${c.id} quantizes with table ${c.tq}, which was never defined` };
        parts.push(c);
      }
      const failed = decodeScan(seg.scan, frame, parts, restart);
      if (failed) return { error: failed };
      scans += 1;
    }
  }
  if (!frame) return { error: "no frame in the file" };
  if (!scans) return { error: "no scan in the file" };
  return orient(toRgba(frame, adobe), orientation);
}

/** Decode one scan's entropy coded data into the components' planes; a string is the reason it stopped short. */
function decodeScan(data, frame, parts, restart) {
  let pos = 0;
  let bitBuf = 0;
  let bitCount = 0;
  let marker = false;
  const readBit = () => {
    if (bitCount === 0) {
      if (pos >= data.length) { marker = true; return 0; }
      let byte = data[pos];
      pos += 1;
      if (byte === 0xff) {
        const next = data[pos];
        if (next === 0) pos += 1;
        else { marker = true; byte = 0; pos -= 1; }
      }
      bitBuf = byte;
      bitCount = 8;
    }
    bitCount -= 1;
    return (bitBuf >> bitCount) & 1;
  };
  const receive = (n) => { let v = 0; for (let i = 0; i < n; i += 1) v = (v << 1) | readBit(); return v; };
  const extend = (v, n) => (n === 0 ? 0 : v < 1 << (n - 1) ? v - (1 << n) + 1 : v);
  const decode = (table) => {
    let code = readBit();
    for (let len = 1; len <= 16; len += 1) {
      if (code <= table.maxcode[len]) return table.symbols[table.valptr[len] + code - table.mincode[len]];
      code = (code << 1) | readBit();
    }
    marker = true;
    return 0;
  };
  const coeffs = new Int32Array(64);
  const block = (c, row, col) => {
    coeffs.fill(0);
    const t = decode(c.dc);
    const diff = t === 0 ? 0 : extend(receive(t), t);
    c.pred += diff;
    coeffs[0] = c.pred * c.q[0];
    for (let k = 1; k < 64;) {
      const rs = decode(c.ac);
      const s = rs & 15;
      const r = rs >> 4;
      if (s === 0) { if (r < 15) break; k += 16; continue; }
      k += r;
      if (k > 63) break;
      coeffs[ZIGZAG[k]] = extend(receive(s), s) * c.q[ZIGZAG[k]];
      k += 1;
    }
    idct(coeffs, c.plane, row * 8 * c.blocksPerLine * 8 + col * 8, c.blocksPerLine * 8);
  };
  const resync = () => {
    // A restart marker sits on a byte boundary; the predictors start again after it.
    bitCount = 0;
    while (pos + 1 < data.length && !(data[pos] === 0xff && data[pos + 1] >= 0xd0 && data[pos + 1] <= 0xd7)) pos += 1;
    if (pos + 1 < data.length) pos += 2;
    marker = false;
    for (const c of parts) c.pred = 0;
  };
  if (parts.length === 1) {
    // One component alone is coded block by block over its own extent, not by MCU.
    const c = parts[0];
    const cols = Math.ceil((Math.ceil((frame.width * c.h) / frame.hmax)) / 8);
    const rows = Math.ceil((Math.ceil((frame.height * c.v) / frame.vmax)) / 8);
    let n = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (restart && n && n % restart === 0) resync();
        block(c, row, col);
        if (marker && pos >= data.length) return `the scan ends before its ${rows * cols} blocks do`;
        n += 1;
      }
    }
    return null;
  }
  let n = 0;
  for (let my = 0; my < frame.mcuy; my += 1) {
    for (let mx = 0; mx < frame.mcux; mx += 1) {
      if (restart && n && n % restart === 0) resync();
      for (const c of parts) for (let v = 0; v < c.v; v += 1) for (let h = 0; h < c.h; h += 1) block(c, my * c.v + v, mx * c.h + h);
      if (marker && pos >= data.length && n + 1 < frame.mcux * frame.mcuy) return `the scan ends at MCU ${n + 1} of ${frame.mcux * frame.mcuy}`;
      n += 1;
    }
  }
  return null;
}

const tmp = new Float64Array(64);

/** The inverse cosine transform of one dequantized block, written as levels into a plane. */
function idct(coeffs, plane, at, stride) {
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let s = 0;
      for (let u = 0; u < 8; u += 1) {
        const c = coeffs[y * 8 + u];
        if (c) s += c * COS[x * 8 + u];
      }
      tmp[y * 8 + x] = s;
    }
  }
  for (let x = 0; x < 8; x += 1) {
    for (let y = 0; y < 8; y += 1) {
      let s = 0;
      for (let v = 0; v < 8; v += 1) s += tmp[v * 8 + x] * COS[y * 8 + v];
      plane[at + y * stride + x] = Math.round(s / 4 + 128);
    }
  }
}

/** The planes sampled up to the frame's size and turned to RGBA. */
function toRgba(frame, adobe) {
  const { width, height, components, hmax, vmax } = frame;
  const pixels = new Uint8Array(width * height * 4);
  const sample = (c, x, y) => c.plane[Math.floor((y * c.v) / vmax) * c.blocksPerLine * 8 + Math.floor((x * c.h) / hmax)];
  const rgb = components.length === 3 && adobe?.transform === 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const Y = sample(components[0], x, y);
      if (components.length === 1) { pixels[at] = pixels[at + 1] = pixels[at + 2] = Y; }
      else if (rgb) { pixels[at] = Y; pixels[at + 1] = sample(components[1], x, y); pixels[at + 2] = sample(components[2], x, y); }
      else {
        const cb = sample(components[1], x, y) - 128;
        const cr = sample(components[2], x, y) - 128;
        pixels[at] = clamp(Y + 1.402 * cr);
        pixels[at + 1] = clamp(Y - 0.344136 * cb - 0.714136 * cr);
        pixels[at + 2] = clamp(Y + 1.772 * cb);
      }
      pixels[at + 3] = 255;
    }
  }
  return { width, height, depth: 8, colorType: 2, pixels };
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
