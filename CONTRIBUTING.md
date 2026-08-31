# Contributing

The rule that matters: **if your change knows what a framework is, it belongs in
a plugin.** A test asserts that nothing under `src/core/` names one.

## Getting going

```bash
git clone https://github.com/drewc611/portamp && cd portamp
node src/cli.js plugins      # nothing to install
npm run demo                 # the pipeline against example/legacy
npm test                     # node --test, no framework
portamp ui                   # look at the run
```

Node 18 or newer. `typescript` and `playwright` are optional and only change
what `input-angular` and the explorer can do. The suite is green without both,
where the tests that need them skip rather than pass on nothing.

## Writing a plugin

A directory under `plugins/` with an `index.js` that default exports one object.
`docs/PLUGIN-API.md` is the whole contract, and the shortest useful plugin is
about thirty lines. Drop it in and it loads: no registration file, no build step.

Plugins may also register a command, which is how `portamp ui` exists without
`src/cli.js` knowing what a UI is.

## The invariants, in the order they matter

1. **Never guess.** If a value cannot be determined, call `ctx.unverified(...)`
   and carry on. A visible gap is worth more than a plausible wrong answer, and
   most of the review on a change here is about this one.
2. **Policy gates are not optional.** Nothing reaches the network without asking
   the policy object. Nothing weakens a gate. The policy object is frozen at
   construction so it cannot be, either.
3. **Zero runtime dependencies.** Optional ones are lazily imported and degrade
   the run rather than ending it. See `input-angular`.
4. **Emitted components render every state.** Loading, error, empty and the
   body. An empty state that renders nothing is the defect this tool exists to
   stop shipping.
5. **No endpoint reaches a component.** They live in one module.

## Tests

`node --test`, no framework. A change is expected to bring one, and the useful
kind states the defect it prevents rather than restating the code. Several tests
here carry a comment naming the bug they guard, which is the style to copy.

If you fix something that was wrong, the test should fail before your fix.

## Prose

Docs and comments avoid hyphens; identifiers and paths keep theirs. Comments
explain why, not what. If a comment restates the line below it, delete it.
