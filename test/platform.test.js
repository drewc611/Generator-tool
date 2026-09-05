import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { readPlatform } from "../plugins/dsp-platform/index.js";
import { ROOT, runPipeline } from "./helpers.js";

/**
 * The browser the old front end was written for is gone; this names what it
 * called that went with it, and what replaced each, and rewrites nothing.
 */

test("a removed, a deprecated and a never standard API are each found by name with their line", () => {
  const found = readPlatform(
    `var db = openDatabase("shop", "1", "x", 1);\nel.attachEvent("onclick", go);\nvar k = e.keyCode;\nfetch(url);\nvar s = escape(secretValue);`,
    "a.js"
  );
  const by = (api) => found.find((f) => f.api.startsWith(api));
  assert.equal(by("Web SQL").status, "removed"); assert.equal(by("Web SQL").since, 2023); assert.equal(by("Web SQL").line, 1);
  assert.equal(by("attachEvent").status, "never standard");
  assert.equal(by("event.keyCode").line, 3);
  assert.equal(by("escape()").use, "encodeURIComponent / decodeURIComponent");
  assert.ok(!found.some((f) => f.api.includes("fetch")), "a current API is not a finding");
  assert.ok(!JSON.stringify(found).includes("secretValue") && !JSON.stringify(found).includes("shop"), "arguments are never captured");
});

test("look alikes are not findings", () => {
  const found = readPlatform(`myescape(x); obj.unescapeHtml(y); const withdraw = 1; f(withx); document.allowed = 1; document.domain === "a"; xhr.open("GET", u, true);`, "b.js");
  assert.deepEqual(found, []);
});

test("a run writes PLATFORM.md with the removed APIs first and the html manifest counted", async () => {
  const run = await runPipeline({ src: join(ROOT, "test/fixtures/platform-app") });
  try {
    assert.equal(run.error, null);
    assert.ok(run.ctx.written.includes("PLATFORM.md"));
    const apis = run.ctx.platform.apis.map((a) => a.api);
    for (const a of ["Web SQL (openDatabase)", "mutation events", "document.all", "event.keyCode / which / charCode", "escape() / unescape()", "Date.prototype.getYear / setYear", "user agent sniffing", "attachEvent / detachEvent", "unload event", "synchronous XMLHttpRequest", "vendor prefixed API", "String.prototype.substr", "Application Cache"]) {
      assert.ok(apis.includes(a), `${a} is found`);
    }
    assert.deepEqual(run.ctx.platform.removed.map((a) => a.api).sort(), ["Application Cache", "Web SQL (openDatabase)", "mutation events"]);
    const md = await readFile(join(run.out, "PLATFORM.md"), "utf8");
    assert.match(md, /\*\*Web SQL \(openDatabase\)\*\*, gone since 2023/);
    assert.match(md, /index\.html/, "the appcache manifest attribute is located in the page");
    assert.match(md, /legacy\.js:?/);
    assert.ok(!md.includes("2 * 1024") && !md.includes("MSIE"), "no argument is repeated");
  } finally {
    await run.cleanup();
  }
});
