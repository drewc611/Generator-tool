import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { assess, readBanner, readManifest, readScriptTags } from "../plugins/dsp-deps/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The libraries the old front end stands on, by version, with only what each
 * project published about that version. Not assessed means not assessed.
 */

test("a manifest gives up each dependency with its first stated version, and names an unpinned one", () => {
  const found = readManifest(`{"dependencies":{"angular":"1.8.3","jquery":"^1.12.4","lodash":"*","x":"latest"},"devDependencies":{"karma":"~6.4.0"}}`, "package.json");
  const by = Object.fromEntries(found.map((f) => [f.name, f.version]));
  assert.equal(by.angular, "1.8.3");
  assert.equal(by.jquery, "1.12.4");
  assert.equal(by.karma, "6.4.0");
  assert.equal(by.lodash, null, "a star pins nothing");
  assert.equal(by.x, null);
  assert.equal(found.find((f) => f.name === "karma").evidence.how, "devDependencies");
  assert.deepEqual(readManifest("not json", "package.json"), []);
});

test("a script tag names its library by file name, cdnjs path or @version, and the line is kept", () => {
  const found = readScriptTags(
    `<script src="a/jquery-1.8.3.min.js"></script>\n<script src="https://cdnjs.cloudflare.com/ajax/libs/vue/2.6.14/vue.min.js"></script>\n` +
    `<script src="https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/js/bootstrap.bundle.min.js"></script>\n<script src="app.js"></script>`,
    "index.html"
  );
  assert.deepEqual(found.map((f) => [f.name, f.version, f.evidence.line]), [["jquery", "1.8.3", 1], ["vue", "2.6.14", 2], ["bootstrap", "4.6.2", 3]]);
  assert.ok(!/https?:\/\//.test(JSON.stringify(found)), "the host is not repeated; the library and version are the fact");
});

test("a vendored library's banner states its version, and only the first line is read", () => {
  assert.deepEqual(readBanner(`/*! jQuery v1.8.3 jquery.com | jquery.org/license */\nx`, "v/j.js"), { name: "jquery", version: "1.8.3", evidence: { file: "v/j.js", line: 1, how: "banner" } });
  assert.equal(readBanner(`// plain app code\n/*! jQuery v1.8.3 */`, "a.js"), null);
  assert.equal(readBanner(`export const x = 1;`, "a.js"), null);
});

test("a version is assessed only against a date its project published", () => {
  assert.equal(assess("angular", "1.8.3").status, "end of life");
  assert.equal(assess("angular", "1.8.3").since, "2021-12-31");
  assert.equal(assess("jquery", "1.12.4").status, "unsupported");
  assert.equal(assess("jquery", "3.5.1").status, "later than the table", "nothing is said against a version newer than the table");
  assert.equal(assess("vue", "2.6.14").status, "end of life");
  assert.equal(assess("lodash", "4.17.21").status, "not assessed");
  assert.equal(assess("lodash", null).status, "unpinned");
  assert.equal(assess("@angular/core", "16.2.0").since, "2024-11-08");
});

test("a run writes DEPENDENCIES.md naming the dated versions, the duplicate and the unpinned, and changes nothing", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/deps-app") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("DEPENDENCIES.md"));
    const deps = run.ctx.deps;
    const dated = deps.dated.map((r) => `${r.name}@${r.version}`).sort();
    for (const d of ["angular@1.8.3", "jquery@1.12.4", "jquery@1.8.3", "bootstrap@3.4.1", "bootstrap@4.6.2", "vue@2.6.14", "moment@2.29.4", "@angular/core@16.2.0"]) {
      assert.ok(dated.includes(d), `${d} is past its published date`);
    }
    assert.deepEqual(deps.duplicates.map((d) => d.name).sort(), ["bootstrap", "jquery"]);
    assert.deepEqual(deps.unpinned.map((r) => r.name), ["lodash"]);
    const jq183 = deps.libraries.find((r) => r.name === "jquery" && r.version === "1.8.3");
    assert.deepEqual(jq183.evidence.map((e) => e.how).sort(), ["banner", "dependencies", "script tag"], "three witnesses for one version merge");
    assert.equal(deps.libraries.find((r) => r.name === "karma").status, "not assessed");

    const md = await readFile(join(run.out, "DEPENDENCIES.md"), "utf8");
    assert.match(md, /`angular` \| 1\.8\.3 \| end of life since 2021-12-31/);
    assert.match(md, /`jquery`: 1\.8\.3, 1\.12\.4, 3\.5\.1/);
    assert.match(md, /`lodash`.*pins nothing/);
    assert.ok(!/https?:\/\//.test(md), "hosts belong to the supply chain report, not here");
    assert.ok(run.ctx.report.unverified.some((n) => /bower\.json/.test(n)), "bower's deprecation is noted");
  } finally {
    await run.cleanup();
  }
});
