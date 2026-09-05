import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { flatten } from "../dsp-routes/parse.js";
import { pascal } from "../dsp-ir/emit.js";
import {
  stripServerBlocks, resolveSsi, lowerLegacyHtml, readHead,
  localAssets, imagemapLinks, readFrameset, layoutTables, readHtaccess,
  performTables,
} from "./lower.js";

/**
 * The reader for a site that never had a framework. A folder of plain pages is
 * the oldest front end there is, and it is already almost the model: every
 * page is a screen, and every link between pages is a route somebody could
 * bookmark. Nothing needs translating; it needs collecting.
 *
 * What disqualifies a page is any sign that something else owns it: a
 * directive, an interpolation, a template tag, or a body that is one mount
 * point for an app. Those pages belong to the reader of their dialect, and
 * claiming them here would port the shell and lose the app. A server page
 * (.php, .asp, .jsp) is different: its blocks are stripped and named, and the
 * HTML around them is exactly the page the server sent.
 *
 * With `--site true` the pages become an application: the shared chrome is
 * lifted into a layout, internal links become routes, and ctx.site carries
 * the graph the output-site plugin builds the shell from.
 */

const OWNED = /^\s*@\((?=[\s\S]*?\)\s*(?:\(|\n|<|@))|@(?:if|for|match|defining|main|import)\b|@\*[\s\S]*?\*@|\bng-[\w-]+=|\b(?:th|data-th)[:-][\w-]+=|\blayout:decorate=|<c:\w+|<jsp:\w+|<fmt:\w+|<form:\w+|<%@|\bv-(?:if|for|model|show|bind|on|html)\b|\bko-[\w-]+=|\bdata-bind=|\{\{|<%|\{%/;
const PAGE_EXT = /\.(html?|shtml|php|asp|jsp)$/i;
const SERVER_EXT = /\.(php|asp|jsp|shtml)$/i;


export function readPage(text, rel, { note = () => {}, resolveInclude = null } = {}) {
  let source = String(text ?? "");
  const server = SERVER_EXT.test(rel);
  if (server) source = resolveSsi(stripServerBlocks(source, note), resolveInclude, note);
  if (OWNED.test(server ? source : text)) return { skip: "another dialect owns it" };
  if (!server) source = resolveSsi(source, resolveInclude, note);

  const head = readHead(source);

  // A frameset page is a layout wearing 1996's clothes. Its frames are pages
  // of their own; the frameset itself maps a route to its content frame.
  const frameset = readFrameset(source);
  if (frameset) return { frameset, head, skip: "a frameset; its frames are the pages" };

  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(source);
  const body = lowerLegacyHtml(stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : source)), note).trim();
  if (!body) return { skip: "nothing renders" };

  // A body that is one dashed tag is an app shell, and its app is the thing
  // to port, not the div it mounts into. Comment removal loops to a fixpoint
  // so overlap cannot manufacture a survivor.
  let rendered = body;
  for (let i = 0; i < 20; i += 1) {
    const next = rendered.replace(/<!--[\s\S]*?-->/g, "");
    if (next === rendered) break;
    rendered = next;
  }
  rendered = rendered.trim();
  if (/^<([a-z][\w]*-[\w-]+)[^>]*>\s*(?:loading\.*|\.\.\.)?\s*<\/\1>$/i.test(rendered)) {
    return { skip: "the body is a mount point for an app" };
  }

  const name = rel.replace(PAGE_EXT, "").split("/").filter((p) => p !== ".").join("-") || "page";
  const selector = name.toLowerCase() === "index" ? "home" : name.toLowerCase().replace(/[^\w-]/g, "-");

  const links = [];
  for (const m of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#?]+\.(?:html?|shtml|php|asp|jsp))(?:[#?][^"']*)?["']/gi)) {
    if (!/^[a-z][\w+.-]*:/i.test(m[1])) links.push(m[1]);
  }
  for (const area of imagemapLinks(body)) links.push(area.href);

  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source)?.[1]?.trim() ?? null;

  const tables = layoutTables(body);
  if (tables) {
    note(`${tables} table(s) carry no header cell and read as layout scaffolding. Proposed for CSS grid in the port; the tables are kept until a person makes that cut.`);
  }

  // Scripts the page loads from its own tree mean the behavior is in the run,
  // and the reader of that behavior owns the page. Collected here, judged by
  // the caller against what the run actually holds.
  const scripts = [...source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((src) => !/^[a-z][\w+.-]*:|^\/\//i.test(src));

  return {
    scripts,
    head,
    assets: localAssets(body, head.cssLinks),
    imagemap: imagemapLinks(body),
    screen: {
      selector,
      className: pascal(selector),
      file: rel,
      inputs: [],
      outputs: [],
      template: body,
      templateOrigin: server ? "a server page, its blocks stripped and named" : "a static page",
      usesNgIf: false,
      usesNgFor: false,
      usesTwoWay: false,
      rxjs: [],
      readBy: "static",
      title,
    },
    links: [...new Set(links)],
  };
}

/** A page's rel path as the route the site serves it at. */
export function routeFor(rel) {
  const clean = "/" + rel.replace(PAGE_EXT, "").replace(/^\.\//, "");
  return clean.replace(/\/index$/i, "/").replace(/\/+/g, "/") || "/";
}

/** Resolve a link the way the browser would, against the page's directory
 * or the <base href> when the page declares one. */
export function resolveLink(fromRel, href, base = null) {
  // A <base href> pointing at a full URL resolves outside the run's tree; the
  // files still live beside the page, so the page's own directory is the base
  // that can actually be checked, and dead link detection judges the result.
  if (base && /^[a-z][\w+.-]*:|^\/\//i.test(base)) base = null;
  const dir = base ? base.replace(/\/[^/]*$/, "").replace(/^\//, "") : fromRel.split("/").slice(0, -1).join("/");
  const parts = [];
  for (const piece of [...dir.split("/"), ...String(href).split("/")]) {
    if (!piece || piece === ".") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }
  return parts.join("/");
}

/**
 * The chrome shared verbatim across pages: nav, header and footer blocks
 * that appear on two or more of them. Returned with the pages each block
 * was seen on, so site mode can lift them and everything else can propose.
 */
export function sharedChrome(pages) {
  const seen = new Map();
  for (const page of pages) {
    for (const m of page.screen.template.matchAll(/<(nav|header|footer)\b[\s\S]*?<\/\1\s*>/gi)) {
      const key = m[0].replace(/\s+/g, " ").trim();
      const entry = seen.get(key) ?? { tag: m[1].toLowerCase(), html: m[0], on: [] };
      entry.on.push(page.rel);
      seen.set(key, entry);
    }
  }
  return [...seen.values()].filter((c) => c.on.length >= 2);
}


/**
 * Site mode, in one place: the chrome leaves the pages, links become routes,
 * every old address gets its redirect, the families and the gaps are named,
 * and ctx.site carries the model output-site builds the shell from. Pulled
 * out of the extract handler so the handler reads as the pipeline it is.
 */
async function assembleSite(ctx, { kept, framesets, redirects, chrome, relOf, routeOf, note }) {
  // Performed here, proposed below: the shared chrome leaves the pages
  // and becomes the layout the site shell wraps every route in.
  for (const piece of chrome) {
    for (const page of kept) {
      if (page.screen.template.includes(piece.html)) {
        page.screen.template = page.screen.template.replace(piece.html, "").trim();
      }
    }
  }
  // Content hashed asset names, behind a flag because URLs are a contract:
  // the bytes name the file and every reference the port writes follows.
  // The note says plainly what the flag knowingly changes.
  const assetNames = {};
  if (ctx.config.hashAssets ?? ctx.config["hash-assets"]) {
    for (const f of ctx.sources.files) {
      if (!/\.(png|jpe?g|gif|ico|webp|svg|css|woff2?|ttf|otf|eot|pdf|mp[34]|webm|ogg)$/i.test(f.rel)) continue;
      const bytes = await readFile(f.path).catch(() => null);
      if (!bytes) continue;
      const rel = f.rel.replace(/^\.\//, "");
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
      assetNames[rel] = rel.replace(/(\.[^./]+)$/, `.${hash}$1`);
    }
    note(`--hash-assets: ${Object.keys(assetNames).length} asset(s) renamed by their content hash, every reference the port writes rewritten to match. An asset URL somebody bookmarked is the contract this flag knowingly changes; the pages' own addresses are untouched.`);
  }

  // Internal links become the routes they always meant. The route is
  // what the anchor navigates to; the router intercepts the click.
  // A link to a frameset is a link to the place the frameset stood;
  // its route redirects on to the content frame, so the anchor can
  // point at the frameset's own route and still land right.
  const framesetRels = new Set(framesets.map((f) => f.rel.replace(/^\.\//, "")));
  const rewrite = (html, fromRel, base) =>
    html
      .replace(/(<(?:a|area)\b[^>]*\bhref\s*=\s*["'])([^"']+)(["'])/gi, (whole, before, href, after) => {
        const [pathPart, tail = ""] = [href.split(/([#?].*)$/)[0], /([#?].*)$/.exec(href)?.[1]];
        if (/^[a-z][\w+.-]*:|^\/\//i.test(pathPart) || !PAGE_EXT.test(pathPart)) return whole;
        const target = resolveLink(fromRel, pathPart, base);
        if (!relOf.has(target) && !framesetRels.has(target)) return whole;
        return `${before}${routeOf(target)}${tail}${after}`;
      })
      // An asset spelled relative to the page breaks the moment the page
      // is served at a route, so every local reference becomes the root
      // absolute path the copied file answers at.
      .replace(/(<(?:img|source|video|audio|embed)\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi, (whole, before, src, after) => {
        const pathPart = src.split(/[#?]/)[0];
        if (/^[a-z][\w+.-]*:|^\/\/|^data:/i.test(pathPart)) return whole;
        const resolved = resolveLink(fromRel, pathPart, base);
        return `${before}/${assetNames[resolved] ?? resolved}${after}`;
      });
  for (const page of kept) {
    page.screen.template = rewrite(page.screen.template, page.rel, page.head?.base);
  }
  chrome = chrome.map((c) => ({ ...c, html: rewrite(c.html, kept[0]?.rel ?? "", null) }));

  // Old addresses keep working: every page's .html path redirects to
  // its route, because the address bar is half of the contract.
  for (const page of kept) {
    const old = "/" + page.rel.replace(/^\.\//, "");
    if (old !== routeOf(page.rel)) redirects.push({ from: old, to: routeOf(page.rel), kind: "extension dropped" });
  }

  // The server's own .htaccess spoke redirects first; what it declared
  // in plain lines joins the map with its origin named.
  for (const f of ctx.sources.files.filter((f) => /(^|\/)\.htaccess$/.test(f.rel))) {
    const text = await readFile(f.path, "utf8").catch(() => "");
    for (const r of readHtaccess(text, note)) redirects.push(r);
  }

  // A frameset's address was really its content frame's address. When
  // the frame's page is in the run, the frameset's route redirects to
  // it; when it is not, the gap stays named in the frames report.
  for (const fs of framesets) {
    if (!fs.main) continue;
    const target = resolveLink(fs.rel, fs.main);
    if (relOf.has(target)) {
      redirects.push({ from: routeOf(fs.rel), to: routeOf(target), kind: "frameset content" });
    }
  }

  // A frameset whose panes stood side by side is a split view in period
  // costume. Proposed with the author's own geometry as evidence; making
  // that cut is a person's call and the shell decides nothing.
  for (const fs of framesets) {
    if (fs.cols && fs.frames.length >= 2) {
      fs.proposal = `a split layout: cols="${fs.cols}" put ${fs.frames.map((f) => f.name ?? f.src).join(" beside ")}`;
      note(`${fs.rel} laid its frames side by side (cols="${fs.cols}"). A split view is the port's shape for it; the frames report carries the geometry, and performing the cut is a person's call.`);
    }
  }

  // A feed in the tree is the site's own word about which pages are
  // entries: read and matched to routes, never invented, and evidence the
  // pagination proposals can stand on.
  const feedEntries = [];
  for (const f of ctx.sources.files.filter((f) => /\.(xml|rss|atom)$/i.test(f.rel) && !/sitemap/i.test(f.rel))) {
    const text = await readFile(f.path, "utf8").catch(() => "");
    if (!/<(rss|feed)[\s>]/i.test(text)) continue;
    const hrefs = [
      ...[...text.matchAll(/<item\b[\s\S]*?<link\s*>([^<]+)<\/link>/gi)].map((m) => m[1].trim()),
      ...[...text.matchAll(/<entry\b[\s\S]*?<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1].trim()),
    ];
    const entryRoutes = [...new Set(hrefs.map((h) => {
      const rel = h.replace(/^[a-z][\w+.-]*:\/\/[^/]+/i, "").replace(/^\//, "").split(/[#?]/)[0];
      return relOf.has(rel) ? routeOf(rel) : null;
    }).filter(Boolean))];
    if (entryRoutes.length) {
      feedEntries.push({ source: f.rel, routes: entryRoutes });
      note(`${f.rel} declares ${entryRoutes.length} page(s) as entries (${entryRoutes.join(", ")}), which is the site's own word that they are one family.`);
    }
  }

  // Page families like news-1, news-2 are one screen and a parameter
  // in everything but the filenames. Proposed, because merging them
  // means deciding which copy is the template.
  const families = new Map();
  for (const page of kept) {
    const m = /^(.*?)[-_]?(\d+)$/.exec(page.screen.selector);
    if (m && m[1]) families.set(m[1], [...(families.get(m[1]) ?? []), page.screen.selector]);
  }
  const pagination = [...families.entries()].filter(([, list]) => list.length >= 2)
    .map(([stem, list]) => ({ stem, pages: list }));
  for (const family of pagination) {
    note(`${family.pages.length} page(s) (${family.pages.join(", ")}) look like one screen paged by filename. A parameterized route (/${family.stem}/:page) is the port's shape; merging them means choosing the template, which is a person's call.`);
  }

  // page.php?id=3 is the query string era's parameterized route. Links
  // to the same page under different values of one parameter are read
  // as a family the way filename pagination is: proposed, never merged.
  const routeSet = new Set(kept.map((p) => routeOf(p.rel)));
  const queryFamilies = new Map();
  for (const page of kept) {
    for (const m of page.screen.template.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'?#]+)\?([\w]+)=([^"'&#]+)["']/gi)) {
      if (/^[a-z][\w+.-]*:|^\/\//i.test(m[1])) continue;
      // The scan runs after link rewriting, so an internal href is
      // already the route it navigates to; a stray relative one still
      // resolves through the page it sat on.
      const route = m[1].startsWith("/") ? m[1] : routeOf(resolveLink(page.rel, m[1], page.head?.base));
      if (!routeSet.has(route)) continue;
      const key = `${route}?${m[2]}`;
      queryFamilies.set(key, (queryFamilies.get(key) ?? new Set()).add(m[3]));
    }
  }
  const queryRoutes = [...queryFamilies.entries()].filter(([, values]) => values.size >= 2)
    .map(([key, values]) => {
      const [route, param] = key.split("?");
      return { route, param, values: [...values] };
    });
  for (const q of queryRoutes) {
    note(`${q.route} is linked with ${q.values.length} value(s) of ?${q.param}=. A parameterized route (${q.route}/:${q.param}) is the port's shape; the page still renders one template until a person splits it.`);
  }

  // Two top level trees named like locales, holding the same paths, are one
  // site in two languages. Read as a fact with a count; parameterizing the
  // routes by locale is proposed, never performed.
  const localeDirs = new Map();
  for (const page of kept) {
    const m = /^([a-z]{2}(?:-[a-z]{2})?)\//i.exec(page.rel.replace(/^\.\//, ""));
    if (!m) continue;
    const tail = page.rel.replace(/^\.\//, "").slice(m[1].length + 1);
    if (!localeDirs.has(m[1])) localeDirs.set(m[1], new Set());
    localeDirs.get(m[1]).add(tail);
  }
  let locales = { dirs: [], sharedPaths: 0 };
  if (localeDirs.size >= 2) {
    const dirs = [...localeDirs.keys()].sort();
    const [first, ...rest] = dirs.map((d) => localeDirs.get(d));
    const shared = [...first].filter((p) => rest.every((s) => s.has(p))).sort();
    if (shared.length) {
      // The route table, parameterized by locale: every shared path as one
      // pattern, and every concrete route knowing its siblings so the shell
      // can say hreflang without merging anything. The trees stay separate;
      // choosing a primary language is a person's call.
      const tail = (p) => { const r = routeFor(p); return r === "/" ? "" : r; };
      locales = {
        dirs,
        sharedPaths: shared.length,
        routes: shared.map((p) => ({ pattern: `/:locale${tail(p)}`, locales: dirs })),
        alternates: Object.fromEntries(shared.flatMap((p) => dirs.map((d) => [
          routeFor(`${d}/${p}`),
          Object.fromEntries(dirs.filter((o) => o !== d).map((o) => [o, routeFor(`${o}/${p}`)])),
        ]))),
      };
      note(`${dirs.join(", ")} hold ${shared.length} page(s) at the same paths and read as one site in ${dirs.length} language(s). The route table carries the /:locale patterns and every page knows its siblings; merging the trees means choosing a primary language, which is a person's call.`);
    }
  }

  ctx.site = {
    pages: kept.map((p) => ({
      rel: p.rel,
      route: routeOf(p.rel),
      selector: p.screen.selector,
      className: p.screen.className,
      title: p.screen.title,
      description: p.head?.description ?? null,
      og: p.head?.og ?? {},
      canonical: p.head?.canonical ?? null,
      assets: p.assets ?? [],
      cssLinks: p.head?.cssLinks ?? [],
      printLinks: p.head?.printLinks ?? [],
      icons: p.head?.icons ?? [],
      tableOriginals: p.tableOriginals ?? [],
    })),
    queryRoutes,
    locales,
    feedEntries,
    assetNames,
    graph: {
      nodes: kept.map((p) => routeOf(p.rel)),
      edges: kept.flatMap((p) => p.links
        .map((l) => resolveLink(p.rel, l, p.head?.base))
        .filter((t) => relOf.has(t))
        .map((t) => [routeOf(p.rel), routeOf(t)])),
    },
    chrome,
    redirects,
    pagination,
    frames: framesets,
    deadLinks: kept.flatMap((p) => p.links
      .map((l) => ({ from: p.rel, target: resolveLink(p.rel, l, p.head?.base) }))
      .filter((x) => !relOf.has(x.target))),
  };
}

export default {
  name: "input-static",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      // A .blade.php file is a Blade view with its own reader; reading it here
      // too would make two screens of one page.
      const files = ctx.sources.files.filter((f) => PAGE_EXT.test(f.rel) && !/\.blade\.php$/i.test(f.rel));
      if (!files.length) return log.debug("no pages");

      const local = new Set(ctx.sources.files.map((f) => f.rel.replace(/^\.\//, "")));
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };

      // SSI resolves the way the server would: from the run's own tree.
      const bodies = new Map();
      const resolveInclude = (name) => {
        const clean = String(name).replace(/^\.?\//, "");
        return bodies.get(clean) ?? bodies.get([...bodies.keys()].find((k) => k.endsWith(`/${clean}`)) ?? "") ?? null;
      };
      for (const f of ctx.sources.files.filter((f) => /\.(inc|html?|shtml|txt)$/i.test(f.rel))) {
        bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => null));
      }

      const pages = [];
      const framesets = [];
      const redirects = [];
      for (const file of files) {
        let text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        // The page says its own charset. latin1 survives a utf8 read
        // losslessly enough to detect, then the bytes are decoded as meant.
        if (/iso-8859-1|windows-1252/i.test(/charset\s*=\s*["']?([\w-]+)/i.exec(text)?.[1] ?? "")) {
          const bytes = await readFile(file.path).catch(() => null);
          if (bytes) text = bytes.toString("latin1");
        }
        const page = readPage(text, file.rel, { note, resolveInclude });
        if (page.frameset) {
          framesets.push({ rel: file.rel, ...page.frameset });
          note(`${file.rel} is a frameset. Each frame is ported as its own page; the frameset's route points at its content frame, and the frame layout is the site shell's to replace.`);
          continue;
        }
        // A meta refresh is a redirect the server never knew about. The page
        // exists to bounce, so it becomes a redirect entry, not a screen.
        if (page.head?.refresh) {
          const target = /^[a-z][\w+.-]*:|^\/\//i.test(page.head.refresh)
            ? page.head.refresh
            : routeFor(resolveLink(file.rel, page.head.refresh, page.head.base));
          redirects.push({ from: routeFor(file.rel), to: target, kind: "meta refresh" });
          note(`${file.rel} redirects by meta refresh to ${page.head.refresh}. It is in the redirect map instead of the screens.`);
          continue;
        }
        if (page.skip) { log.debug(`${file.rel}: ${page.skip}`); continue; }
        // A page that loads a script from its own tree is that script's page.
        // The behavior is in the run and another reader inventories it; the
        // markup alone would be a body with its nerves cut.
        const dir = file.rel.split("/").slice(0, -1).join("/");
        const owned = page.scripts.some((src) => {
          const resolved = [dir, src].filter(Boolean).join("/").replace(/\/+/g, "/").replace(/^\.\//, "");
          return local.has(resolved) || local.has(src.replace(/^\.\//, ""));
        });
        if (owned) { log.debug(`${file.rel}: its scripts are in the run`); continue; }
        // The grid conversion layoutTables proposes, performed only under
        // the flag, with every original kept beside the component.
        if (ctx.config.performTables ?? ctx.config["perform-tables"]) {
          const { html, originals } = performTables(page.screen.template);
          if (originals.length) {
            page.screen.template = html;
            page.tableOriginals = originals;
            note(`${file.rel}: ${originals.length} layout table(s) performed as CSS grid under --perform-tables. The original markup is kept beside the component for the diff; a table with a header cell was left as the data it is.`);
          }
        }
        pages.push({ ...page, rel: file.rel });
      }
      if (!pages.length && !redirects.length) return log.debug("no static pages");

      // Two pages with the same body are one page with two addresses: the
      // first keeps the screen, the rest become redirects to it.
      const byBody = new Map();
      const kept = [];
      for (const page of pages) {
        const body = page.screen.template.replace(/\s+/g, " ").trim();
        const first = byBody.get(body);
        if (first) {
          redirects.push({ from: routeFor(page.rel), to: routeFor(first.rel), kind: "duplicate page" });
          note(`${page.rel} is byte identical to ${first.rel}. One screen is ported; the other address redirects to it.`);
          continue;
        }
        byBody.set(body, page);
        kept.push(page);
      }

      const relOf = new Map(kept.map((p) => [p.rel.replace(/^\.\//, ""), p]));
      const routeOf = (rel) => routeFor(rel);

      /* ------------------------------------------------ the site, assembled */
      const chrome = sharedChrome(kept);
      if (ctx.config.site) {
        await assembleSite(ctx, { kept, framesets, redirects, chrome, relOf, routeOf, note });
      }

      for (const page of kept) ctx.screens.push(page.screen);

      // Links between pages are the route table nobody wrote down. It is only
      // claimed when no declared table exists; a real router outranks
      // inference from anchors.
      if (!ctx.routes) {
        const table = kept.map((page) => ({
          path: routeOf(page.rel), component: page.screen.className, redirectTo: null, lazy: false, file: page.rel, children: [],
        }));
        for (const page of kept) {
          for (const link of page.links) {
            const target = resolveLink(page.rel, link, page.head?.base);
            if (!relOf.has(target)) {
              ctx.unverified(`${page.rel} links to ${link}, which is not a page in this run. The link will dangle in the port.`);
            }
          }
        }
        ctx.routes = { table: flatten(table), hashRouting: false };
      }

      // A form that posts somewhere is the one API call a static page can
      // declare. The action and the field names are in the markup; where they
      // go afterwards is the server's business, and the note says which.
      let forms = 0;
      for (const page of kept) {
        for (const m of page.screen.template.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
          const action = /action\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
          const method = (/method\s*=\s*["'](\w+)["']/i.exec(m[1])?.[1] ?? "GET").toUpperCase();
          if (!action || /^(mailto:|javascript:|#)/i.test(action)) continue;
          const fields = [...new Set([...m[2].matchAll(/<(?:input|select|textarea)\b[^>]*\bname\s*=\s*["']([\w[\]./-]+)["']/gi)].map((f) => f[1]))];
          ctx.api.calls.push({
            method,
            path: action,
            file: page.rel,
            headers: null,
            body: method === "GET" ? null : fields.length ? `form fields: ${fields.join(", ")}` : "unknown",
          });
          forms += 1;
          if (method === "GET" && fields.length) {
            ctx.unverified(`${page.rel}: the form posting to ${action} uses GET, so its fields (${fields.join(", ")}) travel as a query string. The port should keep that spelling.`);
          }
        }
      }
      if (forms) log.info(`${forms} form submission(s) read as API calls`);

      // The action leaves the markup in every mode: an endpoint in a
      // component is the exact thing the endpoint gate exists to stop, and
      // the call is already in the API map where the client owns it. The
      // note names the wiring left to do, because a silent cut would be a
      // guess about intent.
      if (forms) {
        for (const page of kept) {
          page.screen.template = page.screen.template.replace(/(<form\b[^>]*?)\s+action\s*=\s*["']([^"']+)["']/gi, (whole, before, action) => {
            if (/^(mailto:|javascript:|#)/i.test(action)) return whole;
            ctx.unverified(`${page.rel}: the form's action (${action}) moved to the API map. Wire its onSubmit to the generated client; the fields travel as they did.`);
            return before;
          });
        }
      }

      // Without site mode the consolidation stays a proposal: the pages keep
      // their chrome, and the note names the cut a person could make.
      if (!ctx.config.site) {
        for (const { tag, on: where } of chrome) {
          ctx.note(
            `The same <${tag}> appears verbatim on ${where.length} of ${kept.length} page(s). ` +
              `Port it once as a layout component; each page keeps its copy until a person makes that cut. --site true makes it.`
          );
        }
      }

      for (const n of notes) ctx.unverified(n);
      log.info(`${kept.length} static page(s)${ctx.config.site ? `, the site assembled: ${ctx.site.graph.edges.length} link(s), ${redirects.length} redirect(s)` : ""}`);
    });
  },
};
