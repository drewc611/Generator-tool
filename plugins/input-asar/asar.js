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
 */

const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;

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
  if (!header || typeof header !== "object" || !header.files) return { error: "the header names no files" };
  return { header, base: 8 + headerSize };
}

/** Every file in the archive, flattened: path, size, and a function yielding its bytes or the reason it cannot. */
export function readAsar(bytes, { maxEntryBytes = 64 * 1024 * 1024 } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { header, base, error } = readAsarHeader(b);
  if (error) return { error };
  const entries = [];
  const walk = (node, path, depth) => {
    if (depth > 64) return;
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const full = path ? `${path}/${name}` : name;
      if (child && typeof child === "object" && child.files) { walk(child, full, depth + 1); continue; }
      const entry = { name: full, size: Number(child?.size ?? 0), unpacked: Boolean(child?.unpacked), link: child?.link ?? null, executable: Boolean(child?.executable) };
      entry.bytes = () => {
        if (entry.link) return { error: `a link to ${entry.link}; nothing is followed` };
        if (entry.unpacked) return { error: "marked unpacked: the file lives beside the archive in app.asar.unpacked, not in it" };
        if (!Number.isInteger(entry.size) || entry.size < 0) return { error: "the header gives no size" };
        if (entry.size > maxEntryBytes) return { error: `${entry.size} bytes is over the ${maxEntryBytes} byte cap for one file` };
        const offset = Number(child?.offset);
        if (!Number.isInteger(offset) || offset < 0) return { error: "the header gives no offset" };
        const start = base + offset;
        if (start + entry.size > b.length) return { error: "the bytes run past the end of the archive" };
        return { bytes: b.subarray(start, start + entry.size) };
      };
      entries.push(entry);
    }
  };
  walk(header, "", 0);
  return { entries };
}
