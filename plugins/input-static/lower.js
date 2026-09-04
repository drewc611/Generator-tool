/**
 * The old web, lowered. Pages from the font era carry markup no current
 * framework will accept and server blocks no client can run. Each rewrite
 * here has an exact meaning or it does not happen: a <font> is a styled
 * span, a <center> is a centered block, a server block is a gap with a name.
 */

// HTML's seven font sizes, as the pixel sizes browsers actually used.
const FONT_SIZES = { 1: "10px", 2: "13px", 3: "16px", 4: "18px", 5: "24px", 6: "32px", 7: "48px" };

/**
 * Strip server side blocks: <?php ?>, <? ?>, <% %> (ASP and JSP alike).
 * The HTML around them is the page; what the block computed is a gap the
 * note names, never a guess.
 */
export function stripServerBlocks(text, note = () => {}) {
  let count = 0;
  let out = String(text ?? "").replace(/<\?(?:php)?[\s\S]*?(?:\?>|$)/gi, () => { count += 1; return ""; });
  out = out.replace(/<%[\s\S]*?(?:%>|$)/g, () => { count += 1; return ""; });
  if (count) {
    note(`${count} server side block(s) were removed. Whatever each one printed is a gap in the page; the surrounding markup is ported as it stands.`);
  }
  return out;
}

/**
 * Server side includes, resolved the way the server would have: from the
 * run's own tree, recursively, with a depth guard. One the run does not
 * hold becomes a note instead of silence.
 */
export function resolveSsi(text, resolveInclude, note = () => {}, depth = 0) {
  if (!resolveInclude || depth >= 6) return String(text ?? "");
  return String(text ?? "").replace(/<!--#include\s+(?:virtual|file)\s*=\s*["']([^"']+)["']\s*-->/gi, (whole, name) => {
    const body = resolveInclude(name);
    if (body == null) {
      note(`An SSI include of \`${name}\` names a file this run does not hold. The include was removed; the gap is where it stood.`);
      return "";
    }
    return resolveSsi(body, resolveInclude, note, depth + 1);
  });
}

/** The element rewrites with an exact CSS meaning, plus the two that only
 * ever meant motion, which is dropped and said. */
export function lowerLegacyHtml(text, note = () => {}) {
  let out = String(text ?? "");

  out = out.replace(/<font\b([^>]*)>/gi, (whole, attrs) => {
    const styles = [];
    const color = /color\s*=\s*["']?([#\w()]+)["']?/i.exec(attrs)?.[1];
    const size = /size\s*=\s*["']?\+?(-?\d)["']?/i.exec(attrs)?.[1];
    const face = /face\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (color) styles.push(`color: ${color}`);
    if (size && FONT_SIZES[size]) styles.push(`font-size: ${FONT_SIZES[size]}`);
    if (face) styles.push(`font-family: ${face}`);
    return styles.length ? `<span style="${styles.join("; ")}">` : "<span>";
  }).replace(/<\/font\s*>/gi, "</span>");

  out = out.replace(/<center\b[^>]*>/gi, '<div style="text-align: center">').replace(/<\/center\s*>/gi, "</div>");

  if (/<(marquee|blink)\b/i.test(out)) {
    note("A <marquee> or <blink> moved text for effect. The text is kept as a plain span; the motion is dropped on purpose, and adding it back is a product decision.");
    out = out.replace(/<(\/?)(?:marquee|blink)\b[^>]*>/gi, (m, close) => (close ? "</span>" : "<span>"));
  }

  return out;
}

/** The head of an old page, read for what the port must carry. */
export function readHead(text) {
  const head = /<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(text)?.[1] ?? text;
  const meta = (name) =>
    new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`, "i").exec(head)?.[1] ??
    new RegExp(`<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*\\bname\\s*=\\s*["']${name}["']`, "i").exec(head)?.[1] ?? null;
  const property = (name) =>
    new RegExp(`<meta\\b[^>]*\\bproperty\\s*=\\s*["']${name}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`, "i").exec(head)?.[1] ?? null;

  // <meta http-equiv="refresh" content="0; url=new.html"> is a redirect the
  // server never knew about. It belongs in the redirect map, not the page.
  const refreshRaw = /<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(head)?.[1]
    ?? /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*http-equiv\s*=\s*["']refresh["']/i.exec(head)?.[1];
  const refresh = refreshRaw ? /url\s*=\s*(.+)$/i.exec(refreshRaw)?.[1]?.trim() ?? null : null;

  const base = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(head)?.[1] ?? null;
  const charset = /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? null;

  const og = {};
  for (const m of head.matchAll(/<meta\b[^>]*\bproperty\s*=\s*["'](og:[\w:]+)["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/gi)) {
    og[m[1]] = m[2];
  }

  // The cache busting query is part of the URL, never of the file on disk.
  // A print stylesheet is still a stylesheet; its media rides along so the
  // port keeps serving the paper version somebody once cared enough to write.
  const cssLinks = [];
  const printLinks = [];
  for (const m of head.matchAll(/<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1]?.split(/[#?]/)[0];
    if (!href) continue;
    (/\bmedia\s*=\s*["']print["']/i.test(m[0]) ? printLinks : cssLinks).push(href);
  }

  // The canonical address and the icons are identity, and identity is
  // exactly what a port must not lose.
  const canonical = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(head)?.[1] ?? null;
  const icons = [...head.matchAll(/<link\b[^>]*\brel\s*=\s*["'](icon|shortcut icon|apple-touch-icon)["'][^>]*\bhref\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => ({ rel: m[1] === "shortcut icon" ? "icon" : m[1], href: m[2].split(/[#?]/)[0] }));

  return { description: meta("description"), refresh, base, charset, og, cssLinks, printLinks, canonical, icons, ogImage: property("og:image") };
}

/** Local files the page renders or links as assets: images, css, media. */
export function localAssets(text, cssLinks = []) {
  const found = new Set(cssLinks.filter((h) => !/^[a-z][\w+.-]*:|^\/\//i.test(h)));
  for (const m of String(text ?? "").matchAll(/<(?:img|source|video|audio|embed)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (!/^[a-z][\w+.-]*:|^\/\/|^data:/i.test(m[1])) found.add(m[1].split(/[#?]/)[0]);
  }
  return [...found];
}

/** Imagemap areas are navigation somebody drew on a picture. */
export function imagemapLinks(text) {
  const links = [];
  for (const m of String(text ?? "").matchAll(/<area\b[^>]*\bhref\s*=\s*["']([^"'#?]+)["'][^>]*>/gi)) {
    if (!/^[a-z][\w+.-]*:/i.test(m[1])) {
      const alt = /alt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? m[1];
      links.push({ href: m[1], label: alt });
    }
  }
  return links;
}

/** A frameset page is a layout wearing 1996's clothes: each frame is a page
 * of its own, and the frameset says which one is the content. */
export function readFrameset(text) {
  if (!/<frameset\b/i.test(text)) return null;
  const frames = [...String(text).matchAll(/<frame\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m) => ({
    src: m[1],
    name: /name\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? null,
  }));
  // The geometry is evidence: cols is panes side by side, rows is banner
  // and body. The proposal downstream reads which one the author wrote.
  const tag = /<frameset\b[^>]*>/i.exec(text)?.[0] ?? "";
  const cols = /\bcols\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
  const rows = /\brows\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
  return { frames, cols, rows, main: frames.find((f) => /main|content|body/i.test(f.name ?? ""))?.src ?? frames.at(-1)?.src ?? null };
}

/**
 * The server's own redirect declarations, read from .htaccess. Plain
 * Redirect lines and RewriteRules whose pattern is a literal path are
 * evidence; anything with a real regex or a condition is counted and left
 * to a person, because guessing at mod_rewrite is how ports invent URLs.
 */
export function readHtaccess(text, note = () => {}) {
  const redirects = [];
  let complex = 0;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const plain = /^Redirect(?:\s+(301|302|permanent|temp))?\s+(\S+)\s+(\S+)/i.exec(line);
    if (plain) {
      redirects.push({ from: plain[2], to: plain[3], kind: "htaccess" });
      continue;
    }
    const rule = /^RewriteRule\s+(\S+)\s+(\S+)(?:\s+\[([^\]]*)\])?/i.exec(line);
    if (rule) {
      const pattern = rule[1].replace(/^\^/, "").replace(/\$$/, "");
      const literal = !/[.*+?()[\]{}|\\]/.test(pattern);
      if (literal && /R(?:=30[12])?/i.test(rule[3] ?? "")) {
        redirects.push({ from: "/" + pattern.replace(/^\//, ""), to: rule[2], kind: "htaccess" });
      } else {
        complex += 1;
      }
      continue;
    }
    if (/^(RewriteCond|RedirectMatch)/i.test(line)) complex += 1;
  }
  if (complex) {
    note(`${complex} .htaccess rule(s) use patterns or conditions this reader does not evaluate. They are counted, not guessed at; port them by hand from the file.`);
  }
  return redirects;
}

/** Tables without a single th, used as scaffolding rather than data. */
export function layoutTables(text) {
  let count = 0;
  for (const m of String(text ?? "").matchAll(/<table\b[\s\S]*?<\/table\s*>/gi)) {
    if (!/<th\b/i.test(m[0]) && (m[0].match(/<td\b/gi) ?? []).length >= 4) count += 1;
  }
  return count;
}

/**
 * The proposed grid conversion, performed only when asked. Exactly the
 * tables layoutTables names — headerless scaffolding — become CSS grid,
 * and every original is returned so it can be kept beside the component
 * for the diff. A table with a header cell is data and is never touched;
 * a nested table is left alone rather than half converted.
 */
export function performTables(html) {
  const originals = [];
  const out = String(html ?? "").replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, (table) => {
    if (/<th\b/i.test(table)) return table;
    if (/<table\b/i.test(table.slice(6))) return table;
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
    if ((table.match(/<td\b/gi) ?? []).length < 4 || !rows.length) return table;
    const cols = Math.max(...rows.map((r) => (r[1].match(/<td\b/gi) ?? []).length));
    if (cols < 2) return table;
    originals.push(table);
    const body = rows
      .map((r) => `<div class="port-grid-row">${r[1].replace(/<td\b[^>]*>/gi, '<div class="port-grid-cell">').replace(/<\/td\s*>/gi, "</div>").trim()}</div>`)
      .join("\n");
    return `<div class="port-grid" style="--port-grid-cols: ${cols}">\n${body}\n</div>`;
  });
  return { html: out, originals };
}
