import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readRenderBlocking } from "../plugins/dsp-render-blocking/index.js";
import { readInline } from "../plugins/dsp-inline/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port's first paint: what blocks the browser building the page, and the
 * style and script a legacy page carries inline where it can be neither themed
 * nor allowed by a strict policy.
 */

test("a sync head script blocks; a deferred one does not; @import and a head stylesheet are named", () => {
  const found = readRenderBlocking(
    `<!doctype html><html><head>
       <script src="/a.js"></script>
       <script src="/b.js" defer></script>
       <link rel="stylesheet" href="/m.css">
       <style>@import url("/x.css");</style>
     </head><body>x</body></html>`,
    "p.html"
  );
  const kinds = found.map((f) => f.kind);
  assert.ok(found.some((f) => f.kind === "blocking-script" && /a\.js/.test(f.detail)));
  assert.ok(!found.some((f) => /b\.js/.test(f.detail)), "a deferred script does not block");
  assert.ok(kinds.includes("blocking-stylesheet"));
  assert.ok(kinds.includes("css-import"));
});

test("inline style attributes, style blocks and inline scripts are counted, never captured", () => {
  const inline = readInline(
    `<div style="color: red">x</div><p style="margin:0">y</p><style>.a{}</style>
     <script src="/x.js"></script><script>window.ready = true;</script>`,
    "p.html"
  );
  assert.equal(inline.styleAttrs.count, 2);
  assert.equal(inline.styleBlocks, 1);
  assert.equal(inline.scriptBlocks, 1, "the src script is not inline");
  assert.ok(!JSON.stringify(inline).includes("color: red"), "the style value is never captured");
});

test("a run writes RENDER.md and INLINE.md, applying nothing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/paint-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("RENDER.md"));
    assert.ok(run.ctx.written.includes("INLINE.md"));

    const render = await readFile(join(run.out, "RENDER.md"), "utf8");
    assert.match(render, /analytics\.js/);
    assert.match(render, /import/i);

    const inline = await readFile(join(run.out, "INLINE.md"), "utf8");
    assert.match(inline, /CSP|theme|token/i, "the report frames it as theming and security");
  } finally {
    await run.cleanup();
  }
});
