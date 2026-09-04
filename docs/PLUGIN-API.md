# Plugin API

A plugin is a module with a default export holding four things.

```js
export default {
  name: "output-storybook",   // unique, kebab case, prefixed with its class
  version: "0.1.0",
  class: "output",            // input | dsp | output | vis | general
  setup({ on, log, policy }) {},
};
```

`setup` runs once at load. It subscribes to stages and returns nothing.

## Stages

Run in this order. A plugin may subscribe to any number of them.

| Stage | Purpose | What exists yet |
| --- | --- | --- |
| `scan` | Find things | nothing |
| `extract` | Read and parse them | `ctx.sources` |
| `plan` | Decide what to build | `ctx.screens`, `ctx.api` |
| `emit` | Write files | `ctx.tokens`, `ctx.plan` |
| `verify` | Check and report | `ctx.written` |

Within a stage, plugins run in load order: built ins first, then `./plugins`,
then anything listed in the config. If your plugin needs another plugin's
output, subscribe to a later stage rather than relying on ordering.

A plugin that throws stops the run. That is intentional: a half ported screen
is worse than no ported screen.

## Context

One flat object passed to every stage handler.

```js
ctx.config          { src, shots, out, artifacts, tokens, only, skip, dryRun, ... }
                    plus every option the CLI did not recognise, untouched
ctx.log             info, warn, error, debug, already prefixed with your name
ctx.policy          the policy object, see below

ctx.sources.files         [{ path, rel }]
ctx.sources.screenshots   [{ path, name, bytes, state }]
ctx.sources.specs         [] for OpenAPI or Postman input plugins

ctx.tokens          design tokens, available from plan onward
ctx.screens         [{ selector, file, inputs, outputs, usesTwoWay, rxjs }]
ctx.api.calls       [{ method, path, file, name, headers, body }]
ctx.api.interceptors [{ file }]
ctx.plan.components []
ctx.site            with --site true: { pages, graph, chrome, redirects,
                    pagination, frames, deadLinks }, written by input-static
                    and read by output-site
ctx.written         relative paths written so far

await ctx.write(relPath, contents)   writes under config.out, records the path
ctx.note(text)                       a deliberate deviation, goes in PORT_NOTES
ctx.unverified(text)                 something nobody could confirm
```

Add your own keys freely. Keep them flat and boring so the next plugin author
can guess the shape.

## Policy

Anything consequential asks first.

```js
policy.scanForSecrets(text, file)      // records kind and location, never the value
policy.assertNoSecrets()               // throws PolicyViolation if any were found
policy.assertLiveAllowed(target)       // throws unless --allow-live
policy.assertBillableAllowed(target)   // live plus --allow-billable
policy.warnOnFixtureData(sample, file) // flags what looks like real customer data
```

A plugin that makes a network call without asking is a bug, not a feature. The
three failure modes this prevents are all expensive: leaking a credential,
hitting a system you are not authorized to hit, and billing a customer's payment
account on every test run.

## Conventions

- Name the plugin for its class and its job: `input-vue`, `output-svelte`.
- Log one line per stage. The pipeline output should stay readable.
- Never guess. If something cannot be determined, call `ctx.unverified` and move
  on. A wrong value that looks right is worse than a gap somebody can see.
- Emit skeletons with every state present. An empty state that renders nothing is
  the most common thing a port forgets.
- Write no secrets, no customer data, and no URLs into components.

## Your own plugins, beside the tool

Discovery reads two directories the same way: the tool's builtin `plugins/`
and a `plugins/` directory in the working directory the run starts from. A
project can carry its own plugins under version control with no registration
file, no configuration and no fork of the tool: a directory with an
`index.js` that exports the contract above loads on the next run, exactly
like a builtin. The core never learns the difference, which is the point.

Two rules keep that honest. A project plugin cannot replace a builtin: a
duplicate name is refused rather than silently winning. And every rule in
this document binds a project plugin the same way, policy object included;
where the plugins came from was never a policy boundary.

`portamp new-plugin <class>-<subject>` scaffolds the whole kit in the
working directory: the plugin with the contract in its header, a test, docs
in the plugin's own README, and a fixture directory for the test to run
against.
