/**
 * Builds a small native Windows executable in memory: a PE header, one .rsrc
 * section, and the dialog, menu, string table and version resources a test
 * asks for. No binary is committed; the suite writes what it needs where it
 * needs it. Nothing here runs, and the code section it does not have is not
 * missed by a reader that only reads resources.
 */

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const i16 = (n) => u16(n < 0 ? n + 0x10000 : n);
const wsz = (s) => [...String(s)].flatMap((c) => u16(c.charCodeAt(0))).concat(u16(0));
const pad4 = (arr) => { while (arr.length % 4) arr.push(0); return arr; };

export const WS_VISIBLE = 0x10000000;
export const WS_DISABLED = 0x08000000;
export const WS_TABSTOP = 0x00010000;
export const WS_GROUP = 0x00020000;
export const WS_CAPTION = 0x00c00000;
export const DS_SETFONT = 0x40;
export const ATOM = { Button: 0x80, Edit: 0x81, Static: 0x82, ListBox: 0x83, ScrollBar: 0x84, ComboBox: 0x85 };

const klass = (c) => (ATOM[c.className] ? [...u16(0xffff), ...u16(ATOM[c.className])] : wsz(c.className));

/** A DIALOGEX (default) or DIALOG template. */
export function dialogTemplate(d) {
  const ex = d.ex !== false;
  const style = (d.style ?? (WS_VISIBLE | WS_CAPTION)) | (d.font ? DS_SETFONT : 0);
  const out = [];
  if (ex) out.push(...u16(1), ...u16(0xffff), ...u32(0), ...u32(d.exStyle ?? 0), ...u32(style), ...u16(d.controls.length));
  else out.push(...u32(style), ...u32(d.exStyle ?? 0), ...u16(d.controls.length));
  out.push(...i16(d.x ?? 0), ...i16(d.y ?? 0), ...i16(d.cx ?? 200), ...i16(d.cy ?? 120));
  out.push(...u16(0), ...u16(0), ...wsz(d.title ?? ""));
  if (d.font) {
    out.push(...u16(d.font.size ?? 8));
    if (ex) out.push(...u16(400), 0, 1);
    out.push(...wsz(d.font.face ?? "MS Shell Dlg"));
  }
  for (const c of d.controls) {
    pad4(out);
    const cs = (c.style ?? 0) | WS_VISIBLE * (c.hidden ? 0 : 1);
    if (ex) out.push(...u32(0), ...u32(c.exStyle ?? 0), ...u32(cs), ...i16(c.x), ...i16(c.y), ...i16(c.cx), ...i16(c.cy), ...u32(c.id));
    else out.push(...u32(cs), ...u32(c.exStyle ?? 0), ...i16(c.x), ...i16(c.y), ...i16(c.cx), ...i16(c.cy), ...u16(c.id));
    out.push(...klass(c));
    if (c.captionOrdinal !== undefined) out.push(...u16(0xffff), ...u16(c.captionOrdinal));
    else out.push(...wsz(c.caption ?? ""));
    out.push(...u16(0));
  }
  return out;
}

/** A MENU template (version 0) or, with ex, a MENUEX template. */
export function menuTemplate(m) {
  const out = [];
  if (m.ex) {
    out.push(...u16(1), ...u16(4), ...u32(0));
    const items = (list) => {
      list.forEach((it, i) => {
        pad4(out);
        const popup = Boolean(it.children);
        out.push(...u32(it.separator ? 0x800 : 0), ...u32((it.disabled ? 0x3 : 0) | (it.checked ? 0x8 : 0)), ...u32(it.id ?? 0));
        out.push(...u16((popup ? 0x01 : 0) | (i === list.length - 1 ? 0x80 : 0)), ...wsz(it.text ?? ""));
        if (popup) { pad4(out); out.push(...u32(0)); items(it.children); }
      });
    };
    items(m.items);
    return out;
  }
  out.push(...u16(0), ...u16(0));
  const items = (list) => {
    list.forEach((it, i) => {
      const popup = Boolean(it.children);
      const flags = (popup ? 0x10 : 0) | (i === list.length - 1 ? 0x80 : 0) | (it.disabled ? 0x1 : 0) | (it.checked ? 0x8 : 0) | (it.separator ? 0x800 : 0);
      out.push(...u16(flags));
      if (!popup) out.push(...u16(it.id ?? 0));
      out.push(...wsz(it.text ?? ""));
      if (popup) items(it.children);
    });
  };
  items(m.items);
  return out;
}

/** String table blocks of sixteen, keyed by block id. */
export function stringBlocks(strings) {
  const blocks = new Map();
  for (const s of strings) {
    const block = Math.floor(s.id / 16) + 1;
    if (!blocks.has(block)) blocks.set(block, new Array(16).fill(""));
    blocks.get(block)[s.id % 16] = s.text;
  }
  return [...blocks].map(([id, texts]) => ({ id, bytes: texts.flatMap((t) => [...u16(t.length), ...[...t].flatMap((c) => u16(c.charCodeAt(0)))]) }));
}

/** A VS_VERSIONINFO block carrying only a StringFileInfo table. */
export function versionBlock(pairs) {
  const node = (key, type, value, children) => {
    const body = [...u16(0), ...u16(type === 1 ? value.length / 2 : value.length), ...u16(type), ...wsz(key)];
    pad4(body);
    body.push(...value);
    for (const c of children) { pad4(body); body.push(...c); }
    body.splice(0, 2, ...u16(body.length));
    return body;
  };
  const strings = Object.entries(pairs).map(([k, v]) => node(k, 1, wsz(v), []));
  const table = node("040904B0", 1, [], strings);
  const info = node("StringFileInfo", 1, [], [table]);
  return node("VS_VERSION_INFO", 0, [], [info]);
}

/** The whole file: headers, then a resource tree holding every resource given. */
export function buildExe({ dialogs = [], menus = [], strings = [], version = null, clr = false, plus = false, raw = [] } = {}) {
  const RSRC_VA = 0x2000;
  const RSRC_RAW = 0x200;
  const byType = new Map();
  const put = (type, id, bytes) => { if (!byType.has(type)) byType.set(type, []); byType.get(type).push({ id, bytes }); };
  for (const d of dialogs) put(5, d.id, dialogTemplate(d));
  for (const m of menus) put(4, m.id, menuTemplate(m));
  for (const b of stringBlocks(strings)) put(6, b.id, b.bytes);
  if (version) put(16, 1, versionBlock(version));
  for (const r of raw) put(r.type, r.id, r.bytes);

  // Directory tables first, then the data entries, then the blobs.
  const types = [...byType].sort((a, b) => a[0] - b[0]);
  const dir = (n) => 16 + 8 * n;
  let cursor = dir(types.length);
  const typeDirAt = new Map();
  for (const [t, entries] of types) { typeDirAt.set(t, cursor); cursor += dir(entries.length); }
  const idDirAt = new Map();
  for (const [t, entries] of types) for (const e of entries) { idDirAt.set(`${t}/${e.id}`, cursor); cursor += dir(1); }
  const dataEntryAt = new Map();
  for (const [t, entries] of types) for (const e of entries) { dataEntryAt.set(`${t}/${e.id}`, cursor); cursor += 16; }
  const blobAt = new Map();
  for (const [t, entries] of types) for (const e of entries) { cursor = (cursor + 3) & ~3; blobAt.set(`${t}/${e.id}`, cursor); cursor += e.bytes.length; }
  const clrAt = clr ? ((cursor + 3) & ~3) : 0;
  if (clr) cursor = clrAt + 72;
  const rsrc = new Array(cursor).fill(0);
  const write = (at, arr) => { for (let i = 0; i < arr.length; i += 1) rsrc[at + i] = arr[i]; };
  const table = (at, entries) => {
    write(at, [...u32(0), ...u32(0), ...u16(0), ...u16(0), ...u16(0), ...u16(entries.length)]);
    entries.forEach((e, i) => write(at + 16 + i * 8, [...u32(e.name), ...u32(e.offset)]));
  };
  table(0, types.map(([t]) => ({ name: t, offset: 0x80000000 | typeDirAt.get(t) })));
  for (const [t, entries] of types) {
    table(typeDirAt.get(t), entries.map((e) => ({ name: e.id, offset: 0x80000000 | idDirAt.get(`${t}/${e.id}`) })));
    for (const e of entries) {
      table(idDirAt.get(`${t}/${e.id}`), [{ name: 1033, offset: dataEntryAt.get(`${t}/${e.id}`) }]);
      write(dataEntryAt.get(`${t}/${e.id}`), [...u32(RSRC_VA + blobAt.get(`${t}/${e.id}`)), ...u32(e.bytes.length), ...u32(0), ...u32(0)]);
      write(blobAt.get(`${t}/${e.id}`), e.bytes);
    }
  }

  const header = new Array(RSRC_RAW).fill(0);
  const put16 = (at, n) => { const b = u16(n); header[at] = b[0]; header[at + 1] = b[1]; };
  const put32 = (at, n) => { u32(n).forEach((v, i) => { header[at + i] = v; }); };
  header[0] = 0x4d; header[1] = 0x5a;
  put32(0x3c, 0x40);
  header[0x40] = 0x50; header[0x41] = 0x45;
  const coff = 0x44;
  put16(coff, plus ? 0x8664 : 0x14c);
  put16(coff + 2, 1);
  const optionalSize = plus ? 240 : 224;
  put16(coff + 16, optionalSize);
  put16(coff + 18, 0x102);
  const optional = coff + 20;
  put16(optional, plus ? 0x20b : 0x10b);
  put32(optional + (plus ? 108 : 92), 16);
  const directories = optional + (plus ? 112 : 96);
  put32(directories + 2 * 8, RSRC_VA);
  put32(directories + 2 * 8 + 4, rsrc.length);
  if (clr) { put32(directories + 14 * 8, RSRC_VA + clrAt); put32(directories + 14 * 8 + 4, 72); }
  const section = optional + optionalSize;
  ".rsrc".split("").forEach((c, i) => { header[section + i] = c.charCodeAt(0); });
  put32(section + 8, rsrc.length);
  put32(section + 12, RSRC_VA);
  put32(section + 16, rsrc.length);
  put32(section + 20, RSRC_RAW);
  return Buffer.from([...header, ...rsrc]);
}
