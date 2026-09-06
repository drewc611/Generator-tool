import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * Two more targets on the same IR: Qwik renders the proven JSX with its own
 * two constraints respected, and Astro composes the emitted React component as
 * a hydrated island rather than translating a screen a second time.
 */

test("the Qwik target respects the two things Qwik needs, over the proven JSX", async () => {
  const run = await runPipeline({ src: join(ROOT, "example/legacy"), qwik: true });
  try {
    assert.equal(run.error, null);
    const jsx = await readFile(join(run.out, "src/qwik/AppOrders/AppOrders.jsx"), "utf8");
    assert.match(jsx, /component\$\(\(props\) =>/, "the body is a Qwik component");
    assert.match(jsx, /import \{ component\$, useSignal \}/);
    // A handler prop carries the $ the optimizer needs; none is left bare.
    assert.match(jsx, /onChange\$=\{/);
    assert.match(jsx, /onClick\$=\{onRetry\}/);
    assert.doesNotMatch(jsx, /\son(Click|Change|Input|Blur)=\{/, "no handler prop is left without its $");
    // Local state is a signal read through .value, with a setter the handler calls.
    assert.match(jsx, /const query = useSignal\(""\)/);
    assert.match(jsx, /value=\{query\.value\}/, "the model reads through the signal");
    assert.match(jsx, /const setQuery = \(v\) => \{ query\.value = v; \}/);
    // The loop and states came across from the same translator the others use.
    assert.match(jsx, /orders\.map\(\(o\) =>/);
    assert.match(jsx, /role="status"/);
  } finally {
    await run.cleanup();
  }
});

test("the Astro target composes the emitted React component as an island", async () => {
  const run = await runPipeline({ src: join(ROOT, "example/legacy"), astro: true });
  try {
    assert.equal(run.error, null);
    const astro = await readFile(join(run.out, "src/astro/AppOrders.astro"), "utf8");
    assert.match(astro, /import AppOrders from "\.\.\/features\/AppOrders\/AppOrders\.jsx"/, "it imports the React component, not a rewrite");
    assert.match(astro, /<AppOrders/);
    assert.match(astro, /client:load/, "the island is hydrated");
    assert.match(astro, /Astro\.props/);
    assert.ok(run.ctx.written.includes("src/astro/README.md"), "the port says it needs the react integration");
  } finally {
    await run.cleanup();
  }
});

test("both targets are off unless named, so the default run writes neither", async () => {
  const run = await runPipeline({ src: join(ROOT, "example/legacy") });
  try {
    assert.equal(run.error, null);
    assert.ok(!run.ctx.written.some((f) => /^src\/qwik\//.test(f)), "no qwik without the flag");
    assert.ok(!run.ctx.written.some((f) => /^src\/astro\//.test(f)), "no astro without the flag");
  } finally {
    await run.cleanup();
  }
});
