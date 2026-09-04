import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";

import { buildIr } from "../plugins/dsp-ir/ir.js";
import { translate } from "../plugins/output-react/template.js";
import { toVue } from "../plugins/output-vue/print.js";
import { toSvelte } from "../plugins/output-svelte/print.js";
import { toHtml } from "../plugins/output-html/print.js";
import { toAngular } from "../plugins/output-angular/print.js";
import { toLit } from "../plugins/output-lit/index.js";
import { toSolid } from "../plugins/output-solid/index.js";
import { toAlpine } from "../plugins/output-alpine/index.js";
import { readRoutes } from "../plugins/dsp-routes/parse.js";
import { readRaces } from "../plugins/dsp-behavior/index.js";
import { authFlow } from "../plugins/dsp-auth/index.js";
import improve from "../plugins/dsp-improve/index.js";
import { Kernel } from "../src/core/kernel.js";
import { ROOT, BUILTIN, runPipeline, quietLogger } from "./helpers.js";

const exec = promisify(execFile);

/**
 * 3.0, the exact read: the grammar carries positions and every note says its
 * line; slots hold across the targets from both dialects; the API map learns
 * channels, GraphQL, guards, flows and races; and the author kit plus the
 * project plugin directory make the host somebody else's platform too.
 */

test("the grammar carries lines and every note says where it came from", () => {
  const ir = buildIr(`<div>\n  <p>{{ v | mystery }}</p>\n  <span *ngIf="x">{{ q | funky }}</span>\n</div>`);
  assert.match(ir.notes[0], /^line 2: /, "the reader's note names its line");
  assert.match(ir.notes[1], /^line 3: /);
  assert.equal(ir.root.children[1].line, 3, "the node itself remembers the line");

  const result = translate(`<div>\n\n  <app-unknown-widget></app-unknown-widget>\n</div>`, { indent: 0, components: new Map() });
  assert.ok(result.notes.some((n) => /^line 3: <app-unknown-widget>/.test(n)), "the printer's own notes carry the cursor too");
});

test("a named slot with its fallback holds byte identical across the targets, from both dialects", () => {
  const angular = `<div><ng-content select="[header]"><h2>Fallback</h2></ng-content><p>body</p></div>`;
  const vue = `<div><slot name="header"><h2>Fallback</h2></slot><p>body</p></div>`;
  const printers = [
    ["react", (s) => translate(s, { indent: 0 }).jsx],
    ["vue", (s) => toVue(s).markup],
    ["svelte", (s) => toSvelte(s).markup],
    ["custom element", (s) => toHtml(s).markup],
    ["angular", (s) => toAngular(s).markup],
    ["lit", (s) => toLit(s).markup],
    ["solid", (s) => toSolid(s).body],
    ["alpine", (s) => toAlpine(s).markup],
  ];
  for (const [name, print] of printers) {
    const a = print(angular);
    const b = print(vue);
    assert.equal(a, b, `${name}: the same slot spelled two ways prints identically`);
    if (name === "alpine") {
      // Alpine has no slot mechanism and the printer says so instead of
      // inventing one; the honesty is the feature being held here.
      assert.match(a, /projected content went here/, "alpine names the gap");
      continue;
    }
    assert.match(a, /header/, `${name}: the slot's name survives`);
    assert.match(a, /Fallback/, `${name}: the fallback survives`);
  }
});

test("the lit target catches up: a multiple select holds an array honestly", () => {
  const out = toLit(`<select multiple [(ngModel)]="tags"><option value="a">A</option><option value="b">B</option></select>`);
  assert.match(out.markup, /selectedOptions/, "the model reads the selected options");
  assert.match(out.markup, /\?selected=\$\{\(this\.tags \?\? \[\]\)\.includes\("a"\)\}/, "each option renders its membership");
});

test("guards, channels, GraphQL and races are read from source and carried, never reinvented", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-exact-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "app.routes.ts"), `
import { RouterModule } from "@angular/router";
const routes = [
  { path: "admin", component: AdminComponent, canActivate: [authGuard, adminGuard] },
  { path: "", component: HomeComponent },
];`);
  await writeFile(join(dir, "live.ts"), `const feed = new WebSocket("wss://feed.example/socket");`);
  await writeFile(join(dir, "search.ts"), `input$.pipe(debounceTime(300), switchMap((q) => this.http.get(q)));`);
  await writeFile(join(dir, "queries.ts"), `
const client = { uri: "/graphql" };
const ORDERS = gql\`query Orders { orders { id total } }\`;
const CANCEL = gql\`mutation CancelOrder($id: ID!) { cancel(id: $id) }\`;`);

  const run = await runPipeline({ src: dir });
  t.after(run.cleanup);
  assert.equal(run.error, null);

  const table = run.ctx.routes.table;
  assert.deepEqual(table.find((r) => r.fullPath === "/admin").guards, [{ kind: "canActivate", names: ["authGuard", "adminGuard"] }]);
  const guardsFile = await readFile(join(run.out, "src/app/route-guards.js"), "utf8");
  assert.match(guardsFile, /"\/admin": \[\{"kind":"canActivate","names":\["authGuard","adminGuard"\]\}\]/);
  assert.match(await readFile(join(run.out, "ROUTES.md"), "utf8"), /## Guards/);

  assert.deepEqual(run.ctx.api.channels, [{ kind: "websocket", url: "wss://feed.example/socket", file: "live.ts" }]);
  assert.deepEqual(run.ctx.api.graphql.operations.map((o) => `${o.operation} ${o.name}`), ["query Orders", "mutation CancelOrder"]);
  assert.equal(run.ctx.api.graphql.endpoint.path, "/graphql");
  assert.match(await readFile(join(run.out, "API_CHANNELS.md"), "utf8"), /wss:\/\/feed\.example\/socket/);
  const operations = await readFile(join(run.out, "src/api/operations.js"), "utf8");
  assert.match(operations, /"Orders": \{ operation: "query"/);
  assert.match(operations, /No schema is claimed here|schema/i);

  assert.ok(run.ctx.races.some((r) => r.kind === "debounce"), "the debounce is named");
  assert.ok(run.ctx.races.some((r) => r.kind === "cancellation"), "the cancellation is named");
  assert.match(await readFile(join(run.out, "RACES.md"), "utf8"), /switchMap drops the stale request/);
  assert.ok(run.ctx.report.unverified.some((n) => /the port must keep the pattern/.test(n)));
});

test("races are read as evidence with their meaning, not as pattern counts", () => {
  const races = readRaces(`clearTimeout(t); t = setTimeout(go, 200); const ac = new AbortController();`, "a.js");
  assert.deepEqual(races.map((r) => r.kind).sort(), ["cancellation", "debounce"]);
  assert.deepEqual(readRaces("const x = 1;", "b.js"), [], "quiet code raises nothing");
});

test("the auth flow draws only arrows the source proves", () => {
  const flow = authFlow({
    schemes: [{ kind: "bearer", means: "a bearer token in the Authorization header", file: "auth.service.ts" }],
    storage: [{ where: "localStorage", key: "jwt", file: "auth.service.ts" }],
    relogin: ["auth.interceptor.ts"],
    interceptors: [{ className: "AuthInterceptor", file: "auth.interceptor.ts" }],
  }, [{ method: "POST", path: "/auth/login", file: "auth.service.ts" }]);
  assert.match(flow, /sequenceDiagram/);
  assert.match(flow, /read `jwt` from localStorage \(auth\.service\.ts\)/);
  assert.match(flow, /Bearer.*via AuthInterceptor/i);
  assert.match(flow, /POST \/auth\/login/);
  assert.match(flow, /401, and the app reacts \(auth\.interceptor\.ts\)/);
  assert.equal(authFlow({ schemes: [], storage: [], relogin: [], interceptors: [] }), null, "no evidence, no diagram");
});

test("route guards parse from both spellings and an inline guard is not invented a name", () => {
  const routes = readRoutes(`const routes = [
    { path: "a", component: A, canActivate: [g1] },
    { path: "b", component: B, beforeEnter: requireAuth },
    { path: "c", component: C },
  ];`, "r.ts");
  assert.deepEqual(routes[0].guards, [{ kind: "canActivate", names: ["g1"] }]);
  assert.deepEqual(routes[1].guards, [{ kind: "beforeEnter", names: ["requireAuth"] }]);
  assert.deepEqual(routes[2].guards, []);
});

test("improvements rank by the emitted code each fix would touch, measured from disk", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-rank-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "src/features/Big"), { recursive: true });
  await mkdir(join(dir, "src/features/Small"), { recursive: true });
  await writeFile(join(dir, "src/features/Big/Big.jsx"), "x\n".repeat(120));
  await writeFile(join(dir, "src/features/Small/Small.jsx"), "x\n".repeat(10));

  const handlers = {};
  improve.setup({ on: (stage, fn) => { handlers[stage] = fn; }, log: quietLogger().child?.("t") ?? { info() {}, debug() {} } });
  const written = [];
  const ctx = {
    improvements: [
      { kind: "contrast", screen: "big", element: "#a", severity: "medium", evidence: "e", instead: "i" },
      { kind: "contrast", screen: "small", element: "#b", severity: "medium", evidence: "e", instead: "i" },
      { kind: "contrast", screen: "ghost", element: "#c", severity: "medium", evidence: "e", instead: "i" },
    ],
    screens: [
      { selector: "big", className: "Big" },
      { selector: "small", className: "Small" },
    ],
    written: ["src/features/Big/Big.jsx", "src/features/Small/Small.jsx"],
    config: { out: dir },
    write: async (rel, text) => { written.push({ rel, text }); },
  };
  await handlers.verify(ctx);
  const report = written.find((w) => w.rel === "IMPROVEMENTS.md").text;
  const smallAt = report.indexOf("`#b`");
  const bigAt = report.indexOf("`#a`");
  const ghostAt = report.indexOf("`#c`");
  assert.ok(smallAt < bigAt && bigAt < ghostAt, "cheapest measured fix first, the unemitted screen last");
  assert.match(report, /Fix lands in `src\/features\/Small\/Small\.jsx`, 11 emitted line\(s\)/);
  assert.match(report, /Unranked: the screen was not emitted/);
});

test("a project's own plugin loads beside the builtins, and a name clash is refused", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-project-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A real project declares itself a module; without it, Node 18 reads the
  // plugin as CommonJS and discovery skips it with a warning.
  await writeFile(join(dir, "package.json"), `{ "type": "module" }\n`);
  await mkdir(join(dir, "vis-mine"), { recursive: true });
  await writeFile(join(dir, "vis-mine/index.js"), `export default { name: "vis-mine", version: "0.0.1", class: "vis", setup() {} };`);
  await mkdir(join(dir, "dsp-ir"), { recursive: true });
  await writeFile(join(dir, "dsp-ir/index.js"), `export default { name: "dsp-ir", version: "9.9.9", class: "dsp", setup() {} };`);

  const warnings = [];
  const log = { info() {}, warn: (m) => warnings.push(m), error() {}, debug() {}, child() { return this; } };
  const kernel = new Kernel({ log, policy: {} });
  await kernel.discover({ builtinDir: BUILTIN, projectDir: dir });
  assert.ok(kernel.plugins.some((p) => p.name === "vis-mine"), "the project plugin is a plugin like any other");
  assert.equal(kernel.plugins.find((p) => p.name === "dsp-ir").version, "0.1.0", "a clash never replaces a builtin");
  assert.ok(warnings.some((w) => /Duplicate plugin name/.test(w)), "and the refusal is said, not silent");
});

test("new-plugin scaffolds the whole kit: code, test, docs and a fixture", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-kit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = await exec(process.execPath, [join(ROOT, "src/cli.js"), "new-plugin", "vis-sparkline"], { cwd: dir });
  assert.match(out.stdout + out.stderr, /docs at plugins\/vis-sparkline\/README\.md/);
  assert.match(await readFile(join(dir, "plugins/vis-sparkline/index.js"), "utf8"), /name: "vis-sparkline"/);
  assert.match(await readFile(join(dir, "plugins/vis-sparkline/README.md"), "utf8"), /what it refuses\s+to guess at|refuses/);
  assert.match(await readFile(join(dir, "test/sparkline.test.js"), "utf8"), /declares itself correctly/);
  assert.match(await readFile(join(dir, "test/fixtures/vis-sparkline/sample.html"), "utf8"), /smallest input/);
});
