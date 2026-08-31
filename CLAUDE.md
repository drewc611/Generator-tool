# portamp

Read this before changing anything. It is the contract, not a description.

## What this is

A tiny plugin host that ports legacy front ends to React. The core is 527 lines
across four files and knows nothing about Angular, React, screenshots, or HTTP.
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

Plugins that ship: `input-angular`, `input-shots`, `input-blackbox`,
`input-record`, `input-explore`, `dsp-tokens`, `dsp-apimap`, `dsp-behavior`,
`dsp-improve`, `output-react`, `vis-parity`, `vis-ui`, `general-policy`,
`general-authorization`.

## What is honestly incomplete

Named plainly so nobody rediscovers it as a surprise.

- `output-react` translates the four constructs that make up most of a template
  and reports the rest rather than guessing: a pipe becomes an unformatted value
  with a note, an `else` branch is named and left for a person, `ng-template`
  renders inline. It does not resolve component references, so a template that
  uses another component renders that tag as an unknown element.
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
- The design extraction, framework mapping, and API extraction judgment lives in
  `skills/`, not in code. Some of it should migrate into plugins over time; not
  all of it can.

## Next tasks, in the order they pay off

1. **`vis-diff`.** Serve the recorded screenshot and the built component side by
   side on a local port. The verify stage reports in markdown only.
2. **Point `input-record` at something real.** The measuring path in
   `dsp-tokens` is covered by a recorded fixture, but a real product has a
   longer tail than a fixture does.
3. **Component references in templates.** `output-react` renders an unknown tag
   as an unknown element. Resolving it against the other components in the run
   is the next real step in the translator.
4. **`input-vue`, `output-storybook`, `dsp-a11y`.** The plugin classes are the
   point. Each of these is a directory and an index.js.

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
