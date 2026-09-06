import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { safeAsarPath, unpackAsar } from "../plugins/input-asar/index.js";
import { readAsar, readAsarHeader } from "../plugins/input-asar/asar.js";
import { createIntake } from "../plugins/vis-ui/index.js";
import { buildAsar, buildAsarRaw } from "./fixtures/asar/build.mjs";
import { runPipeline } from "./helpers.js";

/**
 * A desktop app built on Electron is a web front end in resources/app.asar
 * beside its .exe. The archive is a header and a run of bytes; input-asar
 * reads it with no dependency, unpacks it as a command or on the console's
 * intake, every path held, and names in a source tree what it will not unpack
 * in place. The archives are built by the suite; none is committed.
 */

const quiet = { info() {}, debug() {}, warn() {}, error() {} };

const APP = {
  "package.json": JSON.stringify({ name: "ledger", main: "main.js" }),
  "main.js": "require('electron')",
  "index.html": `<html><head><title>Ledger</title><link rel="stylesheet" href="css/app.css"></head><body><nav><a href="about.html">About</a></nav><main><h1>Ledger</h1></main></body></html>`,
  "about.html": `<html><head><title>About</title></head><body><nav><a href="index.html">Home</a></nav><main><p>about</p></main></body></html>`,
  css: { files: { "app.css": "body { color: #111 }" } },
  "node_modules": { files: { big: { files: { "lib.node": { unpacked: true, size: 12 } } } } },
  "shortcut.txt": { link: "index.html" },
};

test("the header and the files read back exactly, and what is not in the bytes is named", () => {
  const asar = buildAsar(APP);
  const { header, base, error } = readAsarHeader(asar);
  assert.equal(error, undefined); assert.ok(header.files["index.html"]); assert.equal(base % 4, 0);
  const { entries } = readAsar(asar);
  assert.deepEqual(entries.map((e) => e.name), ["package.json", "main.js", "index.html", "about.html", "css/app.css", "node_modules/big/lib.node", "shortcut.txt"]);
  assert.equal(Buffer.from(entries[2].bytes().bytes).toString(), APP["index.html"]);
  assert.equal(Buffer.from(entries[4].bytes().bytes).toString(), "body { color: #111 }");
  assert.match(entries[5].bytes().error, /marked unpacked: the file lives beside the archive/);
  assert.match(entries[6].bytes().error, /a link to index\.html; nothing is followed/);
  assert.equal(readAsar(Buffer.from("not an asar at all, really not")).error, "not an asar archive: the size pickle does not read as one");
  assert.match(readAsar(asar.subarray(0, asar.length - 10)).entries.find((e) => e.name === "css/app.css").bytes().error ?? "", /run past the end/, "the last file, cut short, is a reason and not a file");
  assert.ok(readAsar(asar.subarray(0, 40)).error, "a header cut short is a reason");
  const odd = buildAsar({ "a.html": "x".repeat(100) });
  const sized = readAsar(Buffer.from(odd.toString("latin1").replace('"size":100', '"size":"x"'), "latin1")).entries[0].bytes();
  assert.equal(sized.error, "the header gives no size", "a size that is not a number is a reason, not an empty file");
  assert.equal(safeAsarPath("../etc/passwd"), null); assert.equal(safeAsarPath("a/./b.html"), "a/b.html"); assert.equal(safeAsarPath("/rooted.html"), "rooted.html");
});

test("unpacking writes the files under a folder, refuses what climbs out, and the command says where it landed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-asar-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const asar = buildAsar({ ...APP, "..": { files: { "escape.html": "<p>no</p>" } } });
  const { written, refused } = await unpackAsar(asar, join(dir, "out"), { keep: safeAsarPath });
  assert.deepEqual(written, ["package.json", "main.js", "index.html", "about.html", "css/app.css"]);
  assert.deepEqual(refused.map((r) => r.entry), ["node_modules/big/lib.node", "shortcut.txt", "../escape.html"]);
  assert.equal(await readFile(join(dir, "out", "css", "app.css"), "utf8"), "body { color: #111 }");
  await writeFile(join(dir, "app.asar"), asar);
  const lines = [];
  const result = await plugin.commands.unpack.run({ log: { info: (l) => lines.push(l), debug() {} }, args: { _: ["unpack", join(dir, "app.asar")], out: join(dir, "cmd") } });
  assert.equal(result.written.length, 5);
  assert.match(lines[0], /^5 file\(s\) written under .*cmd, 3 refused/); assert.match(lines[1], /port it with: node src\/cli\.js run --src/);
  assert.match(plugin.commands.unpack.describe, /portamp unpack <file\.asar>/);
});

test("an archive dropped on the intake is unpacked under its own name, and a run over the folder ports the app", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-asar-intake-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const intake = createIntake(join(dir, "intake"));
  const { files, refused } = await intake.put("resources/app.asar", buildAsar(APP));
  assert.deepEqual(files.map((f) => f.path), ["resources/app/about.html", "resources/app/css/app.css", "resources/app/index.html", "resources/app/main.js", "resources/app/package.json"]);
  assert.deepEqual(refused.map((r) => r.entry), ["node_modules/big/lib.node", "shortcut.txt"]);
  // Two entries folding onto one path keep the first, and a file where a folder is needed is a refusal with its code, never a thrown drop.
  const clash = await intake.put("clash.asar", buildAsar({ "a\\b.html": "<p>first</p>", a: { files: { "b.html": "<p>second</p>" } }, f: "a file", "f\\g.html": "<p>under a file</p>" }));
  assert.deepEqual(clash.refused.map((r) => [r.entry, r.reason]), [["a/b.html", "another entry, a\\b.html, already landed at clash/a/b.html"], ["f\\g.html", "could not be written (EEXIST)"]]);
  assert.equal(await readFile(join(dir, "intake", "clash", "a", "b.html"), "utf8"), "<p>first</p>");
  const run = await runPipeline({ src: join(dir, "intake", "resources", "app"), shots: join(dir, "none"), site: true, offline: true });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  assert.ok(run.ctx.site?.pages?.length >= 2, "the unpacked app's pages are the site");
});

test("an archive in a source tree is named with what it holds, and never unpacked in place", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-asar-src-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "app.asar"), buildAsar(APP));
  await writeFile(join(dir, "broken.asar"), Buffer.from("PK not an asar"));
  const run = await runPipeline({ src: dir, shots: join(dir, "none") });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const notes = run.ctx.report.unverified.join("\n");
  assert.match(notes, /app\.asar is an Electron app archive holding 7 file\(s\), 4 of them pages, scripts or styles\. Nothing inside it was read: unpack it first \(portamp unpack app\.asar\)/);
  assert.match(notes, /broken\.asar is not a readable asar archive/);
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual((await readdir(dir)).sort(), ["app.asar", "broken.asar"], "nothing was written beside the archive");
});

/**
 * The twenty first review pass. The header is JSON somebody else wrote, so
 * every field shape Electron never writes is fed to the reader here: a folder
 * whose files are a list or a string, a size that is a string or a boolean or
 * missing, an offset in hex or empty or past the safe integers, a folder tree
 * deeper than any app, names that collide once backslashes fold or that no
 * file system takes. Each ends in a reason by name, never a value coerced into
 * a file, and unpacking never throws and never writes twice to one path.
 */
test("the twenty first review pass: a header of the wrong shape is a reason per entry, and unpacking refuses collisions rather than clobbering or crashing", async (t) => {
  const bytes = (header, blobs = "ab") => readAsar(buildAsarRaw(header, Buffer.from(blobs)));
  const one = (header, blobs) => bytes(header, blobs).entries[0].bytes();
  assert.equal(bytes({ files: ["a", "b"] }).error, "the header names no files", "a files list is not a table of names");
  assert.equal(bytes({ files: "abc" }).error, "the header names no files", "a string would otherwise yield an entry per character with String.prototype.link as its link");
  assert.equal(bytes('[{"files":{}}]').error, "the header names no files");
  const folderish = bytes({ files: { d: { files: "abc" }, e: { files: [1] }, f: null, g: 5, h: "str" } });
  assert.deepEqual(folderish.entries.map((e) => [e.name, e.bytes().error]), [
    ["d", "the header lists a folder whose files are not a table"], ["e", "the header lists a folder whose files are not a table"],
    ["f", "the header's entry is not a table of fields"], ["g", "the header's entry is not a table of fields"], ["h", "the header's entry is not a table of fields"],
  ], "a node that is neither a folder nor a file is one refused entry, not a tree of invented ones");
  for (const size of [-1, 1.5, "2", true, [2], null, undefined]) assert.equal(one({ files: { a: { size, offset: "0" } } }).error, "the header gives no size", `size ${JSON.stringify(size)} is not a whole number`);
  assert.equal(one({ files: { a: { size: 2, offset: 0 } } }).error, undefined, "a numeric offset is taken");
  for (const offset of ["0x1", "", " 1", "1e3", "-1", "1.5", "99999999999999999999999", "9007199254740993", 1.5, -1, null, undefined]) assert.equal(one({ files: { a: { size: 2, offset } } }).error, "the header gives no offset", `offset ${JSON.stringify(offset)} is not a string of digits within the safe integers`);
  assert.equal(one({ files: { a: { size: 4294967296, offset: "0" } } }).error, "4294967296 bytes is over the 67108864 byte cap for one file", "a four gigabyte size on a small file is the cap, not an allocation");
  assert.equal(one({ files: { a: { link: { x: 1 }, size: 2, offset: "0" } } }).error, undefined, "a link that is not a string is no link, and never prints as [object Object]");
  assert.equal(one({ files: { a: { link: "/etc/passwd" } } }).error, "a link to /etc/passwd; nothing is followed", "an absolute link is named and never followed");
  assert.equal(one({ files: { a: { unpacked: "false", size: 1, offset: "0" } } }).error, undefined, "unpacked is a boolean; a string is not the flag");
  assert.deepEqual(bytes({ files: {} }, "").entries, [], "an archive of no files with the header filling the file is empty, not an error");
  let deep = { size: 1, offset: "0" };
  for (let i = 0; i < 100; i += 1) deep = { files: { d: deep } };
  const bottom = bytes(deep, "a").entries;
  assert.equal(bottom.length, 1); assert.equal(bottom[0].name.split("/").length, 65);
  assert.match(bottom[0].bytes().error, /^a folder nested deeper than 64 levels; nothing under it is read$/, "the descent stops at the ceiling and the folder it stopped at is named");

  assert.equal(safeAsarPath("a/../../b"), null); assert.equal(safeAsarPath("..\\x"), null); assert.equal(safeAsarPath("a\\..\\b"), null);
  assert.equal(safeAsarPath("C:\\x"), "x", "a drive root is a root like a leading slash, dropped so the file lands under the folder"); assert.equal(safeAsarPath("C:"), null);
  assert.equal(safeAsarPath("//etc/passwd"), "etc/passwd"); assert.equal(safeAsarPath("\\\\server\\share\\x"), "server/share/x");
  assert.equal(safeAsarPath("a\u0000b"), null, "a NUL byte is refused, since writeFile throws on one"); assert.equal(safeAsarPath("a\tb"), null); assert.equal(safeAsarPath("a\u007fb"), null);
  assert.equal(safeAsarPath("."), null); assert.equal(safeAsarPath(".."), null); assert.equal(safeAsarPath(""), null); assert.equal(safeAsarPath("a/.../b"), "a/.../b");

  const dir = await mkdtemp(join(tmpdir(), "portamp-asar-review-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const collide = buildAsarRaw({ files: {
    "a\\b": { size: 1, offset: "0" }, a: { files: { b: { size: 1, offset: "1" } } },
    "c\u0000d": { size: 1, offset: "0" }, "C:\\rooted.txt": { size: 1, offset: "1" },
    f: { size: 1, offset: "0" }, "f\\g": { size: 1, offset: "1" }, "h\\i": { size: 1, offset: "0" }, h: { size: 1, offset: "1" },
    bad: { files: "no" },
  } }, Buffer.from("xy"));
  const { written, refused } = await unpackAsar(collide, join(dir, "out"), { keep: safeAsarPath });
  assert.deepEqual(written, ["a/b", "rooted.txt", "f", "h/i"]);
  assert.deepEqual(refused, [
    { entry: "a/b", reason: "another entry, a\\b, already landed at a/b" },
    { entry: "c\u0000d", reason: "the path climbs out of the folder" },
    { entry: "f\\g", reason: "cannot be written at f/g (EEXIST): a file and a folder share a name, or the folder is not writable" },
    { entry: "h", reason: "cannot be written at h (EISDIR): a file and a folder share a name, or the folder is not writable" },
    { entry: "bad", reason: "the header lists a folder whose files are not a table" },
  ], "the first entry keeps a path, the second is refused by name, and a file where a folder stands is a refusal and not an exception");
  assert.equal(await readFile(join(dir, "out", "a", "b"), "utf8"), "x", "the first entry's bytes are the ones on disk");

  const intake = createIntake(join(dir, "intake"));
  const dropped = await intake.put("app.asar", buildAsarRaw({ files: { ok: { size: 1, offset: "0" }, s: "str", d: { files: [] } } }, Buffer.from("x")));
  assert.deepEqual(dropped.files.map((f) => f.path), ["app/ok"]);
  assert.deepEqual(dropped.refused.map((r) => r.reason), ["the header's entry is not a table of fields", "the header lists a folder whose files are not a table"], "the console's intake reads through the same guard");
});
