import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { callAnthropic } from "../general-architect/index.js";

/**
 * A small system of agents that reasons over the port's own analysis.
 *
 * portamp already writes a dozen reports about the app it read: the endpoint
 * map, the notes, the security and supply chain findings, the archetype. This
 * plugin retrieves the passages relevant to a question from those reports (that
 * is the R in RAG, retrieval over the run's own words, no vector database and
 * no dependency) and hands them to a few specialised agents, each a call to a
 * real frontier model with its own role: an architect, a security reviewer, a
 * cost analyst, a reliability engineer. A synthesiser agent then reconciles
 * their answers into one recommendation.
 *
 * It is honest about what it is. The agents are the external model, not
 * portamp's own transformer; every answer is a proposal, and AGENTS.md marks
 * the whole thing unverified and shows which report fed each agent, so the
 * retrieval is auditable rather than magic. The calls are live and billable,
 * gated by the policy exactly like general-architect, and the key is read from
 * the environment at call time, never from source, printed, or written.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-5";

/** The agent roster. Each is a role, a retrieval focus, and a system prompt. */
export const AGENTS = [
  {
    key: "architect",
    title: "Architect",
    focus: "the overall system design, its components and how they fit",
    system:
      "You are a senior cloud architect. Design the system: compute, data, networking, CDN, the boundaries " +
      "between services. State assumptions; never present a guessed number as measured.",
  },
  {
    key: "security",
    title: "Security reviewer",
    focus: "the threat model, authentication, secrets, network exposure and the supply chain",
    system:
      "You are a security engineer. Find the risks: auth gaps, secret handling, exposed surfaces, unpinned " +
      "third party code, the things that bite in production. Be specific about the fix.",
  },
  {
    key: "cost",
    title: "Cost analyst",
    focus: "the cost drivers and where the money goes at scale",
    system:
      "You are a cost analyst. Name the cost drivers and the tradeoffs. Every figure is an estimate that depends " +
      "on load; say so, and say what you would measure to firm it up. Never state a price as fact.",
  },
  {
    key: "reliability",
    title: "Reliability engineer",
    focus: "the failure modes, the scaling limits and the recovery story",
    system:
      "You are a reliability engineer. Name the failure modes, the scaling ceilings and how the system degrades " +
      "and recovers. Prefer designs whose failures are observable and bounded.",
  },
];

/** Lowercase word tokens, three letters or more, so retrieval scores on content words. */
export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/**
 * Split each corpus document into paragraph chunks tagged with their source,
 * then rank the chunks against the query by a small BM25 style score: a term's
 * weight is its rarity across chunks (idf) times its presence in the chunk.
 * Deterministic: ties break by the chunk's position, so the same corpus and
 * query always retrieve the same passages.
 */
export function retrieve(corpus, query, k = 6) {
  const chunks = [];
  for (const doc of corpus) {
    const parts = String(doc.text)
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 20);
    parts.forEach((text, i) => chunks.push({ source: doc.rel, text, order: chunks.length + i, terms: tokenize(text) }));
  }
  if (!chunks.length) return [];

  const df = new Map();
  for (const c of chunks) {
    for (const t of new Set(c.terms)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = chunks.length;
  const idf = (t) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));

  const qTerms = [...new Set(tokenize(query))];
  const scored = chunks.map((c) => {
    const counts = new Map();
    for (const t of c.terms) counts.set(t, (counts.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of qTerms) if (counts.has(t)) score += idf(t) * (1 + Math.log(counts.get(t)));
    return { source: c.source, text: c.text, score, order: c.order };
  });
  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, k)
    .map(({ source, text, score }) => ({ source, text, score }));
}

/** The prompt for one agent: its role focus, the question, and the retrieved context. */
export function buildAgentPrompt({ agent, question, context }) {
  const ctxBlock = context.length
    ? context.map((c) => `[from ${c.source}]\n${c.text}`).join("\n\n")
    : "(no relevant passages were retrieved from the port's reports; answer from the question alone and say so)";
  return {
    system: agent.system + " Answer only for your role. If the retrieved context does not cover something you need, say what is missing rather than inventing it.",
    user:
      `Question: ${question}\n\nYour focus: ${agent.focus}.\n\n` +
      `Context retrieved from the port's own analysis:\n${ctxBlock}\n\n` +
      "Give your role's assessment, grounded in the context where it applies.",
  };
}

/** The synthesiser prompt: reconcile the agents' answers into one recommendation. */
export function buildSynthesisPrompt({ question, answers }) {
  const block = answers.map((a) => `## ${a.title}\n${a.answer}`).join("\n\n");
  return {
    system:
      "You are the lead architect reconciling your team's reviews into one recommendation. Resolve conflicts " +
      "explicitly, name the decisions that matter, and keep every estimate marked as an estimate.",
    user: `Question: ${question}\n\nThe team's assessments:\n\n${block}\n\nWrite the reconciled recommendation.`,
  };
}

/** Read the port's own reports off disk as the retrieval corpus. */
async function readReportCorpus(ctx) {
  const out = ctx.config.out;
  const written = ctx.written ?? [];
  const reports = written.filter((rel) => rel.endsWith(".md") && !rel.startsWith("codemod/"));
  const corpus = [];
  for (const rel of reports) {
    const text = await readFile(join(out, rel), "utf8").catch(() => "");
    if (text.trim()) corpus.push({ rel, text });
  }
  return corpus;
}

export function renderAgents({ question, model, agents, synthesis }) {
  const parts = [
    "# A system of agents over the port's own analysis",
    "",
    `Retrieval augmented and multi agent: passages relevant to the question were retrieved from the reports this`,
    `run wrote (the R in RAG, over the port's own words, no vector database), then handed to specialised agents,`,
    `each a call to an external large language model (\`${model}\`). A synthesiser reconciled their answers. This`,
    "is **not** portamp's own transformer, which cannot reason about a system; every answer is a proposal, unverified,",
    "for a human to prove. The sources each agent read are shown so the retrieval is auditable, not magic.",
    "",
    "## The question",
    "",
    question.trim(),
    "",
  ];
  for (const a of agents) {
    parts.push(`## ${a.title}`, "");
    parts.push(a.answer.trim(), "");
    const sources = [...new Set(a.context.map((c) => c.source))];
    parts.push(`_Retrieved from: ${sources.length ? sources.map((s) => `\`${s}\``).join(", ") : "no matching passages"}._`, "");
  }
  parts.push("## The reconciled recommendation", "", synthesis.trim(), "");
  parts.push(
    "---",
    "",
    "Every section above is a proposal from an external model over the port's own reports, not a verified design.",
    "The models can be confidently wrong; nothing here was measured against a running system.",
    ""
  );
  return parts.join("\n");
}

export default {
  name: "general-agents",
  version: "0.1.0",
  class: "general",
  setup({ on, log, policy }) {
    // verify runs after emit, so the reports the agents retrieve from are on disk.
    on("verify", async (ctx) => {
      if (!ctx.config.agents) return log.debug("not requested");

      policy.assertBillableAllowed(ENDPOINT);

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        ctx.unverified(
          "general-agents was asked to run but ANTHROPIC_API_KEY is not set, so no agents ran. Set the key in your " +
            "own environment (portamp never reads it from source, prints it, or writes it) and re run."
        );
        return log.info("no ANTHROPIC_API_KEY in the environment; no agents ran");
      }

      const question =
        ctx.config["agents-ask"] ??
        ctx.config.agentsAsk ??
        "Propose a production cloud architecture for this application, and review it for security, cost and reliability.";
      const model = ctx.config["agents-model"] ?? ctx.config.agentsModel ?? DEFAULT_MODEL;
      // With --web-search the agents ground their answers in current sources the model cites.
      const webSearch = Boolean(ctx.config["web-search"] ?? ctx.config.webSearch);
      const caller = ctx.config.agentsClient ?? callAnthropic;
      const corpus = ctx.config.agentsCorpus ?? (await readReportCorpus(ctx));

      let agents;
      let synthesis;
      try {
        // The agents run concurrently; their outputs are collected in a fixed
        // role order so the report is deterministic regardless of which returns first.
        agents = await Promise.all(
          AGENTS.map(async (agent) => {
            const context = retrieve(corpus, `${question} ${agent.focus}`, 6);
            const { system, user } = buildAgentPrompt({ agent, question, context });
            const answer = await caller({ apiKey, model, system, user, webSearch });
            return { key: agent.key, title: agent.title, answer, context };
          })
        );
        const synth = buildSynthesisPrompt({ question, answers: agents });
        synthesis = await caller({ apiKey, model, system: synth.system, user: synth.user, webSearch });
      } catch (err) {
        ctx.unverified(
          `general-agents called ${model} and a call failed (${err.message}). No agent report was written; the run ` +
            "is otherwise complete."
        );
        return log.info(`agent run failed: ${err.message}`);
      }

      await ctx.write("AGENTS.md", renderAgents({ question, model, agents, synthesis }));
      ctx.unverified(
        `AGENTS.md is a multi agent, retrieval augmented reasoning pass over the port's own reports, drafted by an ` +
          `external large language model (${model}) and reconciled by a synthesiser agent. It is not portamp's own ` +
          "transformer and not verified; every architecture, risk, cost and failure mode in it is a proposal for a person to prove."
      );
      log.info(`agents ran: ${agents.length} role agents plus a synthesiser over ${corpus.length} report(s), written unverified`);
    });
  },
};
