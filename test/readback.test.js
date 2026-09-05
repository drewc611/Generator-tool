import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readComponent, lowerBody } from "../plugins/input-react/index.js";
import { roundTrip, summarize } from "../plugins/vis-roundtrip/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * portamp reads what it writes. React lowers onto the same dialect every other
 * reader targets, and a template emitted to React and read back returns the
 * structure it started with, which vis-roundtrip checks per screen.
 */

test("a React component lowers onto the dialect the rest of the tool reads", () => {
  const src = `export default function Card({ name, price, items, onBuy }) {
    return (
      <div className="card">
        <h3>{name}</h3>
        {price && (<p className="price">{price}</p>)}
        <ul>{items.map((i) => (<li key={i.id}>{i.label}</li>))}</ul>
        <button onClick={() => onBuy(name)}>Buy</button>
      </div>
    );
  }`;
  const [screen] = readComponent(src, "Card.jsx");
  assert.equal(screen.selector, "card");
  assert.deepEqual(screen.inputs.sort(), ["items", "name", "price"]);
  assert.deepEqual(screen.outputs, ["buy"]);
  assert.match(screen.template, /\{\{ name \}\}/, "an expression is interpolation");
  assert.match(screen.template, /ng-if="price"/, "a && is a conditional");
  assert.match(screen.template, /ng-repeat="i in items"/, "a map is a loop");
  assert.match(screen.template, /ng-click="onBuy\(name\)"/, "an onClick is an event");
  assert.match(screen.template, /class="card"/, "className becomes class");
});

test("the structure of a template survives the emit and the read back, through every target", () => {
  const dialect = `<div *ngIf="loading">Loading</div><table><tr *ngFor="let o of orders" (click)="pick(o)">{{ o.id }}</tr></table><input [(ngModel)]="query">`;
  const trip = roundTrip(dialect);
  const allDiffs = trip.targets.flatMap((t) => t.diffs.map((d) => `${t.name}: ${d}`));
  assert.equal(trip.held, true, "the round trip held through every target: " + allDiffs.join("; "));
  assert.deepEqual(trip.targets.map((t) => t.name), ["React", "Svelte", "Lit"], "all three targets ran");
  for (const t of trip.targets) assert.equal(t.back.elements, trip.original.elements, `${t.name} kept the elements`);
  assert.equal(trip.original.loops, 1);
  assert.equal(trip.original.models, 1);
});

test("a two way input round trips as a model, an input without onChange does not", () => {
  const back = lowerBody(`<input value={query} onChange={(e) => setQuery(e.target.value)} /><input value={fixed} />`, () => {});
  assert.match(back, /ng-model="query"/);
  assert.doesNotMatch(back, /ng-model="fixed"/, "a value with no onChange is not a two way model");
  assert.equal(summarize(back).models, 1);
});

test("a real React file ports and the round trip holds through a run", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/react-app") });
  try {
    assert.equal(run.error, null);
    const screen = run.ctx.screens.find((s) => s.readBy === "react");
    assert.ok(screen, "the React component was read");
    assert.ok(run.ctx.written.includes("ROUNDTRIP.md"));
    const rt = run.ctx.roundtrip.find((r) => r.selector === screen.selector);
    assert.ok(rt.held, "the port read back to the same structure: " + (rt?.targets.flatMap((t) => t.diffs).join("; ") ?? ""));
    const jsx = await readFile(join(run.out, "src/features/ProductCard/ProductCard.jsx"), "utf8");
    assert.match(jsx, /items\.map\(/, "the loop came across into the re-emitted component");
  } finally {
    await run.cleanup();
  }
});
