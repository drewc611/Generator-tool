import assert from "node:assert/strict";
import test from "node:test";

import architect, {
  buildArchitectPrompt,
  callAnthropic,
  renderArchitecture,
  extractCitations,
} from "../plugins/general-architect/index.js";

/**
 * general-architect asks a real external model to design a cloud architecture.
 * These hold its honest edges without a network or a key: the prompt carries
 * the run's own facts, the wrapper says plainly the answer is unverified and
 * not the tool's own, the parser reads the Messages API shape, and the plugin
 * refuses to reach the network unless the live and billable gates are open.
 */

test("the prompt carries the run's own endpoints and routes", () => {
  const { system, user } = buildArchitectPrompt({
    ask: "Design this on AWS.",
    api: { calls: [{ method: "get", path: "/orders" }, { method: "post", path: "/pay" }] },
    site: { pages: [{ route: "/" }, { route: "/cart" }] },
  });
  assert.match(system, /cloud architect/i);
  assert.match(user, /Design this on AWS\./);
  assert.match(user, /GET \/orders/);
  assert.match(user, /POST \/pay/);
  assert.match(user, /\/cart/);
});

test("the render wraps the answer as an unverified external proposal", () => {
  const md = renderArchitecture({ model: "claude-opus-5", ask: "Design X.", answer: "Use S3 and CloudFront." });
  assert.match(md, /claude-opus-5/);
  assert.match(md, /not.*verified|not a verified/i);
  assert.match(md, /external large language model/i);
  assert.match(md, /Use S3 and CloudFront\./);
  assert.match(md, /not.*produced by portamp's own transformer|not.*portamp's own/i);
});

test("callAnthropic posts to the API and reads the text blocks", async () => {
  let seen = null;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return {
      ok: true,
      async json() {
        return { content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "the answer" }] };
      },
    };
  };
  const out = await callAnthropic({ apiKey: "sk-test", model: "claude-opus-5", system: "s", user: "u", fetchImpl });
  assert.equal(out, "the answer");
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen.opts.headers["x-api-key"], "sk-test");
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.model, "claude-opus-5");
  assert.equal(body.messages[0].content, "u");
});

test("extractCitations pulls unique cited sources from the response", () => {
  const cites = extractCitations([
    { type: "text", text: "a", citations: [{ url: "https://aws.amazon.com/s3", title: "S3" }] },
    { type: "text", text: "b", citations: [{ url: "https://aws.amazon.com/s3", title: "S3 again" }, { url: "https://x.dev", title: "X" }] },
  ]);
  assert.deepEqual(cites.map((c) => c.url), ["https://aws.amazon.com/s3", "https://x.dev"], "deduped by url, in order");
});

test("web search grounding offers the tool, resumes a paused turn, and appends cited sources", async () => {
  const bodies = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    if (bodies.length === 1) {
      // The model pauses to run the server side search.
      return { ok: true, async json() { return { stop_reason: "pause_turn", content: [{ type: "text", text: "searching" }] }; } };
    }
    return {
      ok: true,
      async json() {
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Use S3.", citations: [{ url: "https://aws.amazon.com/s3", title: "Amazon S3" }] }],
        };
      },
    };
  };
  const out = await callAnthropic({ apiKey: "sk", model: "claude-opus-5", system: "s", user: "u", fetchImpl, webSearch: true });
  assert.equal(bodies.length, 2, "it resumed the paused turn");
  assert.ok(bodies[0].tools?.some((t) => t.name === "web_search"), "the web search tool was offered");
  assert.match(out, /Use S3\./);
  assert.match(out, /## Sources/);
  // Assert on the cited title as a link label, not a URL substring, so the
  // check is about the rendered source list rather than parsing a URL.
  assert.ok(out.includes("[Amazon S3]"), "the cited source is listed as a link");
});

test("without web search, no tool is sent and no sources section is added", async () => {
  let body = null;
  const fetchImpl = async (u, opts) => {
    body = JSON.parse(opts.body);
    return { ok: true, async json() { return { content: [{ type: "text", text: "plain answer" }] }; } };
  };
  const out = await callAnthropic({ apiKey: "sk", model: "claude-opus-5", system: "s", user: "u", fetchImpl });
  assert.equal(body.tools, undefined, "no tools offered when grounding is off");
  assert.equal(out, "plain answer");
  assert.doesNotMatch(out, /## Sources/);
});

// A tiny harness to reach the plugin's emit handler with stubs.
function handlerOf(policy) {
  let handler = null;
  architect.setup({ on: (stage, fn) => { if (stage === "emit") handler = fn; }, log: { debug() {}, info() {} }, policy });
  return handler;
}

test("the plugin refuses to reach the network when the billable gate is closed", async () => {
  const handler = handlerOf({
    assertBillableAllowed() {
      throw new Error("Refusing to call: live calls are off by default");
    },
  });
  let reached = false;
  const ctx = {
    config: { architect: true, architectClient: async () => { reached = true; return "x"; } },
    write: async () => {},
    unverified: () => {},
  };
  await assert.rejects(() => handler(ctx), /Refusing to call/);
  assert.equal(reached, false, "it never called the model");
});

test("with the gates open and a key, it writes an unverified proposal from the injected model", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    const handler = handlerOf({ assertBillableAllowed: () => true });
    const written = {};
    const notes = [];
    const ctx = {
      config: {
        architect: true,
        architectClient: async ({ user }) => `PROPOSAL for: ${user.slice(0, 10)}`,
      },
      api: { calls: [{ method: "get", path: "/orders" }] },
      site: { pages: [{ route: "/" }] },
      write: async (rel, contents) => { written[rel] = contents; },
      unverified: (t) => notes.push(t),
    };
    await handler(ctx);
    assert.ok(written["ARCHITECTURE.md"], "it wrote the report");
    assert.match(written["ARCHITECTURE.md"], /PROPOSAL for:/);
    assert.match(written["ARCHITECTURE.md"], /not.*verified/i);
    assert.ok(notes.some((n) => /unverified|not verified|proposal/i.test(n)), "it flagged the proposal unverified");
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});
