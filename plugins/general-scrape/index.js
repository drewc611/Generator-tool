import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { localPath } from "../input-fetch/fetch.js";
import { readAttestation } from "../input-fetch/index.js";
import { htmlToMarkdown, htmlToText, pageMeta } from "./markdown.js";

/**
 * Scrape and Batch Scrape: one URL, or many, read as Markdown, HTML or JSON.
 * Neither is confined to one origin the way fetch and map are, so a redirect
 * is followed wherever it leads rather than refused off the origin; each hop
 * still asks the policy first, and the attestation still has to name who owns
 * the system, or systems, being read. A domain the attestation does not cover
 * is this URL's own failure, not the whole batch's: the run keeps going and
 * says which URL was refused and why.
 *
 * No screenshot format: rendering a page as pixels needs a real browser, and
 * this tool's one optional dependency for that, Playwright, is input-record's
 * job, not this one's. Asking for it is refused by name rather than ignored.
 */

const FORMATS = ["markdown", "html", "json"];
const normaliseFormat = (f) => (f === "md" ? "markdown" : f);

/** An address worth asking the network for: http or https, nothing else, or null. */
function httpUrl(raw) {
  try {
    const u = new URL(String(raw ?? "").trim());
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** One request, any redirect followed wherever it leads (unlike fetch/map, there is no one origin to stay confined to), each hop asking the policy first. */
async function fetchOne({ url, policy, timeoutMs = 15000, userAgent = "portamp (+https://github.com/drewc611/Generator-tool)", fetchImpl = globalThis.fetch, maxBytes = 10 * 1024 * 1024 }) {
  let at = url;
  for (let hop = 0; ; hop += 1) {
    policy.assertLiveAllowed(at);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(at, { redirect: "manual", signal: controller.signal, headers: { "user-agent": userAgent, accept: "text/html,application/xhtml+xml" } });
    } finally {
      clearTimeout(timer);
    }
    const location = res.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(res.status) && location) {
      if (hop >= 5) return { url: at, error: "more than five redirects" };
      let to;
      try { to = new URL(location, at).href; } catch { return { url: at, error: `redirected to an address that is not a url: ${location}` }; }
      at = to;
      continue;
    }
    if (!res.ok) return { url: at, error: `HTTP ${res.status}` };
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > maxBytes) return { url: at, error: `over the ${maxBytes} byte cap` };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) return { url: at, error: `over the ${maxBytes} byte cap` };
    return { url: at, html: buffer.toString("utf8") };
  }
}

/** One fetched page rendered into every format asked for. */
export function renderFormats(html, url, formats) {
  const meta = pageMeta(html);
  const out = { meta };
  if (formats.includes("html")) out.html = html;
  if (formats.includes("markdown")) out.markdown = htmlToMarkdown(html, { baseUrl: url });
  if (formats.includes("json")) {
    out.json = JSON.stringify(
      { url, title: meta.title, description: meta.description, canonical: meta.canonical, lang: meta.lang, markdown: htmlToMarkdown(html, { baseUrl: url }), text: htmlToText(html) },
      null,
      2
    ) + "\n";
  }
  return out;
}

/** One URL, read and rendered into the formats asked for, or the reason it could not be. */
export async function scrapeUrl({ url, policy, formats = ["markdown"], ...opts }) {
  const clean = httpUrl(url);
  if (!clean) return { url, ok: false, error: "the url must be http or https" };
  let got;
  try {
    got = await fetchOne({ url: clean, policy, ...opts });
  } catch (err) {
    if (err?.name === "PolicyViolation") throw err;
    return { url: clean, ok: false, error: err.name === "AbortError" ? `no answer within ${opts.timeoutMs ?? 15000} ms` : err.message };
  }
  if (got.error) return { url: clean, ok: false, error: got.error };
  const rendered = renderFormats(got.html, got.url, formats);
  return { url: got.url, ok: true, ...rendered };
}

/** Up to `limit` of `worker` running over `items` at once; a worker error is the caller's to catch, not this function's. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

/**
 * Many URLs, concurrently: a domain the attestation does not cover fails
 * that one URL and the run continues; live calls being off entirely, or the
 * run being offline, is everyone's failure and stops the whole batch, since
 * every remaining URL would fail the identical way.
 */
export async function batchScrape({ urls, policy, formats = ["markdown"], concurrency = 5, ...opts }) {
  return pool(urls, concurrency, async (url) => {
    try {
      return await scrapeUrl({ url, policy, formats, ...opts });
    } catch (err) {
      if (err?.name === "PolicyViolation" && err.rule !== "live-call-outside-attested-domains") throw err;
      return { url, ok: false, error: err.message };
    }
  });
}

/** A scraped url's own path under the output directory, one file per format, the extension swapped for the format's own. */
function outputPath(url, format) {
  const ext = format === "markdown" ? "md" : format;
  return localPath(url).replace(/\.[a-z0-9]+$/i, `.${ext}`);
}

/** The batch described: which url landed where, in which formats, and which were refused and why. */
function batchReport(results, formats) {
  const row = (cells) => `| ${cells.map((c) => String(c ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|")).join(" | ")} |`;
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  return [
    "# The batch", "",
    `${results.length} url(s) asked for, ${ok.length} scraped, ${failed.length} refused, as ${formats.join(", ")}.`, "",
    "## Scraped", "", "| url | file(s) |", "| --- | --- |",
    ...ok.map((r) => row([r.url, formats.map((f) => outputPath(r.url, f)).join(", ")])), "",
    "## Refused", "",
    ...(failed.length ? ["| url | reason |", "| --- | --- |", ...failed.map((r) => row([r.url, r.error]))] : ["Nothing was refused."]), "",
  ].join("\n");
}

async function writeResults(dir, results, formats) {
  for (const r of results) {
    if (!r.ok) continue;
    for (const f of formats) {
      const rel = outputPath(r.url, f);
      const file = join(dir, rel);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, r[f], "utf8");
    }
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "BATCH.md"), batchReport(results, formats), "utf8"); // codeql[js/http-to-file-access]
  await writeFile(join(dir, "portamp.batch.json"), JSON.stringify(results.map(({ meta, html, markdown, json, ...r }) => r), null, 2) + "\n", "utf8");
}

/** The attestation gate every live call in this plugin stands behind, worded for what it is actually doing. */
async function requireAttestation(what, urls) {
  const { error } = await readAttestation(process.cwd());
  if (error) {
    throw new Error(
      `${what} is a live call to a real system and needs portamp.authorization.json beside the run, naming who owns ${urls.length === 1 ? urls[0] : `these ${urls.length} url(s)`} (${error}). ` +
        "Live calls also need --allow-live. Neither is a default."
    );
  }
}

/** "markdown,json" (or "md") to the canonical list this plugin renders; a format it does not offer is refused by name, never silently dropped. */
export function parseFormats(raw) {
  const list = String(raw ?? "markdown").split(",").map((f) => normaliseFormat(f.trim().toLowerCase())).filter(Boolean);
  const bad = list.find((f) => !FORMATS.includes(f));
  if (bad === "screenshot") throw new Error("portamp scrape/batch-scrape: --format screenshot needs a real browser and is not offered here; input-record renders a live page where a screenshot is genuinely needed");
  if (bad) throw new Error(`--format must be markdown, html or json (comma separated for more than one), not ${bad}`);
  return list.length ? list : ["markdown"];
}

export default {
  name: "general-scrape",
  version: "0.1.0",
  class: "general",
  commands: {
    scrape: {
      describe: "read one url as markdown, html or json: portamp scrape <url> [--format markdown|html|json] [--out file-or-dir]; needs --allow-live and portamp.authorization.json",
      async run({ log, policy, args }) {
        const url = args._[1];
        if (!url) throw new Error("portamp scrape <url>: no url given");
        await requireAttestation("Scraping a page", [url]);
        const formats = parseFormats(args.format);
        const result = await scrapeUrl({ url, policy, formats });
        if (!result.ok) throw new Error(`could not scrape ${url}: ${result.error}`);
        if (args.out) {
          const target = resolve(process.cwd(), args.out);
          if (formats.length === 1) {
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, result[formats[0]], "utf8");
            log.info(`wrote ${target}`);
          } else {
            await writeResults(target, [result], formats);
            log.info(`wrote ${formats.length} file(s) under ${target}`);
          }
        } else {
          for (const f of formats) process.stdout.write(result[f].endsWith("\n") ? result[f] : result[f] + "\n");
        }
        return result;
      },
    },
    "batch-scrape": {
      describe: "read many urls as markdown, html or json, concurrently: portamp batch-scrape <url...> [--file urls.txt] [--format markdown|html|json] [--out dir] [--concurrency n]; needs --allow-live and portamp.authorization.json",
      async run({ log, policy, args }) {
        const urls = [...args._.slice(1)];
        if (args.file) {
          const text = await readFile(resolve(process.cwd(), args.file), "utf8");
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) urls.push(trimmed);
          }
        }
        if (!urls.length) throw new Error("portamp batch-scrape <url...> [--file urls.txt]: no urls given");
        await requireAttestation("Batch scraping", urls);
        const formats = parseFormats(args.format);
        const dir = resolve(process.cwd(), args.out ?? "./scraped");
        const results = await batchScrape({ urls, policy, formats, concurrency: args.concurrency === undefined ? 5 : Number(args.concurrency) });
        await writeResults(dir, results, formats);
        const ok = results.filter((r) => r.ok).length;
        log.info(`${ok}/${results.length} url(s) scraped; BATCH.md and portamp.batch.json written under ${dir}`);
        return results;
      },
    },
  },
  setup() {},
};
