# The roadmap, all of it

Two hundred and forty nine features across twenty two phases. The statuses are
honest: ✅ shipped and under test, 🔨 new in this branch, ▢ planned. A planned
feature carries its phases where it is big enough to need them; nothing here
is a name invented to round out a number, and anything that turns out to be a
bad idea gets deleted rather than built.

The count that matters more: everything marked shipped or new runs today, under
427 tests, on Node 18, 20 and 22, and on Windows in CI.


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


## Phase 16 · The translator learns what it used to note

*Thirteen behaviors that were caveats in PORT_NOTES and are now translations.*

**159. then and else, resolved** 🔨
an else or then naming an ng-template resolves to that template's harvested body; a reference the markup does not hold stays a note, never a guess.

**160. Object loops** 🔨
the (key, value) repeat maps Object.entries in react, solid and the element, destructures the pair in svelte, keeps Vue's native pair form, and rides the keyvalue pipe in the angular target.

**161. ng-options, expanded** 🔨
the select comprehension becomes the option loop it always was, value and label read from the expression; a form it cannot read stays a note and the select keeps its markup children.

**162. The repeat carries its if inside** 🔨
AngularJS runs the repeat before the if, so a condition on a repeated row now tests each row inside the loop, where the row exists.

**163. Containerless knockout** 🔨
<!-- ko if / ifnot / foreach / with --> comments become the containers they implied; foreach names its row, $data is rewritten to it, and the rescoping gap is named.

**164. Ranges spelled out** 🔨
v-for over a number counts from one through Array.from, so the range stays visible instead of becoming a magic array.

**165. Event modifiers** 🔨
.prevent, .stop, .self, the key filters and the mouse buttons become the statements they stand for in the function targets, ride the name unchanged in Vue and Alpine, and a modifier with no equivalent runs unguarded and says so.

**166. Text directives** 🔨
ng-bind, ng-bind-template and v-text replace the element's content, exactly as they did at runtime.

**167. Named slots** 🔨
a slot with a name is a second insertion point: a prop in react and solid, a named slot in vue, svelte, lit and the element, a select in the angular target.

**168. Slot fallbacks** 🔨
the children inside a slot tag are the fallback and survive into every target, native where the platform has them, ?? where it does not.

**169. v-pre kept, v-once named** 🔨
a v-pre subtree is carried as written, mustaches included, because the author said those braces are text; v-once keeps rendering and the freeze is noted.

**170. The boolean directives** 🔨
ng-checked, ng-selected, ng-readonly, ng-required, ng-open and ng-multiple each drive their flag.

**171. Dynamic components** 🔨
<component :is> renders its expression: a bound name in react, svelte:component in svelte, the same spelling back in vue; a target with no dynamic tag keeps the element visible instead of losing the expression.

## Phase 17 · Readers that carry what they inventoried

*Ten places a reader said "a person must" and now does.*

**172. The backbone join** 🔨
a view naming its underscore template by id claims the screen made from that block; the events hash rides along and the old "does not translate" note fires only when the template truly is not in the run.

**173. Jinja inheritance** 🔨
{% extends %} composes the way the server did: child blocks over the parent's, super() splicing the default back, untouched blocks keeping theirs.

**174. Jinja macros** 🔨
a macro defined in the file expands at its call sites with arguments substituted textually, defaults included, and the note names the one risk of a textual substitution.

**175. Handlebars #with** 🔨
bare names inside the block are prefixed with its target, which is what the block meant, and the note names the outer scope case.

**176. @index and @key** 🔨
loop metadata reshapes the loop that carries it: @index makes the repeat track by index, @key turns it into the entries loop only an object can have.

**177. Spec parameters** 🔨
path, query and header parameters are read from the document, the path item's shared list folded in, and a required query parameter the traffic never passes is surfaced as the disagreement it is.

**178. Registered knockout components** 🔨
ko.components.register declares a boundary somebody drew: the template, inline or by element id, becomes a screen and params become inputs.

**179. WebForms rows** 🔨
a Repeater, ListView or DataList ItemTemplate becomes a screen: Eval and Bind are field reads, the four controls with exact HTML meanings map across, the EmptyDataTemplate survives as the empty state, and the server side data source is named as the gap it is.

**180. Pre-1.5 directives** 🔨
.directive() with a template and an isolate scope reads as the component it was; a purely behavioral directive stays out of the screens.

**181. Static forms** 🔨
a form's action, method and field names become the API call the page always declared, and a GET form's query string spelling is kept and noted.

## Phase 18 · Analysis that reads what it already had

*Twelve readings the reports did not yet make.*

**182. Structure per screen** 🔨
heading ladders that skip a rung and aria references whose id is nowhere in the same screen, reported as candidates with the split risk named.

**183. Plural sensitive copy** 🔨
"(s)" and counts beside nouns are marked in the catalogue: one message with a plural rule, not two strings, and most languages have more forms than English.

**184. Route parameters** 🔨
each :param is named in ROUTES.md, and one the target screen's template never mentions is surfaced as either controller-read or dead weight.

**185. The fields the screens read** 🔨
each GET joins to the collection its templates iterate and API_FIELDS.md lists exactly which response fields put pixels on screen, framed as a reading, not a contract.

**186. Selectors matching nothing** 🔨
a rule whose classes and ids appear in no template is a dead style candidate, with the deadcode caveats stated: runtime assembly and outside markup are invisible to the search.

**187. Templates, weighed** 🔨
nodes printed and loop nesting per screen; a loop in a loop with handlers on the inner rows is named, and the number is a place to look, not a verdict.

**188. Stale flag candidates** 🔨
a flag no template mentions gates logic, not pixels, which is how a shipped flag looks years later; one only templates mention is set somewhere the run cannot see. Both readings are marked.

**189. Two more date bugs** 🔨
Angular's lowercase digit order joins the uppercase pattern, and new Date(x * 1000) is named as the epoch seconds contract it is.

**190. Entity relations** 🔨
customerId on an order points at the customer entity; each edge carries the property that argues for it and the cardinality the name implies.

**191. The reload contract** 🔨
every localStorage and sessionStorage key the scripts touch is listed by name, because renaming one silently drops whatever the user's browser held.

**192. Unbound scope members** 🔨
a $scope assignment or observable no template binds and its own file barely uses joins the dead code report as the candidate it is.

**193. Verbs in paths** 🔨
POST /orders/deleteOrder is RPC wearing REST's clothes; each one is listed so nobody cleans it up into a path the server does not answer.

## Phase 19 · Outputs that carry more of the truth

*Thirteen emitter behaviors, from a parser fix to a self asserting story.*

**194. Entities decoded** 🔨
&quot; and its four siblings and the numeric forms decode where markup stores text, once and only once.

**195. Outputs become callbacks** 🔨
$emit in Vue and EventEmitter.emit in Angular both mean "call this component's output", and every target now receives that call as the prop it already had.

**196. The story that asserts itself** 🔨
the Empty story carries a play function that fails the moment the empty state renders nothing, in all three story shapes.

**197. The states suite** 🔨
tests/states.test.js reads the emitted components back and fails when one loses loading, error or the empty state; it needs no exploration and no server.

**198. The suite in the port's CI** 🔨
the emitted workflow runs the states suite, so the four states rule outlives portamp's involvement.

**199. The rejecting scenario** 🔨
msw gains rejecting(): every write refused as a validation failure, in the messages the original app was actually seen making.

**200. Cross screen references, everywhere** 🔨
a tag naming another screen in the run resolves in Vue by one import and in Svelte by a respelled tag, as it already did in react; an unmatched tag stays as written.

**201. Open items per cutover step** 🔨
each migration step counts the unverified notes that name its screen, so a step's remaining work has a number before its cutover.

**202. The contested reading as an ADR** 🔨
when the archetype is contested, the first decision record is the contest itself, because every record after it leans on the answer.

**203. Evidence in the W3C tokens** 🔨
the design tokens document carries the measurement trail in $extensions, the format's sanctioned pocket, so a design tool importing it keeps the provenance.

**204. Evidence in the tailwind config** 🔨
the config header says where each scale came from, so a value with no line there reads as the default it is, never as a measurement.

**205. Observed query strings, documented** 🔨
a query string written into a call site becomes a documented parameter, labeled as read from source and never observed live.

**206. Model modifiers round trip** 🔨
v-model.trim.number survives the trip back into Vue, the one target that can keep the exact spelling.

## Phase 20 · A bench with more controls

*Thirteen workbench and core affordances, none of which teach the core a name.*

**207. --skip** 🔨
the complement of --only: leave one plugin out without naming the other eighty.

**208. --dry-run** 🔨
every stage, every gate, every count, no files; the history and the console sidecar skip recording it, so no trace claims a run that wrote nothing.

**209. --offline** 🔨
outranks --allow-live and the attestation both; a CI run that must not reach the network says so once.

**210. --trace** 🔨
the run as a chrome trace, loadable in Perfetto, from the timings the kernel already kept.

**211. plugins --json** 🔨
the roster as data for tooling, and nothing else the core knows.

**212. A version command** 🔨
portamp version, from the package file, without loading a config to answer.

**213. init that will not clobber** 🔨
an existing config is somebody's edits; init refuses and says to move it aside.

**214. The history spells its movement** 🔨
a delta row per column, and dry runs are not recorded.

**215. Doctor reads versions and probes the disk** 🔨
each optional dependency's version, and a write probe against the out directory before a run spends a pipeline discovering it.

**216. Provenance in the console** 🔨
every written file listed with the plugin and stage that wrote it, from the record the kernel already kept.

**217. The source's own licence** 🔨
LICENSE files and SPDX headers are read and classified, because the port is a derivative of exactly that source; found or absent, the note says what follows.

**218. Watch names its trigger** 🔨
the debounce window collects the changed files and the rerun line names them.

**219. Attestations expire** 🔨
an expires date past due makes the attestation absent, with a week's warning before; a contractor's engagement ending is exactly the case.

## Phase 21 · Gates that hold and a corpus that grows

*Eight enforcements, each turning a described rule into a checked one.*

**220. Eight more credential shapes** 🔨
github, gitlab, stripe, npm and google tokens and any three segment signed JWT stop the run like the old shapes did.

**221. The emitted sweep** 🔨
every written file is read back for secret shapes before the run may pass; the second net for a value a plugin copied out of an artifact.

**222. The endpoint gate, widened** 🔨
Vue, Svelte and element outputs are checked like JSX; src/api stays the one tree where endpoints belong.

**223. Knockout joins the byte gate** 🔨
the same screen written in knockout emits the same bytes as its Angular and Vue spellings, through react, vue, svelte and the element.

**224. The newer targets join it too** 🔨
solid, alpine, the angular target and lit must not care which dialect wrote the input, asserted beside the founding four.

**225. Three more miniatures** 🔨
calendar, editor and selector-soup join the calibration corpus, so all eleven archetypes have a labelled example the classifier must agree with.

**226. The demo runs offline in CI** 🔨
proving no path in the pipeline reaches for a network when told not to.

**227. The ceiling holds in CI** 🔨
the example runs under --max-unverified, so the demo's honesty debt is bounded by a gate rather than described by a paragraph.


## Phase 22 · The console earns its knobs

*Twenty two enhancements to the workbench UI, each held by a test the suite runs.*

**228. The pure half, split out** 🔨
the console's logic moved into lib.js, one module the page imports and the suite imports too, so every knob below is enforced by node --test instead of trusted to a browser.

**229. Reports, listed** 🔨
/reports.json names the run's own root level markdown, the written list as the whitelist.

**230. Reports, rendered** 🔨
/report serves any report the run wrote as a themed page, everything escaped before the handful of shapes the reports use renders; a name outside the written list is refused.

**231. A reports face on the notes deck** 🔨
the run's reports, one click from the run they describe, each opening in its own tab.

**232. The notes deck, tabbed** 🔨
signals, files and reports share the deck as faces of one unit instead of overflowing the grid.

**233. A health line** 🔨
/healthz answers with whether the server is up and which run it holds — counts and a timestamp, nothing from the run's content.

**234. The poll pays for change only** 🔨
run.json carries an ETag and honors If-None-Match, so the five second poll costs a 304 while nothing moved, and the page sends the version it holds.

**235. The rows state** 🔨
the live preview gains rows beside empty, loading and error, from rows invented in the page and labeled as invented, so the body state renders without a byte of customer data.

**236. A favicon that is not a 404** 🔨
/favicon.ico serves the console's own icon instead of noise in the log.

**237. The selection lives in the hash** 🔨
the chosen screen and the lit stage write themselves into the URL and come back whole on reload, paste and hashchange alike.

**238. The day chassis** 🔨
the same hardware in pale plastic, a toggle and the t key, remembered per browser when storage allows and working when it does not; the LCD stays backlit so every readout keeps its contrast.

**239. A filter on every list** 🔨
screens, rack, endpoints and files each get the same case blind filter the unverified panel already had, from one function in lib.js.

**240. Verb facets on the endpoints** 🔨
one chip per method, composing with the text filter.

**241. The rack, by cost** 🔨
a second order for the rack putting the expensive plugin first, as a copy — the run's own order is nobody's to reorder.

**242. Any written text file, in the pane** 🔨
a text file's name in the files face is a button; the pane shows what was actually written, highlighted where it is code.

**243. Copy, where source shows** 🔨
every source view carries the one action source deserves, with a spoken fallback when the clipboard is closed.

**244. The keymap as one decision** 🔨
j/k, 1–5 and 0 for stages, [ and ] for the wipe, r to rerun, t for the chassis, ? for help — decided in lib.js where the suite reads it, and keys inside an input still belong to the input.

**245. The shortcuts card** 🔨
a dialog listing every key, on ? and the help key, closed by Esc.

**246. The trend as a line** 🔨
the unverified counts of the recorded runs as a sparkline beside the gauges, scaled in lib.js where the scaling is tested.

**247. The offline line** 🔨
when the wire drops, the console says it is showing the last run this browser saw — the cached run is still the truth, just not fresher than the wire — and the service worker shell carries lib.js under a new cache name.

**248. Reachable first** 🔨
a skip link for the keyboard, a live region on the readout so a finished run announces itself, and a noscript explanation instead of a blank deck.

**249. Printed, it is a report** 🔨
a print stylesheet flattens the chassis into the run report it always was; the transport, the wipe and the lamps stay on screen where they belong.


---

| | |
| --- | --- |
| shipped | 44 |
| new in this branch | 204 |
| planned | 1 |
| total | 249 |

The one still open is open for a stated reason, not for lack of time: npm
publish is one command that belongs to a person, with docs/PUBLISHING.md
waiting beside it. Four that were open closed in this branch: focus order once
the probe recorded positions, the calibration corpus at v0 with eight labelled
miniatures, the compare pane preview the moment it was noticed that the
dependency free element target never needed a build step, and the Vue reader
once structural scanning produced byte identical output to the regexes it
retired.
