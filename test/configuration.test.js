import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readEnv, readDotenvNames, isDotenv, isDotenvExample } from "../plugins/dsp-env/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The configuration surface: every key the old front end asks its environment
 * for, named with where it is read and never with a value, because the source
 * states the name and not the value, and the port must not invent one.
 */

test("process.env, import.meta.env, the environment module and a window config object are read by key", () => {
  const found = readEnv(
    `import { environment } from "../environments/environment";\n` +
    `const a = process.env.API_URL || "http://hidden-value";\nconst b = process.env["REGION"];\n` +
    `const c = import.meta.env.VITE_KEY ?? "x";\nconst d = environment.apiUrl;\nconst e = window.__ENV__.TENANT;\nconst f = window.appConfig.theme;`,
    "a.js"
  );
  const by = (source) => found.filter((f) => f.source === source).map((f) => f.key);
  assert.deepEqual(by("process.env"), ["API_URL", "REGION"]);
  assert.deepEqual(by("import.meta.env"), ["VITE_KEY"]);
  assert.deepEqual(by("environment module"), ["apiUrl"]);
  assert.deepEqual(by("window.__ENV__"), ["TENANT"]);
  assert.deepEqual(by("window.appConfig"), ["theme"]);
  assert.equal(found.find((f) => f.key === "API_URL").fallback, true, "the || marks a fallback");
  assert.equal(found.find((f) => f.key === "REGION").fallback, false);
  assert.equal(found.find((f) => f.key === "REGION").line, 3, "the line is kept");
  assert.ok(!JSON.stringify(found).includes("hidden-value"), "the fallback literal is never captured");
});

test("environment.x is a configuration read only where the environment module is imported", () => {
  const found = readEnv(`const environment = detect();\nconst x = environment.name;`, "b.js");
  assert.equal(found.length, 0, "a local called environment is not the Angular module");
});

test("a .env file gives up its names and never its values", () => {
  const names = readDotenvNames(`# comment\nAPI_URL=http://localhost:9999\nexport TOKEN=abc123secret\n\nBAD LINE\nAPI_URL=again`);
  assert.deepEqual(names, ["API_URL", "TOKEN"]);
  assert.ok(!names.join().includes("secret") && !names.join().includes("localhost"));
  assert.ok(isDotenv(".env") && isDotenv("config/.env.production") && isDotenv(".env.example"));
  assert.ok(isDotenvExample(".env.example") && isDotenvExample(".env.sample") && !isDotenvExample(".env.production"));
  assert.ok(!isDotenv("environment.ts") && !isDotenv(".envrc"));
});

test("a run writes ENV.md and a blank .env.example, and names the live .env it did not read", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/env-app") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("ENV.md"));
    assert.ok(run.ctx.written.includes(".env.example"));

    const env = run.ctx.env;
    const keys = env.entries.map((e) => e.key);
    for (const k of ["API_URL", "REGION", "FEATURE_BETA", "VITE_SENTRY_DSN", "VITE_BUILD", "apiUrl", "analyticsId", "TENANT", "theme"]) {
      assert.ok(keys.includes(k), `${k} is read`);
    }
    assert.deepEqual(env.undeclared.map((e) => e.key), ["VITE_SENTRY_DSN"], "the one key with no fallback and no declaration");
    assert.deepEqual(env.readNever, ["UNUSED_LEGACY_KEY"]);
    assert.deepEqual(env.liveFiles, [".env"]);

    const md = await readFile(join(run.out, "ENV.md"), "utf8");
    assert.match(md, /`VITE_SENTRY_DSN`/);
    assert.match(md, /src\/app\.js:2/, "the read is located");
    assert.match(md, /\.env\.example.*an example file/);
    assert.match(md, /holds real values/);
    assert.ok(!md.includes("localhost:9999") && !md.includes("us-east-1"), "no value from the live .env is repeated");

    const example = await readFile(join(run.out, ".env.example"), "utf8");
    for (const k of ["API_URL=", "REGION=", "FEATURE_BETA=", "VITE_SENTRY_DSN=", "VITE_BUILD="]) assert.match(example, new RegExp(`^${k}$`, "m"));
    assert.doesNotMatch(example, /TENANT|apiUrl/, "server and build supplied keys stay out of the process file");
    assert.ok(!example.includes("9999"), "no value is carried");
  } finally {
    await run.cleanup();
  }
});
