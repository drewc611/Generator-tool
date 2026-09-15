import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { batchScrape, fetchOne, parseFormats, requireAttestation, writeResults } from "../general-scrape/index.js";
import { buildSearchUrl, parseResults, searchReport } from "./search.js";

/**
 * Search: a query read from a search engine's own results page, no browser
 * and no third party service, standing behind the exact same --allow-live
 * and portamp.authorization.json gates as fetch, map, scrape and
 * batch-scrape, since asking a search engine for results is a live call to a
 * real system exactly like any of those. With --scrape true each result is
 * then read the way portamp scrape reads any url, through batchScrape, so a
 * result on a domain the attestation does not cover fails only that result.
 */

/** One query, answered by the named engine's own results page. */
export async function searchWeb({ query, policy, engine = "duckduckgo", limit = 10, scrape = false, formats = ["markdown"], ...opts }) {
  const url = buildSearchUrl(engine, query);
  let got;
  try {
    got = await fetchOne({ url, policy, ...opts });
  } catch (err) {
    if (err?.name === "PolicyViolation") throw err;
    return { query, engine, ok: false, error: err.name === "AbortError" ? `no answer within ${opts.timeoutMs ?? 15000} ms` : err.message, results: [] };
  }
  if (got.error) return { query, engine, ok: false, error: got.error, results: [] };

  const { results: all, unrecognized } = parseResults(engine, got.html);
  if (unrecognized) {
    return { query, engine, ok: false, error: `${engine}'s results page did not match the structure this reader expects (its markup may have changed); nothing was extracted rather than guessed`, results: [] };
  }
  const results = all.slice(0, Math.max(0, limit));

  if (scrape && results.length) {
    const scraped = await batchScrape({ urls: results.map((r) => r.url), policy, formats, concurrency: opts.concurrency ?? 5 });
    results.forEach((r, i) => { r.scraped = scraped[i]; });
  }
  return { query, engine, ok: true, results };
}

export default {
  name: "general-search",
  version: "0.1.0",
  class: "general",
  commands: {
    search: {
      describe: "search the web through a search engine's own results page, no browser: portamp search <query> [--engine duckduckgo] [--limit n] [--scrape true] [--format markdown|html|json] [--out dir]; needs --allow-live and portamp.authorization.json",
      async run({ log, policy, args, fetchImpl }) {
        const query = args._.slice(1).join(" ").trim();
        if (!query) throw new Error("portamp search <query>: no query given");
        const engine = args.engine ?? "duckduckgo";
        const url = buildSearchUrl(engine, query); // an unknown engine name is refused before any gate is even asked
        await requireAttestation("Searching the web", [url]);
        const limit = args.limit === undefined ? 10 : Number(args.limit);
        const scrape = args.scrape === "true" || args.scrape === true;
        const formats = scrape ? parseFormats(args.format) : ["markdown"];
        const result = await searchWeb({ query, policy, engine, limit, scrape, formats, fetchImpl });
        if (!result.ok) throw new Error(`could not search ${engine} for "${query}": ${result.error}`);

        if (args.out) {
          const dir = resolve(process.cwd(), args.out);
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "SEARCH.md"), searchReport(query, engine, result.results), "utf8"); // codeql[js/http-to-file-access]
          await writeFile(join(dir, "portamp.search.json"), JSON.stringify(result, null, 2) + "\n", "utf8"); // codeql[js/http-to-file-access]
          if (scrape) {
            const scraped = result.results.map((r) => r.scraped).filter((s) => s?.ok);
            if (scraped.length) await writeResults(join(dir, "scraped"), scraped, formats);
          }
          log.info(`${result.results.length} result(s) for "${query}"; SEARCH.md and portamp.search.json written under ${dir}`);
        } else {
          log.info(`${result.results.length} result(s) for "${query}" on ${engine}`);
          for (const r of result.results) log.info(`- ${r.title}\n  ${r.url}`);
        }
        return result;
      },
    },
  },
  setup() {},
};
