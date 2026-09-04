import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readMotion } from "../plugins/dsp-motion/index.js";
import { readPrint } from "../plugins/dsp-print/index.js";
import { readCookies } from "../plugins/dsp-cookies/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The modes the old app forgot: motion nobody could still, print styles a port
 * can lose, and cookies set without a question. Each measured and reported.
 */

test("motion is counted, and an unstilled page is flagged", () => {
  const moved = readMotion(`@keyframes spin { to { transform: rotate(1turn); } } .x { animation: spin 1s; } .y { transition: all .2s; }`, "s.css");
  assert.equal(moved.keyframes, 1);
  assert.ok(moved.animations >= 1 && moved.transitions >= 1);
  assert.equal(moved.reducedMotion, false, "no reduced-motion block");

  const stilled = readMotion(`.x { animation: spin 1s; } @media (prefers-reduced-motion: reduce) { .x { animation: none; } }`, "s.css");
  assert.equal(stilled.reducedMotion, true);
});

test("a print block is read with its rules and whether it hides the chrome", () => {
  const { blocks } = readPrint(`@media print { nav { display: none } body { color: black } a::after { content: "x" } }`, "s.css");
  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].selectors >= 3);
  assert.equal(blocks[0].hidesNav, true);
});

test("cookies the client sets are named, and their values are not read", () => {
  const { sets, consent } = readCookies(
    `document.cookie = "session_id=secretvalue"; Cookies.set("uid", "trackme"); window.OneTrust.init();`,
    "app.js"
  );
  const names = sets.map((s) => s.name);
  assert.ok(names.includes("session_id"));
  assert.ok(names.includes("uid"));
  assert.ok(consent.includes("OneTrust"));
  assert.ok(!JSON.stringify(sets).includes("secretvalue"), "the value is never captured");
  assert.ok(!JSON.stringify(sets).includes("trackme"));
});

test("a run writes MOTION.md, PRINT.md and COOKIES.md", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/modes-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("MOTION.md"));
    assert.ok(run.ctx.written.includes("PRINT.md"));
    assert.ok(run.ctx.written.includes("COOKIES.md"));

    const motion = await readFile(join(run.out, "MOTION.md"), "utf8");
    assert.match(motion, /not honoured/, "the page never stills its motion");

    const print = await readFile(join(run.out, "PRINT.md"), "utf8");
    assert.match(print, /media print|hides chrome/i);

    const cookies = await readFile(join(run.out, "COOKIES.md"), "utf8");
    assert.match(cookies, /session_id/);
    assert.match(cookies, /tracking_uid/);
    assert.doesNotMatch(cookies, /abc123|xyz789/, "no cookie value is printed");
    assert.match(cookies, /cookieconsent|none found|consent/i);
  } finally {
    await run.cleanup();
  }
});
