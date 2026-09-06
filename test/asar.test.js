import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { safeAsarPath, unpackAsar } from "../plugins/input-asar/index.js";
import { readAsar, readAsarHeader } from "../plugins/input-asar/asar.js";
import { createIntake } from "../plugins/vis-ui/index.js";
import { buildAsar } from "./fixtures/asar/build.mjs";
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
