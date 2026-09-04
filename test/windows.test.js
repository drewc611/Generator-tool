import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT } from "./helpers.js";

/**
 * The Windows audit, as a gate instead of a hope. The suite already runs on
 * Windows in CI; these checks close the two gaps that pass there by luck
 * until they do not: a dynamic import of a computed path that skips
 * pathToFileURL (a drive letter reads as a protocol), and a filesystem path
 * built by gluing "/" onto the output directory instead of join().
 */

async function toolFiles() {
  const out = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
    }
  };
  await walk(join(ROOT, "src"));
  await walk(join(ROOT, "plugins"));
  return out;
}

test("every dynamic import of a computed path goes through pathToFileURL", async () => {
  const offenders = [];
  for (const file of await toolFiles()) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(/\bimport\s*\(\s*([^)]+?)\s*\)/g)) {
      const arg = m[1];
      // A literal or bare specifier resolves by module rules and is fine
      // anywhere; only an argument that visibly builds a filesystem path is
      // the Windows hazard, and it is only a URL once pathToFileURL says so.
      // jsString() marks a value headed for emitted code, which runs under
      // the port's own bundler and follows its rules, not this one.
      if (!/\bjoin\s*\(|__dirname|dirname\s*\(|config\.\w*[Dd]ir|config\.out|\bROOT\b/.test(arg)) continue;
      if (/pathToFileURL|\.href|file:\/\/|jsString\(/.test(arg)) continue;
      offenders.push(`${file.slice(ROOT.length + 1)}: import(${arg.slice(0, 60)})`);
    }
  }
  assert.deepEqual(offenders, [], `computed imports must go through pathToFileURL:\n${offenders.join("\n")}`);
});

test("no filesystem path is built by gluing a slash onto the output directory", async () => {
  const offenders = [];
  for (const file of await toolFiles()) {
    const text = await readFile(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      // ctx.write takes a rel and joins internally; these are the raw fs
      // calls where a hand glued separator breaks on a Windows drive.
      if (/\b(readFile|writeFile|mkdir|rm|stat|readdir|copyFile)\s*\((?![^)]*join\()[^)]*(config\.out|outDir)\s*\+\s*["'`]\//.test(line)
        || /\b(readFile|writeFile|mkdir|rm|stat|readdir|copyFile)\s*\(\s*`\$\{[^}]*(config\.out|outDir)[^}]*\}\//.test(line)) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `glued output paths must use join():\n${offenders.join("\n")}`);
});

test("the walker hands every plugin forward slashes, whatever the platform", async () => {
  const walker = await readFile(join(ROOT, "plugins/input-angular/index.js"), "utf8");
  assert.match(walker, /relative\(root, p\)\.split\(sep\)\.join\("\/"\)/, "rel paths are normalized at the one place they are made");
});
