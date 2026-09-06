import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { blockFragments, findRepeats } from "../plugins/dsp-components/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port stops repeating itself: a block three pages carried verbatim
 * becomes one shared component the pages compose from, and every target
 * picks it up because the extraction is a screen like any other.
 */

test("block fragments are found with their real extent, nesting counted", () => {
  const html = `<p>lead</p><div class="card"><div class="inner">deep</div></div><footer>end</footer>`;
  const tags = blockFragments(html).map((b) => b.tag);
  assert.ok(tags.includes("div") && tags.includes("footer") && tags.includes("p"));
  const card = blockFragments(html).find((b) => b.html.includes("card"));
  assert.match(card.html, /<div class="card"><div class="inner">deep<\/div><\/div>$/, "the inner div does not end the outer one early");
});

test("a block two screens share is a repeat; a block one screen has is not", () => {
  const shared = `<aside class="promo"><h3>Join</h3><p>weekly tips and a few more words to clear the sixty character floor</p></aside>`;
  const repeats = findRepeats([
    { selector: "a", template: `<div>${shared}</div>` },
    { selector: "b", template: `<section>${shared}</section>` },
    { selector: "c", template: `<div><p>nothing shared here at all, just this lonely paragraph of prose</p></div>` },
  ]);
  assert.equal(repeats.length, 1, "only the block on two screens counts");
  assert.deepEqual([...repeats[0].screens].sort(), ["a", "b"]);
  assert.equal(repeats[0].dynamic, false);
});

test("a repeat that interpolates is dynamic, and stays a proposal", () => {
  const dyn = `<article class="item"><h3>Title</h3><p>Price is {{ product.price }} and the stock count differs by page</p></article>`;
  const repeats = findRepeats([
    { selector: "a", template: dyn },
    { selector: "b", template: `<div>${dyn}</div>` },
  ]);
  assert.equal(repeats.length, 1);
  assert.equal(repeats[0].dynamic, true, "binding means parameterizing, which is a person's call");
});

test("--components lifts the shared block into one component the pages reference", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, components: true });
  try {
    assert.equal(run.error, null);
    const perf = run.ctx.componentLibrary.performed;
    assert.equal(perf.length, 1, "the one shared block was extracted");
    assert.equal(perf[0].screens.size, 3, "all three pages shared it");

    const dirs = await readdir(join(run.out, "src/features"));
    const shared = dirs.find((d) => /^Port/.test(d));
    assert.ok(shared, "a Port-named component was emitted");
    const component = await readFile(join(run.out, `src/features/${shared}/${shared}.jsx`), "utf8");
    assert.match(component, /class(Name)?="promo"/, "the shared markup is the component's body");
    assert.match(component, /role="status"|loading/, "the extracted component still carries its states");

    const about = await readFile(join(run.out, "src/features/About/About.jsx"), "utf8");
    assert.match(about, new RegExp(`import ${shared} from "\\.\\./${shared}/${shared}\\.jsx"`), "the page imports the component");
    assert.match(about, new RegExp(`<${shared} ?/>`), "the page composes it instead of repeating the markup");
    assert.doesNotMatch(about, /Join the newsletter/, "the repeated markup is gone from the page");
  } finally {
    await run.cleanup();
  }
});

test("every target picks up the shared component, because it is a screen like any other", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, components: true, vue: true, svelte: true });
  try {
    assert.equal(run.error, null);
    const dirs = await readdir(join(run.out, "src/features"));
    const shared = dirs.find((d) => /^Port/.test(d));
    const vue = await readFile(join(run.out, "src/features/About/About.vue"), "utf8");
    assert.match(vue, new RegExp(`import ${shared} from`), "vue imports it without anything vue specific being added");
    const svelte = await readFile(join(run.out, "src/features/About/About.svelte"), "utf8");
    assert.match(svelte, new RegExp(`import ${shared} from`), "svelte imports it too");
    // The component itself was emitted in every target's spelling.
    assert.ok(run.ctx.written.includes(`src/features/${shared}/${shared}.vue`));
    assert.ok(run.ctx.written.includes(`src/features/${shared}/${shared}.svelte`));
  } finally {
    await run.cleanup();
  }
});

test("without the flag the report is written and nothing is extracted", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.componentLibrary.performed.length >= 1, "the repeat is still found");
    assert.ok(!run.ctx.written.some((f) => /^src\/features\/Port/.test(f)), "but no component is emitted");
    assert.ok(run.ctx.written.includes("COMPONENTS.md"), "the report names what could be shared");
    assert.ok(run.ctx.report.unverified.some((n) => /could be one component/.test(n)));
  } finally {
    await run.cleanup();
  }
});

test("the extraction is deterministic: two runs write the same bytes", async () => {
  const VOLATILE = new Set([".portamp/run.json", ".portamp/history.jsonl", ".portamp/run.previous.json", "HISTORY.md"]);
  const one = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, components: true });
  const two = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, components: true });
  try {
    assert.equal(one.error, null);
    assert.deepEqual(
      one.ctx.written.filter((f) => !VOLATILE.has(f)).sort(),
      two.ctx.written.filter((f) => !VOLATILE.has(f)).sort(),
      "the same files, named the same way",
    );
    for (const rel of one.ctx.written) {
      if (VOLATILE.has(rel)) continue;
      const a = await readFile(join(one.out, rel)).catch(() => null);
      const b = await readFile(join(two.out, rel)).catch(() => null);
      if (a && b) assert.ok(a.equals(b), `${rel} is byte identical between runs`);
    }
  } finally {
    await one.cleanup();
    await two.cleanup();
  }
});
