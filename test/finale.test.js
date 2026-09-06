import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { toMermaid, buildGraph } from "../plugins/vis-graph/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port measured whole: its weight held to a budget, and its shape drawn as
 * one graph rather than described across a dozen reports.
 */

test("the graph draws composition and endpoint edges from the run's own facts", () => {
  const screens = [
    { selector: "app-list", template: "<div><app-row></app-row></div>", file: "list.ts" },
    { selector: "app-row", template: "<span>{{ x }}</span>", file: "row.ts" },
  ];
  const calls = [{ path: "/api/items", file: "list.ts" }];
  const { composition, endpoints, screenEndpoints } = buildGraph(screens, calls);
  assert.deepEqual(composition, [["app-list", "app-row"]], "the tag naming another screen is an edge");
  assert.ok(endpoints.has("/api/items"));
  assert.deepEqual(screenEndpoints, [["app-list", "/api/items"]], "the call from the screen's file is a wire");

  const mermaid = toMermaid(screens, calls);
  assert.match(mermaid, /flowchart LR/);
  assert.match(mermaid, /S_app_list --> S_app_row/);
  assert.match(mermaid, /S_app_list -\.-> E1/);
});

test("a run writes GRAPH.md with a mermaid block and SIZE.md with a shipping weight", async () => {
  const run = await runPipeline({ src: join(ROOT, "example/legacy") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("GRAPH.md"));
    assert.ok(run.ctx.written.includes("SIZE.md"));

    const graph = await readFile(join(run.out, "GRAPH.md"), "utf8");
    assert.match(graph, /```mermaid[\s\S]*flowchart LR/);

    const size = await readFile(join(run.out, "SIZE.md"), "utf8");
    assert.match(size, /Component code:/);
    assert.ok(run.ctx.size.componentBytes > 0, "the components have a weight");
    // Reports and tests are excluded, so the total is what ships.
    assert.ok(!size.includes("reports |"), "reports do not count toward the shipping weight");
  } finally {
    await run.cleanup();
  }
});

test("--max-kb fails a run whose components exceed the ceiling, and passes a generous one", async () => {
  const over = await runPipeline({ src: join(ROOT, "example/legacy"), maxKb: 0.1 });
  over.cleanup && (await over.cleanup());
  assert.ok(over.error, "a tenth of a kilobyte fails");
  assert.match(over.error.message, /--max-kb ceiling/);

  const under = await runPipeline({ src: join(ROOT, "example/legacy"), maxKb: 9999 });
  try {
    assert.equal(under.error, null, "a generous ceiling passes");
  } finally {
    await under.cleanup();
  }
});
