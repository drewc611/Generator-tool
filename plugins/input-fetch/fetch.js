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
  let pathname = decodeURIComponent(u.pathname).replace(/\/+/g, "/");
  if (pathname.endsWith("/")) pathname += "index.html";
  else if (!/\.[a-z0-9]{1,8}$/i.test(pathname.split("/").pop())) pathname += "/index.html";
  // A query string names a different document; it is kept in the file name so two do not collide.
  const query = u.search ? `~${u.search.slice(1).replace(/[^\w.-]+/g, "_").slice(0, 80)}` : "";
  if (query) pathname = pathname.replace(/(\.[a-z0-9]{1,8})$/i, `${query}$1`);
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

/** The Disallow lines that apply to every agent in a robots.txt, as path prefixes. */
export function robotsDisallow(text) {
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
    else if (field === "disallow" && applies && value) rules.push(value);
  }
  return rules;
}

const disallowed = (rules, url) => {
  const path = new URL(url).pathname;
  return rules.some((r) => path.startsWith(r.replace(/\*.*$/, "")));
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

  const get = async (target, accept) => {
    policy.assertLiveAllowed(target);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // No cookies, no credentials, no stored session: the copy is what an anonymous visitor sees.
      const res = await fetchImpl(target, { redirect: "follow", signal: controller.signal, headers: { "user-agent": userAgent, accept } });
      const type = res.headers.get("content-type") ?? "";
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > maxFileBytes) return { res, type, body: null, tooBig: true };
      const buffer = Buffer.from(await res.arrayBuffer());
      return { res, type, body: buffer.length > maxFileBytes ? null : buffer, tooBig: buffer.length > maxFileBytes };
    } finally {
      clearTimeout(timer);
    }
  };

  // robots.txt first: a site that asked not to be crawled somewhere is not crawled there.
  try {
    const robots = await get(`${origin}/robots.txt`, "text/plain");
    if (robots.res.ok && robots.body) manifest.robots = robotsDisallow(robots.body.toString("utf8"));
  } catch (err) {
    if (err?.name === "PolicyViolation" || /Refusing to call/.test(err?.message ?? "")) throw err;
    manifest.skipped.push({ url: `${origin}/robots.txt`, reason: `robots.txt could not be read (${err.message}); no rule applied` });
  }

  const save = async (target, body) => {
    const rel = localPath(target);
    const file = join(dir, rel);
    await mkdir(dirname(file), { recursive: true });
    // Network data written to a file is what a copy is: the path is this module's (localPath, under dir), the
    // origin is one the policy allowed, and the bytes are kept as served so the port reads the real page.
    await writeFile(file, body); // codeql[js/http-to-file-access]
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
    const { res, type, body, tooBig } = got;
    if (res.url && res.url.replace(/#.*$/, "") !== item.url) {
      // A redirect is recorded and the page is saved once, under the address it lives at, never as a second copy.
      const to = res.url.replace(/#.*$/, "");
      manifest.redirects.push({ from: item.url, to });
      if (new URL(to).origin !== origin) { manifest.skipped.push({ url: item.url, reason: `redirected off the origin to ${new URL(to).host}` }); manifest.external.add(new URL(to).host); continue; }
      if (seen.has(to)) { manifest.skipped.push({ url: item.url, reason: `redirected to ${to}, which is saved under its own address` }); continue; }
      seen.add(to);
      item = { ...item, url: to };
    }
    if (!res.ok) { manifest.skipped.push({ url: item.url, reason: `HTTP ${res.status}` }); continue; }
    if (tooBig || !body) { manifest.skipped.push({ url: item.url, reason: `over the file limit of ${maxFileBytes} bytes` }); continue; }
    if (!PAGE_TYPES.test(type)) {
      // A link that turned out to be a file is an asset after all.
      if (manifest.bytes + body.length <= maxBytes) { const rel = await save(item.url, body); manifest.assets.push({ url: item.url, file: rel, type: type.split(";")[0], bytes: body.length }); manifest.bytes += body.length; }
      continue;
    }
    const rel = await save(item.url, body);
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
    const { res, type, body, tooBig } = got;
    if (!res.ok) { manifest.skipped.push({ url: item.url, reason: `HTTP ${res.status}` }); continue; }
    if (tooBig || !body) { manifest.skipped.push({ url: item.url, reason: `over the file limit of ${maxFileBytes} bytes` }); continue; }
    const rel = await save(item.url, body);
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
    ...(m.robots.length ? m.robots.map((r) => `- Disallow: ${r}`) : ["No rule applied to every agent."]), "",
  ];
  return out.join("\n");
}
