import { deflateRawSync } from "node:zlib";
import { crc32 } from "../png/build.mjs";

/**
 * A zip writer for the suite: stored or deflated entries, directories, an
 * encrypted flag, an unknown method, and a comment after the end record, so
 * the reader is held to the format rather than to one archiver's habits.
 */

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const utf8 = (s) => [...new TextEncoder().encode(s)];

/**
 * entries: [{ name, data (string|Uint8Array), method: 0|8|other, encrypted, extra: bytes }]
 * A name ending in / is a directory. `comment` follows the end record.
 */
export function buildZip(entries, { comment = "" } = {}) {
  const out = [];
  const central = [];
  for (const e of entries) {
    const name = utf8(e.name);
    const data = typeof e.data === "string" ? new Uint8Array(utf8(e.data)) : (e.data ?? new Uint8Array(0));
    const method = e.method ?? 8;
    const stored = method === 8 ? new Uint8Array(deflateRawSync(Buffer.from(data))) : data;
    const crc = crc32(data);
    const flags = (e.encrypted ? 0x1 : 0) | 0x800;
    const extra = e.extra ?? [];
    const localAt = out.length;
    out.push(...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0), ...u32(crc), ...u32(stored.length), ...u32(data.length), ...u16(name.length), ...u16(extra.length), ...name, ...extra, ...stored);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0), ...u32(crc), ...u32(stored.length), ...u32(data.length), ...u16(name.length), ...u16(extra.length), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(localAt), ...name, ...extra);
  }
  const dirAt = out.length;
  out.push(...central);
  const c = utf8(comment);
  out.push(...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(dirAt), ...u16(c.length), ...c);
  return Buffer.from(out);
}
