# The portamp UI

A `vis` class plugin that serves a local web interface after a run. This is the
Winamp slot: the core does the work, the visualization plugin shows it.

Nothing about the UI is required to port anything. It exists because reading
`PORT_NOTES.md` in a terminal is a bad way to compare a screenshot to a build.

## Command

```
portamp ui                 # run the pipeline, then serve on 4321
portamp ui --port 8080
portamp ui --watch         # rerun on source changes; consoles refresh
portamp run && portamp ui  # serve the last run without redoing it
```

Opens a browser. Serves only on localhost. Dies on ctrl c.

## Constraints, non negotiable

- **Zero dependencies.** `node:http` plus one HTML file with inline CSS and JS,
  and one pure module (`lib.js`) the page imports and the test suite imports
  too. No React, no Vite, no bundler. The tool that ports apps to React does
  not itself need React, and adding a build step to a tool whose selling point
  is having no build step defeats the whole thing.
- **The pipeline is the only writer.** The UI displays a run and may cause one
  (the run key, `--watch`); it never edits a file itself. `run.json` and the
  history sidecar are written by the plugin at verify, not by the server.
- **Localhost only.** Bind `127.0.0.1`, never `0.0.0.0`. It serves screenshots
  of a customer system.
- **Under a stated line budget**, currently 2050 across `index.js`, `app.html`
  and `lib.js`. The number lives in `test/ui.test.js` with the history of every
  raise and what bought it, so growth stays a decision, not a drift.

## Layout

A three column desk plus the mast. The one place content is tabbed is the
margin, whose four faces (endpoints & unverified, files, reports, study) are
views of the same run; endpoints and unverified share the default face
because it is the pair people need to see first.

```
┌───────────────────────────────────────────────────────────────┐
│ MAST  wordmark · readout · stats (files/plugins/ms/            │
│       unverified/ported) · trend sparkline · swatches · keys   │
├───────────────┬──────────────────────────┬────────────────────┤
│  INDEX        │  FOLIO                   │  MARGIN (tabs)     │
│  stages, 1-5  │   [ recorded ] [ built ]  │  endpoints &       │
│  ── screens ──│   a wipe divides them;    │   unverified       │
│  orders    ●  │   the built pane is the   │  files             │
│  billing   ○  │   live element when one   │  reports           │
│  ── rack ──   │   was emitted, source     │  study             │
│  by class or  │   with highlighting       │                    │
│  by cost      │   otherwise, copy a key   │                    │
│  ── intake ── │   away                    │                    │
│  drop zone,   │                           │                    │
│  a dropdown   │                           │                    │
│  of rerun     │                           │                    │
│  flags, run   │                           │                    │
└───────────────┴──────────────────────────┴────────────────────┘
```

**Plugin rack**, left, below the screens. Every loaded plugin grouped by
class — or ordered by cost, one key away — with what it contributed and how
long it took. This is the Winamp plugin list and the main reason the UI is
worth building.

**Screen list**, above the rack, filterable. A filled row means a screenshot
matched, an "observed" or "no shot" label says why not. Clicking one loads it
into the folio; the selection lives in the URL hash and survives a reload.

**Folio**, centre, with a draggable wipe. When the run emitted a custom
element the pane shows it live in every state — empty, rows (invented and
labeled as invented), loading, error. No screenshot, no element, an empty
placeholder file: each case says so in the pane rather than showing a blank,
and each layer keeps to its own side of the seam so an empty state in one
never prints over real content in the other.

**Margin**, right, tabbed. Endpoints & unverified holds the endpoints (with a
verb dropdown) and the unverified list with its filter. Files lists
everything the run wrote with the plugin and stage that wrote it; a text
file opens in the folio. Reports lists the run's markdown, rendered by the
server. Study solves arithmetic and one variable equations live and reads a
PDF already in the intake for its plain text, both through general-study's
own pure functions.

**Intake**, bottom of the index. A drop zone takes a folder, a file, or a
picture; "configure rerun" is a real dropdown — searchable, grouped by
category — over the offered flags, closed by default so the column stays
readable, and only a pressed one travels with the next run.

## Interaction

Keyboard first: `j`/`k` walk the screens, `1`–`5` and `0` the stages, `[`/`]`
the wipe, `/` the filter, `r` reruns, `t` flips the ledger, `?` opens the
shortcuts card. The whole keymap is one function in `lib.js`, where the suite
reads it. A skip link, a live readout, a noscript explanation and a print
stylesheet are part of the spec, not extras.

## Style

A ledger, not a chassis: ruled paper, a serif hand for headings, a monospace
hand for every fact, one ink — an oxblood accent — for the one action that
matters (running the pipeline again) and for what the run could not verify.
The recovered palette still gets a swatch strip rather than the chrome:
painting the mast with the ported app's own accent is how the wordmark ends
up unreadable, and a UI you cannot read tells you nothing about the tokens
either. The night ledger is the default because the content is screenshots;
a day ledger — cream paper, the same oxblood ink — exists behind one key.

## Data

The plugin writes `out/.portamp/run.json` at the verify stage and the server
reads it. Beyond the original shape (plugins, screens, endpoints, unverified,
notes, tokens) the run now carries `files`, `provenance`, `coverage` from
vis-coverage and `parity` from vis-equivalence, so the console shows what the
run measured instead of re-deriving any of it. `run.json` answers with an
ETag; the page polls with `If-None-Match` and an unchanged run costs a 304.

Reports are served from the run's own written list — the whitelist — and
rendered escaped. `/healthz` answers whether the server is up and which run
it holds, counts and a timestamp only.

## Acceptance

- `portamp ui` runs the pipeline and opens a browser on 127.0.0.1.
- The rack lists every loaded plugin grouped by class with timings, and
  reorders by cost on its key.
- Clicking a screen loads it, the wipe works with mouse and keys, and the
  selection comes back whole from a pasted URL.
- A screen with no screenshot, no element, or an empty placeholder says so.
- The unverified count matches `PORT_NOTES.md` exactly.
- Killing the server with ctrl c leaves no orphan process.
- `node --check` passes, no dependency was added, and `test/ui.test.js`
  holds every claim above.
