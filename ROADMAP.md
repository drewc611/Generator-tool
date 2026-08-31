# The roadmap, all of it

Ninety seven features across ten phases. The statuses are honest: ✅ shipped and
under test, 🔨 new in this branch, ▢ planned. A planned feature carries its
phases where it is big enough to need them; nothing here is a name invented to
round out a number, and anything that turns out to be a bad idea gets deleted
rather than built.

The count that matters more: everything marked shipped or new runs today, under
224 tests, on Node 18 and 22.


## Phase 1 · A host that stays out of the way

*The Winamp bet: a core so small it cannot grow opinions.*

**1. The kernel** ✅  
registry, discovery, five stages; 120 lines that never learned a framework's name.

**2. Five plugin classes** ✅  
input, dsp, output, vis, general; class order is the only coordination mechanism.

**3. The policy engine** ✅  
frozen at construction, so no caller can replace a gate or turn one off.

**4. The secret gate** ✅  
a credential in source stops the run; the value is never printed or written.

**5. The attestation gate** ✅  
no source path runs without portamp.authorization.json naming who owns the system.

**6. The live and billable gates** ✅  
nothing calls a real system, or a metered one, without being told it may.

**7. The endpoint gate** ✅  
no URL survives into an emitted component; endpoints live in one module.

**8. Shared context** ✅  
one flat object every stage mutates; a plugin author can guess the shape.

**9. Plugin discovery** ✅  
a directory with an index.js loads; no registration file, no build step.

**10. Plugin registered CLI commands** ✅  
a plugin adds a command the core dispatches without understanding.

**11. Option passthrough** ✅  
an unrecognised flag reaches the plugins untouched, so a target is turned on by naming it.

**12. Per plugin timings** ✅  
-v shows what each plugin spent, attributed, per stage.


## Phase 2 · Reading what exists

*Every way in: source, screenshots, traffic, or driving the running thing.*

**13. input-angular, syntax tree pass** ✅  
components, bindings, HttpClient calls, interceptors, read from the AST when typescript is present.

**14. input-angular, regex fallback** ✅  
the same reader without the optional dependency; CI asserts both report the same app.

**15. input-vue** ✅  
single file components into the same shape the Angular reader produces.

**16. input-jquery** ✅  
a front end that declared no components, inventoried without inventing any.

**17. Handler reach analysis** 🔨  
which selectors each jQuery handler touches, through the named functions it calls, to a fixpoint.

**18. input-explore** ✅  
drives a running app the way a person does and works out what it is, with no source at all.

**19. input-record** ✅  
Playwright capture of shots, HAR and computed styles, behind the attestation gate.

**20. input-shots** ✅  
catalogs screenshots and infers the state each filename shows.

**21. input-blackbox** ✅  
HAR, schema dumps and exports; passive, nothing driven, nothing fetched.

**22. dsp-routes** 🔨  
the declared route table, Angular and Vue through one structural parser, hash routing named as unreadable.

**23. Route cross checking** 🔨  
routes to components not in the run, and screens no route reaches, each reported as a decision.


## Phase 3 · One representation in the middle

*N readers times M printers becomes N plus M.*

**24. The IR** ✅  
when, each, element, text, slot, html; one representation every reader fills and every printer drains.

**25. Dialect tables** ✅  
Angular and Vue as data, not code; detectDialect picks by what is actually in the markup.

**26. dsp-tokens** ✅  
density, type scale, spacing, colour roles measured from the running app, provenance recorded per value.

**27. dsp-apimap** ✅  
one endpoint map and a generated client, so no component ever holds a URL.

**28. dsp-behavior** ✅  
an exploration becomes screens, fields, transitions and endpoints recovered from use.

**29. dsp-improve** ✅  
what the original got wrong, measured while it ran, unseen states reported as unseen.

**30. dsp-a11y** ✅  
real WCAG contrast ratios and tap target sizes over the palette the port will use.

**31. dsp-i18n** ✅  
the copy welded into the markup, and the sentences split around a value flagged as untranslatable.

**32. dsp-deadcode** ✅  
declared and never used, as candidates and never verdicts.

**33. general-license** ✅  
fonts and icon sets whose licence does not travel with the port.

**34. Safe code emission** 🔨  
one escaper for values entering generated source; closing script tags and U+2028 cannot break out.


## Phase 4 · Knowing what it is looking at

*Structure, not framework. A reading with its evidence, never a verdict alone.*

**35. dsp-archetype** 🔨  
what kind of app this is, read from structure and traffic, never from the framework.

**36. Contested readings** 🔨  
two shapes within twenty points are reported as both, not resolved by bravado.

**37. Cross cutting observations** 🔨  
unbounded collections, state not in the URL, states never seen, destructive controls.

**38. dsp-modernize** 🔨  
a plan where every decision names the legacy fact that makes it necessary.

**39. dsp-boundaries** 🔨  
component boundaries proposed for selector soup, clustered by what handlers actually touch.

**40. dsp-uplift** 🔨  
the old palette brought to WCAG AA along lightness only; the brand hue survives.

**41. Recovered type ratio** 🔨  
the app's own scale fitted from its sizes, so its display type is kept, not redesigned.

**42. Elevation, motion, focus** 🔨  
the things the old app could not have had, added outright and tinted with its own ink.


## Phase 5 · Writing something better out

*Four targets, every state present, no URL in any component.*

**43. output-react** ✅  
a component per screen, template translated, every state present on purpose.

**44. output-vue** ✅  
the third target on the IR.

**45. output-svelte** ✅  
the second target, and the proof the middle is framework blind.

**46. output-html** ✅  
a custom element depending on nothing; delegated events, escaped rendering, caret preserved.

**47. Component references** 🔨  
a tag naming another screen in the run becomes that component, imported, with props and a key.

**48. output-storybook** ✅  
a story per component, one per state, with invented data that came from nowhere near production.

**49. output-tests** ✅  
a Playwright conformance suite written from what the original was seen to do.

**50. output-openapi** ✅  
the requests the port makes; deliberately no response it never observed.

**51. output-msw** ✅  
something for the port to talk to, carrying property names and types and nobody's values.


## Phase 6 · Proof over promises

*CI asserts the claims the README makes.*

**52. vis-parity** ✅  
what matched, what did not, and what was never checked.

**53. vis-ui** ✅  
the console: rack, wipe, endpoints, unverified list, served on loopback only.

**54. Byte identical targets in CI** ✅  
the same screen in Angular and Vue must print identically in all four targets.

**55. The gates, asserted in CI** ✅  
the secret gate and the endpoint gate must fire on fixtures built to trip them.

**56. Self counting diagrams** ✅  
the plugin rack is generated from the roster and CI fails if it drifts.

**57. A clean CodeQL board** ✅  
security-extended, run locally when the API would not show the alerts; eleven findings to zero.


## Phase 7 · Readers to come

*The formats the last two decades left behind.*

**58. input-angularjs** ▢  
the 1.x reader: ng-repeat, $scope, controllers as the component boundary Angular never made them.

   - read ng-app and ng-controller regions as screens
   - a dialect table for ng-if, ng-repeat, ng-model
   - $http and $resource into the call inventory

**59. input-knockout** ▢  
data-bind attributes are a dialect; observables are the model.

   - parse data-bind expressions
   - map foreach, visible and click into the IR
   - the ko.observable graph into props

**60. input-backbone** ▢  
views, models and hand drawn render() methods, inventoried like jQuery with a model layer.

**61. input-jsf** ▢  
the reader that says whether the shape holds where the markup is not in the repository at all.

   - read facelets templates and managed bean references
   - pair with input-explore for the rendered truth

**62. input-aspnet** ▢  
WebForms: runat=server, ViewState named for what it was, postbacks into the call inventory.

**63. input-openapi** ▢  
an existing spec as a source, cross checked against what the client actually calls.

**64. A real parser for input-vue** ▢  
the regex reader replaced, behind the same output shape, only when it changes nothing.

**65. Angular built in control flow** ▢  
@if, @for and @switch as dialect entries beside *ngIf and *ngFor.

**66. Legacy widget recognition** ▢  
a jQuery datepicker or accordion named as the pattern it is, mapped to a modern equivalent, as a proposal.


## Phase 8 · Analysis to come

*What else the port is the cheapest moment to learn.*

**67. dsp-forms** ▢  
validation rules recovered from attributes, watchers and server complaints, into one schema per form.

   - collect required, pattern, min and max from markup
   - fold in rules observed as error messages during exploration
   - emit a schema output-forms can build from

**68. dsp-entities** ▢  
the data model inferred from payload shapes across endpoints; two shapes that agree are one entity.

**69. dsp-permissions** ▢  
the role checks scattered through templates, collected into one visibility table nobody has seen whole.

**70. dsp-dates** ▢  
every date format, timezone assumption and hand rolled formatter, named before they become bugs twice.

**71. dsp-feature-flags** ▢  
conditions that read like flags, collected; half are dead and which half is a finding.

**72. dsp-perf** ▢  
what the old app ships that the port should not: dead weight, blocking loads, N+1 patterns in the HAR.

**73. dsp-cognitive** ▢  
the cognitive accessibility audit: reading level, all caps, unlabeled icons, timeouts, motion that cannot be stopped.

   - measure copy against plain language thresholds
   - flag timeouts and autoplay seen during exploration
   - report per screen, severities from WCAG COGA

**74. dsp-diff** ▢  
two runs compared, so a port in progress can see what moved underneath it.

**75. Dark palette derivation** ▢  
the uplift's second palette: same hues, lightness order inverted, contrast held to the same targets.

**76. Focus order** ▢  
measured from the exploration, since it needs the DOM; reported against reading order.

**77. More archetypes** ▢  
kanban, calendar, chat, document editor; each with its signals and its modernization decisions.

**78. A calibration corpus** ▢  
archetype confidence checked against labelled real apps, so 75% means something.


## Phase 9 · Targets and artifacts to come

*More ways out, each priced at one printer.*

**79. output-angular** ▢  
modern Angular as a target; the IR does not care that the source may also have been Angular.

**80. output-lit** ▢  
the custom element target with a rendering library, for teams that want one.

**81. output-tailwind** ▢  
the measured tokens as a tailwind config, for ports landing where that is the system.

**82. output-design-tokens** ▢  
the W3C design tokens format, so the uplift can enter a design tool.

**83. output-forms** ▢  
schema driven forms from dsp-forms, with the recovered validation and every error state.

**84. output-i18n** ▢  
the string catalogue as ICU messages, split sentences made whole.

**85. output-adr** ▢  
the modernization plan as architecture decision records, one per decision, evidence attached.

**86. output-migration** ▢  
a strangler fig plan from the route table: which path cuts over when, and what proves each step.

   - order routes by risk, and by traffic where observed
   - pair each cutover with its conformance tests
   - emit the rollback condition beside every step

**87. Storybook for every target** ▢  
stories beside the Vue, Svelte and custom element output, not only React.

**88. MSW failure scenarios** ▢  
handlers for latency, errors and empty pages, so the states the port renders get exercised.


## Phase 10 · Proof and workflow to come

*Closing the loop between the port and the truth.*

**89. vis-equivalence** ▢  
run the emitted conformance suite against the port and fold the result back into the report.

   - execute via the optional Playwright
   - map failures back to screens and steps
   - the parity report gains a measured column

**90. A real preview in the compare pane** ▢  
an optional esbuild step so the wipe compares pixels, not source.

**91. vis-coverage** ▢  
how much of the old app the port covers, measured against the exploration, shown per screen.

**92. vis-timeline** ▢  
the exploration replayed as a timeline: what was clicked, what fired, what changed.

**93. Watch mode** ▢  
a plugin command that re-runs the pipeline on change and keeps the console current.

**94. portamp doctor** ▢  
what is installed, what is optional and absent, and what each gap turns off.

**95. A plugin scaffolder** ▢  
portamp new-plugin writes the directory, the header contract and the test file.

**96. Published to npm** ▢  
npx portamp against a legacy tree, no clone.

**97. Windows in CI** ▢  
the fourth leg of the matrix; path handling is where it will hurt.


---

| | |
| --- | --- |
| shipped | 44 |
| new in this branch | 13 |
| planned | 40 |
| total | 97 |

Planned items land in the order they pay off, and each one arrives the way
everything above arrived: with the honest gaps named, a test that would notice
it breaking, and nothing guessed.
