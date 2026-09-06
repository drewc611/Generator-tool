import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createIntake } from "../plugins/vis-ui/index.js";
import { readZip } from "../plugins/vis-ui/zip.js";
import { buildZip } from "./fixtures/zip/build.mjs";

/**
 * A legacy app arrives zipped more often than as a folder. The console's
 * intake unpacks an archive dropped on it with no dependency, stored and
 * deflated entries alike, every path held to the same rule as a dropped
 * file, and names what it refused rather than guessing at it. The archives
 * are built by the suite; none is committed.
 */

test("the reader lists every entry and yields stored and deflated bytes, and names an encrypted or unknown one", () => {
  const zip = buildZip([
    { name: "site/", data: "" },
    { name: "site/index.html", data: "<h1>old</h1>" },
    { name: "site/css/a.css", data: "body{}", method: 0 },
    { name: "secret.txt", data: "x", encrypted: true },
    { name: "odd.bin", data: "y", method: 12 },
    { name: "ünïcode.html", data: "<p>ü</p>", extra: [1, 2, 3, 4] },
  ], { comment: "made by the suite" });
  const { entries, error } = readZip(zip);
  assert.equal(error, undefined);
  assert.deepEqual(entries.map((e) => [e.name, e.size, e.method, e.directory, e.encrypted]), [
    ["site/", 0, 8, true, false], ["site/index.html", 12, 8, false, false], ["site/css/a.css", 6, 0, false, false],
    ["secret.txt", 1, 8, false, true], ["odd.bin", 1, 12, false, false], ["ünïcode.html", 9, 8, false, false],
  ]);
  assert.equal(Buffer.from(entries[1].bytes().bytes).toString(), "<h1>old</h1>", "a deflated entry inflates");
  assert.equal(Buffer.from(entries[2].bytes().bytes).toString(), "body{}", "a stored entry is its bytes");
  assert.equal(Buffer.from(entries[5].bytes().bytes).toString(), "<p>ü</p>", "an extra field is stepped over and a utf8 name read");
  assert.match(entries[3].bytes().error, /^encrypted/);
  assert.match(entries[4].bytes().error, /compression method 12 is not one Node can undo/);
  assert.equal(readZip(Buffer.from("not a zip at all, not even close")).error, "not a zip archive: no end of central directory record");
  const cut = zip.subarray(0, zip.length - 30);
  assert.ok(readZip(cut).error, "a truncated archive is a reason, not an exception");
  assert.match(readZip(buildZip([{ name: "big.txt", data: "z".repeat(3000) }]), { maxEntryBytes: 2000 }).entries[0].bytes().error, /over the 2000 byte cap/);
});

test("an archive dropped on the intake is unpacked under its own name, paths held, refusals named", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-zip-intake-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const intake = createIntake(join(dir, "intake"));
  const zip = buildZip([
    { name: "legacy/", data: "" },
    { name: "legacy/index.html", data: "<h1>old</h1>" },
    { name: "legacy/js/app.js", data: "var x = 1;", method: 0 },
    { name: "../escape.html", data: "<p>no</p>" },
    { name: "/rooted.html", data: "<p>rooted</p>" },
    { name: "legacy/locked.txt", data: "x", encrypted: true },
  ]);
  const { files, refused } = await intake.put("drop/app.zip", zip);
  assert.deepEqual(files.map((f) => f.path), ["drop/app/legacy/index.html", "drop/app/legacy/js/app.js", "drop/app/rooted.html"], "entries land under the archive's own name; a rooted name loses its root as a dropped path would");
  assert.equal(await readFile(join(dir, "intake", "drop/app/legacy/index.html"), "utf8"), "<h1>old</h1>");
  assert.deepEqual(refused, [
    { entry: "../escape.html", reason: "the path climbs out of the intake" },
    { entry: "legacy/locked.txt", reason: "encrypted; the archive's password is not something this tool asks for" },
  ]);
  const plain = await intake.put("notes.txt", Buffer.from("hi"));
  assert.deepEqual(plain.refused, []); assert.equal(plain.files.length, 4);
  const bad = await intake.put("broken.zip", Buffer.from("PK but not really a zip"));
  assert.deepEqual(bad.refused, [{ entry: "broken.zip", reason: "not a zip archive: no end of central directory record" }]);
  assert.ok(!bad.files.some((f) => f.path === "broken.zip"), "an archive that does not read is not kept as a file either");
});
