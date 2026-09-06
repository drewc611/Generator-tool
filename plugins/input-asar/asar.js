/**
 * An Electron app archive read with no dependency. An asar is a header and a
 * flat run of file bytes: eight bytes say how long the header is, the header
 * is one JSON document describing a tree of files with their size and offset
 * into the run, and every file follows in order. A legacy desktop app built on
 * Electron keeps its whole web front end in resources/app.asar, so unpacking
 * it is what turns the .exe folder into the folder of pages the readers port.
 *
 * What the archive cannot give is named: a file marked unpacked lives beside
 * the archive in app.asar.unpacked and is not in these bytes, a link points
 * elsewhere, and an offset past the end is a broken archive, not a file.
 *
 * The header is JSON somebody else wrote, so every field is checked for the
 * shape Electron writes before it is trusted: a folder's files are a table, a
 * size is a whole number, an offset is a string of digits. A field of another
 * shape is a reason the entry cannot be read, never a value coerced into one.
 */

const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;

/** A JSON object that is a table of names, which is the only shape a folder's files take. */
const isTable = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** How deep a folder tree is followed; Electron's own archives are a few levels and a deeper header is not one. */
const MAX_DEPTH = 64;

/** The header JSON and where the file bytes start, or the reason the bytes are not an asar. */
export function readAsarHeader(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 16) return { error: "not an asar archive: shorter than its header" };
  // The size pickle: its payload length is four, and the payload is the header pickle's length.
  if (u32(b, 0) !== 4) return { error: "not an asar archive: the size pickle does not read as one" };
  const headerSize = u32(b, 4);
  const payload = u32(b, 8);
  const length = u32(b, 12);
  if (headerSize < 8 || 8 + headerSize > b.length || payload + 4 !== headerSize) return { error: "the header's length does not fit the file" };
  if (16 + length > 8 + headerSize) return { error: "the header string runs past the header" };
  let header;
  try { header = JSON.parse(new TextDecoder("utf-8").decode(b.subarray(16, 16 + length))); } catch (err) { return { error: `the header is not json: ${err.message}` }; }
  if (!isTable(header) || !isTable(header.files)) return { error: "the header names no files" };
  return { header, base: 8 + headerSize };
}

/** Electron writes an offset as a string of decimal digits; a number is taken too, anything else is no offset. */
function offsetOf(child) {
  const raw = child.offset;
  if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/** Every file in the archive, flattened: path, size, and a function yielding its bytes or the reason it cannot. */
export function readAsar(bytes, { maxEntryBytes = 64 * 1024 * 1024 } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { header, base, error } = readAsarHeader(b);
  if (error) return { error };
  const entries = [];
  const refusedEntry = (name, reason) => ({ name, size: 0, unpacked: false, link: null, executable: false, bytes: () => ({ error: reason }) });
  const walk = (node, path, depth) => {
    for (const [name, child] of Object.entries(node.files)) {
      const full = path ? `${path}/${name}` : name;
      if (!isTable(child)) { entries.push(refusedEntry(full, "the header's entry is not a table of fields")); continue; }
      if ("files" in child) {
        if (!isTable(child.files)) { entries.push(refusedEntry(full, "the header lists a folder whose files are not a table")); continue; }
        if (depth >= MAX_DEPTH) { entries.push(refusedEntry(full, `a folder nested deeper than ${MAX_DEPTH} levels; nothing under it is read`)); continue; }
        walk(child, full, depth + 1);
        continue;
      }
      const link = typeof child.link === "string" && child.link ? child.link : null;
      const size = typeof child.size === "number" && Number.isInteger(child.size) && child.size >= 0 ? child.size : null;
      const entry = { name: full, size: size ?? 0, unpacked: child.unpacked === true, link, executable: child.executable === true };
      entry.bytes = () => {
        if (entry.link) return { error: `a link to ${entry.link}; nothing is followed` };
        if (entry.unpacked) return { error: "marked unpacked: the file lives beside the archive in app.asar.unpacked, not in it" };
        if (size === null) return { error: "the header gives no size" };
        if (size > maxEntryBytes) return { error: `${size} bytes is over the ${maxEntryBytes} byte cap for one file` };
        const offset = offsetOf(child);
        if (offset === null) return { error: "the header gives no offset" };
        const start = base + offset;
        if (start + size > b.length) return { error: "the bytes run past the end of the archive" };
        return { bytes: b.subarray(start, start + size) };
      };
      entries.push(entry);
    }
  };
  walk(header, "", 0);
  return { entries };
}
