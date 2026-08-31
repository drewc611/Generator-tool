# The portamp UI

A `vis` class plugin that serves a local web interface after a run. This is the
Winamp slot: the core does the work, the visualization plugin shows it.

Nothing about the UI is required to port anything. It exists because reading
`PORT_NOTES.md` in a terminal is a bad way to compare a screenshot to a build.

## Command

```
portamp ui                 # run the pipeline, then serve on 4321
portamp ui --port 8080
portamp run && portamp ui  # serve the last run without redoing it
```

Opens a browser. Serves only on localhost. Dies on ctrl c.

## Constraints, non negotiable

- **Zero dependencies.** `node:http` plus one HTML file with inline CSS and JS.
  No React, no Vite, no bundler. The tool that ports apps to React does not
  itself need React, and adding a build step to a tool whose selling point is
  having no build step defeats the whole thing.
- **Read only.** The UI displays a completed run. It does not trigger runs, edit
  files, or write anything. A UI that mutates the port is a second source of
  truth.
- **Localhost only.** Bind `127.0.0.1`, never `0.0.0.0`. It serves screenshots
  of a customer system.
- **Under 800 lines total**, including the HTML.

## Layout

Four panes, fixed. No routing, no tabs that hide things, no accordion.

```
┌────────────────┬──────────────────────────────────────────┐
│  PLUGIN RACK   │  SIDE BY SIDE                            │
│                │                                          │
│  input   ✓ 4   │   [ recorded screenshot ] [ built React ] │
│  dsp     ✓ 2   │                                          │
│  output  ✓ 1   │   slider wipes between them              │
│  vis     ✓ 2   │                                          │
│  general ✓ 2   │                                          │
│                ├──────────────────────────────────────────┤
│  ── screens ── │  ENDPOINTS                               │
│  orders     ●  │  GET  /api/v1/accounts/orders   source   │
│  billing    ○  │  POST /api/v1/orders            observed │
│  settings   ●  │                                          │
├────────────────┴──────────────────────────────────────────┤
│  UNVERIFIED  3                                            │
│  No screenshot for error, loading. Those states are       │
│  designed, not matched.                                   │
└───────────────────────────────────────────────────────────┘
```

**Plugin rack**, left. Every loaded plugin grouped by class, with what it
contributed and how long it took. This is the Winamp plugin list and it is the
main reason the UI is worth building: you can see at a glance which plugin
produced which part of the output, which is exactly what a plugin architecture
needs to stay debuggable.

**Screen list**, below the rack. Filled dot means a screenshot matched, hollow
means it did not. Clicking one loads it into the comparison pane.

**Side by side**, main area. Recorded screenshot on the left, built component on
the right, with a draggable wipe between them. If there is no screenshot, say so
in the pane rather than showing an empty box.

**Endpoints**, lower right. Method, path, and whether it came from source or from
observation. Observed endpoints get a marker, because they carry the caveat that
a path never exercised does not appear.

**Unverified**, bottom bar. Always visible, never collapsed. This is the list
people need to see and the one they will avoid if it is behind a click.

## Style

Take the tokens the run produced. The UI showing the recovered design system
should use the recovered design system; if the tokens look wrong on screen, that
is information.

Dense, monospace for paths and numbers, one accent used only on the active
selection. Dark background is correct here, since the content is screenshots and
a light chrome around a screenshot fights it.

## Data

The plugin writes `out/.portamp/run.json` at the verify stage and the server
reads it. Shape:

```json
{
  "ranAt": "2026-08-30T23:16:00Z",
  "plugins": [{ "name": "input-angular", "class": "input", "ms": 41, "contributed": "4 files, 1 component" }],
  "screens": [{ "name": "orders", "component": "src/features/Orders/Orders.jsx", "screenshot": "orders-default.png", "matched": true }],
  "endpoints": [{ "name": "getAccountsOrders", "method": "GET", "path": "/api/v1/accounts/orders", "origin": "source" }],
  "unverified": ["..."],
  "notes": ["..."],
  "tokens": {}
}
```

Screenshots are served from the shots directory. The built component cannot be
rendered without a build, so the right pane shows the emitted source with syntax
highlighting until someone wires a preview. Say that in the pane rather than
pretending.

## Acceptance

- `portamp ui` runs the pipeline and opens a browser on 127.0.0.1.
- The rack lists all ten plugins grouped by class with timings.
- Clicking a screen loads it, and the wipe slider works with a mouse and with
  arrow keys.
- A screen with no screenshot says so in the pane.
- The unverified count matches `PORT_NOTES.md` exactly.
- Killing the server with ctrl c leaves no orphan process.
- `node --check` passes and no dependency was added to `package.json`.
