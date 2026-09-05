import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import plugin, { readMedia } from "../plugins/dsp-media/index.js";

/**
 * dsp-media names the video and audio a legacy app embedded and the contract it
 * carried: captions, controls, autoplay. These hold its edges, including that a
 * captioned, controlled video is left with no gap.
 */

const MARKUP = [
  '<video src="a.mp4" autoplay></video>',
  '<video controls><track kind="captions" src="c.vtt"></video>',
  '<audio src="b.mp3" controls></audio>',
].join("\n");

test("it flags a video with no captions and an autoplay, and clears a captioned one", () => {
  const f = readMedia(MARKUP, "page.html");
  assert.equal(f.length, 3);
  const first = f[0];
  assert.equal(first.kind, "video");
  assert.equal(first.captions, false, "the first video has no track");
  assert.ok(first.issues.some((i) => /no captions/.test(i)));
  assert.ok(first.issues.some((i) => /autoplay/.test(i)));

  const second = f[1];
  assert.equal(second.captions, true, "the second video carries a captions track");
  assert.deepEqual(second.issues, [], "a captioned, controlled video has no gap");
});

test("a video with neither controls nor autoplay is flagged as unstartable", () => {
  const f = readMedia('<video src="x.mp4"><track kind="captions" src="c.vtt"></video>', "x.html");
  assert.ok(f[0].issues.some((i) => /nothing starts it/.test(i)));
});

test("the src is never recorded in a finding", () => {
  const f = readMedia('<video src="https://cdn.example.com/signed?token=abc"></video>', "x.html");
  const serialized = JSON.stringify(f);
  assert.doesNotMatch(serialized, /token=abc|cdn\.example\.com/, "the src, which can carry a signed URL, is not captured");
});

test("the plugin writes a report only when a media element was found", async () => {
  assert.equal(plugin.class, "dsp");
  const dir = await mkdtemp(join(tmpdir(), "media-"));
  try {
    await writeFile(join(dir, "page.html"), MARKUP);
    await writeFile(join(dir, "plain.html"), "<p>no media here</p>");
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
    assert.ok(ctx.written["MEDIA.md"], "it wrote the report");
    assert.match(ctx.written["MEDIA.md"], /no captions track/);
    assert.equal(ctx.media.noCaptions, 1);
    assert.match(ctx.note, /caption|video|audio|media/i);

    const clean = { sources: { files: [{ path: join(dir, "plain.html"), rel: "plain.html" }] }, written: {}, write: async (r, c) => (clean.written[r] = c), unverified: () => {} };
    plugin.setup({ on: (stage, fn) => (handlers[stage] = fn), log: { info() {}, debug() {} } });
    await handlers.plan(clean);
    await handlers.emit(clean);
    assert.deepEqual(clean.written, {}, "no media, no report");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no dependency was added and nothing reaches the network", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../plugins/dsp-media/index.js", import.meta.url), "utf8");
  for (const line of source.split("\n").filter((l) => l.startsWith("import "))) {
    assert.match(line, /from "node:/, `${line.trim()} is not a node builtin`);
  }
  assert.doesNotMatch(source, /\bfetch\(|https?:\/\//, "the analyzer does not reach the network");
});
