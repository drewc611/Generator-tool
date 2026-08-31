import assert from "node:assert/strict";
import test from "node:test";

import { translate } from "../plugins/output-react/template.js";
import { toSvelte } from "../plugins/output-svelte/print.js";

const flat = (html, options = {}) => translate(html, { indent: 0, ...options }).jsx.replace(/\s+/g, " ").trim();

test("v-else-if carries the negation of every branch before it", () => {
  const out = flat(`<p v-if="a">A</p><p v-else-if="b">B</p><p v-else>C</p>`);
  assert.match(out, /\{a && \( <p> A <\/p> \)\}/);
  assert.match(out, /\{!\(a\) && \(b\) && \( <p> B <\/p> \)\}/);
  assert.match(out, /\{!\(a\) && !\(b\) && \( <p> C <\/p> \)\}/);
});

test("whitespace between branches does not break the chain, content does", () => {
  const chained = flat(`<p v-if="a">A</p>\n  <p v-else>B</p>`);
  assert.match(chained, /!\(a\) && \( <p> B <\/p> \)/);
  const broken = translate(`<p v-if="a">A</p><hr><p v-else>B</p>`, { indent: 0 });
  assert.doesNotMatch(broken.jsx, /!\(a\)/, "an else past rendered content is not that if's else");
  assert.ok(broken.notes.some((n) => n.includes("else with no if")), "and the gap is named");
});

test("an orphan v-else-if keeps its own condition and says so", () => {
  const result = translate(`<p v-else-if="b">B</p>`, { indent: 0 });
  assert.match(result.jsx.replace(/\s+/g, " "), /\{b && \( <p> B <\/p> \)\}/);
  assert.ok(result.notes.some((n) => n.includes("else with no if")));
});

test("ngSwitch lowers to equality tests and a negated default", () => {
  const out = flat(`<div [ngSwitch]="mode"><b *ngSwitchCase="'fast'">F</b><i *ngSwitchDefault>other</i></div>`);
  assert.match(out, /\{\(mode\) === \('fast'\) && \( <b> F <\/b> \)\}/);
  assert.match(out, /\{!\(\(mode\) === \('fast'\)\) && \( <i> other <\/i> \)\}/);
  assert.doesNotMatch(out, /ngSwitch/, "the directive itself never lands in the output");
});

test("AngularJS ng-switch compares against the literal, not a variable", () => {
  const out = flat(`<div ng-switch on="status"><p ng-switch-when="new">N</p><p ng-switch-default>D</p></div>`);
  assert.match(out, /\(status\) === \("new"\)/, "the case value is a string, because ng-switch-when takes a label");
  assert.match(out, /!\(\(status\) === \("new"\)\)/);
});

test("a checkbox model binds checked, not value", () => {
  const out = flat(`<input type="checkbox" ng-model="agreed">`);
  assert.match(out, /checked=\{agreed\}/);
  assert.match(out, /setAgreed\(event\.target\.checked\)/);
  assert.doesNotMatch(out, /value=\{agreed\}/);
});

test("a radio model compares against its own value and sets it back", () => {
  const out = flat(`<input type="radio" ng-model="mode" value="fast">`);
  assert.match(out, /checked=\{mode === "fast"\}/);
  assert.match(out, /setMode\("fast"\)/);
});

test("a radio without a value wires the setter and names the gap", () => {
  const result = translate(`<input type="radio" ng-model="mode">`, { indent: 0 });
  assert.doesNotMatch(result.jsx, /checked=/);
  assert.ok(result.notes.some((n) => n.includes("no value attribute")));
});

test("the svelte printer spells the three input shapes apart", () => {
  assert.match(toSvelte(`<input type="checkbox" v-model="agreed">`).markup, /bind:checked=\{agreed\}/);
  assert.match(toSvelte(`<input type="radio" v-model="mode" value="fast">`).markup, /bind:group=\{mode\}/);
});

test("filters with an exact JS spelling are rewritten, the rest stay named", () => {
  const result = translate(`<p>{{ name | uppercase }}</p><p>{{ tag | lowercase | slice:0:2 }}</p><p>{{ total | currency }}</p>`, { indent: 0 });
  assert.match(result.jsx, /String\(name\)\.toUpperCase\(\)/);
  assert.match(result.jsx, /\(String\(tag\)\.toLowerCase\(\)\)\.slice\(0, 2\)/);
  assert.match(result.jsx, /\{total\}/, "currency passes through unformatted");
  assert.ok(result.notes.some((n) => n.includes("`currency` filter")));
});

test("limitTo is AngularJS spelling for slice from the front", () => {
  const out = flat(`<p>{{ items | limitTo:3 }}</p>`);
  assert.match(out, /\(items\)\.slice\(0, 3\)/);
});
