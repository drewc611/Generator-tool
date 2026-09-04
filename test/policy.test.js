import assert from "node:assert/strict";
import test from "node:test";

import { Policy, PolicyViolation } from "../src/core/policy.js";
import { quietLogger } from "./helpers.js";

const policy = (over = {}) => new Policy({ log: quietLogger(), ...over });

const SAMPLES = {
  "client secret": `const client_secret = "abcdefghijkl";`,
  "api key": `apiKey: "0123456789abcdef"`,
  "aws access key id": `const id = "AKIAIOSFODNN7EXAMPLE";`,
  "private key": `-----BEGIN RSA PRIVATE KEY-----`,
  "hardcoded bearer token": `headers.set("Authorization", "Bearer abcdefghijklmnopqrstuvwxyz012345")`,
  password: `password = "hunter2hunter"`,
  "slack token": `const hook = "xoxb-0123456789-abcdefgh";`,
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

test("fixtures that look like customer data are flagged, not blocked", () => {
  const warned = [];
  const p = new Policy({ log: { ...quietLogger(), warn: (m) => warned.push(m) } });
  assert.equal(p.warnOnFixtureData("ssn 123-45-6789", "orders.json"), true);
  assert.equal(p.warnOnFixtureData("someone@example.com", "users.json"), true);
  assert.equal(p.warnOnFixtureData("order 17, status open", "orders.json"), false);
  assert.equal(warned.length, 2);
});
