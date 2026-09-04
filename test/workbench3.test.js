import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { Policy, PolicyViolation } from "../src/core/policy.js";
import { badge } from "../plugins/vis-coverage/index.js";
import { renderHistory } from "../plugins/general-history/index.js";
import { previewPage, serve } from "../plugins/vis-ui/index.js";
import { runPipeline } from "./helpers.js";

/* --------------------------------------------- attestation scoped domains */

test("the attested domains narrow the live gate and never widen it", () => {
  const scoped = new Policy({ allowLive: true, allowedDomains: ["legacy.example.com"] });
  assert.ok(scoped.assertLiveAllowed("https://legacy.example.com/api"));
  assert.ok(scoped.assertLiveAllowed("https://app.legacy.example.com/api"), "a subdomain of the attested domain is covered");
  assert.throws(() => scoped.assertLiveAllowed("https://other.example.org/"), PolicyViolation);
  assert.throws(() => scoped.assertLiveAllowed("https://evillegacy.example.com.attacker.net/"), PolicyViolation, "a suffix lookalike is not the domain");

  const closed = new Policy({ allowLive: false, allowedDomains: ["legacy.example.com"] });
  assert.throws(() => closed.assertLiveAllowed("https://legacy.example.com/"), PolicyViolation, "the list never substitutes for --allow-live");
});

test("loopback is governed by --allow-live alone", () => {
  const scoped = new Policy({ allowLive: true, allowedDomains: ["legacy.example.com"] });
  assert.ok(scoped.assertLiveAllowed("http://127.0.0.1:4177/"));
  assert.ok(scoped.assertLiveAllowed("http://localhost:8080/x"));
});

/* -------------------------------------------------------------- provenance */

test("every written file is attributed to the plugin whose turn it was", async (t) => {
  const { ctx, cleanup } = await runPipeline({ src: join(process.cwd(), "example/legacy") });
  t.after(cleanup);
  assert.ok(ctx.provenance, "the kernel recorded provenance");
  for (const file of ctx.written) {
    assert.ok(ctx.provenance[file], `${file} has an author`);
  }
  assert.equal(ctx.provenance["WEIGHT.md"].plugin, "dsp-weight");
  assert.equal(ctx.provenance["src/tokens.js"].plugin, "dsp-tokens");
  assert.equal(ctx.provenance["PORT_NOTES.md"].plugin, "vis-parity");
});

/* ------------------------------------------------------------------ badges */

test("a badge is self contained svg with its text escaped", () => {
  const svg = badge("ported", '<"100%">', "#2da44e");
  assert.match(svg, /^<svg xmlns/);
  assert.ok(!/<"/.test(svg), "no raw angle quote survives into markup");
  assert.match(svg, /&lt;&quot;100%&quot;&gt;/);
  assert.ok(!/shields|img\.shields\.io|badgen/.test(svg), "no badge service, the number needs no network");
});

/* ----------------------------------------------------------------- history */

test("history renders a trend and names the direction", () => {
  const md = renderHistory([
    { ranAt: "2026-08-30T10:00:00Z", screens: 1, endpoints: 3, unverified: 9, files: 16 },
    { ranAt: "2026-08-31T10:00:00Z", screens: 1, endpoints: 3, unverified: 11, files: 20 },
  ]);
  assert.match(md, /\| 2026-08-30T10:00:00Z \| 1 \| 3 \| 9 \| 16 \|/);
  assert.match(md, /went up by 2/);
});

/* ----------------------------------------------------------------- preview */

test("the preview page checks its state and escapes its tag", () => {
  const page = previewPage("app-orders", "src/elements/AppOrders.js", "loading");
  assert.match(page, /<app-orders id="el"><\/app-orders>/);
  assert.match(page, /"loading"/);
  const injected = previewPage('x"><script>alert(1)</script>', "src/elements/X.js", "definitely-not-a-state");
  assert.ok(!injected.includes("<script>alert"), "a hostile tag cannot break out");
  assert.match(injected, /"empty"/, "an unknown state falls back instead of echoing");
});

test("the server serves elements executable and everything else it always did", async (t) => {
  const { out, cleanup } = await runPipeline({ src: join(process.cwd(), "example/legacy"), html: true });
  t.after(cleanup);
  const { server, address: base } = await serve({ outDir: out, shotsDir: out, port: 0, log: { info: () => {} } });
  t.after(() => server.close());

  const element = await fetch(`${base}/elements/AppOrders.js`);
  assert.equal(element.status, 200);
  assert.match(element.headers.get("content-type"), /text\/javascript/);

  const refused = await fetch(`${base}/elements/..%2F..%2Fapi%2Fendpoints.js`);
  const refusedLit = await fetch(`${base}/elements/AppOrders.lit.js`);
  assert.equal(refusedLit.status, 403, "the lit element needs its dependency and is not previewed");
  assert.ok([403, 404].includes(refused.status), "nothing outside src/elements is served executable");

  const preview = await fetch(`${base}/preview?path=${encodeURIComponent("src/elements/AppOrders.js")}&state=error`);
  assert.equal(preview.status, 200);
  const body = await preview.text();
  assert.match(body, /customElements|<app-orders|<x-/);
});
