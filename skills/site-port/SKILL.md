---
name: site-port
description: Turn a folder of plain old pages (.html, .shtml with SSI, .php, framesets, font era markup) into a deployable React application with portamp's site engine, and get it live without breaking a single old address. Use when someone says "port this old site", "make this folder of pages a React app", "modernize our static site", "we still have a site from the 90s", "keep the old URLs working", or hands over a directory of HTML and asks what to do with it. Covers the flags in the order they pay off, what each one writes, the deploy checklist per host, and how to verify the port against its own ledger before anything ships.
---

# Site port

A folder of pages is already almost an application: every page is a screen,
every link is a route, and every old address is a promise. The engine does
the assembly; this playbook is the order of operations and the judgment
calls the flags leave to a person.

## The flags, in the order they pay off

Run them cumulatively; each run is cheap and each flag's output is evidence
for whether the next one is worth turning on.

1. `--site true` — the baseline. Routes, layout from shared chrome, the
   redirect map, the search engine, serve.js. Read `SITE.md` and
   `PORT_NOTES.md` before adding anything else: the gaps named there do not
   shrink by adding flags.
2. `--export true` — prerendered HTML per route, hostable with no build.
   Turn it on unless the port will always run behind a bundler; the export
   is also the honest smoke test, because a route that prerenders wrong is
   wrong.
3. `--pwa true` — only when offline actually matters to the site's readers.
   The worker caches exactly what the run wrote, nothing else.
4. `--hash-assets true` — only when a CDN or cache policy needs immutable
   asset names. It knowingly changes asset URLs; the note in the run says
   so, and pages' own addresses stay untouched.
5. `--split true` — one module per route, warmed on hover. Eight pages do
   not need it; eight hundred do. Decide from `SITE_STATS.md`, not taste.
6. `--perform-tables true` — executes the grid conversion the run already
   proposed. The original table sits beside each component for the diff;
   review that diff before believing the layout.
7. `--logs path/to/access.log` — when the old server's logs exist, this is
   the only honest way to know which retired addresses people still ask
   for. `LOGS_404.md` lists uncovered demand; adding those redirects is a
   person's call.
8. `--max-dead-links N` and `--max-a11y N` — turn the reports into gates
   once the numbers are at a level worth defending in CI.

## What to read after a run

- `PORT_NOTES.md` — every gap, named. The count going up between runs means
  the engine learned to see more, not that the site got worse.
- `LEDGER.json` — every decision, machine readable. `audit --out <dir>`
  checks a finished port against it.
- `SITE.md` — the redirect map in prose plus the nginx spelling.
- `ERA.md` — when the site was built; it predicts which notes to expect.

## Deploy checklist

The redirect map ships in every spelling a host reads. Use exactly one and
delete the rest from the deploy, so nobody debugs a shadow copy later:

| host | file |
| --- | --- |
| Netlify | `_redirects` or `netlify.toml` |
| Vercel | `vercel.json` |
| nginx | the block in `SITE.md` |
| Apache | keep the original `.htaccess` lines the run read |
| the port's own serve.js | `redirects.json`, already wired |

Then, before the switch:

1. `npm test` inside the port. The router, server, search, and export
   suites ship with it and run with no install.
2. `node <portamp>/src/cli.js audit --out <dir>` — routes have components,
   redirects resolve, the sitemap is complete.
3. Ask the old server's logs (or `--logs`) which addresses still get
   traffic, and check each answers a 301 or a page, not a 404.
4. Serve the export at a scratch address and click the navigation with the
   browser's network tab open; a request to a missing asset is a gap the
   suite cannot see for you.

## Judgment calls the engine leaves open

- Filename families (`news-1.html`, `news-2.html`) and query families
  (`story.php?id=3`) are proposed as parameterized routes, never merged;
  merging means choosing which copy is the template.
- Twin locale trees are read as one site in two languages, with the
  patterns and hreflang siblings emitted as data; choosing a primary
  language is yours.
- A side by side frameset is proposed as a split view with its geometry as
  evidence; performing it is yours.
- jQuery behavior on the pages is inventoried, not ported; the inventory
  says which selectors each handler touches, and wiring that into
  components is design work, not translation.
