import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * A tar reader for the suite, so the installed tarball proof unpacks what npm
 * packed with Node alone: 512 byte ustar headers, the size in octal, the name
 * with its prefix, and a pax extended header's path honoured for the entry it
 * precedes. Node has no tar of its own, and the platform's tar reads a Windows
 * drive letter as a remote host, which is how this file came to exist.
 */

const field = (block, at, len) => block.subarray(at, at + len).toString("utf8").replace(/\0.*$/s, "");

/** The entries of a gzipped tar: name, type and bytes. */
export function readTarGz(bytes) {
  const tar = gunzipSync(bytes);
  const entries = [];
  let at = 0;
  let paxPath = null;
  let longName = null;
  while (at + 512 <= tar.length) {
    const block = tar.subarray(at, at + 512);
    if (block.every((b) => b === 0)) break;
    const size = parseInt(field(block, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(block[156] || 48);
    const prefix = field(block, 345, 155);
    let name = (prefix ? `${prefix}/` : "") + field(block, 0, 100);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x" || type === "g") {
      // A pax header: `<length> path=<value>\n` records, the path applying to the next entry only.
      for (const m of body.toString("utf8").matchAll(/\d+ path=([^\n]*)\n/g)) paxPath = m[1];
      continue;
    }
    if (type === "L") { longName = body.toString("utf8").replace(/\0+$/, ""); continue; }
    if (paxPath) { name = paxPath; paxPath = null; }
    if (longName) { name = longName; longName = null; }
    entries.push({ name, type, bytes: body });
  }
  return entries;
}

/** Unpack a gzipped tar under a directory; only regular files and directories, paths held under the directory. */
export async function untarGz(bytes, dir) {
  const written = [];
  for (const e of readTarGz(bytes)) {
    const rel = e.name.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..").join("/");
    if (!rel) continue;
    if (e.type === "5") { await mkdir(join(dir, rel), { recursive: true }); continue; }
    if (e.type !== "0" && e.type !== "\0" && e.type !== "7") continue;
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), e.bytes);
    written.push(rel);
  }
  return written;
}
