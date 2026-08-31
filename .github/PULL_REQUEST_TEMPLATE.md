## What this changes

<!-- One paragraph. What is different after this lands. -->

## Where it landed

- [ ] It is in a plugin, not in `src/`
- [ ] If it is in `src/`, it is generic and the core still names no framework

## The invariants

- [ ] Nothing is guessed. Anything undetermined calls `ctx.unverified(...)`
- [ ] No policy gate was weakened, made optional, or bypassed
- [ ] No runtime dependency was added
- [ ] Emitted components still render loading, error, empty and a body
- [ ] No URL or endpoint reaches an emitted component

## Evidence

<!-- Paste the run, the failing test before and passing after, or the numbers.
     "Should work" is not evidence. -->

```
```

- [ ] `npm test` passes on Node 18 and on a current Node
- [ ] `npm run demo` still produces five files
