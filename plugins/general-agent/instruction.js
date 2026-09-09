import { attrOf, parseMarkup } from "../dsp-ir/markup.js";
import { decodeEntities, htmlToMarkdown, htmlToText, pageMeta } from "../general-scrape/markdown.js";

/**
 * A shared, honest rule based instruction engine, no free form AI: a
 * recognised phrasing compiles to a scrape or search recipe, and a phrasing
 * this reader does not know is refused by name, listing what it does
 * understand, the same restraint general-study's SolveError keeps for an
 * equation this tool cannot solve. Nothing here reads intent; it matches a
 * small, fixed vocabulary and says so when a sentence falls outside it.
 */

const resolve = (href, base) => { try { return base ? new URL(href, base).href : href; } catch { return href; } };

function walk(node, visit) {
  if (node.type === "el") visit(node);
  for (const c of node.children ?? []) walk(c, visit);
}

function textOf(node) {
  if (node.type === "text") return decodeEntities(node.text);
  if (node.tag === "script" || node.tag === "style") return "";
  return (node.children ?? []).map(textOf).join("");
}

const collapse = (s) => s.replace(/\s+/g, " ").trim();
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function headingsIn(html) {
  const out = [];
  walk(parseMarkup(html), (n) => {
    if (!HEADING_TAGS.has(n.tag)) return;
    const text = collapse(textOf(n));
    if (text) out.push({ level: Number(n.tag[1]), text });
  });
  return out;
}

function linksIn(html, base) {
  const out = [];
  walk(parseMarkup(html), (n) => {
    if (n.tag !== "a") return;
    const href = attrOf(n, "href");
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) return;
    out.push({ text: collapse(textOf(n)), url: resolve(href, base) });
  });
  return out;
}

function imagesIn(html, base) {
  const out = [];
  walk(parseMarkup(html), (n) => {
    if (n.tag !== "img") return;
    const src = attrOf(n, "src");
    if (!src) return;
    out.push({ src: resolve(src, base), alt: attrOf(n, "alt") ?? "" });
  });
  return out;
}

/** Each table's own header and body rows, as text, not walked a second way by markdown.js's own table handling. */
function tablesIn(html) {
  const tables = [];
  walk(parseMarkup(html), (n) => {
    if (n.tag !== "table") return;
    const rows = [];
    walk(n, (r) => { if (r.tag === "tr") rows.push(r); });
    tables.push(rows.map((tr) => (tr.children ?? []).filter((c) => c.type === "el" && (c.tag === "td" || c.tag === "th")).map((c) => collapse(textOf(c)))));
  });
  return tables;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** A page's own mailto: links and the plain addresses its visible text carries; no address is invented or normalised. */
function emailsIn(html) {
  const found = new Set(htmlToText(html).match(EMAIL_RE) ?? []);
  walk(parseMarkup(html), (n) => {
    if (n.tag !== "a") return;
    const href = attrOf(n, "href");
    if (!href || !/^mailto:/i.test(href)) return;
    const addr = href.slice(7).split("?")[0];
    if (addr) found.add(decodeURIComponent(addr));
  });
  return [...found];
}

// A currency prefixed number, matched as text and never parsed, converted or verified: $12.34, £5, €9.99, 1,299.00 USD.
const PRICE_RE = /(?:[$£€¥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP))/g;

function pricesIn(html) {
  return [...new Set((htmlToText(html).match(PRICE_RE) ?? []).map((s) => s.trim()))];
}

/** Every field this reader can pull from a scraped page, each a plain structural read, none of them a guess. */
export const FIELDS = {
  title: (html) => pageMeta(html).title,
  description: (html) => pageMeta(html).description,
  text: (html) => htmlToText(html),
  markdown: (html, base) => htmlToMarkdown(html, { baseUrl: base }),
  headings: (html) => headingsIn(html),
  links: (html, base) => linksIn(html, base),
  images: (html, base) => imagesIn(html, base),
  emails: (html) => emailsIn(html),
  prices: (html) => pricesIn(html),
  tables: (html) => tablesIn(html),
};

const FIELD_ALIASES = {
  link: "links", url: "links", urls: "links",
  image: "images", img: "images", imgs: "images",
  heading: "headings", header: "headings", headers: "headings",
  table: "tables",
  email: "emails", "e-mail": "emails", "e-mails": "emails",
  price: "prices", cost: "prices", costs: "prices",
  body: "text", content: "text",
  desc: "description",
  html: "markdown", page: "markdown", everything: "markdown",
};

function normalizeField(word) {
  const w = word.toLowerCase().trim().replace(/^(the|a|an)\s+/, "");
  const key = FIELD_ALIASES[w] ?? w;
  return Object.hasOwn(FIELDS, key) ? key : null;
}

// A verb this reader can act on structurally, versus one that names an action on the live page it has no browser to perform.
const READ_VERBS = ["scrape", "get", "extract", "find", "read", "fetch", "pull", "grab", "show", "list"];
const INTERACTION_VERBS = ["click", "type", "scroll", "hover", "press", "submit", "drag", "log in", "login", "fill", "check", "uncheck", "select", "wait", "navigate", "swipe", "screenshot"];

const URL_RE = /\bhttps?:\/\/[^\s,]+/i;
const SEARCH_RESULT_FIELDS = ["title", "url", "snippet"];
const SEARCH_FIELD_ALIASES = { titles: "title", link: "url", links: "url", urls: "url", snippets: "snippet" };

/** A plain sentence compiled to a scrape or search recipe, or refused by name with what this reader does understand. */
export function interpretInstruction(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: false, error: "no instruction given" };
  const lower = raw.toLowerCase();

  const interacting = INTERACTION_VERBS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(lower));
  if (interacting) {
    return { ok: false, error: `"${interacting}" needs a real browser session acting on the live page; that is input-record's job, not this rule based reader's` };
  }

  const urlMatch = URL_RE.exec(raw);
  if (urlMatch) {
    const url = urlMatch[0].replace(/[.,;]+$/, "");
    const before = raw.slice(0, urlMatch.index);
    const after = raw.slice(urlMatch.index + urlMatch[0].length);
    // Either phrasing is read: fields named before the url ("extract X from <url>")
    // or after it ("<verb> <url> and extract X"), whichever one the sentence carries.
    const beforeMatch = new RegExp(`\\b(?:${READ_VERBS.join("|")})\\b\\s+(.*?)\\s*(?:from|at|on)?\\s*$`, "i").exec(before);
    const afterMatch = new RegExp(`^\\s*(?:,|and)\\s+(?:${READ_VERBS.join("|")})\\s+(?:the\\s+)?(.+)$`, "i").exec(after);
    const askText = beforeMatch?.[1] || afterMatch?.[1] || "";
    const tokens = askText.split(/\s*(?:,|and|&)\s*/i).map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) return { ok: true, action: "scrape", url, fields: ["markdown"] };
    const fields = [];
    const unknown = [];
    for (const t of tokens) {
      const f = normalizeField(t);
      if (f) { if (!fields.includes(f)) fields.push(f); } else unknown.push(t);
    }
    if (unknown.length) {
      return { ok: false, error: `does not recognise ${unknown.map((u) => `"${u}"`).join(", ")} as something to extract; understood fields are ${Object.keys(FIELDS).sort().join(", ")}` };
    }
    return { ok: true, action: "scrape", url, fields };
  }

  const searchMatch = /^search(?:\s+for)?\s+(.+)$/i.exec(raw);
  if (searchMatch) {
    let query = searchMatch[1];
    let fields = ["title", "url"];
    const fieldClause = new RegExp(`\\band\\s+(?:${READ_VERBS.join("|")})\\s+(?:the\\s+)?(.+)$`, "i").exec(query);
    if (fieldClause) {
      query = query.slice(0, fieldClause.index).trim();
      const tokens = fieldClause[1].split(/\s*(?:,|and|&)\s*/i).map((t) => t.trim()).filter(Boolean);
      const searchFields = [];
      const unknown = [];
      for (const t of tokens) {
        const w = t.toLowerCase().replace(/^(the|a|an)\s+/, "");
        const key = SEARCH_FIELD_ALIASES[w] ?? w;
        if (SEARCH_RESULT_FIELDS.includes(key)) { if (!searchFields.includes(key)) searchFields.push(key); } else unknown.push(t);
      }
      if (unknown.length) {
        return { ok: false, error: `a search result only carries ${SEARCH_RESULT_FIELDS.join(", ")}; does not recognise ${unknown.map((u) => `"${u}"`).join(", ")} without scraping each result, which this reader does not chain automatically` };
      }
      if (searchFields.length) fields = searchFields;
    }
    query = query.replace(/[.?!]+$/, "").trim();
    if (!query) return { ok: false, error: "no query found after 'search'" };
    return { ok: true, action: "search", query, fields };
  }

  return { ok: false, error: 'no url and no "search for ..." found in the instruction; understood shapes are "<verb> <field(s)> from <url>" and "search <query>"' };
}

/** The instruction, its recipe and its result, described. */
export function agentReport(instruction, result) {
  const lines = ["# The instruction", "", `> ${instruction}`, "", `action: ${result.action}`];
  lines.push(result.action === "scrape" ? `url: ${result.url}` : `query: ${result.query}`);
  lines.push(`fields: ${result.fields.join(", ")}`, "", "```json", JSON.stringify(result.result, null, 2), "```", "");
  return lines.join("\n");
}
