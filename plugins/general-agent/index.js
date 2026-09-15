import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fetchOne, requireAttestation } from "../general-scrape/index.js";
import { searchWeb } from "../general-search/index.js";
import { buildSearchUrl } from "../general-search/search.js";
import { agentReport, FIELDS, interpretInstruction } from "./instruction.js";

/**
 * Agent: one plain instruction, compiled by interpretInstruction to a scrape
 * or search recipe and carried out, no free form AI anywhere in the loop.
 * `portamp search` and `portamp scrape` stay the tools to reach for when the
 * recipe is already known; this command exists for the sentence a person
 * actually types, "get the price and title from <url>", refusing the ones
 * it cannot carry out rather than guessing at what they meant.
 */

/** The instruction's recipe, carried out. */
export async function runInstruction({ instruction, policy, ...opts }) {
  const parsed = interpretInstruction(instruction);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  if (parsed.action === "scrape") {
    let got;
    try {
      got = await fetchOne({ url: parsed.url, policy, ...opts });
    } catch (err) {
      if (err?.name === "PolicyViolation") throw err;
      return { ok: false, error: err.name === "AbortError" ? `no answer within ${opts.timeoutMs ?? 15000} ms` : err.message };
    }
    if (got.error) return { ok: false, error: got.error };
    const result = {};
    for (const f of parsed.fields) result[f] = FIELDS[f](got.html, got.url);
    return { ok: true, action: "scrape", url: got.url, fields: parsed.fields, result };
  }

  const search = await searchWeb({ query: parsed.query, policy, ...opts });
  if (!search.ok) return { ok: false, error: search.error };
  const result = search.results.map((r) => {
    const picked = {};
    for (const f of parsed.fields) picked[f] = r[f];
    return picked;
  });
  return { ok: true, action: "search", query: parsed.query, fields: parsed.fields, result };
}

export default {
  name: "general-agent",
  version: "0.1.0",
  class: "general",
  commands: {
    agent: {
      describe: 'follow one plain instruction, rule based, no free form AI: portamp agent "<verb> <field(s)> from <url>" or portamp agent "search <query>"; a phrasing this reader does not know, or one that needs a real browser (click, type, scroll...), is refused by name; needs --allow-live and portamp.authorization.json',
      async run({ log, policy, args, fetchImpl }) {
        const instruction = args._.slice(1).join(" ").trim();
        if (!instruction) throw new Error("portamp agent <instruction>: no instruction given");
        const parsed = interpretInstruction(instruction);
        if (!parsed.ok) throw new Error(parsed.error);
        const target = parsed.action === "scrape" ? [parsed.url] : [buildSearchUrl("duckduckgo", parsed.query)];
        await requireAttestation("Following an instruction", target);

        const result = await runInstruction({ instruction, policy, fetchImpl });
        if (!result.ok) throw new Error(`could not follow "${instruction}": ${result.error}`);

        if (args.out) {
          const dir = resolve(process.cwd(), args.out);
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "AGENT.md"), agentReport(instruction, result), "utf8"); // codeql[js/http-to-file-access]
          await writeFile(join(dir, "portamp.agent.json"), JSON.stringify(result, null, 2) + "\n", "utf8"); // codeql[js/http-to-file-access]
          log.info(`"${instruction}" followed as ${result.action}; AGENT.md and portamp.agent.json written under ${dir}`);
        } else {
          log.info(`"${instruction}" followed as ${result.action} (${result.fields.join(", ")})`);
          process.stdout.write(JSON.stringify(result.result, null, 2) + "\n");
        }
        return result;
      },
    },
  },
  setup() {},
};
