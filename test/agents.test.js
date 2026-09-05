import assert from "node:assert/strict";
import test from "node:test";

import agentsPlugin, {
  AGENTS,
  tokenize,
  retrieve,
  buildAgentPrompt,
  buildSynthesisPrompt,
  renderAgents,
} from "../plugins/general-agents/index.js";

/**
 * general-agents is a retrieval augmented, multi agent pass over the port's own
 * reports. These hold its honest edges with no network or key: retrieval ranks
 * the relevant passage from the run's own words, each agent's prompt carries
 * its role and its retrieved context, the report is auditable and marked
 * unverified, and the plugin refuses to reach the network unless the gates open.
 */

test("retrieval ranks the passage that matches the query, from the run's own reports", () => {
  const corpus = [
    { rel: "SECURITY.md", text: "The app ships no Content Security Policy.\n\nAn inline handler a CSP would forbid." },
    { rel: "API_FIELDS.md", text: "GET /orders returns a list of orders.\n\nPOST /pay charges the card." },
  ];
  const hits = retrieve(corpus, "content security policy risk", 3);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].source, "SECURITY.md", "the security passage wins for a security query");

  const api = retrieve(corpus, "orders list and pay card", 3);
  assert.equal(api[0].source, "API_FIELDS.md", "the endpoint passage wins for a query in its own words");

  // Deterministic: same corpus and query, same ranking.
  assert.deepEqual(retrieve(corpus, "content security policy risk", 3), hits);
});

test("tokenize keeps content words and drops punctuation and short words", () => {
  assert.deepEqual(tokenize("The CSP is a policy."), ["the", "csp", "policy"]);
});

test("an agent prompt carries its role and the retrieved context", () => {
  const context = [{ source: "SECURITY.md", text: "no Content Security Policy" }];
  const { system, user } = buildAgentPrompt({ agent: AGENTS[1], question: "Review this", context });
  assert.match(system, /security engineer/i);
  assert.match(user, /Review this/);
  assert.match(user, /from SECURITY\.md/);
  assert.match(user, /no Content Security Policy/);
});

test("the synthesis prompt reconciles the agents' answers", () => {
  const { user } = buildSynthesisPrompt({
    question: "Design it",
    answers: [{ title: "Architect", answer: "Use S3." }, { title: "Cost analyst", answer: "S3 is cheap." }],
  });
  assert.match(user, /Architect/);
  assert.match(user, /Use S3\./);
  assert.match(user, /Cost analyst/);
});

test("the render shows each agent, its sources, the synthesis, and marks it unverified", () => {
  const md = renderAgents({
    question: "Design it",
    model: "claude-opus-5",
    agents: [
      { title: "Architect", answer: "Use S3 and CloudFront.", context: [{ source: "API_FIELDS.md", text: "x" }] },
      { title: "Security reviewer", answer: "Add a CSP.", context: [{ source: "SECURITY.md", text: "y" }] },
    ],
    synthesis: "Ship it with a CSP.",
  });
  assert.match(md, /## Architect/);
  assert.match(md, /Use S3 and CloudFront\./);
  assert.match(md, /Retrieved from: `API_FIELDS\.md`/);
  assert.match(md, /## The reconciled recommendation/);
  assert.match(md, /Ship it with a CSP\./);
  assert.match(md, /unverified/i);
  assert.match(md, /not.*portamp's own transformer/i);
});

function handlerOf(policy) {
  let handler = null;
  agentsPlugin.setup({ on: (stage, fn) => { if (stage === "verify") handler = fn; }, log: { debug() {}, info() {} }, policy });
  return handler;
}

test("the agents refuse to reach the network when the billable gate is closed", async () => {
  const handler = handlerOf({ assertBillableAllowed() { throw new Error("Refusing to call: live off"); } });
  let reached = false;
  const ctx = {
    config: { agents: true, agentsClient: async () => { reached = true; return "x"; } },
    write: async () => {},
    unverified: () => {},
  };
  await assert.rejects(() => handler(ctx), /Refusing to call/);
  assert.equal(reached, false);
});

test("with the gates open and a key, the agents write an unverified report from the injected model", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    const handler = handlerOf({ assertBillableAllowed: () => true });
    const written = {};
    const seenRoles = [];
    const ctx = {
      config: {
        agents: true,
        agentsCorpus: [{ rel: "SECURITY.md", text: "no Content Security Policy" }],
        // Echo which role called, so we can assert every agent plus the synthesiser ran.
        agentsClient: async ({ system }) => {
          seenRoles.push(system.slice(0, 24));
          return `answer for ${system.slice(0, 16)}`;
        },
      },
      write: async (rel, contents) => { written[rel] = contents; },
      unverified: () => {},
    };
    await handler(ctx);
    assert.ok(written["AGENTS.md"], "it wrote the agent report");
    assert.match(written["AGENTS.md"], /## Architect/);
    assert.match(written["AGENTS.md"], /## The reconciled recommendation/);
    assert.match(written["AGENTS.md"], /unverified/i);
    assert.ok(seenRoles.length === AGENTS.length + 1, "every role agent plus the synthesiser called the model");
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});
