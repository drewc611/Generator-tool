import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { shapeOf } from "../plugins/dsp-archetype/shape.js";
import { classify } from "../plugins/dsp-archetype/classify.js";

/**
 * The calibration corpus: one labelled miniature per archetype. The label is
 * a human judgment recorded in the fixture; the test holds the classifier to
 * it. When a change to the signals starts reading a chat as a form, this is
 * where it shows up, with the fixture that caught it named.
 */

const DIR = join(process.cwd(), "test", "fixtures", "corpus");

test("every corpus entry classifies as its label", async () => {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json")).sort();
  assert.ok(files.length >= 11, "the corpus holds at least the eleven labelled miniatures");

  const misses = [];
  for (const file of files) {
    const entry = JSON.parse(await readFile(join(DIR, file), "utf8"));
    const { best, contested, ranked } = classify({
      shape: shapeOf(buildIr(entry.html)),
      calls: entry.calls ?? [],
      model: entry.model ?? null,
      widgets: entry.widgets ?? [],
      components: entry.components ?? 1,
    });
    if (best.id !== entry.label) {
      misses.push(`${file}: labelled ${entry.label}, read as ${best.id} (${ranked.slice(0, 2).map((r) => `${r.id}:${r.score}`).join(" vs ")})`);
    } else if (contested) {
      misses.push(`${file}: read as ${entry.label} but contested with ${ranked[1].id}; sharpen the fixture or the signals`);
    }
  }
  assert.deepEqual(misses, [], `the classifier disagrees with the corpus:\n${misses.join("\n")}`);
});

test("a corpus entry carries evidence, not just a verdict", async () => {
  const entry = JSON.parse(await readFile(join(DIR, "crud-table.json"), "utf8"));
  const { best } = classify({ shape: shapeOf(buildIr(entry.html)), calls: entry.calls });
  assert.ok(best.evidence.length >= 2, "at least two signals back the reading");
});
