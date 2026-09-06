import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readConsole } from "../plugins/dsp-console/index.js";
import { readGlobals } from "../plugins/dsp-globals/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port cleaned: the debug output a legacy front end left in, and the hooks
 * it hung on the global object. Both found and reported, neither deleted,
 * because which log is load bearing and which global other code reads is a
 * person's call.
 */

test("the debug output is found with its method and line, never its arguments", () => {
  const found = readConsole(`console.log("secret", token);\nfoo();\ndebugger;\nconsole.warn("x");`, "a.js");
  const methods = found.filter((f) => f.kind === "console").map((f) => f.method);
  assert.ok(methods.includes("log") && methods.includes("warn"));
  assert.ok(found.some((f) => f.kind === "debugger"));
  assert.equal(found.find((f) => f.method === "warn").line, 4, "the line is kept");
  assert.ok(!JSON.stringify(found).includes("secret"), "the logged value is never captured");
});

test("what the app publishes on the global object is found by kind", () => {
  const found = readGlobals(
    `window.APP = {};\n$.fn.wobble = function () {};\nvar shared = 0;\nfunction go() {}`,
    "a.js"
  );
  const byKind = (k) => found.filter((f) => f.kind === k).map((f) => f.name);
  assert.ok(byKind("window-assign").includes("APP"));
  assert.ok(byKind("jquery-plugin").includes("wobble"));
  assert.ok(byKind("global-var").includes("shared") || byKind("global-var").includes("go"));
});

test("a run writes CONSOLE.md and GLOBALS.md, deleting nothing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/debt-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("CONSOLE.md"));
    assert.ok(run.ctx.written.includes("GLOBALS.md"));

    const con = await readFile(join(run.out, "CONSOLE.md"), "utf8");
    assert.match(con, /console\.(log|debug|warn)/);
    assert.match(con, /debugger/);

    const glob = await readFile(join(run.out, "GLOBALS.md"), "utf8");
    assert.match(glob, /APP_CONFIG|trackEvent/);
    assert.match(glob, /wobble/, "the jQuery plugin is named");
  } finally {
    await run.cleanup();
  }
});
