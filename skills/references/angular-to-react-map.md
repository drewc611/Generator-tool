# Angular to React, construct by construct

Decide the mapping once, apply it everywhere. Deciding per file is what
produces a codebase that looks like four people who never spoke.

## Direct translations

| Angular | React | Notes |
| --- | --- | --- |
| Component class plus template | Function component | Template logic moves into JSX. Keep the component dumb and lift data fetching into a hook |
| `@Input()` | Props | Required inputs become required props. Give every prop a default so the component renders standalone |
| `@Output()` EventEmitter | Callback prop `onThing` | Name it for the event, not the handler |
| `*ngIf` | `{cond && ...}` or early return | Prefer early return when the whole body is conditional |
| `*ngFor` | `.map()` | Key on a stable id, never the array index, or row state follows the wrong row after a sort |
| `[ngClass]` / `[ngStyle]` | Conditional class or style object | |
| `ng-content` | `children` | Named slots become named props holding nodes |
| `@ViewChild` | `useRef` | |
| Pipes | Plain functions | A pipe is a formatting function with extra ceremony. Put them in one `format.ts` |
| `ngOnInit` | `useEffect(fn, [])` | |
| `ngOnDestroy` | `useEffect` cleanup return | |
| `ngOnChanges` | Derive during render, or `useEffect` on the dep | Most `ngOnChanges` bodies are derived state and should not be state at all |
| Router module | React Router or the framework router | Map guards to a route wrapper component |
| `CanActivate` guard | Wrapper component or loader that redirects | Keep the check server side too. A client guard is a convenience, not a control |
| Reactive forms | `useState` plus a schema validator, or a form library | Do not hand roll validation twice |
| `HttpClient` service | A client module, see `api-extraction.md` | One client, not a fetch call per component |
| `@Injectable` service holding state | Context plus hook, or a store | Only if the state is genuinely shared. Most services are not |

## The four traps

**Two way binding.** `[(ngModel)]` has no React equivalent and should not get
one. Every input becomes controlled: a value and an onChange. Where the old app
relied on mutation propagating implicitly, make the data flow explicit and
expect to find a bug the old app was hiding.

**RxJS.** Do not port observables one for one into a React app that has no use
for them. Map the actual pattern:

- A single HTTP call becomes an async function in a hook.
- `switchMap` on user input becomes debounce plus an AbortController, cancelling
  the previous request.
- `BehaviorSubject` shared between components becomes context, or a store.
- `combineLatest` becomes derived state computed during render.
- A polling stream becomes a `setInterval` in an effect, paused when the tab is
  hidden.

Keep RxJS only where the app genuinely streams, for example a websocket feed.
Adding it back to a React app for HTTP calls imports the complexity without the
reason.

**Dependency injection.** Angular DI does two things: shared instances and
testability. React gets shared instances from context and testability from
passing the dependency as a prop. Do not build a DI container. A client passed
through a provider covers almost every real case.

**Change detection.** Angular re renders on a zone tick; React re renders when
state changes. Code that relied on `ChangeDetectorRef.detectChanges` or
`OnPush` tuning usually indicates state living in the wrong place. Find the
real owner of the state rather than reproducing the workaround.

## Structure

One folder per screen, holding the component, its data hook, and its test. Shared
primitives live in a `components` folder and are composed rather than deeply
customized. Prefer composing primitives you control over overriding a component
library, since fighting a library's opinions costs more than it saves after the
second override.

## What usually gets lost, so check it explicitly

- Loading and disabled states that lived in a directive nobody reads.
- Error handling in an HTTP interceptor, which has no automatic React equivalent
  and must move into the client.
- A global spinner or toast wired through a service.
- Route resolvers that fetched data before the screen rendered, which become a
  loading state the old app never showed.
- Locale or timezone handling applied globally by a pipe.
- Permission checks scattered through templates with a structural directive.

Each of these is invisible in a screenshot and absent from the component file.
Grep for them before declaring a screen done.
