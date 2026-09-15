import { parseMarkup, attrOf } from "../dsp-ir/markup.js";
import { decodeEntities } from "../general-scrape/markdown.js";

/**
 * A search engine's own results page, read the way every reader in this tool
 * reads a dialect it does not control: by the vocabulary it actually observes,
 * never by guessing what a differently shaped page would have meant. One
 * engine is read for now, DuckDuckGo's dependency free, no-JS HTML endpoint,
 * because it is server rendered exactly the way this tool reads everything
 * else. A results page that does not carry the vocabulary this reader
 * recognises is named unrecognised rather than reported as zero results,
 * since the two look identical otherwise and only one of them is honest.
 */

const hasClass = (node, cls) => (attrOf(node, "class") ?? "").split(/\s+/).includes(cls);
const collapse = (s) => s.replace(/\s+/g, " ").trim();

function textOf(node) {
  if (node.type === "text") return decodeEntities(node.text);
  if (node.tag === "script" || node.tag === "style") return "";
  return (node.children ?? []).map(textOf).join("");
}

function walk(node, visit) {
  if (node.type === "el") visit(node);
  if (node.type === "el" && (node.tag === "script" || node.tag === "style")) return;
  for (const c of node.children ?? []) walk(c, visit);
}

/** DuckDuckGo wraps every external result behind its own redirector, //duckduckgo.com/l/?uddg=<encoded>&rut=...; the uddg parameter is the real destination and is decoded rather than left wrapped. A link with no uddg parameter is left exactly as written. */
function realUrl(href) {
  try {
    const asUrl = new URL(href, "https://duckduckgo.com/");
    const uddg = asUrl.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : href;
  } catch {
    return href;
  }
}

/** Each result on DuckDuckGo's HTML endpoint is a result__body carrying one result__a title link and one result__snippet; a page carrying neither is named unrecognised. */
export function parseDuckDuckGoHtml(html) {
  const root = parseMarkup(String(html ?? ""));
  const bodies = [];
  walk(root, (node) => { if (hasClass(node, "result__body")) bodies.push(node); });

  const seen = new Set();
  const results = [];
  for (const body of bodies) {
    let titleNode = null;
    let snippetNode = null;
    walk(body, (node) => {
      if (node.tag !== "a") return;
      if (!titleNode && hasClass(node, "result__a")) titleNode = node;
      if (!snippetNode && hasClass(node, "result__snippet")) snippetNode = node;
    });
    if (!titleNode) continue;
    const href = attrOf(titleNode, "href");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    results.push({ title: collapse(textOf(titleNode)), url: realUrl(href), snippet: snippetNode ? collapse(textOf(snippetNode)) : "" });
  }

  if (results.length) return { results, unrecognized: false };
  let anyResultLink = false;
  walk(root, (node) => { if (hasClass(node, "result__a")) anyResultLink = true; });
  return { results: [], unrecognized: !anyResultLink };
}

const ENGINES = {
  duckduckgo: {
    url: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGoHtml,
  },
};

export const SUPPORTED_ENGINES = Object.keys(ENGINES);

/** The results page url for a named engine; an engine this reader does not know is refused by name rather than guessed at or silently defaulted. */
export function buildSearchUrl(engine, query) {
  const e = ENGINES[engine];
  if (!e) throw new Error(`--engine must be one of ${SUPPORTED_ENGINES.join(", ")}, not ${engine}`);
  return e.url(query);
}

/** A fetched results page parsed by its engine's own reader. */
export function parseResults(engine, html) {
  return ENGINES[engine].parse(html);
}

/** The search described: the query, the engine, and every result in rank order. */
export function searchReport(query, engine, results) {
  const row = (cells) => `| ${cells.map((c) => String(c ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|")).join(" | ")} |`;
  return [
    "# The search", "",
    `"${query}" on ${engine}, ${results.length} result(s).`, "",
    "| # | title | url | snippet |", "| --- | --- | --- | --- |",
    ...results.map((r, i) => row([i + 1, r.title, r.url, r.snippet])), "",
  ].join("\n");
}
