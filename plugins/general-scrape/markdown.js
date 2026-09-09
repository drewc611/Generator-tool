import { parseMarkup } from "../dsp-ir/markup.js";

/**
 * One page's HTML turned into Markdown with no dependency: the same tree
 * parseMarkup already builds for a reader's own dialect, walked with the
 * ordinary rules a browser's own rendering follows for block and inline
 * content. It is deliberately not exhaustive. A definition list, a nested
 * table's own colspan, and a form's own controls are read as their visible
 * text only; ARCHITECTURE-shaped extraction is not this function's job.
 */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  copy: "©", reg: "®", trade: "™",
  mdash: "—", ndash: "–", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  middot: "·", laquo: "«", raquo: "»",
};

/** &amp;, &#39; and &#x27; alike, a named entity the table above knows or a numeric one; anything else is left exactly as written. */
export function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const key = body.toLowerCase();
    return Object.hasOwn(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole;
  });
}

const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg", "head"]);
const BLOCK_CONTAINERS = new Set(["html", "body", "div", "section", "article", "header", "footer", "nav", "main", "aside", "figure", "figcaption", "p", "address"]);
const OWN_BLOCK = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "hr", "pre", "blockquote", "ul", "ol", "table"]);

const attr = (node, name) => node.attrs?.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value ?? null;
const resolve = (href, base) => { try { return base ? new URL(href, base).href : href; } catch { return href; } };
/** Whitespace collapses the way a browser's own layout collapses it; none of the source's own indentation survives. */
const collapse = (s) => s.replace(/[ \t\r\n]+/g, " ");

function textOf(node) {
  if (node.type === "text") return decodeEntities(node.text);
  if (SKIP_TAGS.has(node.tag)) return "";
  return (node.children ?? []).map(textOf).join("");
}

/** An element read as one run of inline Markdown: emphasis, links and images resolved, everything else its own plain text. */
function inline(node, base) {
  if (node.type === "text") return collapse(decodeEntities(node.text));
  if (SKIP_TAGS.has(node.tag)) return "";
  const kids = () => (node.children ?? []).map((c) => inline(c, base)).join("");
  switch (node.tag) {
    case "br": return "  \n";
    case "strong": case "b": { const t = kids().trim(); return t ? `**${t}**` : ""; }
    case "em": case "i": { const t = kids().trim(); return t ? `*${t}*` : ""; }
    case "code": { const t = kids(); return t.trim() ? `\`${t.trim()}\`` : ""; }
    case "a": {
      const t = kids().trim();
      const href = attr(node, "href");
      if (!t) return "";
      return href ? `[${t}](${resolve(href, base)})` : t;
    }
    case "img": {
      const src = attr(node, "src");
      if (!src) return "";
      return `![${attr(node, "alt") ?? ""}](${resolve(src, base)})`;
    }
    default: return kids();
  }
}

/** A node read at block level: a heading, a rule, a list, a table or a quote each in the shape Markdown gives them; anything else is one paragraph of inline content, recursing only where a container actually holds further blocks. */
function block(node, base, out, depth = 0) {
  if (node.type === "text") {
    const t = collapse(decodeEntities(node.text)).trim();
    if (t) out.push(t);
    return;
  }
  if (SKIP_TAGS.has(node.tag)) return;
  const kids = node.children ?? [];

  const heading = /^h([1-6])$/.exec(node.tag);
  if (heading) {
    const t = kids.map((c) => inline(c, base)).join("").trim();
    if (t) out.push(`${"#".repeat(Number(heading[1]))} ${t}`);
    return;
  }
  if (node.tag === "hr") { out.push("---"); return; }
  if (node.tag === "pre") {
    const raw = textOf(node).replace(/\n+$/, "");
    if (raw.trim()) out.push("```\n" + raw + "\n```");
    return;
  }
  if (node.tag === "blockquote") {
    const inner = [];
    kids.forEach((k) => block(k, base, inner, depth));
    const t = inner.join("\n\n");
    if (t) out.push(t.split("\n").map((l) => `> ${l}`).join("\n"));
    return;
  }
  if (node.tag === "ul" || node.tag === "ol") {
    // Every line of a list must stay adjacent (one join, one newline) or Markdown reads it as several one line lists.
    const lines = [];
    let i = 0;
    for (const li of kids.filter((k) => k.type === "el" && k.tag === "li")) {
      i += 1;
      const nested = (li.children ?? []).filter((c) => c.type === "el" && (c.tag === "ul" || c.tag === "ol"));
      const flat = (li.children ?? []).filter((c) => !nested.includes(c));
      const text = flat.map((c) => inline(c, base)).join("").trim();
      const marker = node.tag === "ol" ? `${i}.` : "-";
      lines.push(`${"  ".repeat(depth)}${marker} ${text}`);
      nested.forEach((n) => block(n, base, lines, depth + 1));
    }
    if (lines.length) out.push(lines.join("\n"));
    return;
  }
  if (node.tag === "table") {
    const rows = [];
    const collect = (n) => (n.children ?? []).forEach((c) => { if (c.type !== "el") return; if (c.tag === "tr") rows.push(c); else collect(c); });
    collect(node);
    // A table's rows must stay adjacent too, or each row reads as its own one row table.
    const lines = [];
    rows.forEach((tr, i) => {
      const cells = (tr.children ?? []).filter((c) => c.type === "el" && (c.tag === "td" || c.tag === "th"));
      const cellText = (c) => (c.children ?? []).map((k) => inline(k, base)).join("").trim().replace(/\|/g, "\\|") || " ";
      lines.push(`| ${cells.map(cellText).join(" | ")} |`);
      if (i === 0) lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    });
    if (lines.length) out.push(lines.join("\n"));
    return;
  }
  if (BLOCK_CONTAINERS.has(node.tag)) {
    const hasBlockChild = kids.some((k) => k.type === "el" && (BLOCK_CONTAINERS.has(k.tag) || OWN_BLOCK.has(k.tag)));
    if (hasBlockChild) {
      const buf = [];
      kids.forEach((k) => block(k, base, buf, depth));
      if (buf.length) out.push(buf.join("\n\n"));
    } else {
      const t = kids.map((c) => inline(c, base)).join("").trim();
      if (t) out.push(t);
    }
    return;
  }
  // An inline element reached directly at block level (a bare <a> or <strong> under <body>) is its own paragraph.
  const t = inline(node, base).trim();
  if (t) out.push(t);
}

/** Comments, the doctype, scripts and styles removed before the tree is built: none of them is markup parseMarkup's tag regex recognises, so left in they surface as stray text instead of being walked as an element. */
function stripNonContent(html) {
  let text = String(html ?? "");
  for (let prev = null; prev !== text;) { prev = text; text = text.replace(/<!--[\s\S]*?-->/g, ""); }
  text = text.replace(/<!doctype[^>]*>/gi, "");
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  return text;
}

/** A whole document's markup as Markdown, links and images resolved against `baseUrl`. */
export function htmlToMarkdown(html, { baseUrl = null } = {}) {
  const root = parseMarkup(stripNonContent(html));
  const buf = [];
  root.children.forEach((k) => block(k, baseUrl, buf, 0));
  return buf.join("\n\n").trim() + "\n";
}

/**
 * The document's own text alone, no formatting: the Markdown this module
 * already gets right about block boundaries, with the marks stripped rather
 * than walked a second time, so the two can never disagree about where one
 * paragraph ends and the next begins.
 */
export function htmlToText(html) {
  return htmlToMarkdown(html)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^```$/gm, "")
    // [ \t]* rather than \s*: \s also matches a newline, which would let this
    // reach back across a blank line and swallow the paragraph break in front
    // of a list.
    .replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/gm, "")
    .replace(/^[ \t]*\|[ \t]*(?:---[ \t]*\|[ \t]*)+$/gm, "")
    .replace(/\|/g, " ")
    .replace(/^---$/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What the head names about the page: title, description, canonical, language. Read by regex, not the tree, since these live in <head>, which the markdown walk never enters. */
export function pageMeta(html) {
  const text = String(html ?? "");
  const title = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text)?.[1];
  const metaValue = (name) => {
    const re = new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`, "i");
    return re.exec(text)?.[1] ?? new RegExp(`<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\bname\\s*=\\s*["']${name}["']`, "i").exec(text)?.[1] ?? null;
  };
  const canonical = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']*)["']/i.exec(text)?.[1]
    ?? /<link\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*\brel\s*=\s*["']canonical["']/i.exec(text)?.[1] ?? null;
  const lang = /<html\b[^>]*\blang\s*=\s*["']([^"']*)["']/i.exec(text)?.[1] ?? null;
  return {
    title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() : null,
    description: metaValue("description") ? decodeEntities(metaValue("description")).trim() : null,
    canonical,
    lang,
  };
}
