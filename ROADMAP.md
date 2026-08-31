# The roadmap, all of it

One hundred and fifty eight features across fifteen phases. The statuses are
honest: ✅ shipped and under test, 🔨 new in this branch, ▢ planned. A planned
feature carries its phases where it is big enough to need them; nothing here
is a name invented to round out a number, and anything that turns out to be a
bad idea gets deleted rather than built.

The count that matters more: everything marked shipped or new runs today, under
357 tests, on Node 18, 20 and 22, and on Windows in CI.


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

**58. input-angularjs** 🔨  
the 1.x reader: ng-repeat, $scope, controllers as the component boundary Angular never made them.

   - read ng-app and ng-controller regions as screens
   - a dialect table for ng-if, ng-repeat, ng-model
   - $http and $resource into the call inventory

**59. input-knockout** 🔨  
data-bind attributes are a dialect; observables are the model.

   - parse data-bind expressions
   - map foreach, visible and click into the IR
   - the ko.observable graph into props

**60. input-backbone** 🔨  
views, models and hand drawn render() methods, inventoried like jQuery with a model layer.

**61. input-jsf** 🔨  
the reader that says whether the shape holds where the markup is not in the repository at all.

   - read facelets templates and managed bean references
   - pair with input-explore for the rendered truth

**62. input-aspnet** 🔨  
WebForms: runat=server, ViewState named for what it was, postbacks into the call inventory.

**63. input-openapi** 🔨  
an existing spec as a source, cross checked against what the client actually calls.

**64. A real parser for input-vue** 🔨  
replaced by structural scanning behind the byte identical gate: blocks by nesting count, props out of the real object literal. A grammar it still is not, and says so; the templates were always the dialect parser's to parse.

**65. Angular built in control flow** 🔨  
@if, @for and @switch as dialect entries beside *ngIf and *ngFor.

**66. Legacy widget recognition** 🔨  
a jQuery datepicker or accordion named as the pattern it is, mapped to a modern equivalent, as a proposal.


## Phase 8 · Analysis to come

*What else the port is the cheapest moment to learn.*

**67. dsp-forms** 🔨  
validation rules recovered from attributes, watchers and server complaints, into one schema per form.

   - collect required, pattern, min and max from markup
   - fold in rules observed as error messages during exploration
   - emit a schema output-forms can build from

**68. dsp-entities** 🔨  
the data model inferred from payload shapes across endpoints; two shapes that agree are one entity.

**69. dsp-permissions** 🔨  
the role checks scattered through templates, collected into one visibility table nobody has seen whole.

**70. dsp-dates** 🔨  
every date format, timezone assumption and hand rolled formatter, named before they become bugs twice.

**71. dsp-feature-flags** 🔨  
conditions that read like flags, collected; half are dead and which half is a finding.

**72. dsp-perf** 🔨  
what the old app ships that the port should not: dead weight, blocking loads, N+1 patterns in the HAR.

**73. dsp-cognitive** 🔨  
the cognitive accessibility audit: reading level, all caps, unlabeled icons, timeouts, motion that cannot be stopped.

   - measure copy against plain language thresholds
   - flag timeouts and autoplay seen during exploration
   - report per screen, severities from WCAG COGA

**74. dsp-diff** 🔨  
two runs compared, so a port in progress can see what moved underneath it.

**75. Dark palette derivation** 🔨  
the uplift's second palette: same hues, lightness order inverted, contrast held to the same targets.

**76. Focus order** 🔨  
the probe records position and tabindex; tab order is checked against reading order, and a recording without positions measures nothing.

**77. More archetypes** 🔨  
kanban, calendar, chat, document editor; each with its signals and its modernization decisions.

**78. A calibration corpus** 🔨  
v0: eight labelled miniatures the classifier must agree with, one per archetype; real labelled apps still wanted to grow it.


## Phase 9 · Targets and artifacts to come

*More ways out, each priced at one printer.*

**79. output-angular** 🔨  
modern Angular as a target; the IR does not care that the source may also have been Angular.

**80. output-lit** 🔨  
the custom element target with a rendering library, for teams that want one.

**81. output-tailwind** 🔨  
the measured tokens as a tailwind config, for ports landing where that is the system.

**82. output-design-tokens** 🔨  
the W3C design tokens format, so the uplift can enter a design tool.

**83. output-forms** 🔨  
schema driven forms from dsp-forms, with the recovered validation and every error state.

**84. output-i18n** 🔨  
the string catalogue as ICU messages, split sentences made whole.

**85. output-adr** 🔨  
the modernization plan as architecture decision records, one per decision, evidence attached.

**86. output-migration** 🔨  
a strangler fig plan from the route table: which path cuts over when, and what proves each step.

   - order routes by risk, and by traffic where observed
   - pair each cutover with its conformance tests
   - emit the rollback condition beside every step

**87. Storybook for every target** 🔨  
stories beside the Vue, Svelte and custom element output, not only React.

**88. MSW failure scenarios** 🔨  
handlers for latency, errors and empty pages, so the states the port renders get exercised.


## Phase 10 · Proof and workflow to come

*Closing the loop between the port and the truth.*

**89. vis-equivalence** 🔨  
run the emitted conformance suite against the port and fold the result back into the report.

   - execute via the optional Playwright
   - map failures back to screens and steps
   - the parity report gains a measured column

**90. A real preview in the compare pane** 🔨  
no build step needed after all: the dependency free custom element renders live in the pane, empty, loading and error, proven in a browser.

**91. vis-coverage** 🔨  
how much of the old app the port covers, measured against the exploration, shown per screen.

**92. vis-timeline** 🔨  
the exploration replayed as a timeline: what was clicked, what fired, what changed.

**93. Watch mode** 🔨  
a plugin command that re-runs the pipeline on change and keeps the console current.

**94. portamp doctor** 🔨  
what is installed, what is optional and absent, and what each gap turns off.

**95. A plugin scaffolder** 🔨  
portamp new-plugin writes the directory, the header contract and the test file.

**96. Published to npm** ▢  
npx portamp against a legacy tree, no clone.

**97. Windows in CI** 🔨  
the fourth leg of the matrix; path handling is where it will hurt.


## Phase 11 · The translator grows teeth

*The constructs that were reported instead of translated, translated.*

**98. Else chains** 🔨  
v-else and v-else-if fold into negation chains at the sibling level, exactly as @else already did; whitespace between branches survives, rendered content breaks the chain, and an orphan else is named.

**99. ngSwitch** 🔨  
[ngSwitch], *ngSwitchCase and *ngSwitchDefault lower to equality tests with a negated default; the directive itself never reaches the output.

**100. AngularJS ng-switch** 🔨  
both spellings (ng-switch="x" and ng-switch on="x"); ng-switch-when compares against the literal label rather than inventing a variable.

**101. Checkbox models** 🔨  
a model on a checkbox binds checked and writes event.target.checked, in react, svelte, lit, solid and the custom element alike; value would have written "on" into the model forever.

**102. Radio models** 🔨  
checked compares against the radio's own value and the setter writes it back; a radio without a value gets its setter and a note, never a guess.

**103. Multiple select models** 🔨  
value binds the array and the setter reads selectedOptions.

**104. v-model modifiers** 🔨  
.number casts when it parses and keeps the text when it does not; .trim applies on blur so typing stays undisturbed; .lazy is named for what React cannot spell.

**105. A filter rewrite table** 🔨  
uppercase, lowercase, upper, lower, length, json, slice and limitTo become the JS they exactly mean, chained; currency, date and number stay reported, because a wrong format that parses is worse than a visible gap.


## Phase 12 · Readers for what the last ten phases skipped

*Template languages, static sites, and the route tables nobody declared.*

**106. input-static** 🔨  
a folder of plain pages: each is a screen, each link is a route, and a page whose scripts are in the run belongs to those scripts' reader.

**107. Link derived routes** 🔨  
claimed only when no declared table exists; a real router outranks inference from anchors.

**108. Shared chrome detection** 🔨  
the same nav on every page is proposed as one layout component; the pages keep their copies until a person makes the cut.

**109. input-underscore** 🔨  
the templates input-backbone deferred: <%= %>, if/else and _.each lowered onto the attribute dialect, with the unescaped interpolation named.

**110. input-handlebars** 🔨  
#if, #unless and #each carried across, with each's else folded into the empty state and helpers respelled as calls.

**111. Handlebars partials** 🔨  
{{> name}} inlines when the partial is in the run, by registry style basename; arguments that cannot ride along are named, and a partial that is inlined is not also its own screen.

**112. input-jinja** 🔨  
jinja and Django pages as screens, python logic respelled as JS outside of strings, server machinery removed and named.

**113. Jinja includes** 🔨  
{% include %} inlines when the file is in the run, with a cycle guard; {% extends %} is still a layout question and says so.

**114. $routeProvider** 🔨  
the AngularJS route chain read into the same table, .otherwise in both spellings included.


## Phase 13 · Weighing the port before writing it

*Analyses that turn a feeling into a number with a file behind it.*

**115. dsp-assets** 🔨  
what the tree holds against what the code points at; a dead reference is a broken image somebody will find later, so the list is now.

**116. dsp-css** 🔨  
the stylesheet weighed: !important with line numbers, id selectors, four level chains, declarations repeated enough to be a token.

**117. dsp-entropy** 🔨  
strings random enough to be credentials, reported by file, line, length and bits per character, and never by value.

**118. dsp-apistyle** 🔨  
the API's house style read off the traffic: segment casing, plurality, versioning, pagination convention; the port keeps the quirks because the server expects them.

**119. dsp-auth** 🔨  
the scheme and where the token lives; interceptors that show no scheme are their own finding, and no token value reaches any file.

**120. dsp-duplication** 🔨  
screens that are nearly the same screen, by skeleton similarity with the words stripped; proposals, never results.

**121. dsp-state** 🔨  
where state should live, argued from what each screen reads: local until a second screen needs it, and every promotion names its evidence.

**122. dsp-weight** 🔨  
how much port each screen is, by a formula printed beside its numbers; disagree with the weights, not the counts.

**123. Radio group schemas** 🔨  
radios sharing a name become one field whose enum is the values the markup states; a computed value leaves the list open and says so.

**124. Focus order, measured** 🔨  
duplicate of 76 closed by it: position and tabindex in the probe, tab order against reading order in dsp-improve.


## Phase 14 · More places for the same IR to go, and a workbench that explains itself

*Nine more targets on one middle, and the console grows up.*

**125. output-preact** 🔨  
the same proven JSX, hooks from preact/hooks, a tenth the runtime.

**126. output-solid** 🔨  
the one printer where spelling is correctness: props qualified as props.x and signals as x(), because destructuring either is how Solid components stop updating.

**127. output-alpine** 🔨  
behavior written on the markup for the apps that never wanted a build; the runtime is vendored, because portamp writes no external URL.

**128. output-cem** 🔨  
custom-elements.json for the ported elements, so editors autocomplete them instead of shrugging.

**129. output-postman** 🔨  
the requests as a v2.1 collection through a baseUrl variable; responses deliberately absent, in Postman exactly as in OpenAPI.

**130. output-curl** 🔨  
a smoke script written and never run, GETs only, auth deliberately not included.

**131. output-fixtures** 🔨  
response fixtures with types and no captured values; an unobserved shape says so in its own payload.

**132. output-readme** 🔨  
PORT_README.md indexes everything the run wrote, with the honest numbers beside it.

**133. output-ci** 🔨  
the port gets a workflow of its own: parse checks, JSON checks, and the endpoint rule kept after the files leave portamp's hands.

**134. A mermaid migration map** 🔨  
the strangler plan as a flowchart GitHub renders where the pull request is reviewed.

**135. tokens.css** 🔨  
the measured tokens as CSS custom properties, for a consumer with no build step.

**136. Write provenance** 🔨  
the kernel attributes every write to the plugin whose turn it was, still knowing nothing about what any file is.

**137. portamp explain** 🔨  
which plugin wrote a file and at which stage, answered from the run's own record.

**138. Local badges** 🔨  
ported, unverified and the archetype reading as SVGs with no badge service; the number needs no network to be seen.

**139. Run history** 🔨  
one line of counts per run and a trend table, so "is the port getting better" has an answer that is not a feeling.

**140. Console keyboard navigation** 🔨  
j/k and the arrows walk the screens; / jumps to the filter.

**141. An unverified filter** 🔨  
type to narrow the list that matters most.

**142. A quiet refresh** 🔨  
the console re-renders when a watch task rewrites the run, and only then.

**143. A trend readout** 🔨  
the unverified delta against the previous run, in the console's head.

**144. Per class scaffolds** 🔨  
new-plugin writes the stub for the class's actual shape: the stage it belongs in, the context it fills, the mistake its kind usually makes.

**145. Live regions** 🔨  
the emitted loading state is role=status and the error state role=alert, in the element, react and preact targets alike.

**146. An attestation scoped live gate** 🔨  
domains named in portamp.authorization.json narrow --allow-live to those hosts, loopback exempt; the list only ever narrows.

**147. An unverified ceiling** 🔨  
--max-unverified N fails the run over the ceiling, for CI; there is still no flag that relaxes a gate.

**148. Chromium in doctor** 🔨  
playwright installed without its browser fails at run time; doctor says so at ask time.

**149. Element preview routes** 🔨  
the console serves only src/elements/*.js executable, path shaped so the element's own imports resolve; everything else stays text.

**150. Postman and fixtures share the privacy line** 🔨  
no captured value survives into either; the line is a test, not a habit.

**151. Solid expression qualifier** 🔨  
the string masked identifier rewriter that makes 126 safe, tested on keys, strings and locals.

**152. The four printer identity, extended** 🔨  
the checkbox, radio, switch and else chain work lands in the same IR every printer reads, so the byte identity claim covers it automatically.



## Phase 15 · The six that closed the honesty gaps

*Each of these retires a caveat the docs had to carry.*

**153. The structural Vue reader** 🔨  
same entry as 64, landed: a template containing a template reads whole, a nested default object no longer swallows the props after it, and every existing byte of output stayed identical.

**154. Spacing, measured** 🔨  
the one token that stayed a default now comes from gaps between recorded element boxes, clustered within two pixels; rungs the recording cannot prove stay default and the evidence says which are which.

**155. The pixel diff, written** 🔨  
--pixels renders the element target in a real browser against the recording and reports the share of differing pixels, with its limits printed beside it: framing and data dominate the number, so it measures drift, not fidelity.

**156. A pseudo locale** 🔨  
en-XA beside the ICU catalogue: accented, bracketed, a third longer, placeholders untouched, so hardcoded copy shows itself before a translator has to.

**157. Fixtures from the spec's claim** 🔨  
a declared response shape reaches fixtures through its local ref, typed, and the payload says whose claim it is; an observed shape still outranks it.

**158. Provenance in the index** 🔨  
PORT_README names the plugin behind every artifact, the same record portamp explain reads.


---

| | |
| --- | --- |
| shipped | 44 |
| new in this branch | 113 |
| planned | 1 |
| total | 158 |

The one still open is open for a stated reason, not for lack of time: npm
publish is one command that belongs to a person, with docs/PUBLISHING.md
waiting beside it. Four that were open closed in this branch: focus order once
the probe recorded positions, the calibration corpus at v0 with eight labelled
miniatures, the compare pane preview the moment it was noticed that the
dependency free element target never needed a build step, and the Vue reader
once structural scanning produced byte identical output to the regexes it
retired.
