/**
 * A cloud architecture adviser, drawn from a real large language model.
 *
 * portamp's own transformer (vis-transformer) is a two thousand parameter
 * demonstration; it cannot design a cloud system, and this plugin does not
 * pretend it can. This asks a genuine frontier model, through the Anthropic
 * Messages API, to propose an architecture for the app the run just read, and
 * writes the answer down as exactly what it is: a proposal from an external
 * model, unverified, for a human cloud architect to prove or discard.
 *
 * It obeys the same rules every live plugin does. The network call is gated by
 * the policy object as a billable live call, so it runs only under
 * --allow-live and --allow-billable with an attestation, never by default. The
 * API key is read from the environment at call time and never read from the
 * source, printed, or written anywhere. Nothing here is cached into the port.
 *
 * Zero dependency: the call is a plain fetch, not the SDK, so the tool keeps
 * its no runtime dependency contract. The model is asked, not trusted; every
 * word it returns is marked unverified.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-5";

/**
 * Build the system and user prompts from the run's own facts. The system
 * prompt fixes the model as a careful cloud architect that states its
 * assumptions and never presents a guessed number as measured. The user
 * prompt carries the concrete question and whatever the run actually found:
 * the endpoints the app calls, the routes the site has, the archetype dsp
 * read. It never invents facts the run did not produce.
 */
export function buildArchitectPrompt({ ask, api, site, archetype } = {}) {
  const facts = [];
  const calls = api?.calls ?? [];
  if (calls.length) {
    const lines = calls
      .slice(0, 40)
      .map((c) => `- ${String(c.method || "GET").toUpperCase()} ${c.path}`)
      .sort();
    facts.push(`Endpoints the app calls (${calls.length}):\n${lines.join("\n")}`);
  }
  const pages = site?.pages ?? [];
  if (pages.length) {
    const routes = pages.map((p) => p.route).filter(Boolean).sort();
    facts.push(`Routes the front end serves (${routes.length}): ${routes.slice(0, 40).join(", ")}`);
  }
  if (archetype?.reading) facts.push(`The app reads as: ${archetype.reading}.`);

  const factBlock = facts.length
    ? `\n\nWhat portamp read from the app (use only these as given facts):\n${facts.join("\n\n")}`
    : "\n\nportamp read no endpoints or routes from this app; treat the request as a general design question.";

  const question =
    ask ||
    "Propose a production cloud architecture for this application on AWS, and note how it would differ on Google Cloud and on Azure. Cover compute, data, networking, the CDN and static hosting, secrets, observability, and the hardest scaling and failure modes. Give the tradeoffs, not just a diagram.";

  return {
    system:
      "You are a senior cloud architect. Propose concrete, buildable architectures and name the tradeoffs. " +
      "State every assumption you make explicitly. Never present a number you cannot derive (cost, latency, throughput) " +
      "as measured fact; call it an estimate and say what it depends on. Prefer managed services with clear failure " +
      "modes. When the requirements are underspecified, say what you would need to know and give a sensible default. " +
      "Be precise and honest about what is hard.",
    user: `${question}${factBlock}`,
  };
}

/**
 * Post one message to the Anthropic Messages API with a plain fetch and return
 * the concatenated text of the response. fetchImpl is injectable so the plugin
 * can be tested without a network or a key; it defaults to the global fetch.
 * The key is passed in, never read here from anywhere persistent.
 */
/**
 * Pull the cited sources out of a response's content blocks. When the model
 * grounds an answer with the web search tool, each text block it wrote from a
 * source carries a citations array; this collects the urls and titles so the
 * report can list them and the reader can check the model's work.
 */
export function extractCitations(content) {
  const out = [];
  const seen = new Set();
  for (const b of content ?? []) {
    if (!b || b.type !== "text" || !Array.isArray(b.citations)) continue;
    for (const c of b.citations) {
      const url = c && c.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title: (c.title || url).toString() });
    }
  }
  return out;
}

/**
 * Post to the Anthropic Messages API with a plain fetch and return the text.
 * With webSearch on, the model's own web search tool is offered so the answer
 * is grounded in current sources it cites, not only its training; the server
 * runs the search and may pause the turn to do it, so this resumes the turn a
 * bounded number of times until the model finishes, then appends the cited
 * sources. fetchImpl is injectable so the whole path is testable without a
 * network or a key. The key is passed in, never read here from anywhere.
 */
export async function callAnthropic({
  apiKey,
  model,
  system,
  user,
  maxTokens = 16000,
  fetchImpl,
  webSearch = false,
  maxSearchUses = 5,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") throw new Error("no fetch available in this runtime");
  const tools = webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearchUses }] : undefined;
  const messages = [{ role: "user", content: user }];
  const textParts = [];
  const citations = [];

  // The web search tool runs server side; the model can pause the turn to run
  // it and resume. Loop a bounded number of times, resending the assistant
  // content each pause so the server continues, and stop when the turn ends.
  for (let step = 0; step < 6; step++) {
    const body = { model: model || DEFAULT_MODEL, max_tokens: maxTokens, system, messages };
    if (tools) body.tools = tools;
    const res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // The body can echo request detail; keep it short and never assume it is safe to store.
      throw new Error(`Anthropic API returned ${res.status} ${res.statusText} ${detail.slice(0, 200)}`.trim());
    }
    const data = await res.json();
    const content = data.content ?? [];
    for (const b of content) if (b && b.type === "text" && typeof b.text === "string") textParts.push(b.text);
    for (const c of extractCitations(content)) if (!citations.some((x) => x.url === c.url)) citations.push(c);
    if (data.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content });
      continue;
    }
    break;
  }

  let text = textParts.join("\n").trim();
  if (!text) throw new Error("the model returned no text");
  if (webSearch && citations.length) {
    text += "\n\n## Sources\n" + citations.map((c) => `- [${c.title}](${c.url})`).join("\n");
  }
  return text;
}

/** Wrap the model's answer in a header that states plainly what it is and is not. */
export function renderArchitecture({ model, ask, answer } = {}) {
  return [
    "# A cloud architecture proposal",
    "",
    `Drafted by an external large language model (\`${model}\`) through the Anthropic`,
    "Messages API. This is **not** produced by portamp's own transformer, which is a",
    "tiny demonstration and cannot design a system. It is a proposal, not a verified",
    "design: every service, size, cost and latency in it is the model's suggestion for",
    "a human cloud architect to check, price and prove. portamp asked; it did not",
    "confirm. No credential was read or stored to produce this.",
    "",
    "## The question",
    "",
    (ask || "(the run's default architecture question)").trim(),
    "",
    "## The proposal",
    "",
    String(answer).trim(),
    "",
    "---",
    "",
    "Treat the above as a starting point to argue with, not an answer to adopt. The",
    "model can be confidently wrong; nothing here was measured against a running system.",
    "",
  ].join("\n");
}

export default {
  name: "general-architect",
  version: "0.1.0",
  class: "general",
  setup({ on, log, policy }) {
    on("emit", async (ctx) => {
      if (!ctx.config.architect) return log.debug("not requested");

      // A live, billable call: it leaves the machine and charges an account,
      // so both gates must be open and the attestation present. This throws a
      // policy violation otherwise, the same refusal every live plugin gives.
      policy.assertBillableAllowed(ENDPOINT);

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        ctx.unverified(
          "general-architect was asked to run but ANTHROPIC_API_KEY is not set, so no architecture was drafted. " +
            "Set the key in your own environment (portamp never reads it from source, prints it, or writes it) and re run."
        );
        return log.info("no ANTHROPIC_API_KEY in the environment; nothing drafted");
      }

      const ask = ctx.config["architect-ask"] ?? ctx.config.architectAsk ?? null;
      const model = ctx.config["architect-model"] ?? ctx.config.architectModel ?? DEFAULT_MODEL;
      // With --web-search the model grounds the answer in current sources it cites.
      const webSearch = Boolean(ctx.config["web-search"] ?? ctx.config.webSearch);
      const { system, user } = buildArchitectPrompt({ ask, api: ctx.api, site: ctx.site, archetype: ctx.archetype });

      // Injectable so the plugin is testable with no network or key; the real
      // path uses the global fetch inside callAnthropic.
      const caller = ctx.config.architectClient ?? callAnthropic;

      let answer;
      try {
        answer = await caller({ apiKey, model, system, user, webSearch });
      } catch (err) {
        ctx.unverified(
          `general-architect called ${model} and the call failed (${err.message}). No architecture was written; ` +
            "the run is otherwise complete."
        );
        return log.info(`architecture call failed: ${err.message}`);
      }

      await ctx.write("ARCHITECTURE.md", renderArchitecture({ model, ask, answer }));
      ctx.unverified(
        `ARCHITECTURE.md is a proposal drafted by an external large language model (${model}), not by portamp's own ` +
          "transformer and not verified. Every service, sizing, cost and failure mode in it is a suggestion for a human " +
          "cloud architect to prove; the model can be confidently wrong."
      );
      log.info(`architecture proposal drafted by ${model} (${String(answer).length} chars), written unverified`);
    });
  },
};
