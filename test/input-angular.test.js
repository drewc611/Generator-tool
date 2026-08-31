import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { loadTypeScript, readSourceFile, isUsable } from "../plugins/input-angular/ast.js";
import { readWithRegex } from "../plugins/input-angular/regex.js";
import { ROOT } from "./helpers.js";

const ts = await loadTypeScript();
const app = (name) => readFile(join(ROOT, "example/legacy/src/app", name), "utf8");
const ast = (text, rel = "x.ts") => readSourceFile(ts, text, rel);

// typescript is optional. Where it is absent the plugin falls back, and these
// tests report themselves as skipped rather than as passing on nothing.
const needsTs = { skip: ts ? false : "typescript is not installed" };

test("the loader refuses a typescript that cannot do the job", () => {
  assert.equal(isUsable(null), false);
  assert.equal(isUsable({ version: "7.0.0" }), false, "importing is not the same as getting a compiler");
  assert.equal(isUsable({ createSourceFile: () => {}, forEachChild: () => {} }), false);
  if (ts) assert.equal(isUsable(ts), true);
});

test("the AST pass reads the component the example declares", needsTs, async () => {
  const { screens } = ast(await app("orders.component.ts"), "orders.component.ts");
  assert.equal(screens.length, 1);
  assert.equal(screens[0].selector, "app-orders");
  assert.equal(screens[0].className, "OrdersComponent");
  assert.deepEqual(screens[0].inputs, ["accountId"]);
  assert.deepEqual(screens[0].outputs, ["selected"]);
  assert.match(screens[0].template, /\*ngFor/);
});

test("the AST pass reads every HttpClient call and its method", needsTs, async () => {
  const { calls } = ast(await app("orders.service.ts"), "orders.service.ts");
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    ["GET /api/v1/accounts/orders", "POST /api/v1/orders", "DELETE /api/v1/orders/cancel"]
  );
  assert.equal(calls[0].body, null, "a GET has no body to describe");
  assert.equal(calls[1].body, "unknown", "a POST has one and we do not know it");
});

test("a call on something that is not an HttpClient is not an HTTP call", needsTs, () => {
  const { calls } = ast(`
    class C {
      constructor(private http: HttpClient, private cache: Store) {}
      a() { return this.cache.get("not-a-request"); }
      b() { return this.http.get("/real"); }
    }`);
  assert.deepEqual(calls.map((c) => c.path), ["/real"]);
});

test("an interpolated URL keeps its shape rather than being resolved to a guess", needsTs, () => {
  const { calls } = ast("class C { constructor(private http: HttpClient) {} a(id) { return this.http.get(`${this.base}/orders/${id}`); } }");
  assert.equal(calls[0].path, "${this.base}/orders/${id}");
});

// The bug this guards: counting an unused `import { HttpInterceptor }` as an
// interceptor, which inflated the reported count of the example by one.
test("only a class that implements HttpInterceptor is an interceptor", needsTs, async () => {
  const service = await app("orders.service.ts");
  assert.match(service, /import .*HttpInterceptor/, "the fixture still carries the unused import");
  assert.deepEqual(ast(service, "orders.service.ts").interceptors, [], "an import is not an implementation");

  const auth = ast(await app("auth.interceptor.ts"), "auth.interceptor.ts").interceptors;
  assert.equal(auth.length, 1);
  assert.equal(auth[0].className, "AuthInterceptor");
});

// Both readers have to agree on the example, or the numbers a run reports
// would depend on whether an optional dependency happens to be installed.
test("the fallback agrees with the AST pass about the example", async () => {
  for (const name of ["orders.component.ts", "orders.service.ts", "auth.interceptor.ts", "error.interceptor.ts"]) {
    const text = await app(name);
    const regex = readWithRegex(text, name);
    assert.equal(regex.interceptors.length, ts ? ast(text, name).interceptors.length : regex.interceptors.length);
  }
  assert.equal(readWithRegex(await app("orders.service.ts"), "s.ts").interceptors.length, 0, "an import is not an implementation");
  assert.equal(readWithRegex(await app("auth.interceptor.ts"), "a.ts").interceptors[0].className, "AuthInterceptor");
});

test("the regex fallback still finds the ordinary things", async () => {
  const { screens, calls } = readWithRegex(await app("orders.component.ts"), "orders.component.ts");
  assert.equal(screens[0].selector, "app-orders");
  assert.deepEqual(screens[0].inputs, ["accountId"]);
  assert.match(screens[0].template, /ngFor/);
  assert.deepEqual(calls, []);
});

test("a decorator spread over many lines is still one component", needsTs, () => {
  const { screens } = ast(`
    @Component({
      // a comment with selector: 'not-this' inside it
      selector:
        'app-wide',
      template: \`<p>{{ x }}</p>\`,
    })
    export class WideComponent {
      @Input() a;
      @Input() b;
      @Output() changed = new EventEmitter();
    }`);
  assert.equal(screens.length, 1);
  assert.equal(screens[0].selector, "app-wide");
  assert.deepEqual(screens[0].inputs, ["a", "b"]);
  assert.deepEqual(screens[0].outputs, ["changed"]);
});

test("a file with no Angular in it yields nothing", needsTs, () => {
  const out = ast(`export const add = (a, b) => a + b;`);
  assert.deepEqual(out, { screens: [], calls: [], interceptors: [] });
});
