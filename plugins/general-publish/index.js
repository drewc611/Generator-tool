import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * portamp publish-check: proves the package is ready to ship without shipping it.
 *
 * docs/PUBLISHING.md ends with a step a person does by eye: run `npm pack
 * --dry-run` and read the file list, because a recorded screenshot or a real
 * attestation must never be in it. That check is mechanical, so this makes it
 * one command. It runs the same dry run, reads the same list, and holds it
 * against what the package promises:
 *
 *   - only the top levels `files` declares ship, plus what npm always adds
 *   - nothing forbidden ships: an attestation, a local config, a screenshots or
 *     recordings directory, a dotenv, a private key
 *   - `dependencies` is empty, the zero runtime dependency invariant
 *   - the version is a plain semver and every `bin` target is in the tarball
 *
 * It never runs `npm publish`. Publishing is a decision with an owner, and the
 * roadmap keeps that entry open until somebody says so. This only turns "read
 * the list" into a verdict with an exit code, so the last manual step before
 * that decision cannot be skipped by accident.
 */

// The portamp package root, independent of where the command is run from.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// What npm includes whether or not `files` names it.
const ALWAYS = new Set(["package.json", "README.md", "README", "LICENSE", "LICENSE.md", "LICENCE", "CHANGELOG.md"]);

// Whole directory names, matched as a full path segment so a plugin named
// input-shots is not mistaken for a shots/ directory.
const FORBIDDEN = [
  { re: /(^|\/)portamp\.authorization\.json$/i, why: "a real attestation names a real system and owner" },
  { re: /(^|\/)portamp\.config\.js$/i, why: "a local config is one machine's, not the package's" },
  { re: /(^|\/)(screenshots|explored|shots|recordings)\//i, why: "a recorded screenshot or exploration is someone's app" },
  { re: /(^|\/)\.env(\.|$)/i, why: "a dotenv can carry a secret" },
  { re: /\.(pem|key)$/i, why: "a private key" },
];

/** Run `npm pack --dry-run --json` in the package root and return its manifest. */
export function packDryRun(cwd = ROOT) {
  return new Promise((resolve, reject) => {
    execFile("npm", ["pack", "--dry-run", "--json"], { cwd, shell: process.platform === "win32", maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const [first] = JSON.parse(stdout);
        resolve({ name: first.name, version: first.version, paths: first.files.map((f) => f.path), entryCount: first.entryCount, unpackedSize: first.unpackedSize });
      } catch (e) {
        reject(new Error(`npm pack --dry-run --json did not return a manifest: ${e.message}`));
      }
    });
  });
}

/**
 * Hold a packed file list against the package manifest. Pure, so it is tested
 * without spawning npm; returns every check with its verdict.
 */
export function checkPack(pkg, paths) {
  const checks = [];
  const allowed = new Set([...(pkg.files ?? []), ...ALWAYS]);
  const stray = paths.filter((p) => !allowed.has(p.split("/")[0]));
  checks.push({ name: "only the declared top levels ship", ok: stray.length === 0, detail: stray.length ? `stray: ${stray.slice(0, 5).join(", ")}${stray.length > 5 ? ", ..." : ""}` : `${allowed.size} allowed top level(s)` });

  const forbidden = [];
  for (const p of paths) for (const f of FORBIDDEN) if (f.re.test(p)) forbidden.push(`${p} (${f.why})`);
  checks.push({ name: "nothing forbidden ships", ok: forbidden.length === 0, detail: forbidden.length ? forbidden.slice(0, 5).join("; ") : "no attestation, config, recording, dotenv or key" });

  const deps = Object.keys(pkg.dependencies ?? {});
  checks.push({ name: "zero runtime dependencies", ok: deps.length === 0, detail: deps.length ? `dependencies: ${deps.join(", ")}` : "dependencies is empty" });

  const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version ?? "");
  checks.push({ name: "the version is a plain semver", ok: semver, detail: `version ${pkg.version}` });

  const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {});
  const set = new Set(paths);
  const missingBin = Object.values(bins).map((b) => b.replace(/^\.\//, "")).filter((b) => !set.has(b));
  checks.push({ name: "every bin target is in the tarball", ok: missingBin.length === 0, detail: missingBin.length ? `missing: ${missingBin.join(", ")}` : `${Object.keys(bins).length} bin target(s) present` });

  return { checks, ok: checks.every((c) => c.ok) };
}

export default {
  name: "general-publish",
  version: "0.1.0",
  class: "general",
  setup() {},
  commands: {
    "publish-check": {
      describe: "prove the npm package is ready to ship, without shipping it",
      async run({ log }) {
        const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
        let pack;
        try {
          pack = await packDryRun();
        } catch (e) {
          log.error(`npm pack --dry-run failed: ${e.message}`);
          process.exitCode = 1;
          return;
        }
        const { checks, ok } = checkPack(pkg, pack.paths);
        log.info(`\n${pack.name}@${pack.version}: ${pack.entryCount} file(s), ${Math.round(pack.unpackedSize / 1024)} KB unpacked\n`);
        for (const c of checks) (c.ok ? log.info : log.error)(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}  (${c.detail})`);
        if (ok) {
          log.info("\nready to publish. This command never publishes; `npm publish` is a person's decision.\n");
        } else {
          log.error("\nnot ready to publish; fix the FAIL line(s) above. Nothing was published.\n");
          process.exitCode = 1;
        }
      },
    },
  },
};
