/**
 * A screen drawn for the suite: a page, a bar, boxes outlined or filled, and
 * writing as runs of glyph sized marks, because what the photo reader reads is
 * shape and a real font is not needed to hold it to shapes. `light` lays an
 * uneven brightness across the page the way a phone photograph carries one,
 * and `noise` speckles it, so the reader is held to a picture and not a render.
 */

export function canvas(width, height, [r, g, b] = [248, 248, 246]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) { pixels[i * 4] = r; pixels[i * 4 + 1] = g; pixels[i * 4 + 2] = b; pixels[i * 4 + 3] = 255; }
  return { width, height, pixels };
}

export function fillRect(img, x, y, w, h, [r, g, b]) {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy += 1) for (let xx = Math.max(0, x); xx < Math.min(img.width, x + w); xx += 1) {
    const at = (yy * img.width + xx) * 4; img.pixels[at] = r; img.pixels[at + 1] = g; img.pixels[at + 2] = b;
  }
  return img;
}

export function strokeRect(img, x, y, w, h, color, thickness = 2) {
  fillRect(img, x, y, w, thickness, color); fillRect(img, x, y + h - thickness, w, thickness, color);
  fillRect(img, x, y, thickness, h, color); fillRect(img, x + w - thickness, y, thickness, h, color);
  return img;
}

/** A line of writing: `chars` glyph marks of `size` height, each a little different in width, a gap between. */
export function text(img, x, y, chars, size, color = [40, 40, 40]) {
  let cx = x;
  for (let i = 0; i < chars; i += 1) {
    const w = Math.max(2, Math.round(size * (0.45 + ((i * 7) % 4) * 0.1)));
    const h = i % 5 === 3 ? size : Math.round(size * 0.7);
    fillRect(img, cx, y + size - h, w, h, color);
    cx += w + Math.max(1, Math.round(size * 0.3));
  }
  return { x, y, w: cx - x, h: size };
}

/** Uneven light across the page: brighter at one corner, dimmer at the other, as a photograph carries it. */
export function light(img, strength = 60) {
  for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) {
    const f = -strength * ((x / img.width + y / img.height) / 2);
    const at = (y * img.width + x) * 4;
    for (let c = 0; c < 3; c += 1) img.pixels[at + c] = Math.max(0, Math.min(255, img.pixels[at + c] + f));
  }
  return img;
}

/** Deterministic speckle, a few levels either way, so a flat colour is never exactly flat. */
export function noise(img, amount = 6) {
  let seed = 12345;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < img.pixels.length; i += 4) {
    const d = Math.round((next() - 0.5) * 2 * amount);
    for (let c = 0; c < 3; c += 1) img.pixels[i + c] = Math.max(0, Math.min(255, img.pixels[i + c] + d));
  }
  return img;
}

/** The login form the photo tests share: a title bar, two labelled fields, a checkbox row, a button and a footer line. */
export function loginScreen({ scale = 1, photo = false } = {}) {
  const k = (v) => Math.round(v * scale);
  const img = canvas(k(720), k(1000));
  fillRect(img, 0, 0, k(720), k(90), [28, 44, 80]);
  text(img, k(40), k(30), 9, k(30), [240, 240, 240]);
  text(img, k(60), k(160), 8, k(20));
  strokeRect(img, k(60), k(195), k(600), k(60), [90, 90, 90], Math.max(1, k(3)));
  text(img, k(60), k(300), 10, k(20));
  strokeRect(img, k(60), k(335), k(600), k(60), [90, 90, 90], Math.max(1, k(3)));
  text(img, k(80), k(350), 12, k(22), [120, 120, 120]);
  strokeRect(img, k(60), k(440), k(26), k(26), [90, 90, 90], Math.max(1, k(3)));
  text(img, k(104), k(442), 14, k(20));
  fillRect(img, k(60), k(520), k(600), k(72), [36, 120, 200]);
  text(img, k(300), k(542), 6, k(26), [255, 255, 255]);
  text(img, k(200), k(900), 20, k(16), [110, 110, 110]);
  if (photo) { light(img); noise(img); }
  return img;
}
