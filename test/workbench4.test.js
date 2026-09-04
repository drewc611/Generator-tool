import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { Policy, PolicyViolation } from "../src/core/policy.js";
import { renderHistory } from "../plugins/general-history/index.js";
import { readSourceLicense } from "../plugins/general-license/index.js";

const exec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "src", "cli.js");

test("offline outranks allow-live and says so", () => {
  const policy = new Policy({ allowLive: true, offline: true });
  assert.throws(() => policy.assertLiveAllowed("https://example.com"), (err) => {
    assert.ok(err instanceof PolicyViolation);
    assert.match(err.message, /offline/);
    return true;
  });
  const open = new Policy({ allowLive: true });
  assert.doesNotThrow(() => open.assertLiveAllowed("https://example.com"));
});

test("plugins --json is the roster and nothing else", async () => {
  const { stdout } = await exec(process.execPath, [CLI, "plugins", "--json"], { cwd: ROOT });
  const parsed = JSON.parse(stdout);
  assert.ok(parsed.plugins.length >= 80);
  assert.ok(parsed.plugins.every((p) => p.name && p.class && p.version));
  assert.ok(parsed.commands.some((c) => c.name === "doctor"));
});

test("version answers without loading a config", async () => {
  const { stdout } = await exec(process.execPath, [CLI, "--version"], { cwd: ROOT });
  assert.match(stdout, /^portamp \d+\.\d+\.\d+/);
});

test("a dry run writes nothing and still counts everything", async () => {
  const { stdout } = await exec(process.execPath, [CLI, "run", "--dry-run", "--out", "./out-dry-probe"], {
    cwd: join(ROOT, "example"),
  });
  assert.match(stdout, /dry run\s+\d+ file\(s\) would be written/);
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(join(ROOT, "example", "out-dry-probe")), "the out directory must not exist after a dry run");
});

test("--skip leaves a plugin out without naming the rest", async () => {
  const { stdout } = await exec(
    process.execPath, [CLI, "run", "--dry-run", "--skip", "output-react", "-v", "--out", "./out-skip-probe"],
    { cwd: join(ROOT, "example") },
  );
  assert.doesNotMatch(stdout, /emit:output-react /);
  assert.match(stdout, /emit:output-storybook|dry run/);
});

test("the history table spells the movement out", () => {
  const rendered = renderHistory([
    { ranAt: "2026-01-01T00:00:00Z", screens: 3, endpoints: 5, unverified: 10, files: 20 },
    { ranAt: "2026-01-02T00:00:00Z", screens: 4, endpoints: 5, unverified: 8, files: 22 },
  ]);
  assert.match(rendered, /\| Δ since previous \| \+1 \| 0 \| -2 \| \+2 \|/);
});

test("the source's own licence is read and classified, never judged", () => {
  const findings = readSourceLicense([
    { rel: "LICENSE", text: "MIT License\n\nPermission is hereby granted..." },
    { rel: "src/app.js", text: "// SPDX-License-Identifier: GPL-3.0-only\nlet x = 1;" },
  ]);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].family, "a permissive licence");
  assert.equal(findings[1].family, "a copyleft family licence");
});

test("an expired attestation is refused as if absent", async () => {
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "portamp-expiry-"));
  try {
    await mkdir(join(dir, "legacy"), { recursive: true });
    await writeFile(join(dir, "portamp.authorization.json"), JSON.stringify({
      system: "x", owner: "y", relationship: "owner", basis: "internal", attestedBy: "z",
      attestedOn: "2020-01-01", expires: "2020-06-01",
    }));
    const result = await exec(process.execPath, [CLI, "run", "--dry-run"], { cwd: dir }).then(
      (r) => r, (err) => err,
    );
    assert.match(String(result.stderr ?? "") + String(result.stdout ?? ""), /expired on 2020-06-01/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
