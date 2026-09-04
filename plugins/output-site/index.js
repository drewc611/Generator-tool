import { readFile } from "node:fs/promises";
import { translate } from "../output-react/template.js";
import { jsString } from "../dsp-ir/emit.js";
import { resolveLink } from "../input-static/index.js";

/**
 * The site engine. input-static assembles ctx.site: pages with routes, the
 * link graph, the chrome shared across pages, the redirect map. This plugin
 * turns that model into a complete React application architecture: a shell,
 * a router with no dependency, a layout lifted from the chrome, a head
 * manager, a navigation model, and the maps a server needs to keep every
 * old address working.
 *
 * The router is written from scratch because a folder of pages does not need
 * a routing library; it needs pushState, one click listener, and a pure
 * matcher the emitted tests can hold to account.
 *
 *   site: true
 */
export default {
  name: "output-site",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.site) return log.debug("not requested");
      if (!ctx.site?.pages?.length) return log.debug("no site model to build from");
      const site = ctx.site;

      // Every page route pairs with the component output-react writes for
      // the same screen. A page that lost its screen to another reader is a
      // route with no component, and the gap is reported, not papered over.
      const pages = site.pages;
      const imports = pages.map((p) => `import ${p.className} from "../features/${p.className}/${p.className}.jsx";`);
      const routes = pages.map((p) => `  { path: ${jsString(p.route)}, component: ${p.className} },`);

      // The redirect map is linted before anything is written from it: a
      // chain flattens to its end so no visitor hops twice, and a cycle is
      // a defect that fails the run while the fix is one file away.
      const { flat, cycles } = flattenRedirects(site.redirects);
      if (cycles.length) {
        throw new Error(`the redirect map loops: ${cycles.join("; ")}. A cycle sends every visitor nowhere; fix the pages that point at each other and rerun.`);
      }
      site.redirects = flat;

      await ctx.write("src/app/match.js", MATCH);
      await ctx.write("src/app/router.js", ROUTER);
      await ctx.write("src/app/redirects.js", REDIRECTS_JS(site.redirects));
      await ctx.write("src/app/head.js", HEAD_JS(pages));
      const nav = navModel(site, pages);
      await ctx.write("src/app/nav.js", NAV_JS(nav));
      await ctx.write("src/app/breadcrumbs.js", BREADCRUMBS_JS(trailsOf(nav, pages)));
      await ctx.write("src/app/Layout.jsx", layoutFile(site.chrome, ctx));
      await ctx.write("src/app/ErrorBoundary.jsx", ERROR_BOUNDARY);
      await ctx.write("src/app/NotFound.jsx", NOT_FOUND);
      await ctx.write("src/app/App.jsx", APP({ imports, routes }));
      await ctx.write("src/main.jsx", MAIN);

      // The old addresses, in every spelling a host understands. The JSON is
      // the data; _redirects and the nginx block in SITE.md are two common
      // spellings of the same map.
      await ctx.write("redirects.json", JSON.stringify(site.redirects, null, 2) + "\n");
      if (site.redirects.length) {
        await ctx.write("_redirects", site.redirects.map((r) => `${r.from} ${r.to} 301`).join("\n") + "\n");
      }

      // Assets travel as the bytes they were. A stylesheet or an image the
      // run holds is copied under public/ at the path the rewritten page
      // expects; one it does not hold is a named gap.
      const wanted = new Map();
      for (const p of pages) {
        for (const a of [...(p.assets ?? []), ...(p.cssLinks ?? []), ...(p.printLinks ?? []), ...(p.icons ?? []).map((i) => i.href)]) {
          const resolved = resolveLink(p.rel, a);
          if (!wanted.has(resolved)) wanted.set(resolved, p.rel);
        }
      }
      const byRel = new Map(ctx.sources.files.map((f) => [f.rel.replace(/^\.\//, ""), f]));
      const css = new Set();
      const done = new Set();
      const copiedBytes = new Map();
      let copied = 0;
      const copyOne = async (rel, from) => {
        if (done.has(rel)) return;
        done.add(rel);
        const file = byRel.get(rel);
        if (!file) {
          ctx.unverified(`${from} uses ${rel}, which is not in this run. The port references /${rel}; place the file under public/ by hand.`);
          return;
        }
        const bytes = await readFile(file.path);
        await ctx.write(`public/${rel}`, bytes);
        copiedBytes.set(rel, bytes);
        copied += 1;
        // A stylesheet drags its own dependencies: the fonts and images its
        // url() references name, resolved the way the browser will resolve
        // them against the copied sheet's address.
        if (/\.css$/i.test(rel)) {
          css.add(rel);
          for (const m of bytes.toString("utf8").matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)) {
            const u = m[1].split(/[#?]/)[0];
            if (!u || /^(data:|https?:|\/\/)/i.test(u)) continue;
            await copyOne(u.startsWith("/") ? resolveLink("x", u) : resolveLink(rel, u), rel);
          }
        }
      };
      for (const [rel, from] of wanted) await copyOne(rel, from);

      const printCss = [...new Set(pages.flatMap((p) => (p.printLinks ?? []).map((a) => resolveLink(p.rel, a))))];
      const icons = dedupeIcons(pages, resolveLink);
      await ctx.write("index.html", INDEX_HTML([...css].filter((c) => !printCss.includes(c)), printCss, icons));

      // The addresses, spoken to machines: a sitemap of every route and a
      // robots file that carries the original's disallow lines when the run
      // holds them, and invents no policy when it does not.
      await ctx.write("sitemap.xml", SITEMAP(pages));
      const oldRobots = ctx.sources.files.find((f) => /(^|\/)robots\.txt$/.test(f.rel));
      const disallow = oldRobots
        ? (await readFile(oldRobots.path, "utf8").catch(() => "")).split("\n").filter((l) => /^\s*(Disallow|Allow|User-agent)\s*:/i.test(l))
        : [];
      await ctx.write("robots.txt", (disallow.length ? disallow.join("\n") : "User-agent: *\nAllow: /") + "\nSitemap: /sitemap.xml\n");
      if (!ctx.written.includes("package.json")) {
        await ctx.write("package.json", JSON.stringify({
          name: "ported-site",
          private: true,
          type: "module",
          scripts: { serve: "node serve.js", test: "node --test tests/*.test.js" },
        }, null, 2) + "\n");
      }

      // The port's own server: the other half of full stack. It serves the
      // build when one exists, the redirect map as real 301s, the assets as
      // bytes, and the API surface honestly: a fixture where one was emitted,
      // and a 501 naming the endpoint map where none was, never invented data.
      const hasEndpoints = ctx.written.includes("src/api/endpoints.js");
      await ctx.write("serve.js", SERVE(hasEndpoints));
      const apiSample = hasEndpoints ? ctx.api.calls.find((c) => c.path?.startsWith("/")) : null;
      await ctx.write("tests/server.test.js", SERVER_TEST(site.redirects, apiSample));
      await ctx.write("tests/router.test.js", ROUTER_TEST(site.redirects));
      await ctx.write("SITE.md", siteReport(site, pages));
      await ctx.write("SITE_MAP.mmd", mermaidMap(site));
      await ctx.write("SITE_MAP.md", "# Site map\n\n```mermaid\n" + mermaidMap(site) + "```\n");

      // The ledger: every decision this run made about the site, machine
      // readable and deterministically ordered, so a second run can be held
      // to the first one's choices and a diff between runs means something.
      await ctx.write("LEDGER.json", JSON.stringify({
        tool: "portamp",
        decisions: {
          routes: pages.map((p) => ({ route: p.route, component: p.className, from: p.rel })),
          redirects: site.redirects,
          chromeLifted: site.chrome.map((c) => ({ tag: c.tag, on: [...c.on].sort() })),
          actionsLifted: ctx.api.calls.filter((c) => c.path?.startsWith("/")).map((c) => ({ method: c.method, path: c.path, from: c.file })).sort((a, b) => a.path.localeCompare(b.path)),
          paginationProposed: site.pagination,
          queryRoutesProposed: site.queryRoutes ?? [],
          deadLinks: site.deadLinks,
          framesReplaced: site.frames.map((f) => ({ rel: f.rel, content: f.main })),
          orphans: site.graph.nodes.filter((n) => n !== "/" && !site.graph.edges.some(([, to]) => to === n)).sort(),
        },
      }, null, 2) + "\n");

      // Static export: the whole site prerendered to real HTML, one file per
      // route, hostable anywhere with no build and no runtime. The chrome
      // wraps every page exactly as the layout does, the head carries what
      // the old page said, and a retired address becomes the meta refresh
      // stub static hosts have always understood.
      let exported = 0;
      if (ctx.config.export) {
        for (const p of pages) {
          const file = p.route === "/" ? "export/index.html" : `export${p.route}/index.html`;
          const template = ctx.screens.find((s) => s.selector === p.selector)?.template ?? "";
          await ctx.write(file, EXPORT_PAGE({ page: p, template, chrome: site.chrome, css: [...css], printCss, icons }));
          exported += 1;
        }
        for (const r of site.redirects.filter((x) => x.to.startsWith("/"))) {
          const file = /\.[a-z0-9]+$/i.test(r.from) ? `export${r.from}` : `export${r.from}/index.html`;
          if (!ctx.written.includes(file)) await ctx.write(file, REDIRECT_STUB(r.to));
        }
        for (const [rel, bytes] of copiedBytes) await ctx.write(`export/${rel}`, bytes);
        await ctx.write("export/sitemap.xml", SITEMAP(pages));
        log.info(`static export: ${exported} page(s) prerendered, hostable with no build`);
      }

      log.info(`app shell: ${pages.length} route(s), ${site.redirects.length} redirect(s), ${copied} asset(s) copied`);
    });

    on("verify", async (ctx) => {
      if (!ctx.config.site || !ctx.site?.pages?.length) return;
      // The shell imports one component per route. A screen another reader
      // claimed, or one that never became a component, leaves a route that
      // cannot render, and that is a fact to surface while it is cheap.
      const missing = ctx.site.pages.filter(
        (p) => !ctx.written.includes(`src/features/${p.className}/${p.className}.jsx`)
      );
      for (const p of missing) {
        ctx.unverified(`Route ${p.route} expects src/features/${p.className}/${p.className}.jsx and no target emitted it. The shell will not compile until the component exists.`);
      }
      log.info(missing.length ? `${missing.length} route(s) lack a component` : "every route has its component");
    });
  },
};

/** The text of a snippet of markup, by walking it: brackets toggle, text
 * accumulates. A walk terminates and cannot reassemble a tag, which is more
 * than any single regex over nested markup can promise. */
function textOf(html) {
  let out = "";
  let inTag = false;
  for (const ch of String(html ?? "")) {
    if (ch === "<") inTag = true;
    else if (ch === ">") inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
}

/** The navigation model: the chrome's own links first, then any page nested
 * under one of them as a child, so a menu can show depth without inventing it. */
function navModel(site, pages) {
  const items = [];
  const seen = new Set();
  for (const piece of site.chrome) {
    for (const m of piece.html.matchAll(/<a\b[^>]*\bhref\s*=\s*["'](\/[^"'#?]*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)) {
      const route = m[1];
      const label = textOf(m[2]).replace(/\s+/g, " ").trim();
      if (!seen.has(route) && pages.some((p) => p.route === route)) {
        seen.add(route);
        items.push({ label: label || route, route, children: [] });
      }
    }
  }
  for (const p of pages) {
    if (seen.has(p.route)) continue;
    const parent = items.find((i) => i.route !== "/" && p.route.startsWith(i.route + "/"));
    if (parent) parent.children.push({ label: p.title ?? p.route, route: p.route });
  }
  return items;
}

/** Chains flattened to their end; a cycle comes back named instead of hung. */
export function flattenRedirects(redirects) {
  const map = new Map(redirects.filter((r) => r.to.startsWith("/")).map((r) => [r.from, r.to]));
  const cycles = [];
  const flat = [];
  for (const r of redirects) {
    let to = r.to;
    const seen = new Set([r.from]);
    while (map.has(to)) {
      if (seen.has(to)) { cycles.push(`${r.from} → ${to} → …`); to = null; break; }
      seen.add(to);
      to = map.get(to);
    }
    if (to !== null && to !== r.from) flat.push({ ...r, to });
  }
  return { flat, cycles: [...new Set(cycles)] };
}

/** Every route's trail: home, the section it hangs under, itself. */
function trailsOf(items, pages) {
  const labelOf = new Map(items.map((i) => [i.route, i.label]));
  for (const i of items) for (const c of i.children) labelOf.set(c.route, c.label);
  const trails = {};
  for (const p of pages) {
    if (p.route === "/") continue;
    const trail = [{ label: "Home", route: "/" }];
    const parent = items.find((i) => i.route !== "/" && p.route.startsWith(i.route + "/"));
    if (parent) trail.push({ label: parent.label, route: parent.route });
    trail.push({ label: labelOf.get(p.route) ?? p.title ?? p.route, route: p.route });
    trails[p.route] = trail;
  }
  return trails;
}

const dedupeIcons = (pages, resolve) => {
  const seen = new Map();
  for (const p of pages) for (const i of p.icons ?? []) {
    const href = "/" + resolve(p.rel, i.href);
    if (!seen.has(href)) seen.set(href, { rel: i.rel, href });
  }
  return [...seen.values()];
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SITEMAP = (pages) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${esc(p.route)}</loc></url>`).join("\n")}
</urlset>
`;

const BREADCRUMBS_JS = (trails) => `/**
 * Where each route sits, as data: home, its section, itself. A breadcrumb
 * component renders this; the hierarchy came from the chrome and the paths,
 * not from guesswork.
 */
export const TRAILS = ${JSON.stringify(trails, null, 2)};
`;

const REDIRECT_STUB = (to) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${esc(to)}">
<link rel="canonical" href="${esc(to)}">
<title>Moved</title>
</head>
<body>
<p>This page moved to <a href="${esc(to)}">${esc(to)}</a>.</p>
</body>
</html>
`;

const EXPORT_PAGE = ({ page, template, chrome, css, printCss, icons }) => {
  const before = chrome.filter((c) => c.tag !== "footer").map((c) => c.html).join("\n");
  const after = chrome.filter((c) => c.tag === "footer").map((c) => c.html).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title ?? page.route)}</title>
${page.description ? `<meta name="description" content="${esc(page.description)}">\n` : ""}${page.canonical ? `<link rel="canonical" href="${esc(page.canonical)}">\n` : ""}${Object.entries(page.og ?? {}).map(([k, v]) => `<meta property="${esc(k)}" content="${esc(v)}">`).join("\n")}${Object.keys(page.og ?? {}).length ? "\n" : ""}${icons.map((i) => `<link rel="${esc(i.rel)}" href="${esc(i.href)}">`).join("\n")}${icons.length ? "\n" : ""}${css.map((c) => `<link rel="stylesheet" href="/${esc(c)}">`).join("\n")}${css.length ? "\n" : ""}${printCss.map((c) => `<link rel="stylesheet" href="/${esc(c)}" media="print">`).join("\n")}${printCss.length ? "\n" : ""}</head>
<body>
${before}${before ? "\n" : ""}<main>
${template}
</main>
${after}${after ? "\n" : ""}</body>
</html>
`;
};

const MATCH = `/**
 * The matcher, pure on purpose: the emitted tests import this file and hold
 * it to account without a browser in the room.
 */
const segments = (p) => String(p ?? "").split("/").filter(Boolean);

export function matchPath(pattern, path) {
  const want = segments(pattern);
  const got = segments(path.split(/[#?]/)[0]);
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i += 1) {
    if (want[i].startsWith(":")) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return { params };
}

/** Follow the redirect map to its end, with a guard so a cycle cannot hang
 * the app; a cycle resolves to where it entered and is a data bug to fix. */
export function resolveRedirect(map, path) {
  let current = path;
  for (let hops = 0; hops < 10; hops += 1) {
    const next = map[current];
    if (next === undefined) return current;
    current = next;
  }
  return path;
}
`;

const ROUTER = `import { createElement, useEffect, useState } from "react";
export { matchPath, resolveRedirect } from "./match.js";

/**
 * The router: pushState, one document level click listener, nothing else.
 * The pages were rewritten to link routes, so plain anchors keep working;
 * the listener turns a same origin click into a navigation instead of a
 * page load, and every other click passes by untouched.
 */
export function navigate(to) {
  history.pushState({}, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

function intercepted(event) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target.closest?.("a[href]");
  if (!anchor || anchor.target || anchor.hasAttribute("download")) return null;
  if (anchor.origin !== location.origin) return null;
  return anchor;
}

export function useRoute() {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = () => {
      setPath(location.pathname);
      const id = location.hash.slice(1);
      if (id) document.getElementById(id)?.scrollIntoView();
    };
    const onClick = (event) => {
      const anchor = intercepted(event);
      if (!anchor) return;
      event.preventDefault();
      navigate(anchor.pathname + anchor.search + anchor.hash);
    };
    addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => {
      removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return path;
}

export function Link({ to, children, ...rest }) {
  return createElement("a", { href: to, ...rest }, children);
}
`;

const REDIRECTS_JS = (redirects) => `/**
 * Old addresses, kept working. Each entry names why it exists; the server
 * side spelling of the same map is redirects.json and _redirects.
 */
export const REDIRECTS = {
${redirects.filter((r) => r.to.startsWith("/")).map((r) => `  ${jsString(r.from)}: ${jsString(r.to)}, // ${r.kind}`).join("\n")}
};
`;

const HEAD_JS = (pages) => `/**
 * What each page's head said, applied per route. The old site put its
 * titles and descriptions in markup; a single page app has to say them
 * again on every navigation or lose them.
 */
export const HEAD = {
${pages.map((p) => `  ${jsString(p.route)}: { title: ${jsString(p.title ?? "")}, description: ${jsString(p.description ?? "")}, canonical: ${p.canonical ? jsString(p.canonical) : "null"}, og: ${JSON.stringify(p.og ?? {})} },`).join("\n")}
};

const setMeta = (attr, key, value) => {
  if (!value) return;
  let tag = document.head.querySelector(\`meta[\${attr}="\${key}"]\`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", value);
};

export function applyHead(route) {
  const head = HEAD[route];
  if (!head) return;
  if (head.title) document.title = head.title;
  setMeta("name", "description", head.description);
  for (const [property, content] of Object.entries(head.og)) setMeta("property", property, content);
  // The canonical address is identity; it changes per route or comes off.
  let canon = document.head.querySelector('link[rel="canonical"]');
  if (head.canonical) {
    if (!canon) {
      canon = document.createElement("link");
      canon.setAttribute("rel", "canonical");
      document.head.appendChild(canon);
    }
    canon.setAttribute("href", head.canonical);
  } else if (canon) {
    canon.remove();
  }
}
`;

const NAV_JS = (items) => `/**
 * The navigation model, read out of the chrome the pages shared. A menu
 * component renders this; nothing else needs to know how the menu is built.
 */
export const NAV = ${JSON.stringify(items, null, 2)};
`;

function layoutFile(chrome, ctx) {
  const before = [];
  const after = [];
  for (const piece of chrome) {
    const result = translate(piece.html, { indent: 3 });
    for (const note of result.notes) ctx.unverified(`the layout: ${note}`);
    (piece.tag === "footer" ? after : before).push(result.jsx);
  }
  return `/**
 * The layout, lifted from the chrome every page carried. The pages lost
 * their copies when the site was assembled; this is where those bytes went.
 */
export default function Layout({ children }) {
  return (
    <div>
${before.join("\n")}${before.length ? "\n" : ""}      <main>{children}</main>
${after.join("\n")}${after.length ? "\n" : ""}    </div>
  );
}
`;
}

const ERROR_BOUNDARY = `import { Component } from "react";

/**
 * The error state for the whole shell. A page that throws takes down its
 * route, not the site, and the person is told instead of shown a blank.
 */
export default class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div role="alert">
          <h1>This page failed to render</h1>
          <p>The rest of the site still works.</p>
          <button onClick={() => this.setState({ failed: false })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
`;

const NOT_FOUND = `import { NAV } from "./nav.js";

/** The route nobody claimed. It offers the map instead of a dead end. */
export default function NotFound() {
  return (
    <div>
      <h1>Not found</h1>
      <p>No page lives at this address. These do:</p>
      <ul>
        {NAV.map((item) => (
          <li key={item.route}><a href={item.route}>{item.label}</a></li>
        ))}
      </ul>
    </div>
  );
}
`;

const APP = ({ imports, routes }) => `import { useEffect } from "react";
import { useRoute, matchPath, resolveRedirect } from "./router.js";
import { REDIRECTS } from "./redirects.js";
import { applyHead } from "./head.js";
import Layout from "./Layout.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import NotFound from "./NotFound.jsx";
${imports.join("\n")}

export const ROUTES = [
${routes.join("\n")}
];

export default function App() {
  const raw = useRoute();
  const path = resolveRedirect(REDIRECTS, raw.replace(/\\/$/, "") || "/");
  const route = ROUTES.find((r) => matchPath(r.path, path));
  useEffect(() => {
    if (route) applyHead(route.path);
  }, [route]);
  const Page = route?.component;
  return (
    <ErrorBoundary>
      <Layout>{Page ? <Page /> : <NotFound />}</Layout>
    </ErrorBoundary>
  );
}
`;

const MAIN = `import { createRoot } from "react-dom/client";
import App from "./app/App.jsx";

createRoot(document.getElementById("root")).render(<App />);
`;

const INDEX_HTML = (css, printCss = [], icons = []) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ported site</title>
${icons.map((i) => `<link rel="${esc(i.rel)}" href="${esc(i.href)}">`).join("\n")}${icons.length ? "\n" : ""}${css.map((c) => `<link rel="stylesheet" href="/${c}">`).join("\n")}${css.length ? "\n" : ""}${printCss.map((c) => `<link rel="stylesheet" href="/${c}" media="print">`).join("\n")}${printCss.length ? "\n" : ""}<!-- resolve react and react-dom with your bundler or an import map; no address is written here on purpose -->
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.jsx"></script>
</body>
</html>
`;

const SERVE = (hasEndpoints) => `import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { matchPath } from "./src/app/match.js";
import { HEAD } from "./src/app/head.js";
${hasEndpoints ? 'import { endpoints } from "./src/api/endpoints.js";' : "const endpoints = {};"}

/**
 * The port's server. It serves your bundler's output when dist/ exists and
 * the source tree when it does not, answers every old address with the real
 * 301 the redirect map promised, and answers the API surface honestly: a
 * fixture where the run emitted one, marked as invented, and a 501 naming
 * src/api/endpoints.js where it did not. It never invents a response.
 *
 *   node serve.js            # 127.0.0.1:4173
 *   PORT=8080 node serve.js
 */
// resolve() drops the trailing separator a directory URL carries, and the
// containment check below depends on comparing clean absolute paths.
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const DIST = existsSync(join(ROOT, "dist", "index.html")) ? join(ROOT, "dist") : ROOT;
const REDIRECTS = JSON.parse(await readFile(join(ROOT, "redirects.json"), "utf8"));
const API = Object.values(endpoints);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".jsx": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".ico": "image/x-icon", ".webp": "image/webp", ".txt": "text/plain",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
};

// Every path is resolved and then checked against the root it must live in,
// so a traversal cannot read past the port.
const within = (base, rel) => {
  const full = resolve(base, "." + normalize("/" + rel));
  return full === base || full.startsWith(base + sep) ? full : null;
};

async function file(res, base, rel, headers = {}) {
  const full = within(base, rel);
  if (!full) return false;
  // One read, no check first: a missing file and a directory both land in
  // the catch, and checking before reading is the race the check invites.
  const body = await readFile(full).catch(() => null);
  if (body === null) return false;
  res.writeHead(200, { "content-type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream", ...headers });
  res.end(body);
  return true;
}

export function handler() {
  return async (req, res) => {
    try {
      await respond(req, res);
    } catch (error) {
      // One bad request never takes the server with it.
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("the server hit an error; the terminal has it");
      console.error(error);
    }
  };
}

async function respond(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = decodeURIComponent(url.pathname);

    const hit = REDIRECTS.find((r) => r.from === path);
    if (hit) {
      res.writeHead(301, { location: hit.to + url.search });
      return res.end();
    }

    // A path the app itself serves as a page goes to the app: a portal's
    // filter form posts to the address its page lives at, and navigating
    // there must never answer with the form's endpoint. Any other method,
    // or any path that is not a route, still reaches the API surface.
    const isPage = (req.method ?? "GET") === "GET" && HEAD[path.replace(/\\/+$/, "") || "/"] !== undefined;
    const api = !isPage && API.find((e) => e.method === (req.method ?? "GET") && matchPath(e.path, path));
    if (api) {
      const name = (api.path.split("/").filter((s) => s && !s.startsWith(":")).at(-1) ?? "items").replace(/[^\\w-]/g, "-");
      if (api.method === "GET" && await file(res, ROOT, join("fixtures", name + ".json"), { "x-portamp-fixture": "invented, from the run's fixtures" })) return;
      res.writeHead(501, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "not implemented here", endpoint: api.path, see: "src/api/endpoints.js — point the client at the real service or run the emitted mocks" }));
    }

    if (await file(res, join(ROOT, "public"), path)) return;
    if (await file(res, DIST, path)) return;
    // No extension means a route; the app answers it from index.html.
    if (!extname(path) && await file(res, DIST, "index.html")) return;
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not held by this port: " + path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  createServer(handler()).listen(port, "127.0.0.1", () => {
    console.log(\`serving the port on http://127.0.0.1:\${port} (\${DIST === ROOT ? "source tree; run your bundler for a build, dist/ is picked up automatically" : "dist/"})\`);
  });
}
`;

const SERVER_TEST = (redirects, apiSample = null) => {
  const sample = redirects.find((r) => r.from && r.to.startsWith("/"));
  return `import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { handler } from "../serve.js";

const serve = () => new Promise((ready) => {
  const server = createServer(handler());
  server.listen(0, "127.0.0.1", () => ready(server));
});
const get = (server, path) => fetch(\`http://127.0.0.1:\${server.address().port}\${path}\`, { redirect: "manual" });

test("the server answers routes, redirects and honest API refusals", async () => {
  const server = await serve();
  try {
    const home = await get(server, "/");
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<div id="root">/);
${sample ? `
    const moved = await get(server, ${JSON.stringify(sample.from)});
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get("location"), ${JSON.stringify(sample.to)});
` : ""}
    const missing = await get(server, "/definitely-not-a-file.xyz");
    assert.equal(missing.status, 404);
${apiSample ? `
    const api = await fetch(\`http://127.0.0.1:\${server.address().port}${apiSample.path}\`, { method: ${JSON.stringify(apiSample.method ?? "GET")} });
    assert.ok(api.status === 501 || api.headers.get("x-portamp-fixture"), "the API surface answers with a fixture or an honest refusal, never invented data");
` : ""}
    // A traversal is folded back inside the root, so it can only ever see
    // the port's own files: here the extensionless path lands on the shell.
    const traversal = await get(server, "/..%2f..%2f..%2fetc%2fpasswd");
    const body = await traversal.text();
    assert.ok(!body.includes("root:"), "a traversal never reads past the port");
    assert.match(body, /<div id="root">/, "the guarded path falls through to the app shell");
  } finally {
    // Kept alive connections outlive close(); both calls or the suite hangs.
    server.closeAllConnections?.();
    server.close();
  }
});
`;
};

const ROUTER_TEST = (redirects) => {
  const sample = redirects.find((r) => r.from && r.to.startsWith("/"));
  return `import test from "node:test";
import assert from "node:assert/strict";
import { matchPath, resolveRedirect } from "../src/app/match.js";

test("an exact route matches and a different one does not", () => {
  assert.ok(matchPath("/about", "/about"));
  assert.equal(matchPath("/about", "/pricing"), null);
});

test("a parameter segment captures its value, decoded", () => {
  assert.deepEqual(matchPath("/news/:page", "/news/2").params, { page: "2" });
  assert.deepEqual(matchPath("/tag/:name", "/tag/a%20b").params, { name: "a b" });
});

test("query and hash never change what matches", () => {
  assert.ok(matchPath("/about", "/about?utm=old#team"));
});

test("a redirect chain resolves to its end and a cycle cannot hang", () => {
  assert.equal(resolveRedirect({ "/a": "/b", "/b": "/c" }, "/a"), "/c");
  assert.equal(resolveRedirect({ "/x": "/y", "/y": "/x" }, "/x"), "/x");
  assert.equal(resolveRedirect({}, "/about"), "/about");
});
${sample ? `
test("the site's own redirect map is honored", () => {
  assert.equal(resolveRedirect({ ${JSON.stringify(sample.from)}: ${JSON.stringify(sample.to)} }, ${JSON.stringify(sample.from)}), ${JSON.stringify(sample.to)});
});
` : ""}`;
};

function mermaidMap(site) {
  const id = (route) => "r" + route.replace(/[^\w]/g, "_");
  const lines = ["graph LR"];
  for (const node of site.graph.nodes) lines.push(`  ${id(node)}["${node}"]`);
  for (const [from, to] of site.graph.edges) lines.push(`  ${id(from)} --> ${id(to)}`);
  for (const r of site.redirects.filter((x) => x.to.startsWith("/"))) {
    lines.push(`  ${id(r.from)}(("${r.from}")) -.-> ${id(r.to)}`);
  }
  return lines.join("\n") + "\n";
}

function siteReport(site, pages) {
  const inbound = new Set(site.graph.edges.map(([, to]) => to));
  const orphans = site.graph.nodes.filter((n) => n !== "/" && !inbound.has(n));
  const lines = [
    "# The site, assembled",
    "",
    "What the shell is made of and which decisions are still a person's.",
    "",
    "## Routes",
    "",
    "| route | component | was |",
    "| --- | --- | --- |",
    ...pages.map((p) => `| ${p.route} | ${p.className} | ${p.rel} |`),
    "",
    "## Redirects",
    "",
    site.redirects.length ? "Served from redirects.json; `_redirects` says the same for hosts that read that; nginx spells it:" : "None.",
    "",
    ...(site.redirects.length
      ? ["```nginx", ...site.redirects.map((r) => `rewrite ^${r.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$ ${r.to} permanent; # ${r.kind}`), "```", ""]
      : []),
    "## What the graph says",
    "",
    orphans.length ? `Orphan route(s), reachable by address only: ${orphans.join(", ")}.` : "Every route is reachable from another page.",
    site.deadLinks.length ? `Dead link(s): ${site.deadLinks.map((d) => `${d.from} → ${d.target}`).join("; ")}. They dangle in the port exactly as they dangled on the old site.` : "No dead links.",
    "",
    ...(site.frames.length
      ? ["## Frames", "", ...site.frames.map((f) => `${f.rel} framed ${f.frames.map((x) => x.src).join(", ")}; its content frame was ${f.main ?? "not identifiable"}. The shell replaces the frameset; the frames are ordinary routes now.`), ""]
      : []),
    ...(site.pagination.length
      ? ["## Pagination, proposed", "", ...site.pagination.map((p) => `${p.pages.join(", ")} look like one screen paged by filename; a route like /${p.stem}/:page is the port's shape. Merging them means choosing the template, which is a person's call.`), ""]
      : []),
    "## Running it",
    "",
    "`npm run serve` starts the port's own server on 127.0.0.1: the routes, the",
    "301s from the redirect map, the assets, and the API surface answered",
    "honestly (a fixture where one was emitted, a 501 naming the endpoint map",
    "where none was). It serves `dist/` automatically once your bundler has",
    "produced one. `npm test` runs the router and server suites that shipped",
    "with the port.",
    "",
    "## Still a person's",
    "",
    "- Wire form submissions to the generated client; actions moved to the API map.",
    "- Point the bundler or an import map at react and react-dom.",
    "- Decide the pagination merges above, if any.",
    "",
  ];
  return lines.join("\n");
}
