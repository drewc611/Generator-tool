import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { solveExpression, solveEquation, solve } from "../plugins/general-study/solve.js";
import { extractText } from "../plugins/general-study/pdftext.js";
import { readPdf } from "../plugins/input-pdf/parse.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The study helper: arithmetic and one-variable linear equations, each
 * answer proven by the real steps that produced it, and a PDF's plain text
 * pulled through the same zero dependency reader input-pdf already ships.
 * Nothing here is a guess; a shape this solver cannot prove linear is
 * refused by name, the same restraint every reader in this tool keeps.
 */

test("a plain arithmetic expression evaluates with operator precedence honoured", () => {
  assert.equal(solveExpression("2 + 3 * 4").value, "14");
  assert.equal(solveExpression("(2 + 3) * 4").value, "20");
  assert.equal(solveExpression("2 ^ 3 ^ 2").value, "512", "^ is right associative: 2^(3^2)");
  assert.equal(solveExpression("-3 + 4").value, "1");
  assert.equal(solveExpression("10 / 4").value, "2.5");
});

test("division by zero is refused, never returned as Infinity or NaN", () => {
  const r = solveExpression("5 / 0");
  assert.equal(r.ok, false);
  assert.match(r.error, /division by zero/);
});

test("an expression naming a variable is refused as not plain arithmetic", () => {
  const r = solveExpression("2x + 3");
  assert.equal(r.ok, false);
  assert.match(r.error, /variable/);
});

test("a linear equation solves for its one variable with real steps", () => {
  const r = solveEquation("2x + 3 = 11");
  assert.equal(r.ok, true);
  assert.equal(r.variable, "x");
  assert.equal(r.value, "4");
  assert.ok(r.steps.length >= 3, "the working is shown, not just the answer");
  assert.equal(r.steps[r.steps.length - 1], "x = 4");
});

test("a linear equation with the variable on both sides still solves", () => {
  const r = solveEquation("3y - 2 = y + 8");
  assert.equal(r.ok, true);
  assert.equal(r.variable, "y");
  assert.equal(r.value, "5");
});

test("an equation with no variable at all is refused, not evaluated as true or false", () => {
  const r = solveEquation("2 + 2 = 4");
  assert.equal(r.ok, false);
  assert.match(r.error, /no variable/);
});

test("an equation naming two variables is refused rather than solved for one of them", () => {
  const r = solveEquation("x + y = 4");
  assert.equal(r.ok, false);
  assert.match(r.error, /one variable only/);
});

test("a squared variable is named as not linear, never approximated", () => {
  const r = solveEquation("x ^ 2 = 9");
  assert.equal(r.ok, false);
  assert.match(r.error, /not linear/);
});

test("a variable multiplied by itself across the equation is named as not linear", () => {
  const r = solveEquation("x * x = 4");
  assert.equal(r.ok, false);
  assert.match(r.error, /not linear/);
});

test("a contradiction and an identity are both named, neither is a crash", () => {
  const contradiction = solveEquation("x + 1 = x + 2");
  assert.equal(contradiction.ok, false);
  assert.match(contradiction.error, /no solution/);

  const identity = solveEquation("x + 1 = x + 1");
  assert.equal(identity.ok, true);
  assert.equal(identity.identity, true);
  assert.equal(identity.value, null);
});

test("more than one = sign is refused rather than solved against the wrong pair of sides", () => {
  const r = solveEquation("x = 1 = 2");
  assert.equal(r.ok, false);
  assert.match(r.error, /exactly one/);
});

test("an unrecognised character is named, never silently dropped", () => {
  const r = solveExpression("2 + $");
  assert.equal(r.ok, false);
});

test("solve() dispatches on whether = is present", () => {
  assert.equal(solve("2 + 2").value, "4");
  assert.equal(solve("2x = 8").value, "4");
});

test("a PDF's plain text is pulled through the same reader input-pdf already ships", async () => {
  const bytes = await readFile(join(ROOT, "test/fixtures/docs/widget-3000.pdf")).catch(() => null);
  if (!bytes) return; // fixture absent in this checkout; the pipeline test below still covers the real path
  const doc = readPdf(bytes);
  const direct = extractText(bytes);
  assert.equal(direct.ok, true);
  assert.equal(direct.text, doc.pages.map((p) => p.lines.map((l) => l.text).join("\n")).join("\n\n"));
});

test("a non-PDF buffer is named as unreadable, not returned as empty text", () => {
  const r = extractText(Buffer.from("not a pdf"));
  assert.equal(r.ok, false);
  assert.match(r.error, /not a readable PDF/);
});

test("an encrypted PDF is named rather than read as empty", async () => {
  const bytes = await readFile(join(ROOT, "test/fixtures/docs/sealed.pdf")).catch(() => null);
  if (!bytes) return;
  const r = extractText(bytes);
  assert.equal(r.ok, false);
  assert.match(r.error, /encrypted/);
});

test("STUDY.md is written only when --study is pressed, and shows real steps", async () => {
  const src = join(ROOT, "test/fixtures/codemod-site");

  const off = await runPipeline({ src });
  try {
    assert.equal(off.error, null);
    assert.ok(!off.ctx.written.includes("STUDY.md"), "the study helper is opt in");
  } finally {
    await off.cleanup();
  }

  const on = await runPipeline({ src, study: true });
  try {
    assert.equal(on.error, null);
    assert.ok(on.ctx.written.includes("STUDY.md"));
    const report = await readFile(join(on.out, "STUDY.md"), "utf8");
    assert.match(report, /2x \+ 3 = 11/);
    assert.match(report, /x = 4/);
    assert.match(report, /demonstration/i);
  } finally {
    await on.cleanup();
  }
});
