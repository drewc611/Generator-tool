# portamp

Read this before changing anything. It is the contract, not a description.

## What this is

A tiny plugin host that ports legacy front ends. The core is 718 lines across
four files and knows nothing about Angular, React, screenshots, or HTTP.
Everything that knows a framework is a plugin. Keeping that true is the single
most important constraint in the repo.

Target repo: github.com/drewc611/portamp

## Run it

```bash
node src/cli.js plugins      # list what loads
npm run demo                 # full pipeline against example/legacy
npm run demo-site            # a folder of old pages into a React app shell
npm run demo-portal          # a service portal fixture through the same engine
npm test                     # node --test, no framework
node src/cli.js run -v       # timings per plugin
node src/cli.js ui --watch   # the console, rerunning as the source changes
```

No install step. No build step. Node 18 or newer, zero runtime dependencies.
Playwright is optional and only needed for `input-record`.

## Architecture in four sentences

Five plugin classes: `input`, `dsp`, `output`, `vis`, `general`. Five pipeline
stages in order: `scan`, `extract`, `plan`, `emit`, `verify`. A plugin subscribes
to stages and mutates one shared context object. The kernel never calls a plugin
directly and has no idea what any of them do.

```
src/core/kernel.js     registry, discovery, pipeline        (~130 lines)
src/core/policy.js     the rules, enforced, and what clears them  (~220 lines)
src/core/context.js    shared context and logger            (~90 lines)
src/cli.js             argument parsing and wiring          (~280 lines)
plugins/*/index.js     everything that knows a framework
skills/                agent playbooks, also usable standalone
docs/PLUGIN-API.md     the plugin contract
example/               a small Angular app to run against
test/                  node --test, kernel, policy, translator, end to end
```

## Invariants, in priority order

1. **The core stays framework blind.** If you find yourself adding the word
   "Angular" or "React" to anything under `src/`, the change belongs in a plugin.
2. **Zero runtime dependencies in core.** Plugins may declare optional ones and
   must lazily import them with a clear error when missing. See `input-record`.
3. **Policy gates are never bypassed, weakened, or made opt out.** A plugin that
   makes a network call without `policy.assertLiveAllowed` is a defect. Secrets
   found in source stop the run and the value is never printed or written.
4. **No source paths require an attestation.** `input-blackbox` and
   `input-record` both refuse to run without `portamp.authorization.json`.
5. **Never guess.** If something cannot be determined, call `ctx.unverified(...)`
   and continue. A wrong value that looks right is worse than a visible gap.
6. **Emitted components include every state.** Loading, error, empty, and the
   real body. An empty state that renders nothing is the most common port defect.

## Current state

Working end to end. The demo reads the example Angular app, finds one component,
three endpoints and two interceptors, writes tokens, an endpoint map, a client,
a React skeleton, a dozen analysis reports, and `PORT_NOTES.md` listing eleven
unverified items. CI syntax checks every file, runs the pipeline, and asserts
the secret gate fires.

Nine component targets sit on one intermediate representation. CI asserts that
the same screen written in Angular and in Vue produces byte identical React,
Vue, Svelte and custom element output, which is the only honest way to claim
the middle is framework blind.

Plugins that ship, eighty six in five classes, and the core has never learned
the name of any of them:

```
input    input-angular  input-angularjs  input-vue  input-knockout
         input-backbone  input-jquery  input-jsf  input-aspnet  input-static
         input-underscore  input-handlebars  input-jinja
         input-openapi  input-pdf  input-explore  input-record  input-shots
         input-blackbox
dsp      dsp-ir  dsp-tokens  dsp-apimap  dsp-behavior  dsp-improve
         dsp-a11y  dsp-cognitive  dsp-i18n  dsp-deadcode  dsp-dates
         dsp-flags  dsp-forms  dsp-permissions  dsp-perf  dsp-entities
         dsp-diff  dsp-archetype  dsp-modernize  dsp-uplift
         dsp-routes  dsp-boundaries  dsp-assets  dsp-css  dsp-entropy  dsp-era
         dsp-apistyle  dsp-auth  dsp-duplication  dsp-state  dsp-weight
output   output-react  output-vue  output-svelte  output-angular  output-lit
         output-html  output-storybook  output-tests  output-openapi
         output-msw  output-tailwind  output-design-tokens  output-forms
         output-i18n  output-adr  output-migration  output-preact  output-solid
         output-alpine  output-cem  output-postman  output-curl
         output-fixtures  output-readme  output-ci  output-site
vis      vis-parity  vis-ui  vis-timeline  vis-coverage  vis-equivalence
general  general-policy  general-authorization  general-license
         general-doctor  general-scaffold  general-watch  general-history
```

An option the CLI does not recognise is passed through to the plugins
untouched, so a target is turned on by naming it: `--vue true`, `--html true`,
`--openapi true`, `--msw true`, `--site true`. The core still does not know
which plugin asked for it, or that any plugin did.

With `--site true` a folder of plain old pages, .php and .shtml included,
becomes a React application architecture: input-static assembles `ctx.site`
(routes, the link graph, the chrome shared verbatim, the redirect map) and
output-site emits the shell around the ported components — a zero dependency
history router with a pure matcher, a layout lifted from the chrome, per route
head data, a navigation model, redirect maps in three spellings, copied
assets, and tests for the router that run inside the port. The port is full
stack: serve.js (zero dependencies) serves the app, answers every old address
with its real 301, and answers the API surface honestly — a fixture where one
was emitted, a 501 naming the endpoint map where none was — and the server's
own suite ships beside it, wired to npm run serve and npm test.

2.0 adds the accountable half: `--export true` prerenders every route to
plain HTML hostable with no build (chrome wrapped, heads carried, retired
addresses as meta refresh stubs); redirect chains flatten and a cycle fails
the run; .htaccess plain lines join the map as evidence; sitemap.xml and
robots.txt speak to machines with the original's disallow lines carried;
canonical, icons and print stylesheets survive as identity; breadcrumbs and
query string route families land as data and proposals; LEDGER.json records
every decision machine readably; two runs over the same tree are asserted
byte identical in CI; the IR round trips through emitted Angular losslessly;
and a policy stop prints what evidence would clear it.

2.1 gives the port senses: a dependency free search engine over the pages'
own words, did you mean by edit distance, scroll memory, view transitions, a
skip link, base path hosting, feeds and llms.txt and humans.txt and the
redirect map in the deploy hosts' own spellings, reading time, a dark palette
derived without moving hue, social cards drawn from titles, a CSP built from
observed hosts with the page as evidence, the site weighed and drawn, a
sha256 birth certificate per route in the ledger, an opt in service worker,
dsp-era dating the markup by seventeen signals, a dead links ceiling, an
`audit` command that checks a port against its ledger, and a server that
speaks etags, 304s, cache rules, gzip and /healthz. test/thirtyseven.test.js
reads one run and holds all of it.

2.2 reads documents: input-pdf takes a PDF apart with no dependencies (Flate
is node:zlib), keeps text with its measured positions and sizes, turns the
sizes into headings and the annotations into links, refuses an encrypted
file by name, counts glyphs it cannot map rather than faking them, and with
--site gives each document a route beside the pages with the original PDF
copied in as the document of record. DOCS.md says what was read; a tech data
sheet lands as a routed React page the port's own search engine can find.

## What is honestly incomplete

Named plainly so nobody rediscovers it as a surprise.

- `output-react` now translates conditions with their else chains and their
  `then`/`else` template references, loops including the (key, value) form,
  switches, models including checkbox, radio and multiple select, event
  modifiers, named slots with their fallbacks, and the filters with an exact
  JS spelling; what remains is reported rather than guessed: a locale filter
  becomes an unformatted value with a note. A tag naming another screen in the
  run resolves to that ported component in react, vue and svelte alike; one
  the run has not seen stays an unknown element, and says so.
- `input-angular` reads the syntax tree when `typescript` is installed and falls
  back to regular expressions when it is not. The fallback is narrower and says
  so in the run. Neither pass uses a type checker, so a URL built from anything
  but a literal in the same file keeps its `${...}` shape rather than resolving.
- `dsp-tokens` measures a recording when there is one and reads declared
  variables when there is not. Spacing now comes from gaps between recorded
  element boxes when an exploration carries positions; rungs the recording
  cannot prove stay default and the evidence says which are which.
- `vis-parity` compares pixels only when asked (`--pixels true`) and prints
  the number's limits beside it: framing and data differences dominate, so it
  measures drift between runs, not fidelity. The compare pane stays where
  fidelity is judged.
- `input-explore` finds a control the way a person does, which means it finds
  the ones the app makes visible. A control with no affordance, behind a
  keyboard shortcut, or three states deep past a form it cannot fill is not in
  the model, and the run says how many steps it took so the gap has a size.
- `dsp-improve` reports what it measured: names, labels, contrast, target size,
  and states never observed. It does not judge information architecture, and a
  state it never reached is reported as unseen rather than as missing.
- The endpoint gate runs at `verify`, so unlike the secret gate it cannot stop
  the write. It fails the run and names the file; the offending component is
  still on disk to look at. Moving it earlier would mean checking a component
  before it exists.
- `input-jquery` produces an inventory, not components. jQuery declares no
  boundaries and portamp does not invent them, so it reports which selector is
  written to, listened on and called from, and leaves the boundaries to a
  person. `input-jquery` parses with regular expressions; `input-vue` now
  scans structurally, landed behind the byte identical output gate.
- `output-openapi` describes requests and deliberately describes no response.
  The client says what goes out; it never says what comes back, and a schema
  nobody verified is the failure this tool exists to avoid.
- `output-html` binds only the innermost row to a handler inside nested loops,
  and names that case in the notes when it meets it.
- `dsp-deadcode` reports candidates and never verdicts: a class name assembled
  at runtime looks unused and is not, so the report says what was searched.
- `dsp-archetype` recognises the shape of an app from its structure and its
  traffic, and reports a reading rather than a fact: every candidate carries the
  signals it matched and the ones it did not, and two readings within twenty
  points are reported as contested rather than resolved.
- `dsp-modernize` proposes and never performs. Rewriting how an app fetches,
  routes and holds state is a decision about the product, and each proposal
  names the legacy fact that makes it necessary so the premise can be argued
  with rather than the taste.
- `dsp-uplift` changes lightness and never hue. A brand colour is the one value
  in a legacy palette somebody actually chose. It writes `src/tokens.modern.js`
  alongside `src/tokens.js` and the emitted components keep importing the
  latter, because adopting a new palette is not a thing to do quietly.
- The design extraction, framework mapping, and API extraction judgment lives in
  `skills/`, not in code. Some of it should migrate into plugins over time; not
  all of it can.

## Next tasks, in the order they pay off

The full picture is ROADMAP.md: four hundred and six features in
thirty one phases, statuses honest. What remains open, and why:

1. **npm publish.** One command that belongs to a person;
   docs/PUBLISHING.md waits beside it.
2. **Growing the calibration corpus.** Eleven labelled miniatures now, one per
   archetype; real labelled apps would make the confidence numbers mean more.
3. **A grammar for the template dialects.** The readers are structural
   scanners now, not regexes, but a real grammar with positions would make
   every note able to say the line it came from.

## Conventions

- ESM, `.js`, no TypeScript in the tool itself.
- Plugin name is `class-subject`, matching its directory.
- One log line per plugin per stage. Pipeline output stays readable.
- Prose in docs and comments avoids hyphens; identifiers and paths keep theirs.
- Comments explain why, not what. If a comment restates the line below it,
  delete it.
- Every sprint ends with a sanitation pass, and the claims that can rot are
  held by test/hygiene.test.js: the size table is counted, deferral markers
  fail the suite, and a shared helper defined twice fails it too. A sprint
  that changes the numbers ends by updating the words.

## Do not

- Add a dependency to core.
- Make a policy check configurable off.
- Write a URL into an emitted component. Endpoints live in `src/api/endpoints.js`.
- Commit recorded screenshots or a real `portamp.authorization.json`.
- Have a plugin call the network without asking the policy object first.
