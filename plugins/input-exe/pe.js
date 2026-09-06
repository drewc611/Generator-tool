/**
 * A Portable Executable's resource section, read with no dependency. A native
 * Win32 program keeps its user interface as data: every dialog is a template
 * naming its controls, their classes, captions, positions and styles; every
 * menu is a tree of captions and command ids; the string table holds the
 * messages the code shows; the version block names the product. All of it
 * sits in the .rsrc section and none of it needs the code to run.
 *
 * Only the fields a port needs are read, and every offset is bounds checked:
 * a truncated or hostile file is a set of problems named, never an exception.
 */

const RT = { MENU: 4, DIALOG: 5, STRING: 6, VERSION: 16 };

/** Control class ordinals a dialog template may use in place of a class name. */
const CLASS_ATOMS = { 0x80: "Button", 0x81: "Edit", 0x82: "Static", 0x83: "ListBox", 0x84: "ScrollBar", 0x85: "ComboBox" };

class Reader {
  constructor(bytes) { this.b = bytes; this.problems = []; }
  ok(off, len) { return Number.isInteger(off) && off >= 0 && off + len <= this.b.length; }
  u8(off) { return this.ok(off, 1) ? this.b[off] : null; }
  u16(off) { return this.ok(off, 2) ? this.b[off] | (this.b[off + 1] << 8) : null; }
  i16(off) { const v = this.u16(off); return v === null ? null : (v << 16) >> 16; }
  u32(off) { return this.ok(off, 4) ? (this.b[off] | (this.b[off + 1] << 8) | (this.b[off + 2] << 16)) + this.b[off + 3] * 0x1000000 : null; }
  /** A UTF-16LE string ending at its NUL; returns the text and the offset just past the NUL. */
  wsz(off) {
    let text = "";
    let at = off;
    for (;;) {
      const c = this.u16(at);
      if (c === null) return { text, next: at, truncated: true };
      at += 2;
      if (c === 0) return { text, next: at, truncated: false };
      text += String.fromCharCode(c);
    }
  }
}

/** The sections and data directories of a PE file, or the reason it is not one. */
export function readHeaders(bytes) {
  const r = new Reader(bytes);
  if (r.u16(0) !== 0x5a4d) return { error: "not an executable: no MZ header" };
  const pe = r.u32(0x3c);
  if (pe === null || r.u32(pe) !== 0x4550) return { error: "not a portable executable: no PE signature" };
  const coff = pe + 4;
  const sectionCount = r.u16(coff + 2);
  const optionalSize = r.u16(coff + 16);
  const optional = coff + 20;
  const magic = r.u16(optional);
  const plus = magic === 0x20b;
  if (magic !== 0x10b && !plus) return { error: `unknown optional header magic ${magic === null ? "(truncated)" : "0x" + magic.toString(16)}` };
  const directoryCount = r.u32(optional + (plus ? 108 : 92)) ?? 0;
  const directories = [];
  for (let i = 0; i < Math.min(directoryCount, 16); i += 1) {
    const at = optional + (plus ? 112 : 96) + i * 8;
    directories.push({ rva: r.u32(at) ?? 0, size: r.u32(at + 4) ?? 0 });
  }
  const sections = [];
  for (let i = 0; i < (sectionCount ?? 0); i += 1) {
    const at = optional + (optionalSize ?? 0) + i * 40;
    if (!r.ok(at, 40)) { r.problems.push("the section table is truncated"); break; }
    sections.push({
      name: String.fromCharCode(...bytes.subarray(at, at + 8)).replace(/\0+$/, ""),
      virtualSize: r.u32(at + 8), virtualAddress: r.u32(at + 12), rawSize: r.u32(at + 16), rawPointer: r.u32(at + 20),
    });
  }
  return { machine: r.u16(coff), plus, directories, sections, clr: Boolean(directories[14]?.rva), problems: r.problems };
}

/** A relative virtual address as a file offset, through the section that holds it. */
function fileOffset(headers, rva) {
  for (const s of headers.sections) {
    // Only the bytes the file holds map: a section's virtual tail past its raw size is zero fill in memory and,
    // followed through the file, would be the next section's bytes read as this one's.
    const span = Math.min(s.virtualSize || s.rawSize || 0, s.rawSize ?? 0);
    if (rva >= s.virtualAddress && rva < s.virtualAddress + span) return rva - s.virtualAddress + s.rawPointer;
  }
  return null;
}

/** The resource tree flattened: every leaf with its type, id or name, language and bytes. */
export function readResources(bytes, headers) {
  const r = new Reader(bytes);
  const dir = headers.directories[2];
  if (!dir?.rva) return { leaves: [], problems: ["no resource directory"] };
  const base = fileOffset(headers, dir.rva);
  if (base === null) return { leaves: [], problems: ["the resource directory points outside every section"] };
  const leaves = [];
  const problems = [];
  const name = (raw) => {
    if (!(raw & 0x80000000)) return { id: raw };
    const at = base + (raw & 0x7fffffff);
    const len = r.u16(at);
    if (len === null || !r.ok(at + 2, len * 2)) return { name: "?" };
    let text = "";
    for (let i = 0; i < len; i += 1) text += String.fromCharCode(r.u16(at + 2 + i * 2));
    return { name: text };
  };
  const walk = (offset, depth, path) => {
    if (depth > 3) { problems.push("the resource tree nests deeper than the format allows"); return; }
    const named = r.u16(offset + 12);
    const ids = r.u16(offset + 14);
    if (named === null || ids === null) { problems.push("a resource directory is truncated"); return; }
    for (let i = 0; i < named + ids; i += 1) {
      const at = offset + 16 + i * 8;
      const rawName = r.u32(at);
      const rawData = r.u32(at + 4);
      if (rawName === null || rawData === null) { problems.push("a resource directory entry is truncated"); return; }
      const key = name(rawName);
      if (rawData & 0x80000000) { walk(base + (rawData & 0x7fffffff), depth + 1, [...path, key]); continue; }
      const entry = base + rawData;
      const dataRva = r.u32(entry);
      const size = r.u32(entry + 4);
      const start = dataRva === null ? null : fileOffset(headers, dataRva);
      if (start === null || size === null || !r.ok(start, size)) { problems.push(`a resource's data lies outside the file (${path.map((p) => p.name ?? p.id).join("/")})`); continue; }
      const [type = {}, id = {}] = path;
      leaves.push({ type: type.id ?? type.name, id: id.id ?? id.name, language: key.id ?? key.name, bytes: bytes.subarray(start, start + size) });
    }
  };
  walk(base, 0, []);
  return { leaves, problems };
}

/** A sz_Or_Ord field: nothing, an ordinal, or a string. */
function szOrOrd(r, at) {
  const first = r.u16(at);
  if (first === null) return { value: null, next: at, truncated: true };
  if (first === 0) return { value: null, next: at + 2 };
  if (first === 0xffff) return { value: r.u16(at + 2), ordinal: true, next: at + 4 };
  const s = r.wsz(at);
  return { value: s.text, next: s.next, truncated: s.truncated };
}

const align4 = (n) => (n + 3) & ~3;

/**
 * A DIALOG or DIALOGEX template: the window's caption, size and font, and each
 * control with its class, caption, id, position in dialog units and styles.
 */
export function readDialog(bytes) {
  const r = new Reader(bytes);
  const ex = r.u16(0) === 1 && r.u16(2) === 0xffff;
  let at = 0;
  const dialog = { ex, controls: [], problems: [] };
  if (ex) {
    dialog.helpId = r.u32(4); dialog.exStyle = r.u32(8); dialog.style = r.u32(12);
    dialog.count = r.u16(16); at = 18;
  } else {
    dialog.style = r.u32(0); dialog.exStyle = r.u32(4); dialog.count = r.u16(8); at = 10;
  }
  dialog.x = r.i16(at); dialog.y = r.i16(at + 2); dialog.cx = r.i16(at + 4); dialog.cy = r.i16(at + 6);
  at += 8;
  if (dialog.count === null || dialog.cy === null) { dialog.problems.push("the dialog header is truncated"); return dialog; }
  const menu = szOrOrd(r, at); dialog.menu = menu.value; at = menu.next;
  const klass = szOrOrd(r, at); dialog.windowClass = klass.value; at = klass.next;
  const title = r.wsz(at); dialog.title = title.text; at = title.next;
  // DS_SETFONT (0x40) says a font block follows; DS_SHELLFONT includes it.
  if (dialog.style & 0x40) {
    dialog.font = { size: r.u16(at) };
    at += 2;
    if (ex) { dialog.font.weight = r.u16(at); dialog.font.italic = r.u8(at + 2) === 1; at += 4; }
    const face = r.wsz(at); dialog.font.face = face.text; at = face.next;
  }
  for (let i = 0; i < dialog.count; i += 1) {
    at = align4(at);
    const c = {};
    if (ex) {
      c.helpId = r.u32(at); c.exStyle = r.u32(at + 4); c.style = r.u32(at + 8);
      c.x = r.i16(at + 12); c.y = r.i16(at + 14); c.cx = r.i16(at + 16); c.cy = r.i16(at + 18);
      c.id = r.u32(at + 20); at += 24;
    } else {
      c.style = r.u32(at); c.exStyle = r.u32(at + 4);
      c.x = r.i16(at + 8); c.y = r.i16(at + 10); c.cx = r.i16(at + 12); c.cy = r.i16(at + 14);
      c.id = r.u16(at + 16); at += 18;
    }
    if (c.id === null) { dialog.problems.push(`control ${i + 1} of ${dialog.count} is truncated; the rest were not read`); break; }
    const klass = szOrOrd(r, at); at = klass.next;
    c.className = klass.ordinal ? CLASS_ATOMS[klass.value] ?? `#${klass.value}` : klass.value ?? "";
    const caption = szOrOrd(r, at); at = caption.next;
    c.caption = caption.ordinal ? null : caption.value ?? "";
    c.captionOrdinal = caption.ordinal ? caption.value : null;
    const extra = r.u16(at);
    if (extra === null) { dialog.problems.push(`control ${i + 1} is truncated after its caption`); dialog.controls.push(c); break; }
    // DIALOGEX counts the creation data bytes that follow the word; a DIALOG's first word, when it is not zero, is
    // the size of the creation data including that word itself.
    at += ex ? 2 + extra : extra || 2;
    dialog.controls.push(c);
  }
  return dialog;
}

/**
 * A MENU or MENUEX template as a tree: each item a caption with a command id,
 * a separator, or a popup with children.
 */
export function readMenu(bytes) {
  const r = new Reader(bytes);
  const version = r.u16(0);
  const problems = [];
  if (version === 1) {
    // MENUEX: the header's offset field says where the first item starts, relative to that field.
    const offset = r.u16(2) ?? 0;
    let at = 4 + offset;
    const items = (depth) => {
      const list = [];
      if (depth > 16) { problems.push("the menu nests deeper than any menu bar"); return list; }
      for (;;) {
        at = align4(at);
        const type = r.u32(at); const state = r.u32(at + 4); const id = r.u32(at + 8); const flags = r.u16(at + 12);
        if (flags === null) { if (!problems.length) problems.push("the menu is truncated"); return list; }
        const text = r.wsz(at + 14); at = text.next;
        const item = { text: text.text, id, disabled: Boolean(state & 0x3), checked: Boolean(state & 0x8) };
        if (type & 0x800) item.separator = true;
        if (flags & 0x01) { at = align4(at) + 4; item.children = items(depth + 1); }
        list.push(item);
        if (flags & 0x80) return list;
      }
    };
    return { ex: true, items: items(0), problems };
  }
  // MENU: version 0 and a header size, then items with a flags word and, for a command, its id.
  let at = 4 + (r.u16(2) ?? 0);
  const items = (depth) => {
    const list = [];
    if (depth > 16) { problems.push("the menu nests deeper than any menu bar"); return list; }
    for (;;) {
      const flags = r.u16(at);
      if (flags === null) { if (!problems.length) problems.push("the menu is truncated"); return list; }
      at += 2;
      const popup = Boolean(flags & 0x10);
      let id = null;
      if (!popup) { id = r.u16(at); at += 2; }
      const text = r.wsz(at); at = text.next;
      const item = { text: text.text, id, disabled: Boolean(flags & 0x3), checked: Boolean(flags & 0x8) };
      if (flags & 0x800 || (!popup && text.text === "" && id === 0)) item.separator = true;
      if (popup) item.children = items(depth + 1);
      list.push(item);
      if (flags & 0x80) return list;
    }
  };
  return { ex: false, items: items(0), problems };
}

/**
 * A string table block: sixteen length prefixed strings whose ids follow from the block's id. A string the block
 * ends inside is kept as far as it goes and named, so a shortened message is never reported as the message.
 */
export function readStringBlock(bytes, blockId) {
  const r = new Reader(bytes);
  const strings = [];
  const problems = [];
  let at = 0;
  for (let i = 0; i < 16; i += 1) {
    const len = r.u16(at);
    if (len === null) break;
    at += 2;
    if (!len) continue;
    const id = (blockId - 1) * 16 + i;
    let text = "";
    for (let k = 0; k < len; k += 1) { const c = r.u16(at + k * 2); if (c === null) break; text += String.fromCharCode(c); }
    if (text.length < len) problems.push(`string ${id} is cut off after ${text.length} of ${len} characters`);
    at += len * 2;
    strings.push({ id, text, truncated: text.length < len });
  }
  return { strings, problems };
}

/** The StringFileInfo pairs of a VS_VERSIONINFO block: ProductName, FileDescription and the rest. */
export function readVersion(bytes) {
  const r = new Reader(bytes);
  const out = {};
  const block = (at, end, depth) => {
    while (at + 6 <= end && depth < 5) {
      const length = r.u16(at); const valueLength = r.u16(at + 2); const type = r.u16(at + 4);
      if (!length) return;
      const key = r.wsz(at + 6);
      let value = align4(key.next);
      if (type === 1 && valueLength) {
        let text = "";
        for (let k = 0; k < valueLength; k += 1) { const c = r.u16(value + k * 2); if (!c) break; text += String.fromCharCode(c); }
        if (depth >= 2 && key.text && !/^0409/i.test(key.text)) out[key.text] = text;
        value += valueLength * 2;
      } else if (valueLength) {
        value += valueLength;
      }
      block(align4(value), at + length, depth + 1);
      at = align4(at + length);
    }
  };
  block(0, bytes.length, 0);
  return out;
}

/** Everything the reader can say about one executable. */
export function readExecutable(bytes) {
  const headers = readHeaders(bytes);
  if (headers.error) return { error: headers.error };
  const { leaves, problems } = readResources(bytes, headers);
  const dialogs = leaves.filter((l) => l.type === RT.DIALOG).map((l) => ({ id: l.id, language: l.language, ...readDialog(l.bytes) }));
  const menus = leaves.filter((l) => l.type === RT.MENU).map((l) => ({ id: l.id, language: l.language, ...readMenu(l.bytes) }));
  const blocks = leaves.filter((l) => l.type === RT.STRING && Number.isInteger(l.id)).map((l) => readStringBlock(l.bytes, l.id));
  const strings = blocks.flatMap((b) => b.strings);
  const version = leaves.filter((l) => l.type === RT.VERSION).map((l) => readVersion(l.bytes))[0] ?? {};
  const types = [...new Set(leaves.map((l) => l.type))];
  return {
    machine: headers.machine, plus: headers.plus, clr: headers.clr,
    hasResources: Boolean(headers.directories[2]?.rva),
    dialogs, menus, strings, version, types,
    problems: [...headers.problems, ...problems, ...dialogs.flatMap((d) => d.problems.map((p) => `dialog ${d.id}: ${p}`)), ...menus.flatMap((m) => m.problems.map((p) => `menu ${m.id}: ${p}`)), ...blocks.flatMap((b) => b.problems)],
  };
}
