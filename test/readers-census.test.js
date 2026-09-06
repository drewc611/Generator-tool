import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { census } from "../plugins/vis-readers/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * Which reader claimed each file, and which markup no reader did: the census
 * of files beside the census of screens.
 */

test("every file lands in exactly one row, and the unread row is markup only", () => {
  const files = ["a.html", "b.blade.php", "c.js", "d.css", "e.png", "f.hbs", "g.json", "layouts/app.blade.php"].map((rel) => ({ rel }));
  const screens = [{ file: "a.html", readBy: "static" }, { file: "./b.blade.php", readBy: "blade", composed: ["layouts/app.blade.php"] }];
  const c = census(files, screens);
  assert.deepEqual(c.screens.map((s) => `${s.file}:${s.reader}`), ["a.html:static", "b.blade.php:blade"]);
  assert.deepEqual(c.unread, ["f.hbs"], "a template no reader claimed is the finding; a script is not");
  assert.deepEqual(c.composed, [{ file: "layouts/app.blade.php", reader: "blade", into: 1 }], "a layout composed into a page was read, not left unclaimed");
  assert.deepEqual(c.scripts, ["c.js"]); assert.deepEqual(c.styles, ["d.css"]); assert.deepEqual(c.assets, ["e.png", "g.json"]);
  assert.equal(c.screens.length + c.composed.length + c.unread.length + c.scripts.length + c.styles.length + c.assets.length, files.length);
  assert.deepEqual(c.byReader, [["blade", 1], ["static", 1]]);
});

test("a run writes READERS.md with the reader per screen file and names the markup nobody claimed", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/ember") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("READERS.md"));
    const c = run.ctx.readers;
    assert.ok(c.byReader.some(([r]) => r === "ember") && c.byReader.some(([r]) => r === "handlebars"), "both readers are credited");
    assert.equal(c.screens.length + c.composed.length + c.unread.length + c.scripts.length + c.styles.length + c.assets.length + c.notScanned.length, c.total);
    const md = await readFile(join(run.out, "READERS.md"), "utf8");
    assert.match(md, /by ember/);
    assert.match(md, /user-card\.js/, "the class beside the template is a script the analyzers scanned, not unread");
  } finally {
    await run.cleanup();
  }
});

test("a template a reader read from a second file is claimed by that reader, and a Razor view is markup", () => {
  const files = ["orders.component.ts", "orders.component.html", "Views/_ViewStart.cshtml"].map((rel) => ({ rel }));
  const c = census(files, [{ file: "orders.component.ts", templateOrigin: "orders.component.html", readBy: "angular" }]);
  assert.deepEqual(c.screens.map((s) => s.file).sort(), ["orders.component.html", "orders.component.ts"]);
  assert.deepEqual(c.unread, ["Views/_ViewStart.cshtml"], "the skipped Razor file is unclaimed markup, not an asset");
});

test("the extensions the jinja and underscore readers claim are markup when nobody claimed them", () => {
  const c = census(["a.j2", "b.ejs", "c.tpl", "d.jinja", "e.mustache"].map((rel) => ({ rel })), []);
  assert.deepEqual(c.unread, ["a.j2", "b.ejs", "c.tpl", "d.jinja", "e.mustache"]);
  assert.deepEqual(c.assets, []);
});

test("every reader that composes a layout or a fragment into its pages records it, so the census never calls that file unread", async () => {
  for (const fixture of ["blade", "liquid", "pug", "razor", "smarty", "thymeleaf", "twig", "velocity", "freemarker", "jsp", "cfml", "haml", "slim", "twirl", "django", "ejs", "nunjucks"]) {
    const run = await runPipeline({ src: join(ROOT, "test/fixtures", fixture) });
    try {
      assert.equal(run.error, null, `${fixture} runs`);
      const c = run.ctx.readers;
      assert.deepEqual(c.unread, [], `${fixture}: ${c.unread.join(", ")} was read and composed, and must be counted so`);
      assert.ok(c.composed.length >= 1 || fixture === "freemarker" || fixture === "jsp" || fixture === "cfml", `${fixture} composed a layout or fragment into its pages`);
    } finally {
      await run.cleanup();
    }
  }
});


test("a file the scan never opened is its own row, not absent from the count and not mistaken for unclaimed markup", () => {
  const files = ["a.html"].map((rel) => ({ rel }));
  const skipped = [{ rel: "notes.sql", ext: ".sql" }, { rel: "data.dat", ext: ".dat" }];
  const c = census(files, [{ file: "a.html", readBy: "static" }], skipped);
  assert.deepEqual(c.notScanned, ["data.dat", "notes.sql"], "sorted, and never in unread, scripts, styles or assets");
  assert.deepEqual(c.unread, []);
  assert.equal(c.total, 3, "the count the scan never opened is not silently missing from the total");
  assert.equal(census(files, []).notScanned.length, 0, "the third argument is optional; an old caller with two arguments still gets a census");
});

test("a file dropped on the console with an extension no reader has asked for is named, not silently dropped", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "portamp-notscanned-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "index.html"), "<html><body><app-root></app-root></body></html>");
  await writeFile(join(dir, "notes.rtf"), "{\\rtf1 not a format any reader asks for}");
  const run = await runPipeline({ src: dir, site: true });
  try {
    assert.equal(run.error, null);
    assert.deepEqual(run.ctx.readers.notScanned, ["notes.rtf"]);
    const notes = run.ctx.report.unverified.join("\n");
    assert.match(notes, /1 file\(s\) this run never looked inside.*notes\.rtf/s);
    const md = await readFile(join(run.out, "READERS.md"), "utf8");
    assert.match(md, /notes\.rtf/);
  } finally {
    await run.cleanup();
  }
});
