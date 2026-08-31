import { readFile } from "node:fs/promises";
import { stripScripts, stripStyles } from "../dsp-ir/scan.js";
import { flatten } from "../dsp-routes/parse.js";

/**
 * The reader for a site that never had a framework. A folder of plain pages is
 * the oldest front end there is, and it is already almost the model: every
 * page is a screen, and every link between pages is a route somebody could
 * bookmark. Nothing needs translating; it needs collecting.
 *
 * What disqualifies a page is any sign that something else owns it: a
 * directive, an interpolation, a template tag, or a body that is one mount
 * point for an app. Those pages belong to the reader of their dialect, and
 * claiming them here would port the shell and lose the app.
 */

const OWNED = /\bng-[\w-]+=|\bv-(?:if|for|model|show|bind|on|html)\b|\bko-[\w-]+=|\bdata-bind=|\{\{|<%|\{%/;

const pascal = (s) =>
  String(s).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

export function readPage(text, rel) {
  if (OWNED.test(text)) return { skip: "another dialect owns it" };

  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(text);
  const body = stripStyles(stripScripts(bodyMatch ? bodyMatch[1] : text)).trim();
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

  const name = rel.replace(/\.html?$/i, "").split("/").filter((p) => p !== ".").join("-") || "page";
  const selector = name.toLowerCase() === "index" ? "home" : name.toLowerCase().replace(/[^\w-]/g, "-");

  const links = [];
  for (const m of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#?]+\.html?)(?:[#?][^"']*)?["']/gi)) {
    if (!/^[a-z][\w+.-]*:/i.test(m[1])) links.push(m[1]);
  }

  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text)?.[1]?.trim() ?? null;

  // Scripts the page loads from its own tree mean the behavior is in the run,
  // and the reader of that behavior owns the page. Collected here, judged by
  // the caller against what the run actually holds.
  const scripts = [...text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((src) => !/^[a-z][\w+.-]*:|^\/\//i.test(src));

  return {
    scripts,
    screen: {
      selector,
      className: pascal(selector),
      file: rel,
      inputs: [],
      outputs: [],
      template: body,
      templateOrigin: "a static page",
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
  const clean = "/" + rel.replace(/\.html?$/i, "").replace(/^\.\//, "");
  return clean.replace(/\/index$/i, "/").replace(/\/+/g, "/") || "/";
}

export default {
  name: "input-static",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.html?$/i.test(f.rel));
      if (!files.length) return log.debug("no pages");

      const local = new Set(ctx.sources.files.map((f) => f.rel.replace(/^\.\//, "")));
      const pages = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const page = readPage(text, file.rel);
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
        pages.push({ ...page, rel: file.rel });
      }
      if (!pages.length) return log.debug("no static pages");

      const bySelector = new Map(pages.map((p) => [p.rel, p.screen.selector]));
      for (const page of pages) ctx.screens.push(page.screen);

      // Links between pages are the route table nobody wrote down. It is only
      // claimed when no declared table exists; a real router outranks
      // inference from anchors.
      if (!ctx.routes) {
        const table = [];
        const dir = (rel) => rel.split("/").slice(0, -1).join("/");
        for (const page of pages) {
          table.push({ path: routeFor(page.rel), component: page.screen.className, redirectTo: null, lazy: false, file: page.rel, children: [] });
          for (const link of page.links) {
            const target = [dir(page.rel), link].filter(Boolean).join("/").replace(/\/+/g, "/").replace(/^\.\//, "");
            if (!bySelector.has(target) && !bySelector.has(link)) {
              ctx.unverified(`${page.rel} links to ${link}, which is not a page in this run. The link will dangle in the port.`);
            }
          }
        }
        ctx.routes = { table: flatten(table), hashRouting: false };
      }

      // The same nav on every page is a layout component nobody declared.
      // Proposed, not performed: the pages keep their chrome, and the note
      // names the consolidation.
      const chrome = new Map();
      for (const page of pages) {
        for (const m of page.screen.template.matchAll(/<(nav|header|footer)\b[\s\S]*?<\/\1\s*>/gi)) {
          const key = m[0].replace(/\s+/g, " ").trim();
          const entry = chrome.get(key) ?? { tag: m[1].toLowerCase(), count: 0 };
          entry.count += 1;
          chrome.set(key, entry);
        }
      }
      for (const { tag, count } of chrome.values()) {
        if (count >= 2) {
          ctx.note(
            `The same <${tag}> appears verbatim on ${count} of ${pages.length} page(s). ` +
              `Port it once as a layout component; each page keeps its copy until a person makes that cut.`
          );
        }
      }

      log.info(`${pages.length} static page(s)`);
    });
  },
};
