import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { ROOT, runPipeline } from "./helpers.js";

/**
 * The port knows the cloud. output-aws turns the site model into a deterministic
 * AWS deploy plan the user reviews and applies with their own credentials. It
 * emits a plan and applies nothing; it never takes a secret; and what a plan
 * cannot know it names rather than guesses.
 */

const src = join(ROOT, "test/fixtures/repeat-site");

test("output-aws is opt in: no flag, no plan", async () => {
  const run = await runPipeline({ src, site: true });
  try {
    assert.equal(run.error, null);
    assert.ok(!run.ctx.written.some((f) => f.startsWith("aws/")), "the plan is opt in");
  } finally {
    await run.cleanup();
  }
});

test("output-aws emits an S3 + CloudFront plan carrying the redirect map, no secrets", async () => {
  const run = await runPipeline({ src, site: true, aws: true });
  try {
    assert.equal(run.error, null);
    for (const f of ["aws/main.tf", "aws/cloudfront-redirects.js", "aws/deploy.sh", "aws/README.md"]) {
      assert.ok(run.ctx.written.includes(f), `${f} was written`);
    }

    const tf = await readFile(join(run.out, "aws/main.tf"), "utf8");
    assert.match(tf, /s3/i);
    assert.match(tf, /cloudfront/i);

    const fn = await readFile(join(run.out, "aws/cloudfront-redirects.js"), "utf8");
    assert.match(fn, /301/, "the redirect map is compiled into a 301 function");

    const readme = await readFile(join(run.out, "aws/README.md"), "utf8");
    assert.match(readme, /credential|secret|aws configure/i, "it states it takes no credentials");

    // No credential-shaped string anywhere in the emitted plan.
    const files = await readdir(join(run.out, "aws"));
    for (const name of files) {
      const body = await readFile(join(run.out, "aws", name), "utf8");
      assert.doesNotMatch(body, /AKIA[0-9A-Z]{12,}/, `${name} leaks an access key id`);
      assert.doesNotMatch(body, /aws_secret_access_key\s*=\s*["'][^"']+["']/i, `${name} leaks a secret`);
    }
  } finally {
    await run.cleanup();
  }
});

test("two AWS plans over the same site are byte identical", async () => {
  const a = await runPipeline({ src, site: true, aws: true });
  const b = await runPipeline({ src, site: true, aws: true });
  try {
    const one = await readFile(join(a.out, "aws/main.tf"), "utf8");
    const two = await readFile(join(b.out, "aws/main.tf"), "utf8");
    assert.equal(one, two, "the plan is deterministic");
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});
