# portamp

Read this before changing anything. It is the contract, not a description.

## What this is

A tiny plugin host that ports legacy front ends to React. The core is 448 lines
across four files and knows nothing about Angular, React, screenshots, or HTTP.
Everything that knows a framework is a plugin. Keeping that true is the single
most important constraint in the repo.

Target repo: github.com/drewc611/portamp

## Run it

```bash
node src/cli.js plugins      # list what loads
npm run demo                 # full pipeline against example/legacy
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
`input-record`, `dsp-tokens`, `dsp-apimap`, `output-react`, `vis-parity`,
`general-policy`, `general-authorization`.

## What is honestly incomplete

Named plainly so nobody rediscovers it as a surprise.

- `input-angular` parses with regular expressions. It finds components, inputs,
  outputs, directives, RxJS operators, and `HttpClient` calls, and it will miss
  anything unusual. A real AST pass using the TypeScript compiler API is the
  obvious upgrade and the plugin boundary is already correct for it.
- `dsp-tokens` returns sensible defaults and records what it could not recover.
  It does not yet measure `ctx.sources.observedStyles`, which `input-record`
  already populates. That is the highest value next task.
- `output-react` emits a skeleton with a TODO for the template body. It does not
  translate the Angular template. That is the largest remaining piece.
- `test/` does not exist. `npm test` is declared and will fail.
- The design extraction, framework mapping, and API extraction judgment lives in
  `skills/`, not in code. Some of it should migrate into plugins over time; not
  all of it can.

## Next tasks, in the order they pay off

1. **Tests.** `node --test`, no framework. Cover the kernel (discovery, dedupe,
   stage ordering), the policy engine (each pattern, each assert), and one
   end to end run asserting the five emitted files.
2. **`dsp-tokens` measures observed styles.** Cluster `fontSize` values from
   `ctx.sources.observedStyles`, fit a ratio, round to a clean scale. Derive
   density from median table row height. Extract color roles by frequency, not
   by collecting every hex. Record every value that still had to be defaulted.
3. **`output-react` template translation.** Start with the mapping table in
   `skills/references/angular-to-react-map.md`. `*ngIf`, `*ngFor`, interpolation,
   and property binding cover most real templates. Two way binding becomes a
   controlled input, and say so in `PORT_NOTES.md`.
4. **`input-angular` AST pass.** Replace the regular expressions. Keep the same
   context shape so nothing downstream changes.
5. **`vis-diff`.** Serve the recorded screenshot and the built component side by
   side on a local port. The verify stage currently reports in markdown only.

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
