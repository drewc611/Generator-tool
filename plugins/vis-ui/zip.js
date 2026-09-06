import { inflateRawSync } from "node:zlib";

/**
 * A zip archive read with no dependency: the central directory names every
 * entry, each local header says where its bytes are, and the two methods the
 * format almost always uses, stored and deflated, are the two Node can undo
 * itself. An archive dropped on the console's intake is unpacked here so a
 * legacy app zipped by whoever kept it becomes the folder the run reads.
 *
 * What is refused is named: an encrypted entry, a method Node cannot inflate,
 * an entry bigger than the cap, an archive with no central directory. Paths
 * are the caller's to check; every entry's name is returned as written.
 */

const u16 = (b, at) => b[at] | (b[at + 1] << 8);
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The entries of a zip: name, size, method, and a function that yields the bytes, or the reason it cannot. */
export function readZip(bytes, { maxEntryBytes = 64 * 1024 * 1024 } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // The end of central directory record sits at the tail, before an optional comment of up to 64 KB.
  let eocd = -1;
  for (let at = b.length - 22; at >= Math.max(0, b.length - 22 - 65535); at -= 1) {
    if (u32(b, at) === EOCD) { eocd = at; break; }
  }
  if (eocd === -1) return { error: "not a zip archive: no end of central directory record" };
  const count = u16(b, eocd + 10);
  const dirSize = u32(b, eocd + 12);
  const dirAt = u32(b, eocd + 16);
  if (dirAt + dirSize > b.length) return { error: "the central directory lies outside the file" };
  const entries = [];
  let at = dirAt;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > b.length || u32(b, at) !== CENTRAL) return { error: `central directory entry ${i + 1} of ${count} is not where the record says`, entries };
    const flags = u16(b, at + 8);
    const method = u16(b, at + 10);
    const compressed = u32(b, at + 20);
    const size = u32(b, at + 24);
    const nameLength = u16(b, at + 28);
    const extraLength = u16(b, at + 30);
    const commentLength = u16(b, at + 32);
    const localAt = u32(b, at + 42);
    const utf8 = Boolean(flags & 0x800);
    const name = utf8 ? new TextDecoder("utf-8").decode(b.subarray(at + 46, at + 46 + nameLength)) : Array.from(b.subarray(at + 46, at + 46 + nameLength), (c) => String.fromCharCode(c)).join("");
    const entry = { name, size, compressed, method, directory: name.endsWith("/"), encrypted: Boolean(flags & 0x1) };
    entry.bytes = () => {
      if (entry.encrypted) return { error: "encrypted; the archive's password is not something this tool asks for" };
      if (entry.directory) return { bytes: new Uint8Array(0) };
      if (size > maxEntryBytes) return { error: `${size} bytes is over the ${maxEntryBytes} byte cap for one entry` };
      if (localAt + 30 > b.length || u32(b, localAt) !== LOCAL) return { error: "the local header is not where the central directory says" };
      const dataAt = localAt + 30 + u16(b, localAt + 26) + u16(b, localAt + 28);
      if (dataAt + compressed > b.length) return { error: "the entry's bytes run past the end of the file" };
      const raw = b.subarray(dataAt, dataAt + compressed);
      if (method === 0) return { bytes: raw };
      if (method === 8) {
        try {
          const out = inflateRawSync(raw, { maxOutputLength: maxEntryBytes });
          return out.length === size ? { bytes: out } : { error: `inflated to ${out.length} bytes, the directory says ${size}` };
        } catch (err) { return { error: `does not inflate: ${err.message}` }; }
      }
      return { error: `compression method ${method} is not one Node can undo (stored and deflated are)` };
    };
    entries.push(entry);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { entries };
}
