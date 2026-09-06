import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Copies a site the way a careful person would: the pages of one origin,
 * followed link by link to a depth, with their stylesheets, scripts, images
 * and fonts, written under a folder with the paths the site served them at,
 * so input-static reads the copy exactly as it reads a folder of old pages.
 *
 * Every request asks the policy first, so no byte moves without --allow-live
 * and, where an attestation names domains, a domain it names. robots.txt is
 * read and honoured. Nothing is rewritten in what is saved: a page is kept
 * byte for byte, and what was not fetched is written down with the reason,
 * so the copy's gaps are a list rather than a surprise.
 */

const PAGE_TYPES = /^(text\/html|application\/xhtml\+xml)/i;
const ASSET_EXT = /\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|pdf|json|xml|txt|map|mp4|webm|mp3|ogg|wav)$/i;

/** The file a URL is saved as, under the folder: a page path with no extension becomes a folder's index. */
export function localPath(url) {
  const u = new URL(url);
  // A percent escape that is not one (a literal % in an old link) is kept as written rather than thrown on.
  let decoded;
  try { decoded = decodeURIComponent(u.pathname); } catch { decoded = u.pathname; }
  let pathname = decoded.replace(/\/+/g, "/");
  if (pathname.endsWith("/")) pathname += "index.html";
  else if (!/\.[a-z0-9]{1,8}$/i.test(pathname.split("/").pop())) pathname += "/index.html";
  // A query string names a different document; its readable part and a short hash of the exact string are kept in the
  // file name, so two queries that clean to the same letters still land in two files.
  if (u.search) {
    let h = 0x811c9dc5;
    for (const c of u.search) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    const query = `~${u.search.slice(1).replace(/[^\w.-]+/g, "_").slice(0, 80)}-${h.toString(16).padStart(8, "0").slice(0, 6)}`;
    pathname = pathname.replace(/(\.[a-z0-9]{1,8})$/i, `${query}$1`);
  }
  return pathname.replace(/^\//, "").split("/").map((p) => (p === ".." || p === "." ? "_" : p)).join("/");
}

/** The links a page carries, absolute, with what each is for. */
export function linksIn(html, base) {
  const out = [];
  const add = (raw, kind) => {
    const value = String(raw ?? "").trim().replace(/&amp;/g, "&");
    if (!value || /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(value)) return;
    try { out.push({ url: new URL(value, base).href.replace(/#.*$/, ""), kind }); } catch { /* not a URL */ }
  };
  // Comments are removed until none is left, so a comment whose removal exposes another does not hide a link.
  let text = html;
  for (let prev = null; prev !== text;) { prev = text; text = text.replace(/<!--[\s\S]*?-->/g, ""); }
  for (const m of text.matchAll(/<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) add(m[2] ?? m[3] ?? m[4], "page");
  for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = /\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const rel = (/\srel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag) ?? [])[2] ?? "";
    if (href && /stylesheet|icon|preload|manifest|apple-touch-icon/i.test(rel)) add(href[2] ?? href[3] ?? href[4], "asset");
  }
  for (const m of text.matchAll(/<(?:script|img|source|iframe|embed|video|audio|track)\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) add(m[2] ?? m[3] ?? m[4], "asset");
  for (const m of text.matchAll(/\ssrcset\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    for (const part of String(m[2] ?? m[3]).split(",")) add(part.trim().split(/\s+/)[0], "asset");
  }
  for (const m of text.matchAll(/<form\b[^>]*?\saction\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) add(m[2] ?? m[3] ?? m[4], "form");
  for (const m of text.matchAll(/<(?:object)\b[^>]*?\sdata\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) add(m[2] ?? m[3] ?? m[4], "asset");
  return out;
}

/** The URLs a stylesheet pulls in: url(...) and @import. */
export function cssLinks(css, base) {
  const out = [];
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)|@import\s+(?:url\()?\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "").trim();
    if (!value || /^data:/i.test(value)) continue;
    try { out.push({ url: new URL(value, base).href.replace(/#.*$/, ""), kind: "asset" }); } catch { /* not a URL */ }
  }
  return out;
}

/**
 * The Allow and Disallow lines that apply to every agent (or to portamp by name) in a robots.txt, in order. A rule is
 * a path pattern: `*` matches anything and a final `$` is the end of the path, as the robots standard spells them.
 */
export function robotsRules(text) {
  const rules = [];
  let applies = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") applies = value === "*" || /portamp/i.test(value);
    else if ((field === "disallow" || field === "allow") && applies && value) rules.push({ allow: field === "allow", pattern: value });
  }
  return rules;
}

/** The Disallow patterns alone, as the report lists them. */
export const robotsDisallow = (text) => robotsRules(text).filter((r) => !r.allow).map((r) => r.pattern);

const ruleMatches = (pattern, path) => {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
};

/** The most specific rule that matches decides, the longest pattern; on a tie the allow wins, as the standard says. */
const disallowed = (rules, url) => {
  const path = new URL(url).pathname + new URL(url).search;
  let best = null;
  for (const r of rules) {
    if (!ruleMatches(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return Boolean(best && !best.allow);
};

/**
 * Fetch one origin's site into `dir`. Returns the manifest: what was fetched,
 * what was skipped and why, redirects followed and the external hosts seen.
 */
export async function fetchSite({ url, dir, policy, log = { info() {}, debug() {} }, depth = 2, maxPages = 50, maxBytes = 50 * 1024 * 1024, maxFileBytes = 10 * 1024 * 1024, timeoutMs = 15000, userAgent = "portamp (+https://github.com/drewc611/portamp)", fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") throw new Error("this Node has no fetch; Node 18 or newer is needed to copy a site");
  const start = new URL(url);
  if (!/^https?:$/.test(start.protocol)) throw new Error(`only http and https are fetched, not ${start.protocol}`);
  policy.assertLiveAllowed(start.href);
  const origin = start.origin;
  const manifest = { start: start.href, origin, startedAt: new Date().toISOString(), pages: [], assets: [], skipped: [], redirects: [], external: new Set(), forms: new Set(), bytes: 0, robots: [] };

  // Redirects are followed here, not by fetch, so every hop asks the policy before a byte moves and a hop off the
  // origin is recorded and never requested.
  const get = async (target, accept) => {
    let url = target;
    for (let hop = 0; ; hop += 1) {
      policy.assertLiveAllowed(url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try {
        // No cookies, no credentials, no stored session: the copy is what an anonymous visitor sees.
        res = await fetchImpl(url, { redirect: "manual", signal: controller.signal, headers: { "user-agent": userAgent, accept } });
      } finally {
        clearTimeout(timer);
      }
      const location = res.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(res.status) && location) {
        let to;
        try { to = new URL(location, url).href.replace(/#.*$/, ""); } catch { return { res, url, badRedirect: location }; }
        if (hop >= 5) return { res, url, redirectLoop: true };
        if (new URL(to).origin !== origin) return { res, url, off: to };
        url = to;
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > maxFileBytes) return { res, url, type, body: null, tooBig: true };
      const buffer = Buffer.from(await res.arrayBuffer());
      return { res, url, type, body: buffer.length > maxFileBytes ? null : buffer, tooBig: buffer.length > maxFileBytes };
    }
  };

  // robots.txt first: a site that asked not to be crawled somewhere is not crawled there.
  try {
    const robots = await get(`${origin}/robots.txt`, "text/plain");
    if (robots.res.ok && robots.body) manifest.robots = robotsRules(robots.body.toString("utf8"));
  } catch (err) {
    if (err?.name === "PolicyViolation" || /Refusing to call/.test(err?.message ?? "")) throw err;
    manifest.skipped.push({ url: `${origin}/robots.txt`, reason: `robots.txt could not be read (${err.message}); no rule applied` });
  }

  const save = async (target, body) => {
    const rel = localPath(target);
    const file = join(dir, rel);
    try {
      await mkdir(dirname(file), { recursive: true });
      // Network data written to a file is what a copy is: the path is this module's (localPath, under dir), the
      // origin is one the policy allowed, and the bytes are kept as served so the port reads the real page.
      await writeFile(file, body); // codeql[js/http-to-file-access]
    } catch (err) {
      // A page at /v2.0 saved as a file leaves /v2.0/intro nowhere to go; the second is a skip, not an abort.
      manifest.skipped.push({ url: target, reason: `could not be saved as ${rel} (${err.code ?? err.message})` });
      return null;
    }
    return rel;
  };

  const seen = new Set([start.href]);
  const queue = [{ url: start.href, depth: 0, kind: "page" }];
  const assetQueue = [];
  const enqueue = (link, fromDepth) => {
    if (seen.has(link.url)) return;
    let u;
    try { u = new URL(link.url); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    if (u.origin !== origin) { manifest.external.add(u.host); return; }
    if (link.kind === "form") { manifest.forms.add(u.pathname); return; }
    seen.add(link.url);
    if (manifest.robots.length && disallowed(manifest.robots, link.url)) { manifest.skipped.push({ url: link.url, reason: "disallowed by robots.txt" }); return; }
    if (link.kind === "asset" || ASSET_EXT.test(u.pathname)) assetQueue.push({ url: link.url });
    else if (fromDepth + 1 > depth) manifest.skipped.push({ url: link.url, reason: `beyond depth ${depth}` });
    else queue.push({ url: link.url, depth: fromDepth + 1, kind: "page" });
  };

  while (queue.length) {
    let item = queue.shift();
    if (manifest.pages.length >= maxPages) { manifest.skipped.push({ url: item.url, reason: `over the page limit of ${maxPages}` }); continue; }
    if (manifest.bytes >= maxBytes) { manifest.skipped.push({ url: item.url, reason: `over the byte limit of ${maxBytes}` }); continue; }
    let got;
    try { got = await get(item.url, "text/html,application/xhtml+xml"); } catch (err) {
      if (err?.name === "PolicyViolation" || /Refusing to call/.test(err?.message ?? "")) throw err;
      manifest.skipped.push({ url: item.url, reason: err.name === "AbortError" ? `no answer within ${timeoutMs} ms` : err.message });
      continue;
    }
    const { res, url: landed, type, body, tooBig, off, redirectLoop, badRedirect } = got;
    if (off) { manifest.redirects.push({ from: item.url, to: off }); manifest.skipped.push({ url: item.url, reason: `redirected off the origin to ${new URL(off).host}` }); manifest.external.add(new URL(off).host); continue; }
    if (redirectLoop) { manifest.skipped.push({ url: item.url, reason: "more than five redirects" }); continue; }
    if (badRedirect) { manifest.skipped.push({ url: item.url, reason: "redirected to an address that is not a URL" }); continue; }
    if (landed !== item.url) {
      // A redirect is recorded and the page is saved once, under the address it lives at, never as a second copy.
      manifest.redirects.push({ from: item.url, to: landed });
      if (seen.has(landed)) { manifest.skipped.push({ url: item.url, reason: `redirected to ${landed}, which is saved under its own address` }); continue; }
      seen.add(landed);
      item = { ...item, url: landed };
    }
    if (!res.ok) { manifest.skipped.push({ url: item.url, reason: `HTTP ${res.status}` }); continue; }
    if (tooBig || !body) { manifest.skipped.push({ url: item.url, reason: `over the file limit of ${maxFileBytes} bytes` }); continue; }
    if (!PAGE_TYPES.test(type)) {
      // A link that turned out to be a file is an asset after all.
      if (manifest.bytes + body.length <= maxBytes) { const rel = await save(item.url, body); if (rel) { manifest.assets.push({ url: item.url, file: rel, type: type.split(";")[0], bytes: body.length }); manifest.bytes += body.length; } }
      continue;
    }
    const rel = await save(item.url, body);
    if (!rel) continue;
    manifest.bytes += body.length;
    const html = body.toString("utf8");
    const links = linksIn(html, res.url || item.url);
    manifest.pages.push({ url: item.url, file: rel, status: res.status, bytes: body.length, depth: item.depth, links: links.length, title: (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 200) });
    log.debug(`${item.url} → ${rel} (${body.length} bytes, ${links.length} link(s))`);
    for (const link of links) enqueue(link, item.depth);
  }

  while (assetQueue.length) {
    const item = assetQueue.shift();
    if (manifest.bytes >= maxBytes) { manifest.skipped.push({ url: item.url, reason: `over the byte limit of ${maxBytes}` }); continue; }
    let got;
    try { got = await get(item.url, "*/*"); } catch (err) {
      if (err?.name === "PolicyViolation" || /Refusing to call/.test(err?.message ?? "")) throw err;
      manifest.skipped.push({ url: item.url, reason: err.name === "AbortError" ? `no answer within ${timeoutMs} ms` : err.message });
      continue;
    }
    const { res, type, body, tooBig, off, redirectLoop, badRedirect } = got;
    if (off) { manifest.skipped.push({ url: item.url, reason: `redirected off the origin to ${new URL(off).host}` }); manifest.external.add(new URL(off).host); continue; }
    if (redirectLoop || badRedirect) { manifest.skipped.push({ url: item.url, reason: redirectLoop ? "more than five redirects" : "redirected to an address that is not a URL" }); continue; }
    if (!res.ok) { manifest.skipped.push({ url: item.url, reason: `HTTP ${res.status}` }); continue; }
    if (tooBig || !body) { manifest.skipped.push({ url: item.url, reason: `over the file limit of ${maxFileBytes} bytes` }); continue; }
    const rel = await save(item.url, body);
    if (!rel) continue;
    manifest.bytes += body.length;
    manifest.assets.push({ url: item.url, file: rel, type: type.split(";")[0], bytes: body.length });
    // A stylesheet names fonts and images of its own.
    if (/^text\/css/i.test(type) || /\.css$/i.test(new URL(item.url).pathname)) for (const link of cssLinks(body.toString("utf8"), item.url)) enqueue(link, depth);
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.external = [...manifest.external].sort();
  manifest.forms = [...manifest.forms].sort();
  await mkdir(dir, { recursive: true });
  // The manifest names what was fetched, in the copy's own folder, by design.
  await writeFile(join(dir, "FETCH.md"), fetchReport(manifest), "utf8"); // codeql[js/http-to-file-access]
  await writeFile(join(dir, "portamp.fetch.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8"); // codeql[js/http-to-file-access]
  log.info(`${manifest.pages.length} page(s) and ${manifest.assets.length} asset(s) copied from ${origin}, ${manifest.skipped.length} skipped`);
  return manifest;
}

/** The copy described: what was taken, what was not and why, and what the site leaned on elsewhere. */
export function fetchReport(m) {
  const row = (cells) => `| ${cells.map((c) => String(c ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`;
  const out = [
    "# The copy", "",
    `Fetched from ${m.start} between ${m.startedAt} and ${m.finishedAt}, one origin (${m.origin}), as an anonymous visitor with no cookies or credentials. Nothing saved was rewritten; the pages are byte for byte what the server sent, so what the port reads is what the site served.`, "",
    `${m.pages.length} page(s), ${m.assets.length} asset(s), ${m.bytes} bytes. ${m.skipped.length} request(s) skipped, each with its reason below.`, "",
    "## Pages", "", "| url | saved as | depth | bytes | links | title |", "| --- | --- | --- | --- | --- | --- |",
    ...m.pages.map((p) => row([p.url, p.file, p.depth, p.bytes, p.links, p.title])), "",
    "## Assets", "", "| url | saved as | type | bytes |", "| --- | --- | --- | --- |",
    ...m.assets.map((a) => row([a.url, a.file, a.type, a.bytes])), "",
    "## Skipped", "",
    ...(m.skipped.length ? ["| url | reason |", "| --- | --- |", ...m.skipped.map((s) => row([s.url, s.reason]))] : ["Nothing was skipped."]), "",
    "## Redirects followed", "",
    ...(m.redirects.length ? m.redirects.map((r) => `- ${r.from} → ${r.to}`) : ["None."]), "",
    "## Other hosts the site leaned on", "",
    ...(m.external.length ? m.external.map((h) => `- ${h}`) : ["None."]), "",
    "Nothing from another host was fetched; dsp-supplychain reads those references from the markup itself.", "",
    "## Forms", "",
    ...(m.forms.length ? m.forms.map((f) => `- ${f}`) : ["None."]), "",
    "A form's action was recorded and never submitted.", "",
    "## robots.txt", "",
    ...(m.robots.length ? m.robots.map((r) => `- ${r.allow ? "Allow" : "Disallow"}: ${r.pattern}`) : ["No rule applied to every agent."]), "",
  ];
  return out.join("\n");
}
