import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readAsar } from "./asar.js";

/**
 * The reader for an Electron app's archive. A desktop app built on Electron is
 * a web front end zipped into resources/app.asar beside its .exe, so the
 * folder a person drops on the console holds the whole legacy front end in
 * one file the other readers cannot see into. `portamp unpack <file.asar>`
 * writes the archive's files out as the folder they are, and the console's
 * intake does the same to an archive dropped on it, every path held to the
 * intake's rule; the run then reads the app as it reads any folder of pages.
 *
 * In a source tree an archive is named, never unpacked in place: unpacking
 * writes files, and the run writes only into its output.
 */

/**
 * Unpack an archive's files under a directory through a path check; returns what landed and what was refused. Two
 * entries can name one path once backslashes are folded, and a header can list a file where a folder is needed;
 * the first to land keeps the path and the rest are refused by name, because a silent overwrite is a file lost.
 */
export async function unpackAsar(bytes, dir, { keep = (rel) => rel } = {}) {
  const { entries, error } = readAsar(bytes);
  const refused = [];
  const written = [];
  if (error) return { written, refused: [{ entry: "(archive)", reason: error }] };
  const landed = new Map();
  for (const entry of entries) {
    const rel = keep(entry.name);
    if (!rel) { refused.push({ entry: entry.name, reason: "the path climbs out of the folder" }); continue; }
    const got = entry.bytes();
    if (got.error) { refused.push({ entry: entry.name, reason: got.error }); continue; }
    if (landed.has(rel)) { refused.push({ entry: entry.name, reason: `another entry, ${landed.get(rel)}, already landed at ${rel}` }); continue; }
    const target = join(dir, rel);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, got.bytes);
    } catch (err) {
      refused.push({ entry: entry.name, reason: `cannot be written at ${rel} (${err.code ?? "error"}): a file and a folder share a name, or the folder is not writable` });
      continue;
    }
    landed.set(rel, entry.name);
    written.push(rel);
  }
  return { written, refused };
}

/**
 * A path inside an archive as a relative path under the folder, or null when it climbs out. A root, whether a
 * leading slash or a drive letter, is dropped so the file lands under the folder; a control character is refused
 * because no file system takes one and the write would fail.
 */
export const safeAsarPath = (name) => {
  const text = String(name);
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  const parts = text.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (parts.length && /^[A-Za-z]:$/.test(parts[0])) parts.shift();
  return parts.length && parts.every((p) => p !== "..") ? parts.join("/") : null;
};

export default {
  name: "input-asar",
  version: "0.1.0",
  class: "input",
  commands: {
    unpack: {
      describe: "write an Electron app.asar out as the folder it holds: portamp unpack <file.asar> [--out dir]; the folder is then a source to port",
      async run({ log, args }) {
        const file = args._[1];
        if (!file) throw new Error("portamp unpack <file.asar>: no archive given");
        const dir = resolve(process.cwd(), args.out ?? file.replace(/\.asar$/i, "") + "-unpacked");
        const { written, refused } = await unpackAsar(await readFile(resolve(process.cwd(), file)), dir, { keep: safeAsarPath });
        log.info(`${written.length} file(s) written under ${dir}${refused.length ? `, ${refused.length} refused (${refused.slice(0, 3).map((r) => `${r.entry}: ${r.reason}`).join("; ")})` : ""}`);
        if (written.length) log.info(`port it with: node src/cli.js run --src ${dir}`);
        return { written, refused };
      },
    },
  },
  setup({ on, log }) {
    on("scan", async (ctx) => {
      const archives = ctx.sources.files.filter((f) => /\.asar$/i.test(f.rel));
      if (!archives.length) return log.debug("no asar archives");
      for (const f of archives) {
        const { entries, error } = readAsar(await readFile(f.path).catch(() => new Uint8Array(0)));
        if (error) { ctx.unverified(`${f.rel} is not a readable asar archive (${error}).`); continue; }
        const pages = entries.filter((e) => /\.(html?|js|css)$/i.test(e.name)).length;
        ctx.unverified(
          `${f.rel} is an Electron app archive holding ${entries.length} file(s), ${pages} of them pages, scripts or styles. ` +
            `Nothing inside it was read: unpack it first (portamp unpack ${f.rel}) or drop it on the console's intake, then port the folder.`
        );
      }
      log.info(`${archives.length} asar archive(s) named; unpack to port`);
    });
  },
};
