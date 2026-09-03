import assert from "node:assert/strict";
import test from "node:test";

import { DIALECTS, buildIr } from "../plugins/dsp-ir/ir.js";
import { translate } from "../plugins/output-react/template.js";
import { toVue } from "../plugins/output-vue/print.js";
import { toSvelte } from "../plugins/output-svelte/print.js";
import { expand, expandContainerless } from "../plugins/input-knockout/expand.js";

const react = (html, dialect) =>
  translate(html, { indent: 0, dialect: dialect ? DIALECTS[dialect] : undefined });
const flat = (html, dialect) => react(html, dialect).jsx.replace(/\s+/g, " ").trim();

test("an else reference resolves to the ng-template it names", () => {
  const out = react(
    `<div *ngIf="ready; else waiting">done</div><ng-template #waiting><p>hold on</p></ng-template>`,
    "angular",
  );
  assert.match(out.jsx.replace(/\s+/g, " "), /\{ready && \( <div> done <\/div> \)\}/);
  assert.match(out.jsx.replace(/\s+/g, " "), /\{!\(ready\) && \( <p> hold on <\/p> \)\}/);
});

test("an else reference with no template stays a note, never a guess", () => {
  const out = react(`<div *ngIf="ready; else waiting">done</div>`, "angular");
  assert.ok(out.notes.some((n) => n.includes("else waiting") && n.includes("no <ng-template #waiting>")));
});

test("the (key, value) repeat maps over Object.entries in react and pairs in vue", () => {
  const src = `<li ng-repeat="(code, label) in statuses">{{code}}: {{label}}</li>`;
  assert.match(flat(src, "angularjs"), /Object\.entries\(statuses\)\.map\(\(\[code, label\]\)/);
  const vue = toVue(src, { dialect: DIALECTS.angularjs }).markup;
  assert.match(vue, /v-for="\(label, code\) in statuses"/);
});

test("ng-options becomes the option loop it always was", () => {
  const out = flat(`<select ng-model="picked" ng-options="c.id as c.name for c in customers"></select>`, "angularjs");
  assert.match(out, /customers\.map\(\(c\)/);
  assert.match(out, /<option[^>]* value=\{c\.id\}/);
  assert.match(out, /\{c\.name\}/);
});

test("an ng-if on an ng-repeat row tests each row, inside the loop", () => {
  const out = flat(`<li ng-repeat="o in orders track by o.id" ng-if="o.active">{{o.name}}</li>`, "angularjs");
  assert.match(out, /orders\.map\(\(o\) => o\.active && \(/, "the condition sees the row the loop defines");
});

test("knockout containerless comments become the containers they implied", () => {
  const notes = [];
  const out = expandContainerless(
    `<ul><!-- ko foreach: orders --><li data-bind="text: $data.name"></li><!-- /ko --></ul><!-- ko if: ready --><p>done</p><!-- /ko -->`,
    (n) => notes.push(n),
  );
  assert.match(out, /<ng-container ko-foreach="item in orders">/);
  assert.match(out, /<ng-container ko-if="ready">/);
  assert.match(out, /item\.name/, "$data is rewritten to the row the loop names");
  assert.ok(notes.some((n) => n.includes("bare name")), "the rescoping gap is named");
  const jsx = flat(expand(out), "knockout");
  assert.match(jsx, /orders\.map\(\(item\)/);
});

test("v-for over a number spells the range out, counting from one", () => {
  const out = flat(`<li v-for="n in 5">{{n}}</li>`, "vue");
  assert.match(out, /Array\.from\(\{ length: 5 \}, \(_, i\) => i \+ 1\)\.map\(\(n\)/);
});

test("event modifiers become the statements they stand for", () => {
  const out = flat(
    `<form @submit.prevent="save()"><input @keyup.enter="go()" /><div @click.self="pick()"></div></form>`,
    "vue",
  );
  assert.match(out, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); save\(\); \}\}/);
  assert.match(out, /if \(event\.key !== "Enter"\) return; go\(\);/);
  assert.match(out, /if \(event\.target !== event\.currentTarget\) return; pick\(\);/);
});

test("modifiers ride the event name unchanged where the target keeps the spelling", () => {
  const vue = toVue(`<input @keyup.enter.prevent="go()" />`, { dialect: DIALECTS.vue }).markup;
  assert.match(vue, /@keyup\.enter\.prevent="go\(\)"/);
});

test("a modifier with no equivalent runs unguarded and says so", () => {
  const out = react(`<button @click.once="fire()">once</button>`, "vue");
  assert.match(out.jsx, /onClick=/);
  assert.ok(out.notes.some((n) => n.includes(".once") && n.includes("no equivalent")));
});

test("text directives replace the element's content, as they did at runtime", () => {
  assert.match(flat(`<span ng-bind="total"></span>`, "angularjs"), /<span> \{total\} <\/span>/);
  assert.match(flat(`<span ng-bind-template="{{first}} {{last}}"></span>`, "angularjs"), /\{first\} \{last\}/);
  assert.match(flat(`<span v-text="total"></span>`, "vue"), /<span> \{total\} <\/span>/);
});

test("a named slot is a second insertion point and its children the fallback", () => {
  const out = react(`<slot name="header"><h1>Untitled</h1></slot><slot></slot>`, "vue");
  const jsx = out.jsx.replace(/\s+/g, " ");
  assert.match(jsx, /\{header \?\? \( <> <h1> Untitled <\/h1> <\/> \)\}/);
  assert.match(jsx, /\{children\}/);
  assert.ok(out.reads.includes("header"), "the named slot arrives as a prop");
  const svelte = toSvelte(`<slot name="header"><h1>Hi</h1></slot>`, { dialect: DIALECTS.vue }).markup;
  assert.match(svelte.replace(/\s+/g, " "), /<slot name="header"> <h1> Hi <\/h1> <\/slot>/);
});

test("v-pre keeps its subtree as written, mustaches included", () => {
  const out = react(`<code v-pre>{{ raw }}</code>`, "vue");
  assert.doesNotMatch(out.jsx, /\{ raw \}/, "the braces are text, not an expression");
  assert.ok(!out.reads.includes("raw"), "nothing inside it is read as code");
});

test("v-once keeps rendering and names what was lost", () => {
  const out = react(`<h1 v-once>{{title}}</h1>`, "vue");
  assert.match(out.jsx, /\{title\}/);
  assert.ok(out.notes.some((n) => n.includes("rendered once")));
});

test("the boolean directives each drive their flag", () => {
  assert.match(flat(`<input type="checkbox" ng-checked="isOn" />`, "angularjs"), /checked=\{isOn\}/);
  assert.match(flat(`<option ng-selected="row.pick">x</option>`, "angularjs"), /selected=\{row\.pick\}/);
  assert.match(flat(`<input ng-readonly="locked" />`, "angularjs"), /readOnly=\{locked\}/);
});

test("a dynamic component renders the expression, not a guess at its name", () => {
  const jsx = flat(`<component :is="widget" :data="row"></component>`, "vue");
  assert.match(jsx, /const Dyn = widget/);
  assert.match(jsx, /<Dyn data=\{row\}/);
  const svelte = toSvelte(`<component :is="widget"></component>`, { dialect: DIALECTS.vue }).markup;
  assert.match(svelte, /<svelte:component this=\{widget\}/);
  const vue = toVue(`<component :is="widget"></component>`, { dialect: DIALECTS.vue }).markup;
  assert.match(vue, /<component :is="widget">/);
});

test("the harvested template and the range survive the trip through the IR", () => {
  const ir = buildIr(`<ng-template #empty><p>none</p></ng-template><div *ngIf="ok; else empty">x</div>`, {
    dialect: DIALECTS.angular,
  });
  const printed = JSON.stringify(ir.root);
  assert.ok(printed.includes("none"), "the template body is in the tree");
  assert.ok(!printed.includes("ng-template"), "the template element itself is gone");
});
