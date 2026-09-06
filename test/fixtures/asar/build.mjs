/**
 * An asar writer for the suite: the size pickle, the header pickle holding
 * the JSON tree, and the files in order, exactly as Electron lays them out,
 * with links and unpacked entries where a test wants them. None is committed.
 */

const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/**
 * files: { "index.html": "text" | Uint8Array | { link: "x" } | { unpacked: true, size: n } | { files: {...} } }
 */
export function buildAsar(files) {
  const blobs = [];
  let offset = 0;
  const tree = (node) => {
    const out = {};
    for (const [name, value] of Object.entries(node)) {
      if (value && typeof value === "object" && !(value instanceof Uint8Array) && value.files) { out[name] = { files: tree(value.files) }; continue; }
      if (value && typeof value === "object" && !(value instanceof Uint8Array) && value.link) { out[name] = { link: value.link }; continue; }
      if (value && typeof value === "object" && !(value instanceof Uint8Array) && value.unpacked) { out[name] = { size: value.size ?? 0, unpacked: true }; continue; }
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
      out[name] = { size: bytes.length, offset: String(offset) };
      blobs.push(bytes);
      offset += bytes.length;
    }
    return out;
  };
  return buildAsarRaw({ files: tree(files) }, Buffer.concat(blobs.map((b) => Buffer.from(b))));
}

/**
 * Any header object laid out verbatim over a run of bytes, so a test can hand the reader a header Electron would
 * never write: a folder whose files are a list, a size spelled as a string, an offset that is not digits.
 */
export function buildAsarRaw(header, blobs = Buffer.alloc(0)) {
  const json = new TextEncoder().encode(typeof header === "string" ? header : JSON.stringify(header));
  const pad = (4 - (json.length % 4)) % 4;
  const payload = 4 + json.length + pad;
  const pickle = [...u32(payload), ...u32(json.length), ...json, ...new Array(pad).fill(0)];
  return Buffer.from([...u32(4), ...u32(pickle.length), ...pickle, ...blobs]);
}
