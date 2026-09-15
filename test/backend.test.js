import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { inferBackendEntities, resourceKey } from "../plugins/output-backend/entities.js";
import { placeholder } from "../plugins/output-fixtures/index.js";
import { runPipeline } from "./helpers.js";

/**
 * The other half of full stack: output-backend infers real CRUD routes from
 * the calls the legacy app actually made and wires them to an embedded
 * store, so `--site --backend true` produces a server that really persists
 * a write rather than echoing the same fixture forever. Building this
 * honestly (a real pipeline run, a real HTTP server, real requests) surfaced
 * two real defects in dsp-apimap that predate this plugin and are fixed
 * alongside it: a list route and its own item route (GET /x and GET /x/:id)
 * named identically and silently overwrote one another in the endpoints
 * map, and a call's `${id}`-style path reached src/api/endpoints.js
 * untemplated, which serve.js's `:id`-only matcher can never match.
 */

/** A small Angular-shaped fixture with a clean collection and item pair, one action route with no id, and one read only nested path. */
async function backendFixture() {
  const dir = await mkdtemp(join(tmpdir(), "portamp-backend-"));
  await writeFile(join(dir, "index.html"), `<!doctype html><html><head><title>Orders</title></head><body><h1>Orders</h1><a href="/about.html">About</a></body></html>`);
  await writeFile(join(dir, "about.html"), `<!doctype html><html><head><title>About</title></head><body><h1>About</h1><a href="/index.html">Home</a></body></html>`);
  await mkdir(join(dir, "src/app"), { recursive: true });
  await writeFile(
    join(dir, "src/app/orders.service.ts"),
    `import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  constructor(private http: HttpClient) {}
  list() { return this.http.get('/api/orders'); }
  create(body: any) { return this.http.post('/api/orders', body); }
  getOne(id: string) { return this.http.get(\`/api/orders/\${id}\`); }
  update(id: string, body: any) { return this.http.put(\`/api/orders/\${id}\`, body); }
  remove(id: string) { return this.http.delete(\`/api/orders/\${id}\`); }
  cancel() { return this.http.delete('/api/orders/cancel'); }
  history() { return this.http.get('/api/v1/accounts/orders'); }
}
`
  );
  return dir;
}

/* --------------------------------------------------------- entities.js: pure inference */

test("resourceKey groups a collection and its item under one key, regardless of the path's own param spelling", () => {
  assert.equal(resourceKey("/api/orders"), "api/orders");
  assert.equal(resourceKey("/api/orders/:id"), "api/orders");
  assert.equal(resourceKey("/api/orders/${id}"), "api/orders");
});

test("a collection and its item route wire to one entity, with only the verbs the app actually calls", () => {
  const ctx = {
    api: {
      calls: [
        { method: "GET", path: "/api/orders", file: "a" },
        { method: "POST", path: "/api/orders", file: "a" },
        { method: "GET", path: "/api/orders/:id", file: "a" },
        { method: "PUT", path: "/api/orders/:id", file: "a" },
        { method: "DELETE", path: "/api/orders/:id", file: "a" },
      ],
    },
    model: { endpoints: [{ method: "POST", path: "/api/orders", observedBody: { total: "number", customer: "string" } }] },
  };
  const { entities, skipped } = inferBackendEntities(ctx);
  assert.equal(entities.length, 1);
  const [order] = entities;
  assert.equal(order.name, "order");
  assert.deepEqual(
    order.verbs.map((v) => v.op).sort(),
    ["create", "get", "list", "remove", "update"]
  );
  assert.equal(order.shapeSource, "an observed POST /api/orders");
  assert.deepEqual(order.seed, { id: 1, total: placeholder("number", "total"), customer: placeholder("string", "customer") });
  assert.deepEqual(skipped, []);
});

test("an action route with no id and a read only collection are named and left out, never forced into a shape they do not have", () => {
  const ctx = {
    api: {
      calls: [
        { method: "GET", path: "/api/v1/accounts/orders", file: "a" },
        { method: "DELETE", path: "/api/v1/orders/cancel", file: "a" },
      ],
    },
  };
  const { entities, skipped } = inferBackendEntities(ctx);
  assert.deepEqual(entities, []);
  assert.deepEqual(skipped.map((s) => s.path).sort(), ["/api/v1/accounts/orders", "/api/v1/orders/cancel"]);
  assert.match(skipped.find((s) => s.path === "/api/v1/accounts/orders").reason, /already served by fixtures/);
  assert.match(skipped.find((s) => s.path === "/api/v1/orders/cancel").reason, /action route/);
});

test("with no observed shape at all, an entity still wires, seeded with only an id", () => {
  const ctx = { api: { calls: [{ method: "POST", path: "/api/widgets", file: "a" }] } };
  const { entities } = inferBackendEntities(ctx);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].shapeSource, null);
  assert.deepEqual(entities[0].seed, { id: 1 });
});

/* --------------------------------------------------------- dsp-apimap: the two defects this surfaced */

test("a list route and its own item route no longer collide: each gets its own name in the endpoint map", async (t) => {
  const dir = await backendFixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = await runPipeline({ src: dir, site: true });
  t.after(run.cleanup);
  assert.equal(run.error, null);
  const endpointsSrc = await readFile(join(run.out, "src/api/endpoints.js"), "utf8");
  assert.match(endpointsSrc, /getApiOrders:/, "the list route keeps its own name");
  assert.match(endpointsSrc, /getApiOrdersById:/, "the item route gets a name of its own rather than overwriting the list's");
  // Every name is distinct: JS object literal syntax means a repeated key would parse fine and silently drop data, so this is checked by counting occurrences, not just by presence.
  const names = [...endpointsSrc.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(names, [...new Set(names)], "no two calls named the same thing");
});

test("a call's own template literal path is templated to :id before it reaches the endpoint map, matching serve.js's own matcher", async (t) => {
  const dir = await backendFixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = await runPipeline({ src: dir, site: true });
  t.after(run.cleanup);
  const endpointsSrc = await readFile(join(run.out, "src/api/endpoints.js"), "utf8");
  assert.doesNotMatch(endpointsSrc, /\$\{/, "no raw template literal syntax survives into the endpoint map");
  assert.match(endpointsSrc, /"\/api\/orders\/:id"/);
});

/* --------------------------------------------------------- output-backend: end to end, over real http */

let run;
test.before(async () => {
  const dir = await backendFixture();
  run = await runPipeline({ src: dir, site: true, backend: true });
  run.fixtureDir = dir;
  assert.equal(run.error, null);
});
test.after(async () => {
  await run?.cleanup();
  if (run?.fixtureDir) await rm(run.fixtureDir, { recursive: true, force: true });
});

test("--backend true wires the collection+item pair to a real store, and reports what it left out and why", async () => {
  const report = await readFile(join(run.out, "BACKEND.md"), "utf8");
  assert.match(report, /^# The generated backend\n/);
  assert.match(report, /### order/);
  assert.match(report, /already served by fixtures/);
  assert.match(report, /action route/);
  assert.match(report, /ambiguous with the action route/, "DELETE /api/orders/:id collides with DELETE /api/orders/cancel, and is named rather than silently misrouted");

  const manifest = JSON.parse(await readFile(join(run.out, "portamp.backend.json"), "utf8"));
  assert.equal(manifest.entities.length, 1);
  assert.equal(manifest.entities[0].name, "order");
  assert.deepEqual(manifest.entities[0].verbs.map((v) => v.op).sort(), ["create", "get", "list", "update"], "remove was pulled back out, ambiguous with the cancel action route");
  assert.equal(manifest.skipped.length, 3, "the read only nested path, the cancel action route, and the ambiguous remove");
});

test("a create really creates a row: list, create, list again, get, update, over real http", async () => {
  const { handler } = await import(pathToFileURL(join(run.out, "serve.js")).href);
  const server = createServer(handler());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const seeded = await (await fetch(`${base}/api/orders`)).json();
    assert.deepEqual(seeded, [{ id: 1 }], "a fresh checkout still has the seeded row to list before any write");

    const createRes = await fetch(`${base}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ total: 42, customer: "Ada" }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.total, 42);
    assert.ok(created.id, "a real id was assigned");

    const afterCreate = await (await fetch(`${base}/api/orders`)).json();
    assert.equal(afterCreate.length, 2, "the list a moment later sees the row the create just wrote");

    const got = await (await fetch(`${base}/api/orders/${created.id}`)).json();
    assert.deepEqual(got, created);

    const updateRes = await fetch(`${base}/api/orders/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ total: 99 }),
    });
    assert.equal(updateRes.status, 200);
    assert.equal((await updateRes.json()).total, 99);

    const missing = await fetch(`${base}/api/orders/999999`);
    assert.equal(missing.status, 404, "a real 404 for an id that never existed");
  } finally {
    server.close();
  }
});

test("an action route with no id, and the item delete ambiguous with it, both fall through to the honest 501", async () => {
  const { handler } = await import(pathToFileURL(join(run.out, "serve.js")).href);
  const server = createServer(handler());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const before = await (await fetch(`${base}/api/orders`)).json();

    const cancel = await fetch(`${base}/api/orders/cancel`, { method: "DELETE" });
    assert.equal(cancel.status, 501);
    assert.match((await cancel.json()).see, /src\/api\/endpoints\.js/);

    // The same address a real delete would use, on the entity the backend
    // otherwise wires: refused, not misrouted into deleting nothing and
    // answering as if a row named "1" had been removed.
    const deleteById = await fetch(`${base}/api/orders/1`, { method: "DELETE" });
    assert.equal(deleteById.status, 501, "remove was pulled back out as ambiguous, so this still 501s rather than silently succeeding on the wrong id");

    // A prior test in this same run already created and updated its own row,
    // so the list is not asserted to be exactly the seed here, only that
    // neither 501'd delete above removed anything: the seeded row (id 1)
    // survives untouched and the row count did not shrink.
    const stillThere = await (await fetch(`${base}/api/orders`)).json();
    assert.deepEqual(stillThere.find((r) => r.id === 1), { id: 1 }, "the seeded row was never touched");
    assert.equal(stillThere.length, before.length, "neither 501'd delete removed a row");
  } finally {
    server.close();
  }
});

test("real persistence: a write survives the server process restarting", async () => {
  const boot = async () => {
    const mod = await import(pathToFileURL(join(run.out, "serve.js")).href + `?t=${Math.random()}`);
    const server = createServer(mod.handler());
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    return server;
  };

  let server = await boot();
  let base = `http://127.0.0.1:${server.address().port}`;
  const created = await (
    await fetch(`${base}/api/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ total: 7 }) })
  ).json();
  server.close();

  server = await boot();
  base = `http://127.0.0.1:${server.address().port}`;
  const row = await (await fetch(`${base}/api/orders/${created.id}`)).json();
  assert.equal(row.total, 7, "the row a previous process wrote is still there after a fresh process starts");
  server.close();
});

/* --------------------------------------------------------- the plugin's own gates */

test("--backend true without --site true is refused by name rather than silently doing nothing", async (t) => {
  const dir = await backendFixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const r = await runPipeline({ src: dir, backend: true });
  t.after(r.cleanup);
  assert.equal(r.error, null);
  assert.ok(!r.ctx.written.includes("server/backend.js"));
  assert.ok(r.ctx.report.unverified.some((u) => /needs --site true/.test(u)));
});

test("--backend true with no API calls at all names the gap rather than writing an empty scaffold", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-backend-empty-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "index.html"), `<!doctype html><html><head><title>Plain</title></head><body><h1>Plain</h1></body></html>`);
  const r = await runPipeline({ src: dir, site: true, backend: true });
  t.after(r.cleanup);
  assert.equal(r.error, null);
  assert.ok(!r.ctx.written.includes("server/backend.js"));
  assert.ok(r.ctx.report.unverified.some((u) => /no API calls were read/.test(u)));
});
