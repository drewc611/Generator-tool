import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readLandmarks } from "../plugins/dsp-landmarks/index.js";
import { readLabels } from "../plugins/dsp-labels/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The accessible port: the region structure a screen reader navigates and the
 * form controls a page left with no name. Both read and reported, neither
 * renamed, because a landmark and a label are copy a person adds on purpose.
 */

test("a page with no landmarks is named as one a screen reader cannot skip into", () => {
  const { counts, issues } = readLandmarks(
    `<!doctype html><html><body><div class="bar">x</div><div class="c"><h1>Hi</h1></div></body></html>`,
    "p.html"
  );
  assert.equal(counts.main, 0);
  assert.ok(issues.includes("no main landmark"));
  assert.ok(issues.includes("no navigation landmark"));

  const good = readLandmarks(
    `<!doctype html><html><body><a href="#main">skip</a><nav>n</nav><main id="main">x</main></body></html>`,
    "g.html"
  );
  assert.ok(!good.issues.includes("no main landmark"));
  assert.ok(!good.issues.includes("no navigation landmark"));
});

test("a control with only a placeholder is unlabelled; one with a label for is not", () => {
  const found = readLabels(
    `<input type="text" name="q" placeholder="Search">
     <label for="pw">Password</label><input id="pw" type="password">
     <select name="team"><option>a</option></select>`,
    "p.html"
  );
  const names = found.map((f) => f.name);
  assert.ok(names.includes("q"), "a placeholder is not a label");
  assert.ok(names.includes("team"), "a select with no label is flagged");
  assert.ok(!found.some((f) => f.name === "pw"), "the password has a matching label for");
});

test("a run writes LANDMARKS.md and LABELS.md, renaming nothing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/a11y-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("LANDMARKS.md"));
    assert.ok(run.ctx.written.includes("LABELS.md"));

    const marks = await readFile(join(run.out, "LANDMARKS.md"), "utf8");
    assert.match(marks, /main/i);

    const labels = await readFile(join(run.out, "LABELS.md"), "utf8");
    assert.match(labels, /username|remember|team/, "an unlabelled control is named");
    assert.match(labels, /placeholder/i, "the report says a placeholder is not a label");
  } finally {
    await run.cleanup();
  }
});
