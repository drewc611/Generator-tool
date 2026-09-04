import assert from "node:assert/strict";
import test from "node:test";

import { toAngular } from "../plugins/output-angular/print.js";
import { translate } from "../plugins/output-react/template.js";

/**
 * The strongest honesty test the middle can have: emit Angular from the IR,
 * read that Angular back, and get the same thing. Two claims, both checked:
 * the printed form is a fixpoint (printing what was read back reproduces the
 * bytes), and nothing the trip touched changes what another target prints.
 */

const SCREENS = {
  "conditions and loops": `
    <div *ngIf="loading">Loading</div>
    <li *ngFor="let o of orders" [class.hot]="o.hot" (click)="pick(o)">{{ o.n }}</li>`,
  "the same screen spelled in vue": `
    <div v-if="loading">Loading</div>
    <li v-for="o in orders" :class="{hot: o.hot}" @click="pick(o)">{{ o.n }}</li>`,
  "bindings, models and text": `
    <input [(ngModel)]="query" placeholder="Search">
    <p [title]="hint">{{ count }} result(s)</p>
    <img [src]="thumb" alt="preview">`,
  "nesting and static markup": `
    <section class="panel">
      <h2>Orders</h2>
      <table><tr *ngFor="let r of rows"><td>{{ r.id }}</td><td>{{ r.total }}</td></tr></table>
    </section>`,
};

for (const [name, source] of Object.entries(SCREENS)) {
  test(`round trip: ${name}`, () => {
    const once = toAngular(source, {});
    const twice = toAngular(once.markup, {});
    assert.equal(twice.markup, once.markup, "printing what was read back reproduces the bytes");

    const before = translate(source, { indent: 3 }).jsx;
    const after = translate(once.markup, { indent: 3 }).jsx;
    assert.equal(after, before, "the trip through Angular loses nothing React could see");
  });
}

test("a vue screen and its angular round trip print identical react", () => {
  const vue = `<div v-if="a">x</div><li v-for="o in xs" @click="p(o)">{{ o.n }}</li>`;
  const angular = toAngular(vue, {}).markup;
  assert.equal(translate(angular, { indent: 0 }).jsx, translate(vue, { indent: 0 }).jsx);
});
