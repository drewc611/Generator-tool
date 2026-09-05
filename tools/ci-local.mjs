#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * The CI's own steps, run locally. The suite proves what the tests assert;
 * the workflow's exercise steps prove what the emitted files hold, with grep
 * and cmp over real runs, and those only ran on the server until a step
 * failed there that the suite had passed here. This reads the workflow file
 * (its shape is regular: a named step and its run, one line or a block) and
 * runs the check job's steps in order with bash, stopping at the first that
 * fails and naming it, so the same evidence CI reads is read before a push.
 *
 *   node tools/ci-local.mjs --list
 *   node tools/ci-local.mjs --only smarty --only "roadmap count"
 *   node tools/ci-local.mjs --skip "npm test" --keep-going
 *
 * The step that installs the optional reader reaches the network and is
 * skipped unless asked for by name.
 */

export function parseSteps(yaml) {
  const lines = String(yaml).replace(/\r\n/g, "\n").split("\n");
  const steps = [];
  let inCheck = false;
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^  check:\s*$/.test(line)) { inCheck = true; continue; }
    if (inCheck && /^  \S/.test(line)) inCheck = false;
    if (!inCheck) continue;
    const name = /^      - name:\s*(.+?)\s*$/.exec(line);
    if (name) { current = { name: name[1].replace(/^['"]|['"]$/g, ""), run: null }; steps.push(current); continue; }
    const run = /^        run:\s*(.*)$/.exec(line);
    if (run && current) {
      if (run[1].trim() === "|" || run[1].trim() === "|-") {
        const body = [];
        while (i + 1 < lines.length && (/^          /.test(lines[i + 1]) || lines[i + 1].trim() === "")) { i += 1; body.push(lines[i].replace(/^          /, "")); }
        while (body.length && body[body.length - 1].trim() === "") body.pop();
        current.run = body.join("\n");
      } else current.run = run[1];
    }
  }
  return steps.filter((s) => s.run !== null);
}

const NETWORK = /install the optional reader/;
// These read the run with the optional reader installed; without it they can only fail.
const NEEDS_READER = /with the typescript reader|the reader does not change what the run reports/;

export function runSteps(steps, { only = [], skip = [], keepGoing = false, cwd = process.cwd(), log = console.log, readerInstalled = existsSync(join(cwd, "node_modules/typescript")) } = {}) {
  const chosen = steps.filter((s) => (only.length ? only.some((o) => s.name.includes(o)) : !NETWORK.test(s.name)) && !skip.some((k) => s.name.includes(k) || s.run.includes(k)));
  const failed = [];
  for (const step of chosen) {
    if (!readerInstalled && NEEDS_READER.test(step.name) && !only.some((o) => step.name.includes(o))) { log(`skip  ${step.name}  (needs the optional reader; npm install --no-save typescript)`); continue; }
    const started = Date.now();
    const r = spawnSync("bash", ["-e", "-o", "pipefail", "-c", step.run], { cwd, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (r.status === 0) { log(`ok    ${step.name}  (${seconds}s)`); continue; }
    failed.push(step.name);
    log(`FAIL  ${step.name}  (${seconds}s)`);
    log((r.stdout + r.stderr).split("\n").slice(-40).join("\n"));
    if (!keepGoing) break;
  }
  return { ran: chosen.length, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const steps = parseSteps(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
  const args = process.argv.slice(2);
  const take = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] !== undefined ? [args[i + 1]] : []));
  if (args.includes("--list")) { steps.forEach((s, i) => console.log(`${String(i + 1).padStart(3)}  ${s.name}`)); process.exit(0); }
  const { ran, failed } = runSteps(steps, { only: take("--only"), skip: take("--skip"), keepGoing: args.includes("--keep-going"), cwd: root });
  console.log(`${ran - failed.length} of ${ran} step(s) passed${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
