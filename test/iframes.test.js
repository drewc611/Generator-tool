import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readIframes } from "../plugins/dsp-iframes/index.js";

/**
 * dsp-iframes names the iframes a legacy app embedded and the two contracts they
 * carry: a title for a screen reader and a sandbox for a third-party embed.
 * These hold its edges, including that only a cross-origin host is recorded.
 */

const MARKUP = [
  '<iframe src="https://widget.vendor.com/w?token=SECRET"></iframe>',
  '<iframe src="/local/page.html" title="Help" sandbox="allow-scripts"></iframe>',
].join("\n");

test("it flags an untitled, unsandboxed third-party embed and clears a titled, sandboxed local one", () => {
  const f = readIframes(MARKUP, "page.html");
  assert.equal(f.length, 2);
  const vendor = f[0];
  assert.equal(vendor.thirdParty, true);
  assert.equal(vendor.host, "widget.vendor.com");
  assert.ok(vendor.issues.some((i) => /no title/.test(i)));
  assert.ok(vendor.issues.some((i) => /no sandbox on a third-party/.test(i)));

  const local = f[1];
  assert.equal(local.thirdParty, false, "a relative src is same-origin");
  assert.equal(local.title, true);
  assert.equal(local.sandbox, true);
  assert.deepEqual(local.issues, []);
});

test("only the host of a cross-origin src is recorded, never its path or token", () => {
  const f = readIframes('<iframe src="https://widget.vendor.com/w?token=SECRET"></iframe>', "x.html");
  const serialized = JSON.stringify(f);
  assert.doesNotMatch(serialized, /token=SECRET|\/w\?/, "the path and query, which can carry a token, are not captured");
  assert.equal(f[0].host, "widget.vendor.com", "the origin host is recorded so the report can name the embed");
});

test("the plugin writes a report only when an iframe was found, and never writes a src path", async () => {
  assert.equal(plugin.class, "dsp");
  const dir = await mkdtemp(join(tmpdir(), "iframes-"));
  try {
    await writeFile(join(dir, "page.html"), MARKUP);
    await writeFile(join(dir, "plain.html"), "<p>no iframe here</p>");
    const handlers = {};
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    const ctx = {
      sources: { files: [
        { path: join(dir, "page.html"), rel: "page.html" },
        { path: join(dir, "plain.html"), rel: "plain.html" },
      ] },
      written: {},
      write: async (rel, contents) => { ctx.written[rel] = contents; },
      unverified: (t) => (ctx.note = t),
    };
    await handlers.plan(ctx);
    await handlers.emit(ctx);
    assert.ok(ctx.written["IFRAMES.md"], "it wrote the report");
    assert.match(ctx.written["IFRAMES.md"], /no title/);
    assert.match(ctx.written["IFRAMES.md"], /Third-party hosts embedded/, "the report names the third-party section");
    assert.equal(ctx.iframes.hosts[0], "widget.vendor.com", "the third-party host is recorded on the context");
    assert.doesNotMatch(ctx.written["IFRAMES.md"], /token=SECRET/, "no src query is written");
    assert.match(ctx.note, /title|sandbox|iframe|frame/i);

    const clean = { sources: { files: [{ path: join(dir, "plain.html"), rel: "plain.html" }] }, written: {}, write: async (r, c) => (clean.written[r] = c), unverified: () => {} };
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    await handlers.plan(clean);
    await handlers.emit(clean);
    assert.deepEqual(clean.written, {}, "no iframes, no report");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/dsp-iframes/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:/, `${line.trim()} is not a node builtin`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:\/\/[a-z]/i, "the analyzer does not reach the network");
});
