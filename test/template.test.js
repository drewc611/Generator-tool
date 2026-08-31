import assert from "node:assert/strict";
import test from "node:test";

import { translate, parse } from "../plugins/output-react/template.js";

const jsx = (html) => translate(html, { indent: 0 }).jsx;
const flat = (html) => jsx(html).replace(/\s+/g, " ").trim();

test("the parser survives markup a real template contains", () => {
  const nodes = parse(`<div class="a"><img src="x"><br>text<!-- c --></div><p>tail`);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].tag, "div");
  assert.deepEqual(nodes[0].children.map((c) => c.type), ["element", "element", "text", "comment"]);
  assert.equal(nodes[1].tag, "p", "an unclosed tag does not swallow the document");
});

test("interpolation becomes an expression and literal braces survive", () => {
  assert.match(flat(`<p>Hello {{ name }}</p>`), /<p> Hello \{name\} <\/p>/);
  assert.match(flat(`<p>a {literal} b</p>`), /\{"\{"\}literal\{"\}"\}/);
});

test("ngIf becomes a guard", () => {
  assert.match(flat(`<div *ngIf="loading">L</div>`), /^\{loading && \( <div> L <\/div> \)\}$/);
});

test("ngFor becomes a map with a key", () => {
  const out = flat(`<li *ngFor="let o of orders">{{o.id}}</li>`);
  assert.match(out, /orders\.map\(\(o\) => \(/);
  assert.match(out, /<li key=\{o\.id \?\? o\}>/);
});

test("ngFor index and trackBy are used for the key when they are there", () => {
  assert.match(flat(`<li *ngFor="let o of xs; index as i">a</li>`), /xs\.map\(\(o, i\) => \( <li key=\{i\}>/);
  assert.match(flat(`<li *ngFor="let o of xs; trackBy: byId">a</li>`), /key=\{byId\(0, o\)\}/);
});

test("property, attribute and event bindings map to their React spelling", () => {
  assert.match(flat(`<img [src]="u" alt="a">`), /<img src=\{u\} alt="a" \/>/);
  assert.match(flat(`<div [attr.aria-label]="l"></div>`), /aria-label=\{l\}/);
  assert.match(flat(`<button (click)="go()">x</button>`), /onClick=\{\(\) => go\(\)\}/);
  assert.match(flat(`<button (click)="go($event)">x</button>`), /onClick=\{\(event\) => go\(event\)\}/);
});

test("class and for take their React names", () => {
  assert.match(flat(`<label class="a" for="q">x</label>`), /className="a" htmlFor="q"/);
});

test("two way binding becomes a controlled input and reports the state it needs", () => {
  const r = translate(`<input [(ngModel)]="query">`, { indent: 0 });
  assert.match(r.jsx, /value=\{query\} onChange=\{\(event\) => setQuery\(event\.target\.value\)\}/);
  assert.deepEqual(r.models, ["query"]);
});

// The bug this guards: two className attributes on one element, where React
// silently keeps the last and the static classes vanish.
test("every source of a class merges into one className", () => {
  const out = flat(`<div class="card" [class.busy]="loading" [ngClass]="{ late: o.late }"></div>`);
  assert.equal((out.match(/className/g) || []).length, 1, "exactly one className");
  assert.match(out, /\["card", loading && "busy", o\.late && "late"\]\.filter\(Boolean\)\.join\(" "\)/);
});

test("a conditional class never renders the word false", () => {
  const out = flat(`<div [class.busy]="loading"></div>`);
  assert.match(out, /\.filter\(Boolean\)/, "a falsy branch must drop out, not stringify");
});

test("ngClass that is not an object literal is passed through and reported", () => {
  const r = translate(`<div [ngClass]="classes"></div>`, { indent: 0 });
  assert.match(r.jsx, /className=\{classes\}/);
  assert.ok(r.notes.some((n) => /not an object literal/.test(n)));
});

test("static and bound styles merge into one style prop", () => {
  const out = flat(`<p style="color: red; font-size: 12px" [style.width.px]="w"></p>`);
  assert.equal((out.match(/style=/g) || []).length, 1);
  assert.match(out, /color: "red", fontSize: "12px", width: `\$\{w\}px`/);
});

test("ng-container and ng-template disappear, ng-content becomes children", () => {
  assert.match(flat(`<ng-container *ngIf="e"><b>x</b></ng-container>`), /\{e && \( <b> x <\/b> \)\}/);
  assert.match(flat(`<ng-content></ng-content>`), /\{children\}/);
});

test("a pipe is not invented, it is reported", () => {
  const r = translate(`<p>{{ total | currency }}</p>`, { indent: 0 });
  assert.match(r.jsx, /\{total\}/);
  assert.ok(r.notes.some((n) => /currency/.test(n) && /no direct equivalent/.test(n)));
});

test("a pipe character inside a string is not a pipe", () => {
  const r = translate(`<p>{{ a || "x|y" }}</p>`, { indent: 0 });
  assert.match(r.jsx, /\{a \|\| "x\|y"\}/);
  assert.equal(r.notes.length, 0);
});

test("an else branch is kept visible rather than dropped", () => {
  const r = translate(`<div *ngIf="a; else other">x</div>`, { indent: 0 });
  assert.match(r.jsx, /\{a &&/);
  assert.ok(r.notes.some((n) => /else other/.test(n)));
});

test("the identifiers a template reads are reported, loop variables are not", () => {
  const r = translate(`<li *ngFor="let o of orders">{{o.id}} {{ region }}</li>`, { indent: 0 });
  assert.deepEqual(r.reads, ["orders", "region"]);
  assert.deepEqual(r.collections, ["orders"]);
});

test("an empty template is a fragment, not a crash", () => {
  assert.equal(jsx(""), "<></>");
  assert.equal(jsx("   "), "<></>");
});

test("several roots are wrapped in one fragment", () => {
  assert.match(flat(`<p>a</p><p>b</p>`), /^<> <p> a <\/p> <p> b <\/p> <\/>$/);
});
