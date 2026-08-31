# portamp

Read this before changing anything. It is the contract, not a description.

## What this is

A tiny plugin host that ports legacy front ends. The core is 539 lines across
four files and knows nothing about Angular, React, screenshots, or HTTP.
Everything that knows a framework is a plugin. Keeping that true is the single
most important constraint in the repo.

Target repo: github.com/drewc611/portamp

## Run it

```bash
node src/cli.js plugins      # list what loads
npm run demo                 # full pipeline against example/legacy
npm test                     # node --test, no framework
node src/cli.js run -v       # timings per plugin
```

No install step. No build step. Node 18 or newer, zero runtime dependencies.
Playwright is optional and only needed for `input-record`.

## Architecture in four sentences

Five plugin classes: `input`, `dsp`, `output`, `vis`, `general`. Five pipeline
stages in order: `scan`, `extract`, `plan`, `emit`, `verify`. A plugin subscribes
to stages and mutates one shared context object. The kernel never calls a plugin
directly and has no idea what any of them do.

```
src/core/kernel.js     registry, discovery, pipeline        (~110 lines)
src/core/policy.js     the rules, enforced                  (~130 lines)
src/core/context.js    shared context and logger            (~100 lines)
src/cli.js             argument parsing and wiring          (~110 lines)
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
three endpoints and two interceptors, writes tokens, an endpoint map, a client, a
React skeleton, and `PORT_NOTES.md` listing three unverified items. CI syntax
checks every file, runs the pipeline, and asserts the secret gate fires.

Four emit targets sit on one intermediate representation. CI asserts that the
same screen written in Angular and in Vue produces byte identical React, Vue,
Svelte and custom element output, which is the only honest way to claim the
middle is framework blind.

Plugins that ship, sixty one in five classes, and the core has never learned
the name of any of them:

```
input    input-angular  input-angularjs  input-vue  input-knockout
         input-backbone  input-jquery  input-jsf  input-aspnet
         input-openapi  input-explore  input-record  input-shots  input-blackbox
dsp      dsp-ir  dsp-tokens  dsp-apimap  dsp-behavior  dsp-improve
         dsp-a11y  dsp-cognitive  dsp-i18n  dsp-deadcode  dsp-dates
         dsp-flags  dsp-forms  dsp-permissions  dsp-perf  dsp-entities
         dsp-diff  dsp-archetype  dsp-modernize  dsp-uplift
         dsp-routes  dsp-boundaries
output   output-react  output-vue  output-svelte  output-angular  output-lit
         output-html  output-storybook  output-tests  output-openapi
         output-msw  output-tailwind  output-design-tokens  output-forms
         output-i18n  output-adr  output-migration
vis      vis-parity  vis-ui  vis-timeline  vis-coverage  vis-equivalence
general  general-policy  general-authorization  general-license
         general-doctor  general-scaffold  general-watch
```

An option the CLI does not recognise is passed through to the plugins
untouched, so a target is turned on by naming it: `--vue true`, `--html true`,
`--openapi true`, `--msw true`. The core still does not know which plugin asked
for it, or that any plugin did.

## What is honestly incomplete

Named plainly so nobody rediscovers it as a surprise.

- `output-react` translates the four constructs that make up most of a template
  and reports the rest rather than guessing: a pipe becomes an unformatted value
  with a note, an `else` branch is named and left for a person, `ng-template`
  renders inline. A tag naming another screen in the run resolves to that ported
  component; one the run has not seen stays an unknown element, and says so.
- `input-angular` reads the syntax tree when `typescript` is installed and falls
  back to regular expressions when it is not. The fallback is narrower and says
  so in the run. Neither pass uses a type checker, so a URL built from anything
  but a literal in the same file keeps its `${...}` shape rather than resolving.
- `dsp-tokens` measures a recording when there is one and reads declared
  variables when there is not. Spacing is still a default: nothing measured so
  far tells you what the spacing scale was meant to be, only what it rendered as.
- `vis-parity` reports in markdown and compares nothing visually. It says so in
  the notes rather than claiming a pass.
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
  person. `input-vue` and `input-jquery` both parse with regular expressions.
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

The full picture is ROADMAP.md: ninety seven features in ten phases, statuses
honest. The next few from it:

1. **`vis-equivalence`.** `output-tests` writes the suite; running it against
   the port and folding the result back into the report is the other half.
2. **`input-angularjs`.** The 1.x reader; ng-repeat is a dialect table away.
3. **`dsp-forms`.** Validation recovered from markup and observed complaints,
   as one schema per form.
4. **A real preview in the compare pane.** An optional esbuild step would make
   the wipe compare pixels rather than source.
5. **`input-jsf`.** The reader that would say whether the shape holds where the
   markup is not in the repository at all.
6. **A parser for `input-vue`.** It is regular expressions, and the run says so.

## Conventions

- ESM, `.js`, no TypeScript in the tool itself.
- Plugin name is `class-subject`, matching its directory.
- One log line per plugin per stage. Pipeline output stays readable.
- Prose in docs and comments avoids hyphens; identifiers and paths keep theirs.
- Comments explain why, not what. If a comment restates the line below it,
  delete it.

## Do not

- Add a dependency to core.
- Make a policy check configurable off.
- Write a URL into an emitted component. Endpoints live in `src/api/endpoints.js`.
- Commit recorded screenshots or a real `portamp.authorization.json`.
- Have a plugin call the network without asking the policy object first.
