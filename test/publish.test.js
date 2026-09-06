import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import plugin, { checkPack, packDryRun } from "../plugins/general-publish/index.js";

/**
 * publish-check turns the last manual step in docs/PUBLISHING.md, reading the
 * npm pack file list by eye, into a verdict. The pure check is held here without
 * spawning npm; one test runs the real dry run against this repository, which
 * is the actual proof that the package is clean. It never publishes.
 */

const PKG = { name: "portamp", version: "1.2.3", files: ["src", "plugins"], bin: { portamp: "src/cli.js" }, dependencies: {} };

test("a clean pack passes every check", () => {
  const { checks, ok } = checkPack(PKG, ["package.json", "README.md", "src/cli.js", "plugins/x/index.js"]);
  assert.equal(ok, true);
  assert.equal(checks.length, 5);
  assert.ok(checks.every((c) => c.ok), checks.filter((c) => !c.ok).map((c) => c.detail).join("; "));
});

test("a stray top level fails; npm's always-included files do not", () => {
  const { checks } = checkPack(PKG, ["package.json", "LICENSE", "src/cli.js", "example/legacy/app.js"]);
  const top = checks.find((c) => /top levels/.test(c.name));
  assert.equal(top.ok, false);
  assert.match(top.detail, /example\/legacy\/app\.js/);
  const clean = checkPack(PKG, ["package.json", "LICENSE", "CHANGELOG.md", "src/cli.js"]);
  assert.equal(clean.checks.find((c) => /top levels/.test(c.name)).ok, true, "LICENSE and CHANGELOG are npm's, not strays");
});

test("an attestation, a recordings directory or a dotenv is forbidden; a plugin named input-shots is not", () => {
  const bad = checkPack(PKG, ["src/cli.js", "src/portamp.authorization.json", "plugins/x/screenshots/a.png", "src/.env"]);
  const f = bad.checks.find((c) => /forbidden/.test(c.name));
  assert.equal(f.ok, false);
  assert.match(f.detail, /attestation/);
  assert.match(f.detail, /screenshot/);
  assert.match(f.detail, /dotenv/);
  const fine = checkPack(PKG, ["src/cli.js", "plugins/input-shots/index.js", "plugins/general-authorization/index.js"]);
  assert.equal(fine.checks.find((c) => /forbidden/.test(c.name)).ok, true, "a directory merely named like a forbidden one, or the plugin that checks attestations, is not forbidden");
});

test("a runtime dependency, a bad version, or a missing bin fails", () => {
  const dep = checkPack({ ...PKG, dependencies: { left: "1" } }, ["src/cli.js"]);
  assert.equal(dep.checks.find((c) => /dependencies/.test(c.name)).ok, false);
  const ver = checkPack({ ...PKG, version: "latest" }, ["src/cli.js"]);
  assert.equal(ver.checks.find((c) => /semver/.test(c.name)).ok, false);
  const bin = checkPack(PKG, ["package.json"]);
  const b = bin.checks.find((c) => /bin target/.test(c.name));
  assert.equal(b.ok, false);
  assert.match(b.detail, /src\/cli\.js/);
});

test("the real repository packs clean: the actual proof, run against npm", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const pack = await packDryRun();
  assert.equal(pack.name, "portamp");
  assert.ok(pack.paths.includes("src/cli.js"), "the bin ships");
  const { checks, ok } = checkPack(pkg, pack.paths);
  assert.equal(ok, true, checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; "));
});

test("it registers one command and never publishes", async () => {
  assert.equal(plugin.class, "general");
  assert.deepEqual(Object.keys(plugin.commands), ["publish-check"]);
  const source = await readFile(new URL("../plugins/general-publish/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']publish["']\s*[,\]]/, "npm publish is never invoked");
  assert.match(source, /--dry-run/, "only the dry run is ever run");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    // A node builtin or the shared IR helpers beside it: neither is a dependency and neither reaches the network.
    assert.match(line, /from "(node:|\.\.\/dsp-ir\/)/, `${line.trim()} is neither a node builtin nor the shared IR helpers`);
  }
});
