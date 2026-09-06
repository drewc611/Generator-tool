import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * publish-check reads the file list npm would pack and holds it against what
 * the package promises. That proves the list; it does not prove the files in
 * it work. Every other test here runs from inside the checkout, where a plugin
 * that reached for example/ or test/ or node_modules/ would still find them,
 * so a tarball missing one of those would pass the suite and fail the first
 * person to install it. This packs the real tarball, unpacks it, and runs the
 * shipped cli from a directory with no repository around it: the roster has to
 * match the checkout's, and a run over the example has to write PORT_NOTES.md.
 *
 * node has no tar of its own, so the tar binary is used and the test skips,
 * saying so, where there is none.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const shell = process.platform === "win32";
const run = (file, args, cwd) => execFileSync(file, args, { cwd, shell, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });

function tarAvailable() {
  try {
    run("tar", ["--version"], ROOT);
    return true;
  } catch {
    return false;
  }
}

test("the packed tarball installs and runs on its own, outside the repository", async (t) => {
  if (!tarAvailable()) {
    t.skip("tar is not on PATH; the installed tarball proof needs it to unpack what npm packed");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "portamp-installed-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const [packed] = JSON.parse(run("npm", ["pack", "--pack-destination", dir, "--json"], ROOT));
  assert.equal(packed.name, "portamp");
  const tarball = join(dir, packed.filename);
  assert.ok((await stat(tarball)).size > 0, `${packed.filename} was written`);

  run("tar", ["-xzf", tarball, "-C", dir], dir);
  const pkg = join(dir, "package");
  const shipped = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));
  assert.equal(shipped.version, packed.version, "the unpacked manifest is the one that was packed");
  const cli = join(pkg, shipped.bin.portamp);
  assert.ok((await stat(cli)).isFile(), `the bin target ${shipped.bin.portamp} is in the unpacked package`);

  // The cwd is the temp directory, not the package and not the checkout, so a
  // path a plugin resolved against cwd instead of its own location would miss.
  const here = JSON.parse(run("node", [join(ROOT, "src/cli.js"), "plugins", "--json"], ROOT)).plugins;
  const there = JSON.parse(run("node", [cli, "plugins", "--json"], dir)).plugins;
  assert.equal(there.length, here.length, `the installed package loads ${there.length} plugin(s); the checkout loads ${here.length}`);
  assert.deepEqual(there.map((p) => p.name).sort(), here.map((p) => p.name).sort(), "the installed roster is the checkout's roster");

  const out = join(dir, "out");
  const log = run("node", [cli, "run", "--src", join(ROOT, "example/legacy"), "--out", out, "--offline"], dir);
  assert.match(log, /file\(s\) written/, "the run reports what it wrote");
  const notes = await readFile(join(out, "PORT_NOTES.md"), "utf8");
  assert.ok(notes.length > 0, "PORT_NOTES.md was written by the installed package");
  assert.ok((await stat(join(out, "src"))).isDirectory(), "the port's source was emitted");
});
