import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parseSteps, runSteps } from "../tools/ci-local.mjs";
import { ROOT } from "./helpers.js";

/**
 * The CI's exercise steps read the emitted files with grep and cmp; the local
 * runner reads the same steps from the workflow so they run before a push.
 */

test("every named step of the check job is parsed with its run, one line or a block", async () => {
  const yaml = await readFile(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const steps = parseSteps(yaml);
  const named = (yaml.match(/^      - name:/gm) ?? []).length;
  assert.equal(steps.length, named, "a step whose run this parser cannot read would be silently skipped");
  assert.ok(steps.every((s) => s.run.trim().length > 0));
  const block = steps.find((s) => s.name === "the core names no framework");
  assert.match(block.run, /^if grep -rniE/, "a block run keeps its lines with the block indent removed");
  assert.match(block.run, /\necho "src\/core names no framework in code"$/);
  assert.equal(steps.find((s) => s.name === "plugins load").run, "node src/cli.js plugins");
});

test("steps are chosen by name, the network step is skipped unless named, and a failing step is named and stops the run", () => {
  const steps = [
    { name: "install the optional reader", run: "exit 3" },
    { name: "a true step", run: "true" },
    { name: "a false step", run: "echo boom; exit 1" },
    { name: "after", run: "true" },
    { name: "tests, with the typescript reader", run: "exit 4" },
  ];
  const lines = [];
  const r = runSteps(steps, { log: (l) => lines.push(l) });
  assert.deepEqual(r, { ran: 3, failed: ["a false step"] });
  assert.ok(lines.some((l) => /^ok\s+a true step/.test(l)) && lines.some((l) => /^FAIL\s+a false step/.test(l)) && lines.some((l) => /boom/.test(l)));
  assert.ok(!lines.some((l) => /after/.test(l)), "the first failure stops the run");
  assert.deepEqual(runSteps(steps, { only: ["install"], log: () => {} }), { ran: 1, failed: ["install the optional reader"] });
  const skipped = [];
  assert.deepEqual(runSteps(steps, { skip: ["false"], keepGoing: true, readerInstalled: false, log: (l) => skipped.push(l) }), { ran: 3, failed: [] });
  assert.ok(skipped.some((l) => /^skip\s+tests, with the typescript reader/.test(l)), "a step that needs the optional reader is skipped and says so when it is not installed");
  assert.deepEqual(runSteps(steps, { skip: ["false"], keepGoing: true, readerInstalled: true, log: () => {} }), { ran: 3, failed: ["tests, with the typescript reader"] });
});

test("the runner runs a real step of this repository's workflow from the command line", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "tools/ci-local.mjs"), "--only", "the roadmap count is the number the file claims"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok\s+the roadmap count is the number the file claims/m);
  assert.match(r.stdout, /1 of 1 step\(s\) passed/);
  const list = spawnSync(process.execPath, [join(ROOT, "tools/ci-local.mjs"), "--list"], { cwd: ROOT, encoding: "utf8" });
  assert.match(list.stdout, /the smarty reader composes a template/);
});
