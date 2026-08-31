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

test("fixtures that look like customer data are flagged, not blocked", () => {
  const warned = [];
  const p = new Policy({ log: { ...quietLogger(), warn: (m) => warned.push(m) } });
  assert.equal(p.warnOnFixtureData("ssn 123-45-6789", "orders.json"), true);
  assert.equal(p.warnOnFixtureData("someone@example.com", "users.json"), true);
  assert.equal(p.warnOnFixtureData("order 17, status open", "orders.json"), false);
  assert.equal(warned.length, 2);
});
