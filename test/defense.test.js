import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readSecurity } from "../plugins/dsp-security/index.js";
import { readSupplyChain } from "../plugins/dsp-supplychain/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port defended: the sharp edges a legacy front end carries into its
 * markup and scripts, and the third party code it loads from another host.
 * Both read, both proposed, neither performed, and no captured value printed.
 */

test("the security pass names the sharp edges and withholds values", () => {
  const html = `<!doctype html><html><head></head><body>
    <a href="/x" target="_blank">unsafe</a>
    <a href="/y" target="_blank" rel="noopener">safe</a>
    <button onclick="go()">go</button></body></html>`;
  const kinds = new Set(readSecurity(html, "p.html").map((f) => f.kind));
  assert.ok(kinds.has("inline-handler"));
  assert.ok(kinds.has("blank-noopener"));
  assert.ok(kinds.has("no-csp"), "a page with a head and no CSP meta is named");

  const blanks = readSecurity(html, "p.html").filter((f) => f.kind === "blank-noopener");
  assert.equal(blanks.length, 1, "only the link without rel=noopener is a finding");

  const js = readSecurity(`el.innerHTML = danger; eval(cfg); document.write(x);`, "a.js");
  const jsKinds = new Set(js.map((f) => f.kind));
  assert.ok(jsKinds.has("inner-html") && jsKinds.has("eval") && jsKinds.has("document-write"));
  // The value assigned or evaluated is never captured, only the structural marker.
  assert.ok(!JSON.stringify(js).includes("danger"));
});

test("the supply chain pass names external code and whether it carries integrity", () => {
  const { scripts, styles } = readSupplyChain(
    `<script src="https://cdn.a.net/x.js"></script>
     <script src="https://cdn.b.net/y.js" integrity="sha384-z" crossorigin></script>
     <script src="app.js"></script>
     <link rel="stylesheet" href="https://cdn.c.net/t.css">`,
    "p.html"
  );
  assert.equal(scripts.length, 2, "the local app.js is the app's own, not third party");
  const a = scripts.find((s) => s.host === "cdn.a.net");
  assert.equal(a.sri, false, "no integrity hash");
  const b = scripts.find((s) => s.host === "cdn.b.net");
  assert.equal(b.sri, true);
  assert.equal(styles[0].host, "cdn.c.net");
});

test("a run writes SECURITY.md and SUPPLYCHAIN.md, and applies nothing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/security-site") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("SECURITY.md"));
    assert.ok(run.ctx.written.includes("SUPPLYCHAIN.md"));

    const security = await readFile(join(run.out, "SECURITY.md"), "utf8");
    assert.match(security, /noopener/, "the reverse tabnabbing fix is proposed");
    assert.match(security, /eval|innerHTML|document\.write/);

    const supply = await readFile(join(run.out, "SUPPLYCHAIN.md"), "utf8");
    assert.match(supply, /jsdelivr/);
    assert.match(supply, /integrity/i, "SRI is the axis it reports on");
    assert.ok(run.ctx.report.unverified.some((n) => /Subresource Integrity|integrity/.test(n)));
  } finally {
    await run.cleanup();
  }
});
