/**
 * Reads a Visual Basic 6 .frx for the two things a port needs from it and
 * nothing more. The .frx is the binary companion of a .frm: a flat file of
 * records the text form points into by offset (`List = "frmLogin.frx":0012`),
 * one record per property whose value would not fit on a line. A combo or
 * list box's `List` is its options, which the port carries as real options
 * instead of a list it is handed; a long `Text` is a value, which the reader
 * notes exists and never prints; a `Picture` or any other binary is an image
 * resource the port does not carry; `ItemData` pairs a number with each item
 * and is not carried either.
 *
 * The layout varied by property and by the version that wrote the file, so a
 * record is read against every layout its property is known to take, and a
 * reading is accepted only when every length it claims fits inside the file
 * and the bytes it names are printable text: a list as a 2 byte count of
 * items, each a 2 byte length and that many ANSI bytes, or the same behind a
 * 4 byte count of the payload's bytes it must fill exactly; a text as a 4
 * byte length and that many bytes, or a 2 byte one; a picture as a 4 byte
 * size, the `lt` marker VB writes and the image's own size. A record that
 * fits no layout, or an offset past the end of the file, is named and never
 * guessed at.
 */

export const hex = (n) => n.toString(16).toUpperCase().padStart(4, "0");

/** Printable ANSI: tab, line feed and carriage return, then everything from a space up but DEL. High bytes are Windows 1252 letters. */
function printable(b, from, to) {
  for (let i = from; i < to; i += 1) {
    const c = b[i];
    if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || c === 0x7f) return false;
  }
  return true;
}

let ansi = null;
/** Windows 1252, the code page a .frx was written in; latin1 when this node was built without the table. */
export function decodeAnsi(bytes) {
  if (ansi === null) { try { ansi = new TextDecoder("windows-1252"); } catch { ansi = false; } }
  return ansi ? ansi.decode(bytes) : Buffer.from(bytes).toString("latin1");
}

/** A 2 byte count of items, then per item a 2 byte length and that many bytes, all of it inside `limit`. */
function listWords(b, at, limit = b.length) {
  if (at + 2 > limit) return null;
  const count = b.readUInt16LE(at);
  const items = [];
  let p = at + 2;
  for (let i = 0; i < count; i += 1) {
    if (p + 2 > limit) return null;
    const len = b.readUInt16LE(p);
    p += 2;
    if (p + len > limit || !printable(b, p, p + len)) return null;
    items.push(decodeAnsi(b.subarray(p, p + len)));
    p += len;
  }
  return { items, end: p };
}

/** The same list behind a 4 byte count of the payload's bytes, which the items must fill exactly. */
function listSized(b, at) {
  if (at + 4 > b.length) return null;
  const limit = at + 4 + b.readUInt32LE(at);
  if (limit > b.length) return null;
  const inner = listWords(b, at + 4, limit);
  return inner && inner.end === limit ? inner : null;
}

/** A length of `width` bytes, then that many printable bytes. The text itself is not kept: it is a value. */
const textOf = (width) => (b, at) => {
  if (at + width > b.length) return null;
  const length = width === 4 ? b.readUInt32LE(at) : b.readUInt16LE(at);
  const end = at + width + length;
  if (end > b.length || !printable(b, at + width, end)) return null;
  return { length, end };
};
const textLong = textOf(4);
const textShort = textOf(2);

/** What the image's first bytes say it is, as the phrase a sentence needs. */
function imageFormat(b, at, end) {
  const n = end - at;
  const starts = (s) => n >= s.length && b.toString("latin1", at, at + s.length) === s;
  if (starts("BM")) return "a bitmap";
  if (n >= 4 && b[at] === 0 && b[at + 1] === 0 && b[at + 2] === 1 && b[at + 3] === 0) return "an icon";
  if (n >= 4 && b[at] === 0 && b[at + 1] === 0 && b[at + 2] === 2 && b[at + 3] === 0) return "a cursor";
  if (starts("GIF8")) return "a gif";
  if (n >= 2 && b[at] === 0xff && b[at + 1] === 0xd8) return "a jpeg";
  if (n >= 4 && b[at] === 0x89 && b.toString("latin1", at + 1, at + 4) === "PNG") return "a png";
  if (n >= 4 && b.readUInt32LE(at) === 0x9ac6cdd7) return "a metafile";
  if (n >= 44 && b.toString("latin1", at + 40, at + 44) === " EMF") return "an enhanced metafile";
  return "an image in a format this reader does not name";
}

/** The bytes 6C 74 00 00, "lt", that VB writes before every picture. */
const LT = 0x0000746c;

/** A 4 byte size of what follows (zero for no picture), the marker, a 4 byte size of the image, the image. */
function picture(b, at) {
  if (at + 4 > b.length) return null;
  const size = b.readUInt32LE(at);
  if (size === 0) return { format: "none", length: 0, end: at + 4 };
  const end = at + 4 + size;
  if (size < 8 || end > b.length || b.readUInt32LE(at + 4) !== LT || b.readUInt32LE(at + 8) !== size - 8) return null;
  return { format: imageFormat(b, at + 12, end), length: size - 8, end };
}

/** A 2 byte count, then a 4 byte number per item. The numbers are not read; only that they fit. */
function itemData(b, at) {
  if (at + 2 > b.length) return null;
  const count = b.readUInt16LE(at);
  const end = at + 2 + count * 4;
  return end <= b.length ? { count, end } : null;
}

const PICTURES = new Set(["Picture", "Icon", "MouseIcon", "DragIcon", "DownPicture", "DisabledPicture", "MaskPicture"]);
const TEXTS = new Set(["Text", "Caption", "ToolTipText", "Tag"]);

/** The layout a property's record is documented to take; `$"file.frx":0000` marks a string whatever its property. */
export function expectedKind(property, dollar = false) {
  if (property === "List") return "list";
  if (property === "ItemData") return "itemdata";
  if (PICTURES.has(property)) return "picture";
  if (dollar || TEXTS.has(property)) return "text";
  return "unknown";
}

/**
 * The record at a pointer's offset, read against the layouts its property
 * takes: { kind: "list", items } | { kind: "text", length } | { kind:
 * "picture", format, length } | { kind: "itemdata", count } | { kind:
 * "unread", reason } | { kind: "beyond", reason }. A text's bytes are never
 * in the result; a list's items are, because they are the options a port
 * shows. A property this reader does not know is tried against every layout,
 * the picture's marker first because it is the one that cannot be mistaken.
 */
export function readRecord(bytes, { property, offset, dollar = false }) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const base = { property, offset };
  if (!Number.isInteger(offset) || offset < 0 || offset >= b.length) return { ...base, kind: "beyond", reason: `the offset ${hex(offset)} is past the end of the file (${b.length} byte(s))` };
  const asList = () => { const r = listWords(b, offset) ?? listSized(b, offset); return r && { ...base, kind: "list", items: r.items, end: r.end }; };
  const asText = () => { const r = textLong(b, offset) ?? textShort(b, offset); return r && { ...base, kind: "text", length: r.length, end: r.end }; };
  const asPicture = () => { const r = picture(b, offset); return r && { ...base, kind: "picture", format: r.format, length: r.length, end: r.end }; };
  const asItemData = () => { const r = itemData(b, offset); return r && { ...base, kind: "itemdata", count: r.count, end: r.end }; };
  const unread = (reason) => ({ ...base, kind: "unread", reason });
  switch (expectedKind(property, dollar)) {
    case "list": {
      const r = asList();
      if (r) return r;
      const t = asText();
      return unread(t ? `the record reads as one string of ${t.length} byte(s), not as a list` : "the record fits neither list layout");
    }
    case "text": {
      const r = asText();
      if (r) return r;
      const l = asList();
      return unread(l ? `the record reads as a list of ${l.items.length} item(s), not as text` : "the record fits neither text layout");
    }
    case "picture": return asPicture() ?? unread("the record does not carry the picture header VB writes");
    case "itemdata": return asItemData() ?? unread("the record's count of numbers runs past the end of the file");
    default: return asPicture() ?? asList() ?? asText() ?? unread("the record fits no layout this reader knows");
  }
}

/**
 * Resolves every pointer a modelled form carries against the companions
 * beside it. `load(name)` returns a companion's bytes or null when it is not
 * in the tree; each name is loaded once. A select whose `List` read gets the
 * items as its options; every other record is described for the report and
 * the notes and changes nothing. Returns the records in file order, each with
 * the control that owns it.
 */
export async function applyFrx(form, load) {
  const cache = new Map();
  const bytesOf = async (name) => {
    const key = name.toLowerCase();
    if (!cache.has(key)) cache.set(key, await load(name));
    return cache.get(key);
  };
  const records = [];
  const visit = async (owner, pointers, control) => {
    for (const ptr of pointers ?? []) {
      const bytes = await bytesOf(ptr.file);
      if (!bytes) { records.push({ owner, file: ptr.file, property: ptr.property, offset: ptr.offset, kind: "missing" }); continue; }
      const rec = { owner, file: ptr.file, ...readRecord(bytes, ptr) };
      if (rec.kind === "list") {
        if (!control || control.kind !== "select" || ptr.property !== "List") rec.reason = "on a control that is not a select";
        else if (!rec.items.some((s) => s !== "")) rec.reason = rec.items.length ? "every item is empty" : "the record holds no items";
        else { control.options = rec.items; control.optionsFrom = "frx"; rec.applied = true; }
      }
      records.push(rec);
    }
  };
  await visit(form.name, form.frx, null);
  const walk = async (list) => { for (const c of list) { await visit(c.name + (c.index != null ? `(${c.index})` : ""), c.frx, c); await walk(c.children ?? []); } };
  await walk(form.controls);
  for (const nv of form.nonvisual ?? []) await visit(nv.name, nv.frx, null);
  return records;
}

/** One record as the clause a report prints: where it is, then what it was. No value but a list's item count is in it. */
export function describe(rec) {
  const at = `${rec.owner}.${rec.property} at ${hex(rec.offset)}`;
  switch (rec.kind) {
    case "list": return rec.applied ? `${at}, ${rec.items.length} item(s) read as its options` : `${at}, a list of ${rec.items.length} item(s) not carried (${rec.reason})`;
    case "text": return `${at}, ${rec.length} byte(s) of text, a value the port is not handed and this report does not print`;
    case "picture": return rec.format === "none" ? `${at}, an empty picture record` : `${at}, ${rec.format} of ${rec.length} byte(s), an image resource not carried`;
    case "itemdata": return `${at}, ${rec.count} number(s) paired with the list's items, not carried`;
    case "missing": return `${at}, in ${rec.file}, which is not in the tree`;
    default: return `${at}, not read: ${rec.reason}`;
  }
}
