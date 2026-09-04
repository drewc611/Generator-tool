import { inflateSync } from "node:zlib";

/**
 * A PDF reader with no dependencies. A PDF is a graph of numbered objects,
 * and the parts a port needs are the parts that decode without guessing:
 * the page tree, the text operators with their positions and sizes, the
 * link annotations, the outline, and the document's own metadata. Flate is
 * the one compression that matters and Node ships it. Everything this file
 * cannot decode is returned as a named problem, never as invented text.
 *
 * It reads by scanning for objects rather than trusting the xref table,
 * because a linear scan survives the broken and hand-edited files that
 * legacy documentation actually is, and an incremental update's later copy
 * of an object naturally wins by overwriting the earlier one.
 */

const WS = new Set([" ", "\t", "\r", "\n", "\f", "\0"]);
const DELIM = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

/** WinAnsi (cp1252) differs from latin1 only in 0x80..0x9F. */
const WINANSI = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8A: "Š",
  0x8B: "‹", 0x8C: "Œ", 0x8E: "Ž", 0x91: "‘", 0x92: "’",
  0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9A: "š", 0x9B: "›", 0x9C: "œ",
  0x9E: "ž", 0x9F: "Ÿ",
};

class Lexer {
  constructor(text, pos = 0) {
    this.text = text;
    this.pos = pos;
  }
  skipWs() {
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (WS.has(c)) this.pos += 1;
      else if (c === "%") { while (this.pos < this.text.length && this.text[this.pos] !== "\n") this.pos += 1; }
      else break;
    }
  }
  name() {
    let out = "";
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (WS.has(c) || DELIM.has(c)) break;
      if (c === "#" && /[0-9a-f]{2}/i.test(this.text.slice(this.pos + 1, this.pos + 3))) {
        out += String.fromCharCode(parseInt(this.text.slice(this.pos + 1, this.pos + 3), 16));
        this.pos += 3;
      } else {
        out += c;
        this.pos += 1;
      }
    }
    return out;
  }
  string() {
    // ( ... ) with nesting and backslash escapes; the value is bytes.
    let depth = 1;
    let out = "";
    while (this.pos < this.text.length && depth > 0) {
      const c = this.text[this.pos];
      if (c === "\\") {
        const n = this.text[this.pos + 1];
        const oct = /^[0-7]{1,3}/.exec(this.text.slice(this.pos + 1, this.pos + 4))?.[0];
        if (oct) { out += String.fromCharCode(parseInt(oct, 8)); this.pos += 1 + oct.length; continue; }
        out += { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "\n": "" }[n] ?? n ?? "";
        this.pos += 2;
        continue;
      }
      if (c === "(") depth += 1;
      if (c === ")") { depth -= 1; if (!depth) { this.pos += 1; break; } }
      out += c;
      this.pos += 1;
    }
    return { bytes: out };
  }
  hexString() {
    const end = this.text.indexOf(">", this.pos);
    const hex = this.text.slice(this.pos, end === -1 ? this.text.length : end).replace(/[^0-9a-f]/gi, "");
    this.pos = end === -1 ? this.text.length : end + 1;
    let out = "";
    for (let i = 0; i + 1 < hex.length + 1; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2).padEnd(2, "0"), 16));
    return { bytes: out };
  }
  value() {
    this.skipWs();
    const c = this.text[this.pos];
    if (c === undefined) return undefined;
    if (c === "<" && this.text[this.pos + 1] === "<") {
      this.pos += 2;
      const dict = {};
      for (;;) {
        this.skipWs();
        if (this.text.slice(this.pos, this.pos + 2) === ">>") { this.pos += 2; break; }
        if (this.text[this.pos] !== "/") { this.pos += 1; continue; }
        this.pos += 1;
        const key = this.name();
        dict[key] = this.value();
      }
      return dict;
    }
    if (c === "<") { this.pos += 1; return this.hexString(); }
    if (c === "(") { this.pos += 1; return this.string(); }
    if (c === "/") { this.pos += 1; return { name: this.name() }; }
    if (c === "[") {
      this.pos += 1;
      const arr = [];
      for (;;) {
        this.skipWs();
        if (this.text[this.pos] === "]") { this.pos += 1; break; }
        if (this.pos >= this.text.length) break;
        arr.push(this.value());
      }
      return arr;
    }
    if (/[-+.\d]/.test(c)) {
      const m = /^[-+]?[\d.]+/.exec(this.text.slice(this.pos));
      this.pos += m[0].length;
      const num = Number(m[0]);
      // "n g R" is a reference; anything else backtracks to the number.
      const save = this.pos;
      this.skipWs();
      const g = /^(\d+)\s+R(?![\w])/.exec(this.text.slice(this.pos, this.pos + 24));
      if (g && Number.isInteger(num) && num >= 0) { this.pos += g[0].length; return { ref: num }; }
      this.pos = save;
      return num;
    }
    const word = /^[a-z]+/i.exec(this.text.slice(this.pos))?.[0];
    if (word === "true" || word === "false") { this.pos += word.length; return word === "true"; }
    if (word === "null") { this.pos += 4; return null; }
    this.pos += 1;
    return undefined;
  }
}

const isName = (v, n) => v && typeof v === "object" && v.name === n;

function decodeStream(dict, raw, resolve, problems) {
  const filters = [dict.Filter].flat().filter(Boolean).map((f) => resolve(f)?.name ?? resolve(f));
  let data = raw;
  for (const filter of filters) {
    if (filter === "FlateDecode") {
      const parms = resolve(dict.DecodeParms);
      if (parms && Number(resolve(parms.Predictor) ?? 1) !== 1) {
        problems.push("a Flate stream uses a predictor; its content is skipped rather than misread");
        return null;
      }
      try {
        data = inflateSync(Buffer.from(data, "latin1")).toString("latin1");
      } catch {
        problems.push("a Flate stream would not inflate; its content is skipped");
        return null;
      }
    } else if (filter) {
      problems.push(`a stream uses ${filter}, which this reader does not decode; its content is skipped`);
      return null;
    }
  }
  return data;
}

/** PDF text strings: UTF-16BE behind a BOM, PDFDoc/latin1 otherwise. */
export function decodeTextString(bytes) {
  const s = String(bytes ?? "");
  if (s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < s.length; i += 2) out += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
    return out;
  }
  return s;
}

function parseToUnicode(cmapText) {
  const map = new Map();
  let codeBytes = 1;
  for (const m of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of m[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      codeBytes = Math.max(codeBytes, pair[1].length / 2);
      let dst = "";
      for (let i = 0; i + 3 < pair[2].length + 1; i += 4) dst += String.fromCharCode(parseInt(pair[2].slice(i, i + 4), 16));
      map.set(parseInt(pair[1], 16), dst);
    }
  }
  for (const m of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const triple of m[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      codeBytes = Math.max(codeBytes, triple[1].length / 2);
      const lo = parseInt(triple[1], 16);
      const hi = parseInt(triple[2], 16);
      const base = parseInt(triple[3].slice(-4), 16);
      for (let c = lo; c <= hi && c - lo < 65536; c += 1) map.set(c, String.fromCharCode(base + (c - lo)));
    }
  }
  return { map, codeBytes };
}

function fontDecoder(fontDict, resolve, getStream, problems) {
  const font = resolve(fontDict) ?? {};
  const toUni = resolve(font.ToUnicode);
  if (toUni) {
    const text = getStream(font.ToUnicode);
    if (text) {
      const { map, codeBytes } = parseToUnicode(text);
      return { codeBytes, decode: (code) => map.get(code) ?? null };
    }
  }
  if (isName(resolve(font.Subtype), "Type0")) {
    // A CID font without a usable ToUnicode maps codes to glyphs, not text.
    return { codeBytes: 2, decode: () => null };
  }
  const winAnsi = isName(resolve(resolve(font.Encoding)?.BaseEncoding ?? font.Encoding), "WinAnsiEncoding");
  return {
    codeBytes: 1,
    decode: (code) => {
      if (winAnsi && WINANSI[code]) return WINANSI[code];
      if (code >= 32 && code !== 127) return String.fromCharCode(code);
      return code === 9 || code === 10 || code === 13 ? " " : null;
    },
  };
}

const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

function extractText(content, fonts, problems, counters) {
  const texts = [];
  const lex = new Lexer(content);
  const stack = [];
  let tm = [1, 0, 0, 1, 0, 0];
  let lm = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let decoder = { codeBytes: 1, decode: (c) => (c >= 32 && c !== 127 ? String.fromCharCode(c) : null) };
  let size = 0;

  const show = (bytes) => {
    let out = "";
    for (let i = 0; i < bytes.length; i += decoder.codeBytes) {
      let code = 0;
      for (let b = 0; b < decoder.codeBytes; b += 1) code = (code << 8) | (bytes.charCodeAt(i + b) || 0);
      const ch = decoder.decode(code);
      if (ch === null) counters.unmapped += 1;
      else out += ch;
    }
    if (!out.trim()) return;
    const eff = Math.abs(size * Math.hypot(lm[2], lm[3])) || Math.abs(size);
    texts.push({ str: out, x: lm[4], y: lm[5], size: Math.round(eff * 10) / 10 });
  };

  const newline = () => { lm = mul([1, 0, 0, 1, 0, -leading], lm); };

  while (lex.pos < content.length) {
    lex.skipWs();
    const c = content[lex.pos];
    if (c === undefined) break;
    if (c === "(" || c === "<" || c === "[" || c === "/" || /[-+.\d]/.test(c)) {
      stack.push(lex.value());
      continue;
    }
    const op = /^[A-Za-z'"*]+/.exec(content.slice(lex.pos, lex.pos + 8))?.[0];
    if (!op) { lex.pos += 1; continue; }
    lex.pos += op.length;
    switch (op) {
      case "BT": tm = [1, 0, 0, 1, 0, 0]; lm = tm; break;
      case "Tf": {
        const [name, s] = stack.slice(-2);
        size = Number(s) || 0;
        decoder = fonts.get(name?.name) ?? decoder;
        break;
      }
      case "Tm": tm = stack.slice(-6).map(Number); lm = tm; break;
      case "TL": leading = Number(stack.at(-1)) || 0; break;
      case "TD": leading = -(Number(stack.at(-1)) || 0); // falls through
      case "Td": lm = mul([1, 0, 0, 1, Number(stack.at(-2)) || 0, Number(stack.at(-1)) || 0], lm); tm = lm; break;
      case "T*": newline(); break;
      case "Tj": show(String(stack.at(-1)?.bytes ?? "")); break;
      case "'": newline(); show(String(stack.at(-1)?.bytes ?? "")); break;
      case '"': newline(); show(String(stack.at(-1)?.bytes ?? "")); break;
      case "TJ": {
        const parts = (stack.at(-1) ?? []).filter((p) => p && typeof p === "object" && "bytes" in p);
        show(parts.map((p) => p.bytes).join(""));
        break;
      }
      default: break;
    }
    stack.length = 0;
  }
  return texts;
}

/** Positioned runs into reading order lines, top of the page first. */
export function linesOf(texts) {
  const sorted = [...texts].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const t of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(last.y - t.y) <= Math.max(2, last.size * 0.4)) {
      last.text += (t.x - last.endX > last.size * 0.6 ? " " : "") + t.str;
      last.endX = t.x + t.str.length * last.size * 0.5;
      last.size = Math.max(last.size, t.size);
    } else {
      lines.push({ text: t.str, y: t.y, x: t.x, size: t.size, endX: t.x + t.str.length * t.size * 0.5 });
    }
  }
  return lines.map(({ text, y, x, size }) => ({ text: text.replace(/\s+/g, " ").trim(), y, x, size })).filter((l) => l.text);
}

/**
 * The whole document, read. Returns null only for something that is not a
 * PDF at all; an encrypted file returns { encrypted: true } because the
 * honest answer to a password is not a guess.
 */
export function readPdf(buffer) {
  const src = Buffer.from(buffer).toString("latin1");
  if (!src.startsWith("%PDF-")) return null;

  const problems = [];
  const objects = new Map();
  for (const m of src.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
    const lex = new Lexer(src, m.index + m[0].length);
    const value = lex.value();
    let stream = null;
    lex.skipWs();
    if (src.startsWith("stream", lex.pos)) {
      let at = lex.pos + "stream".length;
      if (src[at] === "\r") at += 1;
      if (src[at] === "\n") at += 1;
      const declared = value?.Length;
      const length = typeof declared === "number" ? declared : null;
      const end = length !== null && src.startsWith("endstream", src.indexOf("endstream", at + length))
        ? at + length
        : src.indexOf("endstream", at);
      stream = src.slice(at, end === -1 ? src.length : end).replace(/\r?\n$/, "");
    }
    objects.set(Number(m[1]), { value, stream });
  }

  const resolve = (v) => {
    let out = v;
    for (let hops = 0; out && typeof out === "object" && "ref" in out && hops < 32; hops += 1) {
      out = objects.get(out.ref)?.value;
    }
    return out;
  };
  const getStream = (ref) => {
    const entry = typeof ref === "object" && "ref" in (ref ?? {}) ? objects.get(ref.ref) : null;
    if (!entry?.stream) return null;
    // An indirect /Length resolves late; reslice when the declared number was a reference.
    return decodeStream(resolve(entry.value) ?? {}, entry.stream, resolve, problems);
  };

  for (const m of src.matchAll(/trailer\s*<</g)) {
    const dict = new Lexer(src, m.index + "trailer".length).value();
    if (dict?.Encrypt) return { encrypted: true };
  }
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(src) && ![...objects.values()].some((o) => isName(resolve(o.value?.Type), "Catalog") && !o.value?.Encrypt)) {
    return { encrypted: true };
  }

  let catalog = null;
  let info = {};
  for (const [, entry] of objects) {
    const v = entry.value;
    if (v && typeof v === "object" && isName(resolve(v.Type), "Catalog")) catalog = v;
    if (v && typeof v === "object" && !v.Type && (v.Title || v.Producer || v.Author) && !v.Parent) {
      info = {
        title: v.Title ? decodeTextString(resolve(v.Title)?.bytes) : null,
        author: v.Author ? decodeTextString(resolve(v.Author)?.bytes) : null,
        producer: v.Producer ? decodeTextString(resolve(v.Producer)?.bytes) : null,
      };
    }
  }
  if (!catalog) return { pages: [], outline: [], info, problems: ["no document catalog was found"], unmapped: 0 };

  const pageDicts = [];
  const walkPages = (node, inherited, depth) => {
    const dict = resolve(node);
    if (!dict || depth > 64 || pageDicts.length > 2048) return;
    const merged = { Resources: dict.Resources ?? inherited.Resources };
    if (isName(resolve(dict.Type), "Page")) pageDicts.push({ ...merged, ...dict });
    for (const kid of [resolve(dict.Kids)].flat().filter(Boolean)) walkPages(kid, merged, depth + 1);
  };
  walkPages(catalog.Pages, {}, 0);

  const counters = { unmapped: 0 };
  const pages = pageDicts.map((page) => {
    const fonts = new Map();
    const fontDict = resolve(resolve(page.Resources)?.Font) ?? {};
    for (const [name, ref] of Object.entries(fontDict)) fonts.set(name, fontDecoder(ref, resolve, getStream, problems));

    const content = [resolve(page.Contents) instanceof Array ? resolve(page.Contents) : [page.Contents]]
      .flat().filter(Boolean)
      .map((ref) => getStream(ref) ?? (typeof resolve(ref) === "object" ? null : null))
      .filter((s) => s !== null)
      .join("\n");

    const links = [];
    for (const annotRef of [resolve(page.Annots)].flat().filter(Boolean)) {
      const annot = resolve(annotRef);
      if (!isName(resolve(annot?.Subtype), "Link")) continue;
      const action = resolve(annot.A);
      const uri = action && isName(resolve(action.S), "URI") ? decodeTextString(resolve(action.URI)?.bytes) : null;
      if (uri) links.push({ uri });
      else links.push({ internal: true });
    }

    return { lines: linesOf(extractText(content, fonts, problems, counters)), links };
  });

  const outline = [];
  const walkOutline = (node, level) => {
    let item = resolve(node);
    for (let hops = 0; item && hops < 512; hops += 1) {
      if (item.Title) outline.push({ title: decodeTextString(resolve(item.Title)?.bytes), level });
      if (item.First && level < 8) walkOutline(item.First, level + 1);
      item = resolve(item.Next);
    }
  };
  if (resolve(catalog.Outlines)?.First) walkOutline(resolve(catalog.Outlines).First, 1);

  return { pages, outline, info, problems: [...new Set(problems)], unmapped: counters.unmapped };
}
