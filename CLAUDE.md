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
node tools/ci-local.mjs --only smarty   # the CI's own exercise steps, locally, before a push
node src/cli.js fetch https://old.example.com --out fetched --allow-live   # copy a site to port; needs portamp.authorization.json
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

Plugins that ship, a hundred and eighty nine in five classes, and the core has never learned
the name of any of them:

```
input    input-alpine  input-angular  input-angularjs  input-vue  input-knockout
         input-backbone  input-jquery  input-jsf  input-aspnet  input-static
         input-underscore  input-handlebars  input-jinja
         input-openapi  input-pdf  input-explore  input-record  input-shots
         input-blackbox  input-polymer  input-riot  input-react  input-svelte  input-lit  input-stencil  input-webcomponents  input-ember  input-mithril  input-marko  input-liquid  input-twig  input-xslt  input-blade  input-razor  input-freemarker  input-velocity  input-pug  input-thymeleaf  input-smarty  input-jsp  input-cfml  input-haml  input-slim  input-twirl  input-django  input-ejs  input-pebble  input-volt  input-exe  input-fetch  input-winforms  input-xaml  input-vb6  input-delphi
dsp      dsp-ir  dsp-tokens  dsp-apimap  dsp-behavior  dsp-improve
         dsp-a11y  dsp-cognitive  dsp-components  dsp-props  dsp-i18n  dsp-deadcode  dsp-dates
         dsp-flags  dsp-focus  dsp-forms  dsp-permissions  dsp-perf  dsp-entities  dsp-motion  dsp-print  dsp-cookies
         dsp-diff  dsp-events  dsp-media  dsp-archetype  dsp-modernize  dsp-uplift
         dsp-routes  dsp-boundaries  dsp-assets  dsp-css  dsp-entropy  dsp-era
         dsp-apistyle  dsp-auth  dsp-duplication  dsp-state  dsp-weight  dsp-seo  dsp-analytics  dsp-images  dsp-fonts  dsp-security  dsp-supplychain  dsp-console  dsp-globals  dsp-landmarks  dsp-labels  dsp-render-blocking  dsp-inline  dsp-learn  dsp-storage  dsp-timers  dsp-observers  dsp-complexity  dsp-magic  dsp-imports  dsp-async  dsp-tables  dsp-iframes  dsp-env  dsp-deps  dsp-platform  dsp-dom  dsp-keyboard
output   output-react  output-vue  output-svelte  output-angular  output-lit
         output-html  output-storybook  output-tests  output-openapi
         output-msw  output-tailwind  output-design-tokens  output-forms
         output-i18n  output-adr  output-migration  output-preact  output-solid
         output-alpine  output-cem  output-postman  output-curl
         output-fixtures  output-readme  output-ci  output-site
         output-next  output-remix  output-astro  output-qwik  output-nuxt  output-sveltekit  output-dockerfile  output-nginx  output-types  output-cypress
         output-codemod  output-aws  output-azure  output-gcp  output-vercel  output-netlify  output-cloudflare  output-caddy  output-eleventy  output-playwright
vis      vis-parity  vis-ui  vis-timeline  vis-coverage  vis-equivalence  vis-roundtrip  vis-graph  vis-transformer  vis-a11y  vis-security  vis-perf  vis-lifecycle  vis-readers
general  general-policy  general-authorization  general-license  general-size
         general-doctor  general-scaffold  general-watch  general-history  general-architect  general-agents  general-publish
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
reads one run and holds all of it. The growth batch closes eleven of the
site engine's planned entries behind flags that only ever add: --hash-assets,
--perform-tables, --split with prefetch on intent, --logs for the 404 report,
--max-a11y, locale routes with hreflang, feeds read as family evidence,
floats and side by side frames named, and an era corpus holding dsp-era to
its dates. skills/ grew to six playbooks; the plugins measure and the skills
carry the judgment.

2.2 reads documents: input-pdf takes a PDF apart with no dependencies (Flate
is node:zlib), keeps text with its measured positions and sizes, turns the
sizes into headings and the annotations into links, refuses an encrypted
file by name, counts glyphs it cannot map rather than faking them, and with
--site gives each document a route beside the pages with the original PDF
copied in as the document of record. DOCS.md says what was read; a tech data
sheet lands as a routed React page the port's own search engine can find.

3.0 is the exact read: the grammar stamps every node with its line and both
the reader's and the printers' notes begin with where they came from; named
slots with fallbacks hold byte identical across the targets from both
dialects; lit's multiple select holds an array honestly; WebSocket channels
and GraphQL operations are read from source into the API surface with the
schema unclaimed; AUTH_FLOW.mmd draws only arrows the source proves; route
guards land as metadata in src/app/route-guards.js and are never
reinvented; RACES.md names the debounces and cancellations the port must
keep; the improve report ranks findings by the emitted lines each fix
would touch; and new-plugin scaffolds the whole author kit, with a
project's own plugins/ directory loading beside the builtins and a name
clash refused out loud. test/exact.test.js holds all of it.

3.1 reaches two more frameworks and holds the port against its witnesses:
output-next and output-remix arrange the site model as an app directory and
as route modules, importing the components the run already emitted and
carrying the flattened redirect map in each host's own spelling; the jQuery
inventory lands per route in src/app/behavior-manifest.js, matched by
selector to each page's markup; dsp-state reads Vuex, Pinia and NgRx shapes
with balanced braces; tests/replay.spec.js walks the recorded steps and
reports drift per step; PARITY_STRUCTURE.md diffs the recording's elements
against each ported screen's IR; the console keeps the previous run.json and
compares the two; test/windows.test.js gates the platform assumptions; and
dsp-tokens merges spacing across several recordings with the disagreement
kept. test/frontier.test.js and test/windows.test.js hold it.

5.0 makes the port stop repeating itself: dsp-components finds the blocks
more than one screen carried verbatim, and with --components lifts each
static one into a component screen the pages are rewritten to name. Because
every target already resolves a tag naming another screen to that component,
React, Vue, Svelte and the custom element all compose the shared component
with nothing target specific added; a block that binds or interpolates is
named in COMPONENTS.md and never lifted, because parameterizing it is a
guess about what varies. Nested repeats collapse to the largest, the
extraction is deterministic, and the catalog is written whether or not the
flag is set. test/components.test.js holds it.

5.1 gives the shared component the other half. dsp-components lifts a block
that recurs byte for byte; the commoner repeat is not byte identical, two
cards or two rows with the same structure and different words. dsp-props
reduces each block to its skeleton, the markup with every text and attribute
value blanked to a marker, groups the blocks that share a skeleton across
screens, and where the blanked slots disagree names each disagreeing slot as
a prop with the values it observed. A shape whose every slot agrees is an
exact repeat and left to dsp-components; the rest land in PROPS.md as
parameterized proposals, never lifted, because which slots are allowed to
vary is a decision about the product. test/props.test.js holds it.

5.2 reads two more of the old web. input-polymer takes a `<dom-module>` with
its inner `<template>`, its declared `properties` as inputs and its
`fire`/`dispatchEvent` names as outputs; input-riot takes a `.riot` or `.tag`
file's root custom tag, its `opts` and `this.props` reads as inputs and its
`this.trigger` names as outputs. Neither survives into the target as itself:
Polymer's `[[x]]`/`{{x}}`/`on-event`/`dom-if`/`dom-repeat` and Riot's `{ x }`/
`each`/`if`/`on<event>` are lowered onto the AngularJS attribute dialect the
rest of the tool already reads, so detectDialect picks them up and the
translator, the endpoint map and every emitter treat them as any other
component. Where a binding has no honest equivalent the lowering says so
through ctx.unverified rather than inventing one. test/oldweb.test.js holds it.

5.3 reaches two more targets by two different routes. output-qwik reuses the
exact JSX the React printer proves against the other targets, because Qwik
renders JSX; the printer only respects Qwik's two rules, that every handler
prop carry the `$` the optimizer splits it out by and that local state be a
useSignal read through `.value`, both mechanical over the proven JSX.
output-astro translates no screen twice: it emits an `.astro` page that
imports the React component the run already emitted and hydrates it with
`client:load`, the honest Astro port of a screen with client state, so no
handler is lost to a second translation and the port stays one source.
test/targets4.test.js holds both.

5.4 reads what a page told a machine rather than a person. dsp-seo audits
every page for the signals a screenshot never shows: the title and its
length, the meta description, the canonical, the robots directive, the html
lang, the viewport, the Open Graph and Twitter card counts, and the
structured data types, and names each gap (a missing or overlong title, no
canonical, no lang, several h1, a skipped heading) as one the port should
close on purpose, inventing none. dsp-analytics finds the tracking vendors
the source loaded, fifteen recognised by signature, and treats re-adding any
of them as a consent decision rather than a default; none is carried into
the output, and the identifier a tag carries is shown by its prefix only,
the caution the secret gate keeps. test/machines.test.js holds both.

6.0 makes portamp read what it writes. input-react is the first reader of a
modern framework: a React function component's props become inputs, its `on*`
props outputs, and its JSX return lowers onto the same AngularJS dialect every
other reader targets, reversing the shapes that have an inverse (`{cond &&
(<x/>)}` a conditional, `{list.map(...)}` a loop, `{expr}` interpolation, an
input with value and onChange a model, an event prop an event) and naming a
ternary or anything else rather than guessing. vis-roundtrip then closes the
loop: each screen's template is emitted to React by output-react and read
back by input-react, and the structure that returns (elements, conditionals,
loops, models, tags, whitespace set aside) is compared to what went in.
ROUNDTRIP.md names any drift per screen and the run reports it, so the claim
that the port keeps its shape is a comparison that fails out loud rather than
a promise. A React app is now also a source portamp ports onward. Values are
not proven by a round trip, only structure; that is what can be checked
without a person, so it is. test/readback.test.js holds it.

6.1 weighs the assets the port should not inherit unchanged. dsp-images reads
every `<img>` for a srcset, a sizes hint, a loading attribute, explicit
dimensions, an alt and its format, and names what is missing per image so a
small screen stops downloading the desktop picture and the page stops
reflowing when one lands; which srcset to generate and which modern format to
encode are build decisions, so IMAGES.md proposes them and rewrites no tag.
dsp-fonts reads each `@font-face` for its formats and its font-display, notes
hosted Google Fonts links, and counts the font files in the tree, then names
the measurable gaps: no woff2, a face declared in eot, svg or ttf no target
needs, and font-display left unset so text is invisible while the font loads.
Whether a licence lets a face travel stays general-license's job.
test/assets2.test.js holds both.

6.2 finds three modes a page built before they mattered leaves out.
dsp-motion counts the keyframes, animations, transitions and smooth scrolling
a stylesheet declares and reports whether any `prefers-reduced-motion: reduce`
block stills them, printing the one media query where none exists, because
motion nobody can turn off is nausea or a seizure risk. dsp-print reads every
`@media print` block with its balanced body and whether it hides the chrome,
so a stylesheet that printed an invoice cleanly for a decade is carried across
as identity rather than silently regressed. dsp-cookies names every
`document.cookie`, js-cookie and jquery.cookie write and the consent mechanism
in play, if any, because a tracking cookie set before consent is a violation
the port would inherit; the cookie's value is never printed. test/modes.test.js
holds all three.

6.3 gives Vue and Svelte the meta-frameworks React already had. output-nuxt
arranges the site model as a Nuxt app: `app.vue` carries the lifted chrome,
one file per route under `pages/` imports the emitted Vue component and rides
its head through `useHead`, and the flattened redirect map lands in
`nuxt.config.ts` as routeRules. output-sveltekit arranges it as a SvelteKit
app: `+layout.svelte` carries the chrome, one `+page.svelte` per route imports
the emitted Svelte and rides `<svelte:head>`, and the redirect map lands in
`src/hooks.server.js`, where SvelteKit throws a 301 for a retired address
because it has no config redirect table. Like output-next and output-remix,
neither ports a component twice: the files under src/features are the single
source, imported not copied, and each asks for --vue or --svelte when the
components it arranges are not there. test/metaframeworks.test.js holds both.

6.4 measures the port whole. general-size weighs what the run wrote by kind,
reading the bytes on disk: components, the api client, tokens and styles, the
host arrangement, each with its share; reports and tests are excluded because
they do not ship and their volatile files would make the total non
deterministic. With `--max-kb` it becomes a budget the run enforces, the same
shape as the unverified ceiling: component code over the ceiling fails the
run. vis-graph draws the architecture the reports describe in prose as one
Mermaid flowchart in GRAPH.md, a solid arrow where one screen's template names
another and a dotted one where an endpoint call was recorded from a screen's
own file, both the run's own facts and neither invented. test/finale.test.js
holds both.

6.5 defends the port. dsp-security reads the sharp edges a legacy front end
carries into its markup and scripts: inline event handlers a CSP would forbid,
eval, a direct innerHTML or dangerouslySetInnerHTML write, document.write, a
target=_blank link with no rel=noopener, and a full page shipping no Content
Security Policy. A finding carries only its kind and a structural detail, an
attribute name or an href, never the evaluated string or user data, the
caution the secret gate keeps; each is proposed a fix and none performed.
dsp-supplychain inventories every external `<script>` and stylesheet loaded
from a host the team does not control, with whether it carries a Subresource
Integrity hash, and flags the unpinned ones a swapped remote file could run
under. test/defense.test.js holds both.

7.0 gives the port somewhere to run. The site engine already writes a full
application and a zero dependency serve.js beside it; output-dockerfile wraps
that server in an image with no npm install (the port has no dependencies and
no build), an EXPOSE and a PORT env matching serve.js, and a HEALTHCHECK
hitting the /healthz the server answers, so the container serves exactly what
`npm run serve` serves. output-nginx writes a server block that serves the
prerendered static export, answers every retired address with a return 301
from the flattened redirect map, and falls a client route through to
index.html. Both are gated by their flag and a site model, invent no build
the port does not have, and carry the same redirect map every other host
target does. test/home.test.js holds both.

7.1 cleans the port. dsp-console finds every `console.<method>` call and every
`debugger` left in the scripts, with the method and its line and never the
arguments, because a value logged may be one a port should not reprint; shipped
to production they leak internal detail. dsp-globals finds what the app hangs
on the global object, `window.NAME =` assignments, `$.fn` jQuery plugins, and
column zero script scope `var`/`function` declarations, each a hook a module
port isolates away and must contain, or the port silently loses something other
code read. Both report rather than delete, because which log is load bearing
and which global is still read is a person's call. test/cleaned.test.js holds
both.

7.2 gives the port a type surface and an end to end suite. output-types writes
one TypeScript interface per screen, each input a prop typed `unknown` because
the reader knows the name and not the type (unknown forces a check at the
boundary, where any would wave it away), each output a handler, plus the
loading, error and retry every component takes; the endpoint paths the app
calls become a string literal `ApiPath` union and the methods an `ApiMethod`
union, so a call to an address the port never saw is a type error. The
components stay .jsx; only a types folder is added. output-cypress walks the
ported site: one spec visits every route and asserts the page mounted, another
visits each retired address and asserts the browser lands on the new path, run
against the port's own serve.js with a matching baseUrl. test/typed.test.js
holds both.

7.3 reads the structure a screen reader navigates, where dsp-a11y already
measures contrast and target size. dsp-landmarks audits the region structure
of each page, the main, nav, header, footer, aside, search and form landmarks
present, and names the gaps a user feels: no main to skip into, more than one
main, no navigation landmark, no skip link. dsp-labels finds each input, select
and textarea with no accessible name, no `<label for>`, aria-label, title or
wrapping label, because a control announced only as edit text is one nobody
relying on it can fill, and a placeholder disappears on focus and is not a
label. Both report by file and line rather than rename, because a landmark and
a label are copy a person adds on purpose. test/accessible.test.js holds both.

8.0 reads what stands between the port and its first paint. dsp-render-blocking
finds a synchronous script in the head with neither async nor defer, a
stylesheet the head blocks on, and a CSS `@import` that serializes the fetch,
each with the parser it stalls and the unblock it should take. dsp-inline
counts the elements carrying a `style` attribute (per tag), the `<style>`
blocks, and the inline `<script>` blocks with no src, never a captured body or
value, because an inline style cannot be themed with the design tokens the port
emits and inline style and script are exactly what a strict Content Security
Policy forbids, so lifting them out closes a theming gap and a security gap at
once. test/paint.test.js holds both.

9.x is the long tail, and it is where the rules above earn their keep. Four
scorecards gather what the analyzers measured into one page each (vis-a11y,
vis-security, vis-perf, vis-lifecycle), every one counting rather than grading
and every one paired with a `--max-*` ceiling that only ever adds a check and
is reckoned through the scorecard's own function so gate and report agree.
Six more readers reach the old web and the enterprise web alike: input-ember
lowers Glimmer, input-mithril walks hyperscript, input-marko reads control
flow written as tags, input-liquid composes a theme the way the server did,
input-twig rewrites Twig's spellings onto jinja's and shares that one lowering,
and input-xslt reads a stylesheet as the template it is with XPath as the path
it names. Each names what has no honest equivalent rather than approximating
it. Four analyzers read what the source says about its own dependencies:
dsp-env the configuration keys (names, never values), dsp-deps the libraries by
version against the support dates their projects published (not in the table
means not assessed), dsp-platform the browser APIs the platform removed or
deprecated, dsp-dom the size of each screen's tree against thresholds
Lighthouse publishes. Two hosts join the site engine (output-eleventy, and
output-playwright beside output-cypress). Two defects surfaced under the new
readers and were fixed for every reader at once: the object literal parser read
a ternary as key value pairs, and an event wired on a child component reached
React as a raw attribute, so the IR now learns the run's own tag names from
every printer that builds one. And the words are held like the digits: the
README's plugin and test counts, the size table within three percent, the
port README's index of every report, and every count spelled in English
numerals are each a test that fails when a sentence drifts from the file.

10.0 takes what you have. input-exe reads a native Windows executable as
the legacy front end it is: the dialog templates in its resource section
become screens on the shared dialect (a static beside a field is its label,
radios inside a group box share the group's name, a combo box is a select
whose options the code filled and so is named as a list the port is handed,
a mnemonic is an accesskey, OK submits every field back by name), menus
become menu bars, the string table and the version block are reported, and a
.NET assembly is named as keeping its forms in code. PE32 and PE32+ are read
with no dependency and every offset bounds checked. input-shots decodes a PNG
with node's own inflate and counts the colours its pixels are made of into
PALETTE.md; dsp-tokens takes the page background from them and nothing else,
because a header bar and body text are both dark. The console has an intake:
drop an .exe, a screenshot or a folder on it, press the flags it offers, and
the next run reads exactly that from the console's own sidecar, never the
port; the server hands bytes to the intake the command owns and writes
nothing itself. test/exe.test.js, test/shots.test.js and test/ui.test.js
hold it.

10.2 reaches a site you can reach but do not have, and ships. input-fetch
copies one origin's pages and assets into a folder behind the recorder's two
gates (--allow-live and the attestation), robots.txt honoured, every skip
written into FETCH.md, and the folder is what input-static ports; the console
takes a URL through the same function. The package is proven installed:
test/installed.test.js packs the tarball, unpacks it away from the checkout
and runs the shipped cli from there, and a v* tag publishes with provenance
once a person adds NPM_TOKEN. test/fetch.test.js and test/installed.test.js
hold it.

10.3 reads the desktop's own forms. input-winforms reads the
InitializeComponent body of a *.Designer.cs or *.Designer.vb with a scanner
that knows both languages' strings; input-xaml reads a WPF, UWP, Xamarin or
MAUI window, page or control as the XML it is with its bindings; input-vb6
reads a .frm's blocks and its code's wired handlers and MsgBox messages, the
binary .frx named not read; input-delphi reads a .dfm, .fmx or .lfm's object
blocks with their string lists and collections. All four lower onto the shared
dialect with the choices input-exe makes for a native dialog, so a form from
any of the five reaches React, Vue and Svelte the same way, and each writes
its own report. The console's intake unpacks a zip with node's own zlib,
every entry held to the intake's path rule. test/winforms.test.js,
test/xaml.test.js, test/vb6.test.js, test/delphi.test.js and test/zip.test.js
hold it.

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

The full picture is ROADMAP.md: six hundred and forty two features in
one hundred and fifty phases, statuses honest. What remains open, and why:

1. **npm publish.** The workflow is written: a v* tag runs the suite,
   publish-check, the tag against the version and the token's presence, then
   publishes with provenance. What remains is a person's: adding NPM_TOKEN;
   docs/PUBLISHING.md says how.
2. **Growing the calibration corpus.** Twenty two labelled miniatures now, two
   per archetype, enough for a leave one out cross validation; real labelled apps
   would make the confidence numbers mean more.
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
