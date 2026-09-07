import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The desktop shell (desktop/main.js) expects the repository it wraps to sit
 * on disk at process.resourcesPath/portamp, unpacked, because it imports
 * src/core/kernel.js from there at runtime rather than reading it out of the
 * asar archive. electron-builder only puts a from/to file mapping there when
 * it is declared under extraResources; the same mapping declared under
 * files instead packs it inside the asar, where fileURLToPath'd dynamic
 * import() cannot resolve it, and the packaged app fails at the first click
 * with "Cannot find module .../portamp/src/core/kernel.js" on every platform,
 * not just one. Building the real installers on all three platforms to catch
 * this again would need the electron toolchain in every CI run, so this test
 * holds the two files to their contract structurally instead, fast and with
 * no dependency, the same way test/hygiene.test.js holds prose to counts
 * without re-deriving them.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("the packaged app's resources match what main.js reads them from", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "desktop/package.json"), "utf8"));
  const main = await readFile(join(ROOT, "desktop/main.js"), "utf8");

  const resourceName = /join\(process\.resourcesPath,\s*["'](\w+)["']\)/.exec(main);
  assert.ok(resourceName, "main.js reads the packaged repo from a named resourcesPath subdirectory");
  const name = resourceName[1];

  const extra = pkg.build.extraResources ?? [];
  const mapping = extra.find((e) => typeof e === "object" && e.to === name);
  assert.ok(mapping, `desktop/package.json's build.extraResources copies a "from" to "${name}", matching main.js`);
  assert.ok(mapping.from, "the mapping names a source directory");
  for (const must of ["src/**", "plugins/**", "package.json"]) {
    assert.ok(mapping.filter?.includes(must), `the extraResources filter carries ${must}`);
  }

  // The bug this test exists to catch: the same from/to mapping declared
  // under files instead of extraResources builds without error and asar
  // packs the repo, so process.resourcesPath/portamp never exists on disk.
  for (const f of pkg.build.files ?? []) {
    assert.ok(typeof f === "string", "build.files holds plain paths only; a from/to mapping belongs in extraResources");
  }
});

test("the desktop app declares no publish target, so electron-builder never needs one to build", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "desktop/package.json"), "utf8"));
  // With no publish target, electron-builder's own updateInfoBuilder throws
  // (computeChannelNames reads a null publish config's .channel) unless
  // publish is explicitly turned off; there is no auto-updater wired into
  // main.js, so off is the honest setting, not a workaround.
  assert.equal(pkg.build.publish, null, "build.publish is explicitly null; nothing here auto-updates");
});
