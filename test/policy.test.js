import assert from "node:assert/strict";
import test from "node:test";

import { Policy, PolicyViolation } from "../src/core/policy.js";
import { quietLogger } from "./helpers.js";

const policy = (over = {}) => new Policy({ log: quietLogger(), ...over });

const SAMPLES = {
  "client secret": `const client_secret = "abcdefghijkl";`,
  "api key": `apiKey: "0123456789abcdef"`,
  "aws access key id": `const id = "AKIAIOSFODNN7EXAMPLE";`,
  "aws secret access key": `aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"`,
  "private key": `-----BEGIN RSA PRIVATE KEY-----`,
  "hardcoded bearer token": `headers.set("Authorization", "Bearer abcdefghijklmnopqrstuvwxyz012345")`,
  "hardcoded basic auth header": `headers.set("Authorization", "Basic YWRtaW46aHVudGVyMmh1bnRlcg==")`,
  password: `password = "hunter2hunter"`,
  "database connection string with embedded credentials": `const db = "postgres://admin:hunter2hunter@db.internal:5432/app";`,
  "slack token": `const hook = "xoxb-0123456789-abcdefgh";`,
  "slack webhook url": `const url = "https://hooks.slack.com/services/T0000000/B0000000/abcdefghijklmnopqrstuvwx";`,
};

test("every pattern the engine claims to catch has a sample that fires it", () => {
  for (const [kind, sample] of Object.entries(SAMPLES)) {
    const hits = policy().scanForSecrets(sample, "sample.ts");
    assert.ok(hits.some((h) => h.kind === kind), `${kind} did not fire on its own sample`);
  }
});

test("ordinary source does not fire the gate", () => {
  const source = [
    `const token = window.localStorage.getItem("portal.session");`,
    `const key = process.env.API_KEY;`,
    `this.http.get("/api/v1/orders");`,
    `const color = { accent: "#004B87" };`,
  ].join("\n");
  assert.deepEqual(policy().scanForSecrets(source, "clean.ts"), []);
});

test("the slack webhook pattern keys on the token shape, not the host", () => {
  // The pattern names no host at all, on purpose: a regex that checks a
  // hostname is its own hard-to-anchor problem (a lookalike domain can wear
  // the same path), and what actually matters for a leaked credential is the
  // token, not which domain it was requested from. Any host wearing a real
  // Slack-sized /services/T.../B.../secret path still gets caught.
  const hosts = [
    `const url = "https://hooks.slack.com/services/T0000000/B0000000/abcdefghijklmnopqrstuvwx";`,
    `const url = "https://evil-hooks.slack.com/services/T0000000/B0000000/abcdefghijklmnopqrstuvwx";`,
    `const url = "https://hooks.slack.community/services/T0000000/B0000000/abcdefghijklmnopqrstuvwx";`,
  ];
  for (const source of hosts) {
    const hits = policy().scanForSecrets(source, "sample.ts");
    assert.ok(hits.some((h) => h.kind === "slack webhook url"), `should fire on the token shape regardless of host: ${source}`);
  }

  // Something that merely mentions /services/ or a slack URL with no real
  // token shape behind it is not a credential and should not fire.
  const clean = [
    `fetch("/api/services/export");`,
    `const help = "see https://api.slack.com/messaging/webhooks for docs";`,
  ];
  for (const source of clean) {
    const hits = policy().scanForSecrets(source, "sample.ts");
    assert.ok(!hits.some((h) => h.kind === "slack webhook url"), `should not fire with no real token shape: ${source}`);
  }
});

test("a finding records where, never what", () => {
  const p = policy();
  const [hit] = p.scanForSecrets(`\n\nconst id = "AKIAIOSFODNN7EXAMPLE";`, "config.ts");
  assert.equal(hit.file, "config.ts");
  assert.equal(hit.line, 3);
  assert.equal(hit.kind, "aws access key id");
  assert.ok(!JSON.stringify(hit).includes("AKIAIOSFODNN7EXAMPLE"), "the value must not reach the finding");
});

test("assertNoSecrets stops the run and keeps the value out of the message", () => {
  const p = policy();
  p.scanForSecrets(`const id = "AKIAIOSFODNN7EXAMPLE";`, "config.ts");
  assert.throws(
    () => p.assertNoSecrets(),
    (error) => {
      assert.ok(error instanceof PolicyViolation);
      assert.equal(error.rule, "no-credentials-in-source");
      assert.match(error.message, /config\.ts:1/);
      assert.ok(!error.message.includes("AKIAIOSFODNN7EXAMPLE"), "the message must not carry the value");
      assert.match(error.message, /rotating/, "the reader is told the credential is already burned");
      return true;
    }
  );
});

test("a clean scan asserts nothing and returns", () => {
  const p = policy();
  p.scanForSecrets("const answer = 42;", "clean.ts");
  assert.equal(p.assertNoSecrets(), undefined);
});

test("live calls are off until asked for", () => {
  assert.throws(() => policy().assertLiveAllowed("legacy.internal"), /Live calls are off by default/);
  assert.equal(policy({ allowLive: true }).assertLiveAllowed("legacy.internal"), true);
});

test("billable needs live as well as billable, in that order", () => {
  assert.throws(() => policy().assertBillableAllowed("/charge"), /Live calls are off by default/);
  assert.throws(() => policy({ allowLive: true }).assertBillableAllowed("/charge"), /marked billable/);
  assert.equal(policy({ allowLive: true, allowBillable: true }).assertBillableAllowed("/charge"), true);
});

test("allowing billable alone does not let a live call through", () => {
  assert.throws(() => policy({ allowBillable: true }).assertLiveAllowed("x"), PolicyViolation);
});

// A gate that can be reassigned is a gate that will be, by a plugin that finds
// it inconvenient.
test("a gate cannot be removed after the policy is built", () => {
  const p = policy();
  assert.throws(() => { p.assertNoSecrets = () => true; }, TypeError);
  assert.throws(() => { p.allowLive = true; }, TypeError);
  assert.throws(() => { p.somethingNew = 1; }, TypeError);
  assert.equal(p.allowLive, false);
});

test("freezing the policy does not stop it recording findings", () => {
  const p = policy();
  p.scanForSecrets(`const id = "AKIAIOSFODNN7EXAMPLE";`, "a.ts");
  assert.equal(p.findings.length, 1, "the array is still pushable, only the binding is frozen");
});

test("every policy stop can say what would clear it", async () => {
  const { Policy } = await import("../src/core/policy.js");
  for (const rule of [
    "no-credentials-in-source", "offline", "no-live-calls",
    "live-call-outside-attested-domains", "no-billable-calls", "no-endpoints-in-components",
  ]) {
    const clears = Policy.clears(rule);
    assert.ok(clears && clears.length > 20, `${rule} names its evidence`);
  }
  assert.equal(Policy.clears("not-a-rule"), null, "an unknown rule explains nothing rather than guessing");
});

test("an endpoint in a component is refused", () => {
  const paths = ["/api/v1/orders", "/api/v1/accounts/orders"];
  assert.throws(
    () => policy().assertNoEndpointLiteral(`<a href="/api/v1/orders">x</a>`, "A.jsx", paths),
    (error) => {
      assert.equal(error.rule, "no-endpoints-in-components");
      assert.equal(error.path, "/api/v1/orders");
      assert.match(error.message, /belong in src\/api\/endpoints\.js/);
      return true;
    }
  );
});

// The false positive this guards: refusing to port a template because it links
// to documentation. An external link is not an endpoint.
test("a link that is not an endpoint is left alone", () => {
  const paths = ["/api/v1/orders"];
  const p = policy();
  assert.equal(p.assertNoEndpointLiteral(`<a href="https://docs.example.com/orders">Help</a>`, "A.jsx", paths), true);
  assert.equal(p.assertNoEndpointLiteral(`import { createClient } from "../api/client.js";`, "A.jsx", paths), true);
  assert.equal(p.assertNoEndpointLiteral(`<a href="/help">Help</a>`, "A.jsx", paths), true);
});

test("with no endpoint map there is nothing to check against", () => {
  assert.equal(policy().assertNoEndpointLiteral(`anything at all /api/v1/orders`, "A.jsx", []), true);
  assert.equal(policy().assertNoEndpointLiteral(`x`, "A.jsx", ["", "/"]), true, "a path too short to mean anything is skipped");
});

/* ----------------------------------------------------- isComponentPath, ctx.beforeWrite */
// isComponentPath is port-shape knowledge (src/features, src/elements,
// src/app), not core's to know, so it lives in the general-policy plugin,
// not on Policy; these tests exercise it and the write time hook it installs
// through the plugin the way a real run does, not a hand rolled substitute.

test("isComponentPath names exactly the tree the endpoint gate checks", async () => {
  const { isComponentPath } = await import("../plugins/general-policy/index.js");
  assert.ok(isComponentPath("src/features/AppOrders/AppOrders.jsx"));
  assert.ok(isComponentPath("src/elements/AppOrders.js"));
  assert.ok(isComponentPath("src/app/route-guards.js"), "an app shell code file is still gated");
  assert.ok(!isComponentPath("src/api/endpoints.js"), "endpoints live here by design, not a violation");
  assert.ok(!isComponentPath("src/tokens.js"), "outside the three component trees entirely");
  assert.ok(!isComponentPath("PORT_NOTES.md"), "a report, not a component");
  for (const shell of ["redirects", "nav", "head", "breadcrumbs", "search-index"]) {
    assert.ok(!isComponentPath(`src/app/${shell}.js`), `${shell}.js holds destinations by construction`);
  }
});

// The point of the whole change: ctx.write itself refuses, so the bytes
// never land, not just a later scan that finds them once they have. This
// runs the plugin's real extract handler to install the hook, the same as
// a real run does, rather than faking ctx.beforeWrite by hand.
test("ctx.write refuses a component naming a raw endpoint before it touches disk", async (t) => {
  const { mkdtemp, readFile: read, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createContext } = await import("../src/core/context.js");
  const generalPolicy = (await import("../plugins/general-policy/index.js")).default;

  const out = await mkdtemp(join(tmpdir(), "portamp-write-gate-"));
  t.after(() => rm(out, { recursive: true, force: true }));

  const p = policy();
  const ctx = createContext({ config: { out, dryRun: false }, log: quietLogger(), policy: p });
  ctx.api.calls.push({ path: "/api/v1/orders" });
  ctx.sources.files = [];

  const handlers = {};
  generalPolicy.setup({ on: (stage, fn) => (handlers[stage] = fn), log: quietLogger(), policy: p });
  await handlers.extract(ctx);
  assert.equal(typeof ctx.beforeWrite, "function", "the plugin installed the hook");

  await assert.rejects(
    () => ctx.write("src/features/Orders/Orders.jsx", `<a href="/api/v1/orders">x</a>`),
    (error) => {
      assert.equal(error.rule, "no-endpoints-in-components");
      return true;
    }
  );
  await assert.rejects(read(join(out, "src/features/Orders/Orders.jsx"), "utf8"), /ENOENT/);
  assert.ok(!ctx.written.includes("src/features/Orders/Orders.jsx"), "a refused write is not recorded either");

  // A clean component, and a non component file naming the same path, both
  // still write normally: the gate is precise, not a blanket refusal.
  await ctx.write("src/features/Orders/Orders.jsx", `<p>orders</p>`);
  assert.equal(await read(join(out, "src/features/Orders/Orders.jsx"), "utf8"), `<p>orders</p>`);
  await ctx.write("src/api/endpoints.js", `export const endpoints = { orders: "/api/v1/orders" };`);
  assert.match(await read(join(out, "src/api/endpoints.js"), "utf8"), /\/api\/v1\/orders/);
});

test("the write time hook reads routes from both ctx.site and ctx.routes, the same as the verify time scan", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createContext } = await import("../src/core/context.js");
  const generalPolicy = (await import("../plugins/general-policy/index.js")).default;

  const out = await mkdtemp(join(tmpdir(), "portamp-write-gate-routes-"));
  t.after(() => rm(out, { recursive: true, force: true }));

  const p = policy();
  const ctx = createContext({ config: { out, dryRun: false }, log: quietLogger(), policy: p });
  ctx.api.calls.push({ path: "/orders" });
  ctx.site = { pages: [{ route: "/orders" }] };
  ctx.sources.files = [];

  const handlers = {};
  generalPolicy.setup({ on: (stage, fn) => (handlers[stage] = fn), log: quietLogger(), policy: p });
  await handlers.extract(ctx);

  // /orders is both an endpoint and this run's own route; the route wins in
  // a navigation position, exactly as assertNoEndpointLiteral does.
  await assert.doesNotReject(() => ctx.write("src/app/Nav.jsx", `<a href="/orders">Orders</a>`));
});

test("fixtures that look like customer data are flagged, not blocked", () => {
  const warned = [];
  const p = new Policy({ log: { ...quietLogger(), warn: (m) => warned.push(m) } });
  assert.equal(p.warnOnFixtureData("ssn 123-45-6789", "orders.json"), true);
  assert.equal(p.warnOnFixtureData("someone@example.com", "users.json"), true);
  assert.equal(p.warnOnFixtureData("order 17, status open", "orders.json"), false);
  assert.equal(warned.length, 2);
});
