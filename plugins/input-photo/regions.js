/**
 * A picture cut into the regions a screen is made of, with no dependency and
 * no model: the pixels are shrunk to a working width, each is foreground where
 * it differs from the light around it (so a photograph's uneven lighting does
 * not become a shape), the foreground is grouped into connected components,
 * small components on one line become a line of text, and each remaining
 * component is read by its shape alone: an outline is a frame, a solid patch
 * is a block, a frame the height of a text line is a field, a block with a
 * line of text on it is a button, a frame holding other regions is a card.
 *
 * What a region says is not read: there is no OCR here, so every line of text
 * is a place with a size and nothing more, and the caller names it as unread.
 * The classification is by shape, so it is a reading and not a fact, and the
 * caller says so too.
 */

const WORK_WIDTH = 320;

/** A grayscale copy shrunk to the working width by box filter, so noise averages out and the rest is fast. */
export function shrink(image, workWidth = WORK_WIDTH) {
  const scale = Math.max(1, image.width / workWidth);
  const width = Math.max(1, Math.round(image.width / scale));
  const height = Math.max(1, Math.round(image.height / scale));
  const gray = new Float32Array(width * height);
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * scale); const y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * scale); const x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) { const at = (yy * image.width + xx) * 4; r += image.pixels[at]; g += image.pixels[at + 1]; b += image.pixels[at + 2]; n += 1; }
      const i = y * width + x;
      rgb[i * 3] = r / n; rgb[i * 3 + 1] = g / n; rgb[i * 3 + 2] = b / n;
      gray[i] = (0.299 * r + 0.587 * g + 0.114 * b) / n;
    }
  }
  return { width, height, gray, rgb, scale };
}

/** The mean over a window around each pixel, by summed area table, so a lighting gradient is background and not a shape. */
function localMean(gray, width, height, radius) {
  const sat = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y += 1) {
    let row = 0;
    for (let x = 1; x <= width; x += 1) { row += gray[(y - 1) * width + (x - 1)]; sat[y * (width + 1) + x] = sat[(y - 1) * (width + 1) + x] + row; }
  }
  const mean = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius); const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius); const x1 = Math.min(width, x + radius + 1);
      const sum = sat[y1 * (width + 1) + x1] - sat[y0 * (width + 1) + x1] - sat[y1 * (width + 1) + x0] + sat[y0 * (width + 1) + x0];
      mean[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return mean;
}

/** Foreground: a pixel darker or lighter than the light around it by more than the threshold. */
export function foreground(small, { threshold = 28 } = {}) {
  const { gray, width, height } = small;
  const mean = localMean(gray, width, height, Math.max(8, Math.round(Math.min(width, height) / 6)));
  const mask = new Uint8Array(width * height);
  // The page is whatever most of the picture is; a dark UI reads its light marks as foreground the same way.
  let dark = 0;
  for (let i = 0; i < gray.length; i += 1) if (gray[i] < 128) dark += 1;
  const darkPage = dark > gray.length / 2;
  for (let i = 0; i < gray.length; i += 1) {
    const d = gray[i] - mean[i];
    mask[i] = (darkPage ? d > threshold : d < -threshold) ? 1 : 0;
  }
  return { mask, darkPage };
}

/**
 * Connected components of the mask, four connected, each with its box and pixel count. With `box` the
 * search is limited to that box and `value` says which pixels count, so the light writing on a dark button
 * is found as the holes in its block.
 */
export function components(mask, width, height, { minArea = 3, box = null, value = 1 } = {}) {
  const label = new Int32Array(width * height).fill(-1);
  const out = [];
  const stack = new Int32Array(width * height);
  const within = (x, y) => !box || (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h);
  const first = box ? box.y * width + box.x : 0;
  const last = box ? (box.y + box.h - 1) * width + box.x + box.w : mask.length;
  for (let start = first; start < last; start += 1) {
    if (mask[start] !== value || label[start] !== -1 || (box && !within(start % width, Math.floor(start / width)))) continue;
    const id = out.length;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    let x0 = width; let y0 = height; let x1 = -1; let y1 = -1; let count = 0;
    while (top) {
      const i = stack[--top];
      const x = i % width; const y = (i - x) / width;
      count += 1;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [x > 0 && within(x - 1, y) ? i - 1 : -1, x + 1 < width && within(x + 1, y) ? i + 1 : -1, y > 0 && within(x, y - 1) ? i - width : -1, y + 1 < height && within(x, y + 1) ? i + width : -1]) {
        if (j >= 0 && mask[j] === value && label[j] === -1) { label[j] = id; stack[top++] = j; }
      }
    }
    out.push({ id, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, count });
  }
  return out.filter((c) => c.count >= minArea);
}

const inside = (a, b) => a !== b && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * Regions from an RGBA image: kind, position and size in pixels of the original and as a share of it,
 * children for a card, and for a field or button the text line that labels it. `lineHeight` is the
 * median glyph height in pixels, the size the picture's writing is.
 */
export function segment(image, options = {}) {
  const small = shrink(image, options.workWidth);
  const { mask, darkPage } = foreground(small, options);
  const comps = components(mask, small.width, small.height, options);
  const { width: W, height: H, scale } = small;
  const area = W * H;
  // Shape first: an outline fills little of its box; a patch fills most of it.
  for (const c of comps) {
    c.fill = c.count / (c.w * c.h);
    const big = c.w * c.h > area * 0.004 && c.w >= 6 && c.h >= 6;
    c.shape = big && c.fill < 0.45 ? "frame" : big && c.fill >= 0.45 ? "block" : "glyph";
  }
  // The writing on a filled block is the light left in it: the holes that touch none of the block's edges.
  for (const c of comps.filter((k) => k.shape === "block")) {
    for (const hole of components(mask, W, H, { minArea: options.minArea ?? 3, box: c, value: 0 })) {
      if (hole.x <= c.x || hole.y <= c.y || hole.x + hole.w >= c.x + c.w || hole.y + hole.h >= c.y + c.h) continue;
      if (hole.w * hole.h > c.w * c.h * 0.5) continue;
      comps.push({ ...hole, id: comps.length, fill: hole.count / (hole.w * hole.h), shape: "glyph", light: true });
    }
  }
  const glyphs = comps.filter((c) => c.shape === "glyph");
  const glyphH = median(glyphs.map((g) => g.h)) || 4;
  // A small square outline standing alone is a check box, not a letter.
  for (const g of glyphs) if (g.fill < 0.6 && g.h >= glyphH * 1.1 && Math.abs(g.w - g.h) <= Math.max(2, g.h * 0.25)) g.shape = "check";
  // Glyphs on one row within a small gap of each other are a line of text.
  const lines = [];
  const byRow = glyphs.filter((g) => g.shape === "glyph").sort((a, b) => a.y - b.y || a.x - b.x);
  const taken = new Set();
  for (const g of byRow) {
    if (taken.has(g)) continue;
    const line = { x: g.x, y: g.y, x1: g.x + g.w, y1: g.y + g.h, glyphs: [g] };
    taken.add(g);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of byRow) {
        if (taken.has(o)) continue;
        const overlap = Math.min(line.y1, o.y + o.h) - Math.max(line.y, o.y);
        const gap = Math.max(o.x - line.x1, line.x - (o.x + o.w));
        if (overlap > Math.min(line.y1 - line.y, o.h) * 0.4 && gap <= glyphH * 2.2 && o.h <= glyphH * 3) {
          line.glyphs.push(o); taken.add(o); grew = true;
          line.x = Math.min(line.x, o.x); line.y = Math.min(line.y, o.y); line.x1 = Math.max(line.x1, o.x + o.w); line.y1 = Math.max(line.y1, o.y + o.h);
        }
      }
    }
    lines.push({ kind: line.glyphs.length >= 2 ? "text" : "mark", x: line.x, y: line.y, w: line.x1 - line.x, h: line.y1 - line.y, glyphs: line.glyphs.length });
  }
  const shapes = comps.filter((c) => c.shape !== "glyph").map((c) => ({ kind: c.shape, x: c.x, y: c.y, w: c.w, h: c.h, fill: c.fill }));
  const lineH = median(lines.filter((l) => l.kind === "text").map((l) => l.h)) || glyphH;
  // A frame no taller than two lines and wider than it is tall is a field; a block with one line on it is a button;
  // a frame that holds other regions is a card; a block with nothing on it is an image or a bar.
  const all = [...shapes, ...lines];
  for (const s of shapes) {
    const within = all.filter((o) => o !== s && inside(o, s));
    const texts = within.filter((o) => o.kind === "text");
    const lowWide = s.h <= lineH * 3.2 && s.w > s.h * 2.5;
    if (s.kind === "frame") {
      if (lowWide && within.every((o) => o.kind === "text" || o.kind === "mark") && texts.length <= 1) { s.kind = "field"; s.label = texts[0] ?? null; }
      else if (within.length) s.kind = "card";
      else s.kind = lowWide ? "field" : "box";
    } else if (s.kind === "block") {
      if (texts.length === 1 && within.length <= 2 && s.h <= lineH * 3.5 && s.w >= s.h && s.w < W * 0.9) { s.kind = "button"; s.label = texts[0]; }
      else if (s.w >= W * 0.6 && s.h <= lineH * 5) { s.kind = "bar"; s.label = texts.length === 1 ? texts[0] : null; }
      else s.kind = "image";
    } else if (s.kind === "check") s.kind = "check";
  }
  // A text line inside a field or on a button is that control's caption, not a paragraph of its own.
  const captions = new Set(shapes.map((s) => s.label).filter(Boolean));
  const top = all.filter((r) => !captions.has(r) && !shapes.some((s) => s.kind === "card" && inside(r, s)));
  for (const card of shapes.filter((s) => s.kind === "card")) {
    card.children = order(all.filter((r) => !captions.has(r) && inside(r, card) && !shapes.some((s) => s !== card && s.kind === "card" && inside(s, card) && inside(r, s))), lineH);
  }
  const px = (r) => ({ ...r, x: Math.round(r.x * scale), y: Math.round(r.y * scale), w: Math.round(r.w * scale), h: Math.round(r.h * scale), at: { left: r.x / W, top: r.y / H, width: r.w / W, height: r.h / H } });
  const finish = (r) => { const p = px(r); if (r.label) p.label = px(r.label); if (r.children) p.children = r.children.map(finish); delete p.fill; return p; };
  return { regions: order(top, lineH).map(finish), lineHeight: Math.round(lineH * scale), darkPage, work: { width: W, height: H } };
}

/** Reading order: rows top to bottom, each row left to right, a row being what overlaps vertically by half a line. */
function order(regions, lineH) {
  const sorted = [...regions].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const r of sorted) {
    const row = rows.find((row) => Math.min(row.y1, r.y + r.h) - Math.max(row.y, r.y) >= Math.min(lineH, r.h) / 2);
    if (row) { row.items.push(r); row.y = Math.min(row.y, r.y); row.y1 = Math.max(row.y1, r.y + r.h); }
    else rows.push({ y: r.y, y1: r.y + r.h, items: [r] });
  }
  return rows.flatMap((row) => row.items.sort((a, b) => a.x - b.x));
}
