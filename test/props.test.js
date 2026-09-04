import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { decompose, findVariants, proposalsFrom } from "../plugins/dsp-props/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The shared component learns what varies: two blocks with the same shape and
 * different words are one component with a prop per difference, proposed and
 * never lifted, because deciding what may vary is the product's call.
 */

const CARD = (name, desc, url) =>
  `<article class="product"><h3>${name}</h3><p>${desc}</p><a class="buy" href="${url}">Buy this one</a></article>`;

test("two blocks of the same shape share a skeleton and differ only in their slots", () => {
  const a = decompose(CARD("Widget", "A dependable widget for everyday work here.", "/order/widget"));
  const b = decompose(CARD("Gadget", "A superb gadget for every complex task now.", "/order/gadget"));
  assert.equal(a.skeleton, b.skeleton, "the shape is the same");
  assert.notDeepEqual(a.slots.map((s) => s.value), b.slots.map((s) => s.value), "the content is not");
  // class and the "Buy this one" text are constant; name, desc, href vary.
  assert.ok(a.slots.some((s) => s.kind === "attr" && s.name === "href"));
});

test("a shape shared across screens with differing content is proposed with a prop per varying slot", () => {
  const variants = findVariants([
    { selector: "widgets", template: CARD("The Standard Widget", "A dependable widget for everyday work, built to last.", "/order/widget") },
    { selector: "gadgets", template: CARD("The Deluxe Gadget", "A superb gadget for every complex task, tuned well.", "/order/gadget") },
  ]);
  assert.equal(variants.length, 1, "one shared shape");
  const [proposal] = proposalsFrom(variants);
  assert.equal(proposal.screens.length, 2);
  // The href varies, the class does not, so href is a prop and class is not.
  assert.ok(proposal.props.some((p) => p.kind === "attr" && p.on === "href"), "the differing href becomes a prop");
  assert.ok(!proposal.props.some((p) => p.kind === "attr" && p.on === "class"), "the constant class does not");
  assert.ok(proposal.props.length >= 3, "name, description and href all vary");
});

test("a block that is byte identical across screens is not a props case; it belongs to dsp-components", () => {
  const same = CARD("Same", "Exactly the same words on both pages, well past sixty chars.", "/order/same");
  const variants = findVariants([
    { selector: "a", template: same },
    { selector: "b", template: same },
  ]);
  assert.equal(variants.length, 0, "no slot varies, so nothing to parameterize");
});

test("a shape on only one screen is not a shared component", () => {
  const variants = findVariants([
    { selector: "solo", template: CARD("Only", "A card that appears on exactly one page and nowhere else here.", "/x") },
  ]);
  assert.equal(variants.length, 0);
});

test("a run writes PROPS.md naming the parameterized proposal and its props", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/variant-cards"), site: true });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.propsLibrary.length >= 1, "the shared shape was found");
    assert.ok(run.ctx.written.includes("PROPS.md"), "the report is written");
    const doc = await readFile(join(run.out, "PROPS.md"), "utf8");
    assert.match(doc, /Parameterized component proposals/);
    assert.match(doc, /`href` attribute/, "the varying href is named as a prop");
    assert.ok(run.ctx.report.unverified.some((n) => /parameterized component/.test(n)));
    // Proposed, never performed: no component was emitted from it.
    assert.ok(!run.ctx.written.some((f) => /PortShape|PortThe/.test(f)));
  } finally {
    await run.cleanup();
  }
});
