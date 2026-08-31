# portamp

Port a legacy front end to React without losing the look or the API contract.

![The portamp console: a skinned panel showing a pipeline run, plugin meters and the five stage buttons](media/portamp-console.svg)

<sub>portamp is a command line tool, not a desktop app. The chassis is a joke
about where the plugin classes come from. Everything on the panel is real: 527
lines of core, no runtime dependencies, ten plugins, and the literal output of
`npm run demo`.</sub>

## Why it looks like that

Winamp shipped five plugin classes: input, output, DSP, visualization, and
general purpose. The core decoded nothing by itself. It loaded plugins, handed
them a buffer, and got out of the way, which is how one small executable ended
up playing formats its authors had never heard of.

portamp is that idea pointed at front end migration. Same five classes, same
small core, same rule that everything interesting lives outside it. `input`
reads a legacy app instead of a file, `dsp` transforms what was read, `output`
writes React instead of audio, and `vis` shows you what you got.

## Thirty seconds

```bash
git clone https://github.com/drewc611/portamp && cd portamp
node src/cli.js plugins      # 10 plugin(s)
npm run demo                 # runs the pipeline against example/legacy
npm test                     # 149 tests, node --test, no framework
```

No install step. No build step. Node 18 or newer and nothing else.

```
scan      5 file(s) under ./legacy
          2 screenshot(s), states: default, empty
extract   1 component(s), 3 call(s), 2 interceptor(s)
plan      3 distinct endpoint(s)
          tokens ready (density compact, accent #004B87), 1 value(s) measured
          no font or icon set needing a licence check
emit      1 token pair(s) under AA, 0 of them badly
          1 component(s) emitted, 1 template(s) translated
verify    parity report written, 7 item(s) unverified

done  6 file(s) written to ./out
      7 item(s) could not be verified, see PORT_NOTES.md
```

Five unverified items on a four file example is the tool working, not failing.
Each one is a thing it declined to guess.

## The size of it

The constraint is the feature. A core small enough to read in one sitting is a
core you can be sure about, and it is the only reason the plugin boundary stays
honest: there is nowhere in 527 lines to hide a special case for Angular.

| | |
| --- | --- |
| Core | **527 lines** across four files |
| Every line of the tool | 4,667 lines of JavaScript |
| Tests | 1,473 lines, 149 cases |
| Source on disk | **199 KB** |
| Published package | 234 KB |
| Runtime dependencies | **none** |
| Build step | none |

```bash
cat src/core/*.js src/cli.js | wc -l    # 527
du -sh src plugins                      # the whole tool
```

The core has not grown a line since the first commit while the plugins learned
to translate templates and read a syntax tree. That is the whole argument for
the shape: capability arrives in `plugins/`, and `src/` stays something one
person can hold in their head.

The artwork in this README lives in `media/`, which is deliberately outside the
`files` list in `package.json`. Pictures are for the repository. They have no
business in the tarball.

## Architecture

![The portamp signal chain: a general policy gate above input, dsp, output and vis plugins, all sitting on the kernel, with the five pipeline stages below](media/architecture.svg)

Five plugin classes and five pipeline stages, in order: `scan`, `extract`,
`plan`, `emit`, `verify`. A plugin subscribes to the stages it cares about and
mutates a shared context. The kernel never calls a plugin directly and has no
idea what any of them do.

Writing one is about thirty lines:

```js
export default {
  name: "output-storybook",
  version: "0.1.0",
  class: "output",
  setup({ on, log, policy }) {
    on("emit", async (ctx) => {
      for (const s of ctx.screens) {
        await ctx.write(`src/features/${s.selector}/${s.selector}.stories.jsx`, story(s));
      }
      log.info(`${ctx.screens.length} stories`);
    });
  },
};
```

Drop it in `./plugins/` and it loads. No registration file, no build step. The
full contract is in [`docs/PLUGIN-API.md`](docs/PLUGIN-API.md).

## The ten it ships with

![The plugin rack: ten plugins listed by class, with what each one does](media/plugin-rack.svg)

## What a translation looks like

The example's template, and what portamp emits for it:

```html
<div *ngIf="loading">Loading</div>
<table><tr *ngFor="let o of orders"><td>{{o.id}}</td></tr></table>
<input [(ngModel)]="query" />
```

```jsx
{loading && (
  <div>
    Loading
  </div>
)}
<table>
  {orders.map((o) => (
    <tr key={o.id ?? o}>
      <td>
        {o.id}
      </td>
    </tr>
  ))}
</table>
<input value={query} onChange={(event) => setQuery(event.target.value)} />
```

The component around it declares `useState` for `query` because the two way
binding needed it, takes `orders` and `loading` as props because the template
reads them, and keys the loop. What it could not do faithfully it says out loud:
a `| currency` pipe becomes an unformatted value and a line in `PORT_NOTES.md`,
never a formatter somebody guessed at.

## Anything in, anything out

The tool was built to port Angular to React. It is not shaped that way any more.

Every reader turns its own dialect into one intermediate representation, and
every emitter turns that back into its own target. Without the middle, porting
N frameworks to M frameworks is N times M translators and the second target
costs as much as the first. With it, a reader is a dialect table and an emitter
is a printer.

```
  input-angular ─┐                             ┌─ output-react
  input-vue     ─┼──▶  dsp-ir  ──▶  the IR ──▶ ┼─ output-svelte
  input-explore ─┘                             ├─ output-storybook
  (used, not read)                             └─ output-tests
```

The IR says what markup means, not how anybody spells it: `when`, `each`,
`element`, `text`, `slot`, `html`. `*ngIf` and `v-if` are the same node by the
time anything downstream sees them, and so are `[class.x]` and `:class`.

The proof is not a diagram. This screen, written twice:

```html
<div *ngIf="loading">L</div>
<li *ngFor="let o of orders" [class.hot]="o.hot" (click)="pick(o)">{{o.n}}</li>

<div v-if="loading">L</div>
<li v-for="o in orders" :class="{hot: o.hot}" @click="pick(o)">{{o.n}}</li>
```

produces byte identical React, and byte identical Svelte, from both. CI asserts
it. The Svelte printer is 150 lines and nothing else changed to add it, which is
the only honest way to claim the middle is framework blind.

Svelte gets `class:hot={o.hot}` rather than a joined string, because a printer
per target beats one shared printer that speaks nobody's language well.

## Conformance: the part nobody else does

Every codemod hands you code. None of them tells you whether what you now have
still behaves like what you replaced.

portamp already walked the old app and wrote down what each action did: which
screen it opened, which request it fired, what the app said when it refused.
That is a test suite. `output-tests` writes it, against the port.

```js
test("clicking Create order does what it did in the original", async ({ page }) => {
  await page.goto(base);
  await page.getByRole("button", { name: "New order" })...click();

  await page.getByRole("button", { name: "Create order" })...click();

  // The original refused, in these words. A port that accepts this
  // input has lost a rule nobody wrote down anywhere else.
  await expect(page.getByText("Customer is required", { exact: false })).toBeVisible();
});
```

Nothing in that was written by hand. The rule is there because submitting the
empty form made the old app say so, and the step replays the click that opened
the screen because the exploration recorded how it got there.

Run it against the original and it passes, nine for nine. Run it against a port
that quietly dropped the validation and renamed a heading, and it fails on
exactly those two and nothing else:

```
  7 passed
  2 failed
    clicking Create order does what it did in the original
    clicking New order does what it did in the original
```

That is the whole point. A port is not finished because it compiles.

## What it actually does

**Reads the old app.** Walks the Angular tree, finds components, inputs and
outputs, structural directives, two way bindings, RxJS operators, services that
talk to `HttpClient`, and interceptors. Interceptors matter more than they look:
they add headers at no call site, which is the single most common thing a port
drops silently.

**Reads the screenshots.** Catalogs them and infers which state each one shows
from its filename, so `orders-empty.png` is understood as the empty state. Then
it tells you which states have no screenshot, because those get designed rather
than matched and somebody should know which is which.

**Recovers a system, not pixels.** Emits a token file (density, type scale,
spacing, color roles, radius, elevation) and builds from that. Copying pixels
inherits every inconsistency the old app accumulated and leaves the first new
screen with nothing to follow.

**Regenerates the API layer.** One endpoint map and one client with timeout,
retry with backoff and jitter, cancellation, and normalized errors. Components
never contain a URL.

**Writes down what it could not verify.** `PORT_NOTES.md` lists every screen
with no matching screenshot, every request body it could not determine, and
every interceptor you need to confirm by hand. The next person inherits that
uncertainty either way.

## When there is no source

Most legacy modernization starts with a system nobody can build anymore. The
binary runs, the repo is missing or does not compile, and the person who wrote
it left in 2016.

The answer is to use the thing. `input-explore` drives the running app the way
a person would, and writes down what it learns.

```
portamp run --allow-live

[input-explore]  3 screen(s), 60 step(s), 183 request(s), 0 skipped
[dsp-behavior]   3 screen(s), 5 transition(s), 3 endpoint(s) recovered from use
[dsp-improve]    16 improvement(s) over the original, 5 of them serious
[output-react]   3 component(s) emitted
```

It clicks what it finds, fills forms and submits them empty to see what the
validation says, and follows what opens. Rows in a table are found the only way
a legacy app reliably announces them: `cursor: pointer`. Each step runs from a
fresh load, so one action cannot poison the next.

Out of that comes `BEHAVIOR_MODEL.md`, which is the app as it behaves:

```
### New order  `screen-3`
- Kind: form
- Seen in: body. Never seen in: loading, empty, error

| field      | type | required | rule the app stated  |
| ---------- | ---- | -------- | -------------------- |
| `customer` | text | yes      | Customer is required |

## Flow
screen-1 --[ a row ]--> screen-2
screen-1 --[ New order ]--> screen-3
screen-3 --[ Create order ]--> screen-1

## Endpoints
| GET  | `/api/v1/orders`     | q | 200 | none                    | Search, a row |
| GET  | `/api/v1/orders/:id` |   | 200 | none                    | a row         |
| POST | `/api/v1/orders`     |   | 201 | `{"customer":"string"}` | Create order  |
```

Nothing there was assumed. `customer` is required because submitting without it
made the app say so. `:id` is a parameter because several paths differed only in
that segment; one example would have stayed a path. The request body is recorded
as types, never as values, so whatever got typed during the exploration is not
written down anywhere. Neither is a customer name: a control labelled with the
record it sits on becomes "a row".

### Making it better, not copying it faithfully

A port that reproduces the original's defects is not a good port. `dsp-improve`
measures the original while it runs and says what the rebuild does instead:

```
## Controls with no accessible name (1)
- `#refresh` on `screen-1`, high.
  - Observed: Its only content is "↻", which carries no name for a screen reader.
  - Instead: The rebuild gives it an aria-label.

## Text below the contrast threshold (1)
- `p` on `screen-1`, high.
  - Observed: rgb(187,187,187) on rgb(251,250,248) is 1.84:1 at 12px, under
    the 4.5:1 this size needs.

## States the original never showed (5)
- `list-screen`, high.
  - Observed: No error state was seen across the whole exploration, and it
    loads data.
  - Instead: Without one a failed request leaves the last good screen up,
    which reads as success.
```

Contrast is the WCAG ratio, computed from the colours as they rendered. Tap
targets are measured. A state is reported as never seen rather than as absent,
because the explorer not reaching something is not proof it does not exist.

### Replaying instead of re driving

An exploration is a recording. Drop `exploration.json` beside the screenshots
and the whole chain runs again with no browser, which is how it is tested:

```bash
portamp run --src ./nosource --shots ./explored --out ./out
```

### What it will not do

Anything that reads as destructive is skipped and listed, never performed.
Exploring somebody's admin panel should not delete a customer.

```
## Not exercised
- `#delete-account` (Delete account): "Delete account" reads as destructive
```

`explore.allowDestructive` exists and is off. Turning it on is a decision about
somebody's production data, so it is a decision you have to make out loud.

**Passive, when you cannot drive it either.** Drop whatever survived into
`./artifacts` and `input-blackbox` reads it: a HAR of the app's traffic, a schema
dump (usually the most honest description of a legacy app's real data model), an
OpenAPI export if one exists, report exports whose column headers reveal field
names and formats, and any documentation.

**Recording routes you already know.** `input-record` visits a list of routes
you supply and captures a screenshot, a HAR and the computed styles for each.
Use it when you know the map already and only want the pixels and the traffic.

```js
record: {
  baseUrl: "https://legacy.internal",
  routes: [
    { path: "/orders", name: "orders-default" },
    { path: "/orders?empty=1", name: "orders-empty", state: "empty" },
  ],
  login: async (page) => { /* your auth, your credentials */ },
  redact: ["[data-pii]", ".customer-name"],
}
```

```
npm i -D playwright && npx playwright install chromium
portamp run --allow-live
```

Recorded calls land in the same inventory shape as calls read from source, so
every downstream plugin treats them identically. The report says which came
from where, and flags the obvious limit: a path never exercised during
recording does not exist in the inventory.

Redaction happens before the shutter, not after. Screenshots of a real system
carry customer names and account numbers, and a blurred element in a committed
PNG is still better handled by never capturing it sharp.

## Authorization, for the no source path

Modernizing software you own is ordinary engineering. Reconstructing software
you do not own is a different activity with a different name. Both no source
inputs require an attestation on disk before they will run:

```json
{
  "system": "Claims Intake, internal web app",
  "owner": "Acme Insurance",
  "relationship": "owner",
  "basis": "Internally developed and owned outright.",
  "attestedBy": "A. Clark",
  "attestedOn": "2026-08-30",
  "sourceAvailable": false
}
```

`relationship` is `owner`, `licensee`, or `contractor`. A licensee has to
affirm the license permits derivative works, because many do not and a port is
one. A contractor has to name the engagement. A basis describing license or
protection circumvention is refused outright, regardless of who owns what.

## Policy is in the kernel, not the README

![A run stopping: a credential was found in the legacy source, the location is reported and the value is not](media/policy-stop.svg)

Rules the kernel enforces, not suggests:

- A credential in legacy source stops the run at `extract`, before anything is
  written. The location is reported, the value never is, and nothing is copied
  into the port.
- An endpoint that reached a component fails the run at `verify` and names the
  file. It is checked against the endpoint map rather than by looking for
  URL shaped strings, so a template that links to documentation still ports.
- The policy object is frozen once built. A plugin that finds a gate
  inconvenient cannot reassign it.
- Live calls are off by default. `--allow-live` is a statement that you are
  authorized to call the thing.
- Billable endpoints need `--allow-billable` on top of that, because some
  endpoints charge per request and a test suite pointed at production invoices
  the customer on every run.
- Fixtures that look like they contain real customer data get flagged before
  they reach a repository.

A plugin that wants to do something consequential asks the policy object first.

## The UI

`portamp ui` serves the last run on `127.0.0.1:4321` and opens a browser.

![The portamp UI: plugin rack, a wipe between the recorded screenshot and the emitted component, endpoints, and the unverified list](media/portamp-ui.png)

Four panes, fixed. No routing, no tabs that hide things.

- **Plugin rack**, left. Every loaded plugin grouped by class, what it
  contributed, and what it cost. This is the reason the UI is worth building:
  you can see which plugin produced which part of the output, which is what a
  plugin architecture needs to stay debuggable.
- **Side by side**, main. The recorded screenshot and the emitted component with
  a wipe between them. Drag it, or focus it and use the arrow keys: it is a real
  range input underneath, so the keyboard and a screen reader work without
  anything extra. When there is no screenshot the pane says so and the wipe
  disappears, because a wipe between a message and some source is not a
  comparison.
- **Endpoints**, lower right, each marked `source` or `observed`.
- **Unverified**, bottom bar. Always visible, never behind a click. It is the
  list people need and the one they will avoid if it is collapsed.

It is a `vis` plugin, which is the Winamp slot exactly: the core does the work,
the visualization plugin shows it. Nothing about it is required to port
anything, and `portamp run` never loads it.

The constraints are the interesting part:

- **Zero dependencies.** `node:http` and one HTML file with inline CSS and JS.
  The tool that ports apps to React does not itself need React, and adding a
  build step to a tool whose selling point is having no build step would be
  funny for about a day.
- **Read only.** It displays a completed run. It cannot trigger one, edit a
  file, or write anything. A UI that mutates the port is a second source of
  truth. A test asserts the server contains no write call.
- **Loopback only.** It binds `127.0.0.1`, never `0.0.0.0`, because it serves
  screenshots of a customer system. A test asserts the bound address, and both
  file routes refuse any path that climbs out of their directory.
- **Under 800 lines**, including the HTML. It is 659, and a test fails the build
  if that stops being true.

The built component cannot be rendered without a build, so the right pane shows
the emitted source, syntax highlighted, and says that is what it is rather than
pretending to be a preview.

## Configuration

`portamp init` writes a starter file. Everything is optional.

```js
export default {
  src: "./legacy",
  shots: "./screenshots",
  out: "./out",
  plugins: [],          // ./plugins is automatic; list extra paths here
  tokens: {},           // override anything the extractor infers
  allowLive: false,
  allowBillable: false,
};
```

## Commands

```
portamp run          run the pipeline
portamp ui           serve the last run at 127.0.0.1:4321
portamp plugins      list what is loaded, and what commands they add
portamp init         write a starter config
```

Useful flags: `--only name,name` to run a subset, `-v` for plugin timings,
`--allow-live`, `--allow-billable`.

## Layout

```
src/core/kernel.js     plugin registry, discovery, pipeline
src/core/policy.js     the rules, enforced
src/core/context.js    shared context and logger
src/cli.js             argument parsing and wiring
plugins/*/index.js     everything that knows a framework
skills/                agent playbooks: legacy-to-react, adhd-brief
docs/PLUGIN-API.md     write your own
example/legacy         a small Angular app to read
example/blackbox-app   a running app to use, never read
test/                  node --test, no framework
media/                 the artwork in this README, out of the package
```

## Bundled skills

`skills/` holds playbooks for use with an agent, and they work standalone.

- **legacy-to-react** is the judgment the tool cannot mechanize: extracting a
  design system from screenshots, the construct by construct framework mapping,
  the API traps, and the parity checklist.
- **adhd-brief** cuts long answers down and keeps them down. Answer first, three
  supporting lines, stop. It also cuts input tokens, which is where the spend
  actually is: one file instead of the directory, no re reading context, no
  restating tool output. It never trades away a real risk or an exact number for
  brevity.

## Known gaps

Named here so nobody has to discover them as a surprise.

- The template translator handles `*ngIf`, `*ngFor`, interpolation, property and
  event binding, two way binding, `ngClass`, `ngStyle`, `ng-container` and
  `ng-content`. It does not resolve references to other components, so a
  template using `<app-row>` emits `<app-row>` and leaves you to wire it. Pipes,
  `else` branches and unusual `ngClass` shapes are reported, not invented.
- `input-angular` uses the TypeScript compiler API when `typescript` is
  installed and regular expressions when it is not. Neither uses a type checker,
  so a URL assembled from anything but a literal in the same file keeps its
  `${...}` shape rather than being resolved to a guess.
- Spacing is still a default. Nothing measured so far says what the spacing
  scale was meant to be, only what it happened to render as.
- `vis-parity` reports in markdown and compares nothing visually. `vis-diff` is
  the next plugin.

## Where this is going

The plugin classes are the point. Everything below is a directory and an
`index.js`, and none of it needed the core to change.

**Shipped since the first cut**

| | |
| --- | --- |
| `input-vue` | Single file components, into the same shape the Angular reader produces |
| `input-explore` | Drives a running app and works out what it is |
| `dsp-behavior` | Turns that into screens, fields, flow and endpoints |
| `dsp-improve` | What the original got wrong, measured while it ran |
| `dsp-a11y` | Contrast and target size over the palette the port will use |
| `output-storybook` | A story per component, one per state |
| `general-license` | Fonts and icon sets whose licence does not travel |
| `vis-ui` | The comparison view, which is where `vis-diff` landed |

**Still open, in the order they pay off**

1. **A real preview in the compare pane.** The right side shows the emitted
   source because rendering it needs a build. A tiny esbuild step behind an
   optional dependency would make it a real side by side.
2. **Component references in templates.** A template using `<app-row>` emits
   `<app-row>` and leaves you to wire it. Resolving it against the other
   components in the same run is the next real step in the translator.
3. **`input-jsf`, `input-jquery`.** The readers that would prove the shape holds
   for something that is not a component framework at all.
4. **`output-svelte`, `output-vue`.** The emitters are the least framework blind
   part of the tool, and a second one would say how much.
5. **Focus order in `dsp-a11y`.** It measures contrast and target size. Focus
   order needs the DOM, which means it belongs on the exploration rather than
   on the tokens.
6. **A parser for the Vue reader.** It is regular expressions, like the Angular
   fallback, and it says so in the run.

MIT. See [LICENSE](LICENSE).
