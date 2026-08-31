import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { flatten, readRoutes } from "../plugins/dsp-routes/parse.js";
import { propose } from "../plugins/dsp-boundaries/index.js";
import { readScript, declaredFunctions } from "../plugins/input-jquery/index.js";
import { balanced, topLevelBlocks } from "../plugins/dsp-ir/scan.js";
import { runPipeline } from "./helpers.js";

const ROOT = process.cwd();

/* --------------------------------------------------------- the scanner */

test("a brace inside a string does not end a block", () => {
  assert.equal(balanced(`{ a: "}" , b: 1 }`, 0), `{ a: "}" , b: 1 }`);
  assert.equal(balanced("{ a: { b: 2 } }", 0), "{ a: { b: 2 } }");
  assert.equal(balanced("{ never closes", 0), null);
});

test("top level blocks exclude the nested ones", () => {
  assert.deepEqual(topLevelBlocks(`{a:1}, {b:{c:2}}`, "{"), ["{a:1}", "{b:{c:2}}"]);
});

/* ---------------------------------------------------------- dsp-routes */

test("an Angular route table is read, children joined the way the router joins them", () => {
  const routes = flatten(readRoutes(`
    const routes: Routes = [
      { path: "", redirectTo: "orders", pathMatch: "full" },
      { path: "orders", component: OrdersComponent, children: [
        { path: ":id", component: OrderDetailComponent },
      ]},
      { path: "admin", loadChildren: () => import("./admin.module").then(m => m.AdminModule) },
    ];
    RouterModule.forRoot(routes);
  `, "routing.ts"));

  assert.deepEqual(routes.map((r) => r.fullPath), ["/", "/orders", "/orders/:id", "/admin"]);
  assert.equal(routes[0].redirectTo, "orders");
  assert.equal(routes[2].component, "OrderDetailComponent", "the child kept its own component");
  assert.equal(routes[1].component, "OrdersComponent", "and did not answer for the parent");
  assert.equal(routes[3].lazy, true);
});

test("a Vue route table reads through the same parser", () => {
  const routes = flatten(readRoutes(`
    export const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", redirect: "/orders" },
        { path: "/orders", component: OrdersPanel },
        { path: "/orders/:id", component: () => import("./OrderDetail.vue") },
      ],
    });
  `, "router.js"));
  assert.deepEqual(routes.map((r) => r.fullPath), ["/", "/orders", "/orders/:id"]);
  assert.equal(routes[2].lazy, true, "a component that is an import() is lazy");
});

test("a file with no route table yields nothing rather than noise", () => {
  assert.deepEqual(readRoutes(`const x = [{ notAPath: 1 }];`, "a.ts"), []);
});

test("the example's route resolves to the screen the run actually read", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline();
  t.after(cleanup);
  assert.equal(error, null);

  const orders = ctx.routes.table.find((r) => r.fullPath === "/orders");
  assert.equal(orders.screen, "app-orders", "OrdersComponent matched by class name");

  const report = await readFile(join(out, "ROUTES.md"), "utf8");
  assert.match(report, /`<app-orders>`, in this run/);
  assert.match(report, /lazy/);
});

/* ------------------------------------------------------ dsp-boundaries */

test("selectors touched by the same handler cluster together", () => {
  const { widgets, edges } = readScript(`
    $("#refresh").on("click", function () { $("#rows").html(x); $("#count").text(n); });
    $("#other").on("click", function () { beep(); });
  `, "app.js");
  const proposals = propose(widgets, edges);
  const rows = proposals.find((p) => p.members.includes("#rows"));
  assert.deepEqual(rows.members, ["#count", "#refresh", "#rows"]);
  assert.ok(!rows.members.includes("#other"), "an unconnected selector stays out");
});

// The signal this guards: the handler that only says load() has still drawn a
// boundary, one call away, which is where jQuery apps keep the actual work.
test("a boundary is found through a named function, and through two", () => {
  const functions = declaredFunctions(`
    function render(rows) { $("#rows").html(rows); $("#count").text(rows.length); }
    function load() { $.get("/api/x", render); render([]); }
  `);
  assert.ok(functions.get("load").selectors.includes("#rows"), "load reaches what render touches");

  const { widgets, edges } = readScript(`
    function render(rows) { $("#rows").html(rows); }
    function load() { render([]); }
    $("#refresh").on("click", function () { load(); });
  `, "app.js");
  const proposals = propose(widgets, edges);
  const cluster = proposals.find((p) => p.members.includes("#refresh"));
  assert.ok(cluster.members.includes("#rows"), "two hops still land in one cluster");
});

test("a pair of mutually recursive functions does not spin", () => {
  const functions = declaredFunctions(`
    function a() { b(); $("#x").text(1); }
    function b() { a(); $("#y").text(2); }
  `);
  assert.ok(functions.get("a").selectors.includes("#y"));
  assert.ok(functions.get("b").selectors.includes("#x"));
});

test("the cluster is named for what it renders, not for a control in it", () => {
  const { widgets, edges } = readScript(`
    $("#q").on("change", function () { $("#q").val(); $("#rows").html(x); });
  `, "app.js");
  const [proposal] = propose(widgets, edges);
  assert.equal(proposal.name, "Rows");
});

/* -------------------------------------------------- end to end, jQuery */

test("a jQuery app produces an inventory, proposals, a reading and a plan", async (t) => {
  const { ctx, out, error, cleanup } = await runPipeline({ src: join(ROOT, "example/legacy-jquery") });
  t.after(cleanup);
  assert.equal(error, null);

  assert.equal(ctx.archetype.best.id, "selector-soup");
  assert.ok(ctx.boundaries.length >= 2);
  assert.ok(ctx.boundaries.every((p) => p.connected), "every singleton was absorbed by an edge");

  const boundaries = await readFile(join(out, "BOUNDARIES.md"), "utf8");
  assert.match(boundaries, /proposals and not results/);
  assert.match(boundaries, /Nothing here is a component until a person says it is/);

  const plan = await readFile(join(out, "MODERNIZATION.md"), "utf8");
  assert.match(plan, /Decide the components before writing any of them/);

  assert.ok(ctx.routes.hashRouting, "the hand rolled hash routing was noticed");
  assert.deepEqual(
    ctx.api.calls.map((c) => `${c.method} ${c.path}`).sort(),
    ["GET /api/v1/orders", "POST /api/v1/orders"]
  );
});

test("no component is emitted from a proposal", async (t) => {
  const { ctx, cleanup } = await runPipeline({ src: join(ROOT, "example/legacy-jquery") });
  t.after(cleanup);
  assert.equal(ctx.screens.length, 0, "a proposal is not a screen");
  assert.ok(!ctx.written.some((f) => /src\/features\//.test(f)), "and nothing was built from one");
});
