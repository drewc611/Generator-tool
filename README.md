# portamp

Port a legacy front end to React without losing the look or the API contract.

![The portamp console: a skinned panel showing a pipeline run, plugin meters and the five stage buttons](media/portamp-console.svg)

<sub>portamp is a command line tool, not a desktop app. The chassis is a joke
about where the plugin classes come from. Everything on the panel is real: 448
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
npm test                     # 70 tests, node --test, no framework
```

No install step. No build step. Node 18 or newer and nothing else.

```
scan      5 file(s) under ./legacy
          2 screenshot(s), states: default, empty
extract   1 component(s), 3 call(s), 2 interceptor(s)
plan      3 distinct endpoint(s)
          tokens ready (density compact, accent #004B87), 1 value(s) measured
emit      1 component(s) emitted, 1 template(s) translated
verify    parity report written, 5 item(s) unverified

done  5 file(s) written to ./out
      5 item(s) could not be verified, see PORT_NOTES.md
```

Five unverified items on a four file example is the tool working, not failing.
Each one is a thing it declined to guess.

## The size of it

The constraint is the feature. A core small enough to read in one sitting is a
core you can be sure about, and it is the only reason the plugin boundary stays
honest: there is nowhere in 448 lines to hide a special case for Angular.

| | |
| --- | --- |
| Core | **448 lines** across four files |
| Every line of the tool | 2,257 lines of JavaScript |
| Tests | 721 lines, 70 cases |
| Source on disk | **80 KB** |
| Published package | 110 KB |
| Runtime dependencies | **none** |
| Build step | none |

```bash
cat src/core/*.js src/cli.js | wc -l    # 448
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
it left in 2016. portamp handles that two ways, and both go through the same
gate.

**Passive.** Drop whatever survived into `./artifacts` and `input-blackbox`
reads it: a HAR of the app's traffic, a schema dump (usually the most honest
description of a legacy app's real data model), an OpenAPI export if one
exists, report exports whose column headers reveal field names and formats,
and any documentation.

**Active.** Configure `record` and `input-record` drives the running app with
Playwright, capturing a screenshot per route and state, a HAR of every request,
and the computed styles that let the token extractor recover a real design
system instead of defaulting to one.

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
portamp plugins      list what is loaded
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
example/               a small Angular app to run against
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

The plugin classes are the point. Obvious next ones: `input-vue`, `input-jsf`,
`output-svelte`, `output-storybook`, `dsp-a11y` to gate on contrast and focus
order, `vis-diff` to serve the old screenshot and the new build side by side,
and `general-license` to check that fonts and icon sets in the old app are
licensed for the new one.

MIT. See [LICENSE](LICENSE).
