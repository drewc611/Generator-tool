import assert from "node:assert/strict";
import test from "node:test";

import architect, {
  buildArchitectPrompt,
  callAnthropic,
  renderArchitecture,
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
