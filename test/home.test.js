import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port's home: the ported site deploys the way everything else does. A
 * Dockerfile wraps the zero dependency serve.js, and an nginx server block
 * serves the static export and answers every retired address with its 301.
 */

test("output-dockerfile containerizes the port around its own serve.js", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, dockerfile: true });
  try {
    assert.equal(run.error, null);
    const dockerfile = await readFile(join(run.out, "Dockerfile"), "utf8");
    assert.match(dockerfile, /serve\.js/, "the image runs the port's own server");
    assert.match(dockerfile, /EXPOSE/);
    assert.doesNotMatch(dockerfile, /^\s*RUN\s+npm\s+(ci|install)/m, "the port has no dependencies to install");
    assert.ok(run.ctx.written.includes(".dockerignore"));
    assert.ok(run.ctx.written.includes("docker-compose.yml"));
  } finally {
    await run.cleanup();
  }
});

test("output-nginx serves the export and carries the redirect map as 301s", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true, nginx: true });
  try {
    assert.equal(run.error, null);
    const confRel = run.ctx.written.find((f) => /^nginx\/.*\.conf$/.test(f));
    assert.ok(confRel, "an nginx conf was written");
    const conf = await readFile(join(run.out, confRel), "utf8");
    assert.ok((conf.match(/return 301/g) ?? []).length >= 1, "a retired address is a 301");
    assert.match(conf, /try_files/, "client routes fall through to index.html");
  } finally {
    await run.cleanup();
  }
});

test("neither deployment target runs without its flag, nor without a site model", async () => {
  const off = await runPipeline({ src: join(ROOT, "test/fixtures/repeat-site"), site: true });
  try {
    assert.ok(!off.ctx.written.includes("Dockerfile"), "no Dockerfile without the flag");
    assert.ok(!off.ctx.written.some((f) => /^nginx\//.test(f)), "no nginx without the flag");
  } finally {
    await off.cleanup();
  }

  const noSite = await runPipeline({ src: join(ROOT, "example/legacy"), dockerfile: true, nginx: true });
  try {
    assert.equal(noSite.error, null);
    assert.ok(!noSite.ctx.written.includes("Dockerfile"), "no container without a site model");
    assert.ok(noSite.ctx.report.unverified.some((n) => /Docker target needs --site/.test(n)));
  } finally {
    await noSite.cleanup();
  }
});
