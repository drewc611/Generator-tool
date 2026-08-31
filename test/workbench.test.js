import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fold } from "../plugins/vis-equivalence/index.js";
import { readPage as readJsf } from "../plugins/input-jsf/index.js";
import { readPage as readAspnet } from "../plugins/input-aspnet/index.js";
import { recogniseWidgets } from "../plugins/input-jquery/index.js";
import { classify } from "../plugins/dsp-archetype/classify.js";
import { shapeOf } from "../plugins/dsp-archetype/shape.js";
import { buildIr } from "../plugins/dsp-ir/ir.js";
import { runPipeline } from "./helpers.js";

const ROOT = process.cwd();

/* -------------------------------------------------------- vis-equivalence */

test("a playwright result folds into a verdict, failures first class", () => {
  const verdict = fold({
    suites: [{
      suites: [{ specs: [
        { title: "clicking Create order does what it did", tests: [{ results: [{ status: "passed" }] }] },
        { title: "the filter narrows the list", tests: [{ results: [{ status: "failed", error: { message: "expected 2 rows\ngot 5" } }] }] },
      ]}],
      specs: [{ title: "the page loads", tests: [{ results: [{ status: "passed" }] }] }],
    }],
  });
  assert.equal(verdict.total, 3);
  assert.equal(verdict.passed, 2);
  assert.equal(verdict.failures[0].error, "expected 2 rows");
});

test("no port url means the suite deliberately does not run", async (t) => {
  const { ctx, cleanup } = await runPipeline({ src: join(ROOT, "example/nosource"), shots: join(ROOT, "test/fixtures/explored") });
  t.after(cleanup);
  assert.ok(!ctx.written.includes("EQUIVALENCE.md"));
});

/* ------------------------------------------------------- the two readers */

test("a facelets page inventories its bindings and names its bean", () => {
  const { bindings, forms } = readJsf(`<h:form><h:dataTable value="#{orderBean.orders}"/><h:commandButton action="#{orderBean.search}"/></h:form>`, "a.xhtml");
  assert.deepEqual(bindings.map((b) => b.bean), ["orderBean", "orderBean"]);
  assert.equal(forms, 1);
});

test("a WebForms page inventories controls, handlers and postbacks", () => {
  const { controls, postbacks, viewState } = readAspnet(`<asp:GridView ID="gv" OnRowCommand="gv_Row" /><asp:TextBox AutoPostBack="true" />`, "a.aspx");
  assert.equal(controls[0].handler, "RowCommand → gv_Row");
  assert.equal(postbacks, 1);
  assert.match(viewState, /on/);
});

/* ---------------------------------------------------- widget recognition */

test("a datepicker is a fact; the replacement is a proposal", () => {
  const found = recogniseWidgets(`$("#when").datepicker({}); $("#grid").dataTable();`);
  assert.equal(found.length, 2);
  assert.match(found[0].instead, /input type="date"/);
  assert.match(found[1].instead, /unbounded fetch/);
});

/* ------------------------------------------------------- more archetypes */

test("a board of cards reads as kanban, a message stream as chat", () => {
  const board = `<div><div *ngFor="let col of lanes"><h3>{{col.name}}</h3><div *ngFor="let card of col.cards">{{card.title}}</div></div><p>Drag a card to another column</p></div>`;
  const chat = `<div><ul><li *ngFor="let m of messages">{{m.text}}</li></ul><form><input [(ngModel)]="draft" placeholder="Message"><button type="submit">Send</button></form></div>`;
  assert.equal(classify({ shape: shapeOf(buildIr(board)), calls: [{ method: "POST", path: "/api/cards/move" }, { method: "GET", path: "/api/board" }] }).best.id, "kanban");
  assert.equal(classify({ shape: shapeOf(buildIr(chat)), calls: [{ method: "POST", path: "/api/messages" }, { method: "GET", path: "/api/messages" }] }).best.id, "chat");
});

/* --------------------------------------------------- timeline and coverage */

test("the timeline generalises what it replays: rows, ids, complaints only", async (t) => {
  const { out, cleanup } = await runPipeline({ src: join(ROOT, "example/nosource"), shots: join(ROOT, "test/fixtures/explored") });
  t.after(cleanup);
  const timeline = await readFile(join(out, "TIMELINE.md"), "utf8");
  assert.match(timeline, /click a row/);
  assert.match(timeline, /\/api\/v1\/orders\/:id/, "the record id is masked, the version is not");
  assert.doesNotMatch(timeline, /Northwind|Contoso|A-\d{4}/, "no captured record survives");
});

test("coverage counts what exists, not what is intended", async (t) => {
  const { ctx, out, cleanup } = await runPipeline({ src: join(ROOT, "example/nosource"), shots: join(ROOT, "test/fixtures/explored") });
  t.after(cleanup);
  assert.ok(ctx.coverage.ported >= 0 && ctx.coverage.ported <= 100);
  const coverage = await readFile(join(out, "COVERAGE.md"), "utf8");
  assert.match(coverage, /not omniscient about what exists/);
});
