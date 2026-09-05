import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * output-caddy serves the static export with Caddy, the server that gets its own
 * TLS with no configuration, and carries the same flattened redirect map every
 * other host target does, spelled in Caddy's own dialect.
 */

test("output-caddy serves the export and carries the redirect map as 301s", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, caddy: true });
  try {
    assert.equal(run.error, null);
    const rel = run.ctx.written.find((f) => /^caddy\/Caddyfile$/.test(f));
    assert.ok(rel, "a Caddyfile was written");
    const conf = await readFile(join(run.out, rel), "utf8");
    assert.ok((conf.match(/redir \S+ \S+ 301/g) ?? []).length >= 1, "a retired address is a 301 redir");
    assert.match(conf, /try_files \{path\}/, "client routes fall through to index.html");
    assert.match(conf, /file_server/, "static files are served");
  } finally {
    await run.cleanup();
  }
});

test("caddy does not run without its flag, nor without a site model", async () => {
  const off = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true });
  try {
    assert.ok(!off.ctx.written.some((f) => /^caddy\//.test(f)), "no caddy without the flag");
  } finally {
    await off.cleanup();
  }

  const noSite = await runPipeline({ src: join(ROOT, "example/legacy"), caddy: true });
  try {
    assert.equal(noSite.error, null);
    assert.ok(!noSite.ctx.written.some((f) => /^caddy\//.test(f)), "no caddy without a site model");
    assert.ok(noSite.ctx.report.unverified.some((n) => /Caddy target needs --site/.test(n)));
  } finally {
    await noSite.cleanup();
  }
});

test("the redirect map matches the nginx target's, spelled in Caddy's dialect", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, caddy: true, nginx: true });
  try {
    assert.equal(run.error, null);
    const caddy = await readFile(join(run.out, "caddy/Caddyfile"), "utf8");
    const nginxRel = run.ctx.written.find((f) => /^nginx\/.*\.conf$/.test(f));
    const nginx = await readFile(join(run.out, nginxRel), "utf8");
    const caddyCount = (caddy.match(/redir \S+ \S+ 301/g) ?? []).length;
    const nginxCount = (nginx.match(/return 301/g) ?? []).length;
    assert.equal(caddyCount, nginxCount, "both hosts carry the same number of 301s");
  } finally {
    await run.cleanup();
  }
});
