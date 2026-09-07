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

A three column desk under one unified, frosted toolbar. The one place content
is tabbed is the inspector, whose four faces (signals, files, reports, study)
are views of the same run; signals is the default face because endpoints and
unverified are the pair people need to see first.

```
┌───────────────────────────────────────────────────────────────┐
│ MAST  wordmark · readout · stats (files/plugins/ms/            │
│       unverified/ported) · trend sparkline · theme · keys      │
├───────────────┬──────────────────────────┬────────────────────┤
│  SIDEBAR      │  MAIN                    │  INSPECTOR (segs)  │
│  ── pipeline ─│   header: name · path    │  Signals Files      │
│  stages, 1-5  │   [ recorded ][ built ]  │  Reports Study      │
│  ── screens ──│   a scrubber divides     │                    │
│  orders    ●  │   them; the built pane   │  endpoints &        │
│  billing   ○  │   is the live element    │   unverified,       │
│  ── plugins ──│   when one was emitted,  │   selected by a     │
│  by class or  │   source with            │   macOS style       │
│  by cost      │   highlighting otherwise │   segmented control │
│  ── tray ──   │                           │                    │
│  drop zone,   │                           │                    │
│  a searchable │                           │                    │
│  flags panel, │                           │                    │
│  run           │                           │                    │
└───────────────┴──────────────────────────┴────────────────────┘
```

**Plugin rack**, in the sidebar, below the screens. Every loaded plugin
grouped by class — or ordered by cost, one key away — with what it
contributed and how long it took. This is the Winamp plugin list and the main
reason the UI is worth building.

**Screen list**, above the rack, filterable, rendered as rounded rows that
pick up the accent when selected. A filled row means a screenshot matched, an
"observed" or "no shot" label says why not. Clicking one loads it into the
main pane; the selection lives in the URL hash and survives a reload.

**Main pane**, centre, with a media scrubber between the two layers instead
of a plain wipe. When the run emitted a custom element the pane shows it live
in every state — empty, rows (invented and labeled as invented), loading,
error. No screenshot, no element, an empty placeholder file: each case says
so in the pane rather than showing a blank, and each layer keeps to its own
side of the seam so an empty state in one never prints over real content in
the other.

**Inspector**, right, switched by a real macOS style segmented control
instead of a row of tab buttons. Signals holds the endpoints (with a verb
dropdown) and the unverified list with its filter. Files lists everything the
run wrote with the plugin and stage that wrote it; a text file opens in the
main pane. Reports lists the run's markdown, rendered by the server. Study
solves arithmetic and one variable equations live and reads a PDF already in
the intake for its plain text, both through general-study's own pure
functions.

**Tray**, bottom of the sidebar. A drop zone takes a folder, a file, or a
picture; "configure rerun" opens a real popover — searchable, grouped by
category — over the offered flags, closed by default so the column stays
readable, and only a checked one travels with the next run.

## Interaction

Keyboard first: `j`/`k` walk the screens, `1`–`5` and `0` the stages, `[`/`]`
the wipe, `/` the filter, `r` reruns, `t` flips the ledger, `?` opens the
shortcuts card. The whole keymap is one function in `lib.js`, where the suite
reads it. A skip link, a live readout, a noscript explanation and a print
stylesheet are part of the spec, not extras.

## Style

A native console, not a themed one: frosted, blurred materials for the
toolbar and sidebar, the system font stack rendering as real San Francisco or
Segoe or Roboto depending on the machine it runs on, and Apple's own system
semantic colors — one blue for the primary action, green/orange/red doing
only the state work they mean and never decoration. A macOS style segmented
control switches the inspector's faces; a media scrubber, not a plain range
input, divides the two layers in the main pane. The night console is the
default because the content is screenshots; a day console — the same
materials, inverted to a light ground — exists behind one key.

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
