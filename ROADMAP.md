# The roadmap, all of it

Five hundred features across fifty one phases. The statuses are
honest: ✅ shipped and under test, 🔨 new in this branch, ▢ planned. A planned
feature carries its phases where it is big enough to need them; nothing here
is a name invented to round out a number, and anything that turns out to be a
bad idea gets deleted rather than built.

The count that matters more: everything marked shipped or new runs today, under
564 tests, on Node 18, 20 and 22, and on Windows in CI.


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


## Phase 23 · Reading the old web

*Pages from the font era, read for exactly what they said.*

**250. Server blocks stripped and counted** 🔨
`<?php ?>`, `<? ?>` and `<% %>` are removed; what each one printed is a gap the note names, never a guess.

**251. Server pages are pages** 🔨
.php, .asp and .jsp files read as the HTML the server sent, with the plain .html ownership test untouched so ERB and underscore templates still go to their own readers.

**252. SSI includes, resolved as served** 🔨
`<!--#include virtual|file -->` resolves from the run's own tree, recursively with a depth guard; one the run does not hold is a named gap where it stood.

**253. The seven font sizes, exact** 🔨
`<font color size face>` lowers to a styled span using the pixel sizes browsers actually used; `<center>` becomes the centered block it meant.

**254. Motion dropped on purpose** 🔨
`<marquee>` and `<blink>` keep their text as a plain span; the note says the motion was a product decision then and putting it back is one now.

**255. The head, read for the port** 🔨
description, og properties, base href, charset and stylesheet links per page, because a single page app has to say them again or lose them.

**256. Meta refresh is a redirect** 🔨
a page that exists to bounce joins the redirect map instead of the screens, its target resolved the way the browser would have.

**257. The bytes as they were meant** 🔨
a page declaring iso-8859-1 or windows-1252 is re-decoded from its bytes, so the port does not inherit mojibake as content.

**258. Framesets read as layout** 🔨
each frame is a page of its own; the frameset's route points at its content frame, and the frame layout is the shell's to replace.

**259. Layout tables named** 🔨
a table with no header cell and enough plain cells reads as scaffolding, proposed for grid; the table stays until a person makes the cut.

**260. Imagemaps are navigation** 🔨
`<area>` hrefs with their alt text join the link graph, because somebody drew that menu on a picture on purpose.

**261. The asset inventory per page** 🔨
images, media and stylesheets a page renders from its own tree, collected with query strings and fragments shed.

**262. Links resolve like a browser** 🔨
relative paths, `..`, and `<base href>` resolve against the page's directory; a base pointing off the tree is refused and dead link detection judges the rest.

**263. Old addresses have routes** 🔨
extension dropped, index collapsed to its directory: every page's path maps to the route the site will serve it at.


## Phase 24 · The site assembled

*A folder of pages becomes one application model, honestly.*

**264. ctx.site, the contract** 🔨
pages with routes and heads, the link graph, the chrome, the redirects, pagination, frames and dead links — one model between the reader and the shell.

**265. Duplicate pages are one page** 🔨
byte identical bodies keep one screen; every other address redirects to it, and the note names the pair.

**266. Chrome lifted, not proposed** 🔨
with --site true the nav, header and footer blocks shared verbatim leave the pages and become the layout; without it the proposal note stands as before.

**267. Internal links become routes** 🔨
anchors and areas pointing at pages in the run are rewritten to the routes those pages got; everything else is left exactly alone.

**268. Every old address keeps working** 🔨
each page's .html path redirects to its route, because the address bar is half of the contract.

**269. Pagination proposed as a parameter** 🔨
news-1, news-2 read as one screen paged by filename; the parameterized route is proposed and the merge stays a person's call.

**270. The link graph with its truth** 🔨
nodes, edges, orphans reachable by address only, and dead links that dangle in the port exactly as they dangled on the old site.

**271. Form actions leave the markup** 🔨
an endpoint in a component is the exact thing the endpoint gate stops, so the action moves to the API map in every mode and the note names the wiring left.

**272. GET forms keep their spelling** 🔨
fields that travelled as a query string are reported so the port keeps that contract.

**273. The scan knows the old web** 🔨
the walk keeps .htm, .shtml, .php, .asp, .jsp, .inc and the asset formats, so includes and images are in the run instead of silently absent.

**274. The secret gate stays text wide** 🔨
binary formats skip the credential scan because decoded bytes invent matches; every text format, however obscure, still goes through the gate.

**275. Inline events are events** 🔨
onclick and its whole family become IR events with the `return` spellings stripped, so a 1998 button and a v-on button reach every target the same way.

**276. javascript: was never a location** 🔨
an href that ran code becomes the click handler it was, and the fake location is dropped.

**277. Presentation attributes keep their meaning** 🔨
bgcolor, align and valign carry their exact CSS into the IR; nothing else about the element changes.

**278. Statement lists survive the arrow** 🔨
a multi statement inline handler reaches react and svelte wrapped as a block instead of a syntax error.


## Phase 25 · The app shell

*output-site: the architecture around the components.*

**279. output-site, behind --site true** 🔨
the eighty fourth plugin; the core still does not know its name.

**280. A router with no dependency** 🔨
pushState, one document level click listener, nothing else; a folder of pages does not need a routing library.

**281. The matcher is pure and alone** 🔨
matchPath lives in its own module with no imports, so the emitted tests hold it to account without a browser in the room.

**282. Redirects resolve with a cycle guard** 🔨
a chain follows to its end; a cycle resolves to where it entered and is a data bug to fix, not a hang.

**283. Clicks intercepted honestly** 🔨
same origin, left button, no modifier, no target, no download — everything else passes by untouched.

**284. The hash still scrolls** 🔨
navigation with a fragment scrolls to its element, because in page anchors predate every framework.

**285. App.jsx, routes to components** 🔨
one route per page importing the component the run wrote, redirects resolved first, NotFound for the rest.

**286. The layout is where the bytes went** 🔨
Layout.jsx renders the lifted chrome around a semantic `<main>{children}</main>`.

**287. A page that throws takes its route** 🔨
ErrorBoundary holds the shell up, says so, and offers to try again.

**288. NotFound offers the map** 🔨
the route nobody claimed lists the navigation model instead of a dead end.

**289. The head reapplied per route** 🔨
title, description and og properties set on every navigation, created when missing, because a single page app forgets them otherwise.

**290. The navigation model, extracted** 🔨
nav.js holds the chrome's own links with pages nested under them by route, so a menu renders data instead of guesswork.

**291. The redirect map in three spellings** 🔨
redirects.json is the data; _redirects and the nginx block in SITE.md say the same thing to hosts that read those.

**292. Assets travel as bytes** 🔨
what a page renders is copied under public/ at the path the rewritten page expects; one the run does not hold is a named gap.

**293. An entry with no address** 🔨
index.html carries the stylesheets and the mount point; react's location is the bundler's business and no CDN URL is written on purpose.

**294. The port can be loaded** 🔨
a minimal package.json with type module is written when nothing else wrote one, so the emitted modules run under plain node.


## Phase 26 · Proof the shell holds

*The site engine is only real if a run proves it.*

**295. The emitted router tests itself** 🔨
tests/router.test.js lands in the port and runs under node --test: matching, parameters, query and hash, redirect chains, and the site's own map.

**296. SITE.md, the assembly report** 🔨
routes with their components and origins, redirects with the server spellings, orphans, dead links, frames and the pagination proposals.

**297. The site map as a graph** 🔨
SITE_MAP.mmd draws the pages, the links between them and the redirects into them, in mermaid where the diff shows changes.

**298. A route without a component is said** 🔨
verify reports every route whose component no target emitted, while the gap is cheap.

**299. The legacy site fixture, end to end** 🔨
example/legacy-site holds a frameset, a meta refresh, SSI, a form, a font era page, pagination and a dead link; npm run demo-site ports it, test/site.test.js asserts the whole architecture, and CI checks the emitted app parses and its tests pass.


## Phase 27 · The site engine grows

*Planned: from an app shell to a product port.*

**300. A Next.js target** 🔨
the same site model as an app directory: layout.jsx from the lifted chrome, one page per route importing the component the run emitted, redirects in next.config.mjs, and nothing ported twice.

**301. A Remix target** 🔨
routes as route modules, and every retired address a route module whose loader answers the real 301; the components stay the single source.

**302. Static export mode** 🔨
one HTML file per route, prerendered from the model, for sites that never needed hydration at all.

**303. .htaccess read for redirects** 🔨
RewriteRule and Redirect lines join the redirect map with their evidence.

**304. sitemap.xml and robots.txt** 🔨
written from the route table; disallowed paths carried from the original when one exists.

**305. Asset hashing** 🔨
content hashed filenames with every written reference rewritten, behind --hash-assets because URLs are a contract, and the note says which contract the flag knowingly changes.

**306. Layout tables performed** 🔨
the proposed grid conversion executed behind --perform-tables, the original markup kept beside each component for the diff, and a table with a header cell never touched.

**307. jQuery behavior hydrated** 🔨
the inventory input-jquery writes, matched by selector to each page's markup so a handler lands on the route that owned it; a behavior-manifest and a work list, never invented wiring.

**308. i18n routes** 🔨
/en/ and /de/ trees recognised as one site in two languages: the /:locale patterns and every page's siblings emitted as data, hreflang applied per navigation, and merging the trees left to a person.

**309. Breadcrumbs from the hierarchy** 🔨
the nav model's nesting as a breadcrumb component, data only.

**310. Scroll restoration** 🔨
back means where you were; a new route means the top; the hash still wins.

**311. Prefetch on intent** 🔨
under --split, pointing at an internal link starts its route module; the loaders are data so the router and the prefetch share one spelling.

**312. Canonical URLs carried** 🔨
rel=canonical read per page and reapplied per route.

**313. RSS and Atom feeds read** 🔨
a feed in the tree names the pages that are entries, matched to routes and carried as the site's own word about its families.

**314. Print stylesheets carried** 🔨
media=print links survive into the shell instead of being dropped.

**315. The favicon family** 🔨
the icons the pages declared, copied and linked from the entry.

**316. Redirect lint** 🔨
chains flattened, cycles failed, and a redirect into a dead link named for what it is.

**317. Query string routes** 🔨
page.php?id=3 families read as parameterized routes the way filename pagination already is.

**318. Per route code splitting** 🔨
lazy imports in App.jsx behind --split, because eight pages do not need it and eight hundred do; the loading state is a real state, not a blank.

**319. A service worker for the port** 🔨
offline for the ported site itself, opt in, with the same honesty the console's worker has: it caches exactly what the run wrote.

**320. Anchor text audit** 🔨
"click here" counted and named with its route, because link text is navigation for a screen reader.

**321. The 404 report** 🔨
--logs matches the old server's refusals against the port: redirected, a live route, a served asset, or uncovered with its demand counted, so the map grows from evidence.

**322. Float layouts proposed to flex** 🔨
the css reader names every rule that floats and sizes at once; performing the flex rewrite stays a person's call and CSS_STATS.md lists the evidence.

**323. Frames as split view** 🔨
a frameset that laid its panes side by side proposed as a split layout, the author's own cols= geometry carried as the evidence.

**324. The old web corpus** 🔨
labelled miniatures for php, ssi, frames, the font era and the modern web hold dsp-era to its dates the way the archetype corpus holds the classifier.


## Phase 28 · Deeper honesty, wider reach

*Planned: the long list, still in the order it pays off.*

**325. npm publish** ▢
one command that belongs to a person; docs/PUBLISHING.md waits beside it.

**326. Real labelled apps in the corpus** ▢
the archetype numbers mean more when the labels come from apps somebody shipped.

**327. A grammar for the template dialects** 🔨
the parser stamps every node with its line, the converter keeps a cursor, and the byte identical gates never noticed: positions are carried, not printed.

**328. Source positions in every note** 🔨
reader and printer notes alike begin with the line they came from; the file was already named, so a note now says exactly where.

**329. The IR round trips** 🔨
emit angular from the IR, read it back, assert the same IR; the strongest honesty test the middle can have.

**330. Slots across all nine targets** 🔨
a named slot with its fallback, spelled in Angular and in Vue, prints byte identical in every target; the one with no slot mechanism names the gap instead of inventing one.

**331. Two way binding in lit** 🔨
the lit target catches up: a multiple select reads its selected options and every literal option renders its membership in the model.

**332. A store reader** 🔨
Vuex, Pinia and NgRx shapes read from source with balanced braces: store names, state keys and action names, no reducer executed and no value reproduced, listed in STATE.md.

**333. WebSocket calls in the API map** 🔨
subscriptions read from source the way requests are: raw sockets, the rxjs wrapper and socket.io, described in API_CHANNELS.md with nothing about the messages invented.

**334. GraphQL operations read** 🔨
queries and mutations in source become named operations in src/api/operations.js, with the endpoint carried only when the source names it; the schema stays unclaimed.

**335. Auth flows described** 🔨
AUTH_FLOW.mmd draws only arrows the source proves — the token read, the header it rides in, the login call, the 401 reaction — each with the file that proves it, and no evidence means no diagram.

**336. Route guards carried** 🔨
canActivate and friends, and Vue's beforeEnter, read as route metadata in src/app/route-guards.js; what each guard checks is never reinvented, and the note says to wire them by hand.

**337. Recorded interactions replayed** 🔨
each recorded step with a selector becomes a replay step in tests/replay.spec.js; the suite reports drift per step, and a recorded input value is not reproduced.

**338. The parity pane diffs the DOM** 🔨
PARITY_STRUCTURE.md compares the recording's element list against each ported screen's IR by tag counts and named controls; a missing button is named, not scored.

**339. Accessibility gates, opt in** 🔨
--max-a11y N fails a run whose measured findings exceed the line, same shape as --max-unverified: a gate that only ever adds.

**340. The console compares runs** 🔨
the previous run.json is kept one generation, and the console holds two runs side by side: what moved, what got worse, which notes closed.

**341. A plugin author kit** 🔨
new-plugin scaffolds the whole kit: the plugin with the contract in its header, its test, docs in its own README, and a fixture directory the test runs against.

**342. Third party plugin discovery** 🔨
a project's plugins/ directory loads the way builtin ones do, documented in PLUGIN-API.md; a name clash never replaces a builtin and the refusal is said, not silent.

**343. Windows paths in every plugin** 🔨
test/windows.test.js gates it: every computed dynamic import goes through pathToFileURL, no fs path is glued from the output dir with a slash, and rel paths are normalized once.

**344. The CLI explains a failure** 🔨
a policy stop prints what evidence would clear it, not just what rule fired.

**345. Deterministic runs asserted** 🔨
two runs over the same tree byte identical, gated in CI, temp paths and timestamps excepted.

**346. The improve report ranks by cost** 🔨
findings ordered by the size of the emitted component each fix would touch, measured from the file on disk; a screen the run never emitted is listed last, unranked.

**347. Tokens from more than one recording** 🔨
several exploration*.json sessions merged: a rung every session found is agreed, a rung only some found is disputed with its count, and nothing averages two sessions into a number neither measured.

**348. The behavior report names races** 🔨
debounce, cancellation and teardown patterns named where they stand in RACES.md: each one is a bug somebody already fought, and the port keeps the pattern or reintroduces the bug.

**349. A migration ledger** 🔨
every decision the run made, machine readable, so a second run can be held to the first one's choices.


## Phase 29 · Full stack, and language that reads

*The port runs, the server refuses honestly, and the copy is measured the way
a tired reader meets it.*

**350. The port serves itself** 🔨
serve.js, zero dependencies: routes, assets, and dist/ picked up automatically once a bundler has run; one bad request never takes the server down.

**351. Old addresses answer 301** 🔨
the redirect map is served, not just written: every retired path answers with the real redirect it promised, query string carried.

**352. The API surface answers honestly** 🔨
a GET with an emitted fixture serves it marked as invented; everything else answers 501 naming src/api/endpoints.js. The server never makes data up.

**353. The server tests itself inside the port** 🔨
tests/server.test.js ships with the port and proves the routes, the 301s, the refusal, and that a path traversal folds back inside the root.

**354. The port has scripts** 🔨
npm run serve and npm test in the emitted package.json, so the port works like a project the moment it lands.

**355. Going is not calling** 🔨
the endpoint gate distinguishes navigation from use: an href, a Link or the route table may spell a path an API answers, a fetch or a bare string may not, and a path inside a hostname was never that path.

**356. Walls of text, measured** 🔨
a block past eighty words is named with its count; skimming drops sentences at random and a wall guarantees skimming.

**357. Abbreviations nobody expanded** 🔨
letters that recur and are never explained are counted, with the expansion beside them accepted in either order.

**358. The same action, many names** 🔨
primary actions collected across screens; three or more different names for the act of submitting is reported as the vocabulary it makes people learn.

**359. Lists longer than working memory** 🔨
a select past fifteen static options is measured; choosing became searching.

**360. The copy, summarized with its limits** 🔨
strings, words and a median reading grade, stated with the caveat that the formula was built for prose and is used here to rank, not to grade.

**361. The portal, proven** 🔨
example/legacy-portal, a fictional postal service portal with the shapes of the real ones: tracking and lookup forms into the API map, a data table kept as data, nested services under their section in the nav model, legalese and walls caught by the language audit, and the whole thing ported to a running full stack React app under test. The same engine was smoke tested against a real government developer portal's public pages, which is what surfaced 355.


## Phase 30 · The port grows senses

*Thirty seven at once: a search engine, road manners, machine tongues, identity
kept, evidence written down, and a server that speaks this decade's HTTP. All
of it held by one suite that reads what one run actually wrote.*

**362. A search engine inside the port** 🔨
rank(), pure and dependency free, ships in match.js; the port answers questions about itself with no service behind it.

**363. The index from the pages' own words** 🔨
search-index.js built at emit from each page's rendered text, so the engine can only find what the site actually says.

**364. An empty question gets an empty answer** 🔨
rank guards the degenerate cases instead of padding them; a blank query returns nothing, stated.

**365. Did you mean, measured** 🔨
nearestRoutes by edit distance; a close route is offered, a far one is silence rather than a guess.

**366. The port survives a subdirectory** 🔨
a base href in the entry and stripBase in the router; the same build serves at / and at /repo/ untouched.

**367. The scroll decision is pure** 🔨
decideScroll(hash, saved) returns hash, saved or top; provable on the bench without a browser.

**368. View transitions** 🔨
document.startViewTransition wraps navigation when the browser has it and costs nothing when it does not.

**369. A skip link and a main landmark** 🔨
the first tab stop jumps past the chrome; main carries the id and takes focus.

**370. Breadcrumbs performed** 🔨
the nav model's nesting as a real component: nav labelled Breadcrumb, the last crumb aria-current.

**371. Not found offers three ways out** 🔨
the guess, the search box, and the map of everything that exists; an empty result says so.

**372. feed.xml** 🔨
RSS 2.0 written from the route table, one item per page.

**373. llms.txt** 🔨
the site described for the machines that read prose: every route with an excerpt of its own words.

**374. humans.txt** 🔨
provenance for people who view source; the words and the palette stay the original site's.

**375. vercel.json** 🔨
the redirect map in that host's own spelling, permanent flags carried.

**376. netlify.toml** 🔨
the same map in a fifth spelling, beside _redirects and the nginx block.

**377. Reading time per route** 🔨
readingMinutes in the head table, counted from the page's words rather than guessed.

**378. A dark palette derived, not invented** 🔨
theme-dark.css behind prefers-color-scheme; lightness flips, hue never moves, the one rule dsp-uplift already keeps.

**379. Social cards from the page's own title** 🔨
an SVG card per page that declared no og:image; a page that brought its own keeps it.

**380. Print synthesized only when absent** 🔨
a site with its own print stylesheet keeps it; one without gets a minimal print-port.css and the notes say which happened.

**381. A security policy from evidence** 🔨
_headers carries a CSP of 'self' plus exactly the hosts the pages were seen to reach for, nothing speculative.

**382. SECURITY_HEADERS.md names the page** 🔨
every allowed host stands beside the page that reached for it, so the policy can be argued with.

**383. The site, weighed** 🔨
SITE_STATS.md: bytes per route, the heaviest named, totals that add up.

**384. The site, drawn** 🔨
SITE_MAP.svg renders the link graph as a picture with no library and no build.

**385. Every route carries its birth certificate** 🔨
sourceSha256 in LEDGER.json: the hash of the legacy bytes each route was ported from.

**386. A web app manifest, opt in** 🔨
--pwa writes manifest.webmanifest named from the site's own title; off is off, and the suite asserts the absence too.

**387. The era, read from the markup** 🔨
dsp-era, the eighty fifth plugin: seventeen dated signals from frameset to grid, a verdict carried with how many agreed.

**388. A site built across eras says so** 🔨
disagreeing signals are reported as spread in ERA.md rather than averaged into a fiction.

**389. Locale trees seen as facts** 🔨
twin top level trees holding the same paths are counted and named; parameterizing the routes stays 308.

**390. A ceiling for dead links** 🔨
--max-dead-links N fails the run past the line, same shape as --max-unverified; a gate that only ever adds.

**391. audit: the port against its ledger** 🔨
every route has its component, every redirect resolves, the sitemap is complete; a hole exits 1 and names itself.

**392. ETags** 🔨
a hash per file served; an unchanged file costs a 304 and no bytes.

**393. Cache headers with a memory** 🔨
markup never rests, assets rest an hour; the split is the rule, not a config.

**394. gzip where it pays** 🔨
text past a kilobyte, only when the client asked for it.

**395. /healthz** 🔨
ok, plus which tree is serving, so a deploy can be checked by a machine.

**396. The export outranks the raw tree** 🔨
dist/ over export/ over source, and the server says its mode instead of leaving it to be guessed.

**397. A clean goodbye** 🔨
SIGINT closes the server instead of dropping its connections.

**398. The export tests itself** 🔨
export.test.js ships inside the port and proves the prerendered pages answer at their routes.


## Phase 31 · Documents

*A data sheet shipped as PDF is legacy front end too. Read with no
dependencies, carried without invention, and turned into a routed React page
with the original kept as the document of record.*

**399. A PDF reader with no dependencies** 🔨
input-pdf, the eighty sixth plugin: objects by linear scan so broken files still read, Flate through node:zlib, and a later copy of an object wins the way incremental updates always meant.

**400. Text with its positions, honestly decoded** 🔨
ToUnicode CMaps and WinAnsi where they exist; a glyph with no text mapping is counted and dropped, never replaced with a lookalike.

**401. Headings from the sizes the document used** 🔨
body text is the size most characters are set in; anything measurably larger becomes h1, h2, h3 in order, with an anchor and a table of contents.

**402. Links carried from annotations** 🔨
URI annotations become a referenced addresses list on the page, spelled exactly as the document spelled them.

**403. The outline as the document's own claim** 🔨
bookmarks are read and reported beside the measured headings, because what a document says about its structure is evidence too.

**404. A sealed document refused by name** 🔨
an encrypted PDF yields nothing but the fact; guessing at a password is not a thing this tool does.

**405. Documents join the site** 🔨
with --site each PDF gets a route beside the pages, the old .pdf address answers with its 301, the search engine finds the document by its own words, and a route collision steps aside with a note.

**406. The original outranks the reading** 🔨
the PDF is copied into the port byte for byte and linked from its page; DOCS.md says what was read, what was declared, and what was skipped, filter by filter.


## Phase 32 · The playbooks

*The plugins measure; the skills carry the judgment the measurements leave
to a person, written down so it survives handoff.*

**407. adhd-brief, four layers deep** 🔨
reading the reader's state before answering, the answer shape, the work behind the reply, writing people must act on, and the rewrite recipe for every dsp-cognitive finding.

**408. plain-language** 🔨
the repairs for the words that ship inside a product: one verb per action, links that say where they go, walls broken at the topic turn, error messages that lead with the fix.

**409. site-port** 🔨
the folder of old pages playbook: the flags in the order they pay off, the redirect spelling each host reads, the deploy checklist, and the calls the engine leaves open.

**410. doc-port** 🔨
PDF documents carried honestly: what the reader proves versus skips, the scanned and encrypted cases, and when the original outranks the reading.

**411. port-audit** 🔨
whether a port ships, from the evidence it wrote about itself: the files in order, the audit command, the three checks only a person can do, severity without averaging.


## Phase 33 · Two more frameworks, and the port meets its witnesses

*The site model reaches Next and Remix, and the port is held against what
recorded it: the stores it declared, the sessions it was driven through, the
structure it showed, and the run before this one.*

**412. output-next** 🔨
the Next.js arrangement: layout.jsx from the lifted chrome, one page per route importing the emitted component, the flattened redirect map in next.config.mjs, head data on each page's metadata.

**413. output-remix** 🔨
the Remix arrangement: route modules for the pages, and a route module whose loader answers the real 301 for every retired address; flat route names escape a literal dot as [.].

**414. jQuery behavior by route** 🔨
the inventory matched by selector to each page's markup, written as src/app/behavior-manifest.js and a per route work list; a handler that matches no page is named, never guessed onto one.

**415. Stores read as shapes** 🔨
Vuex, Pinia and NgRx read from source with balanced braces; the state keys and action names are the app's contract with itself, and STATE.md answers each by name.

**416. Recordings replayed** 🔨
tests/replay.spec.js walks the recorded steps against the served port and reports drift per step; a step with no selector is counted, a recorded input value is not reproduced.

**417. Structure diffed** 🔨
PARITY_STRUCTURE.md holds the recording's element list against each ported screen's IR: tag counts and named controls, because a moved div explains a changed pixel and attributes the recording never carried are not compared.

**418. Runs compared** 🔨
the previous run.json survives one generation and the console puts two runs side by side: what moved, what got worse, which notes closed.

**419. The Windows audit, gated** 🔨
test/windows.test.js turns the platform assumptions into checks: every computed import through pathToFileURL, no fs path glued from the output dir, rel paths normalized at their one source.

**420. Tokens across recordings** 🔨
several sessions merged with the disagreement kept: agreement measured, a disputed rung reported with its count, nothing averaged into a rung neither session found.


## Phase 34 · 5.0 · The port stops repeating itself

*A block of markup three pages carried verbatim becomes one shared component
the pages compose from. Framework blind by construction: the extraction adds
a component to the run and rewrites the pages to name it, and every target
resolves that name for free.*

**421. dsp-components finds the repeats** 🔨
block level fragments that recur verbatim across two or more screens, found by counting each tag's opens and closes so a nested block never ends its parent early, grouped by their normalized form with every occurrence's real position kept.

**422. Static is performed, dynamic is proposed** 🔨
a repeat that binds, interpolates or handles reads screen local state a shared component would not have, so it is named in COMPONENTS.md and never lifted; only a block that recurs byte for byte and carries no dynamic markup is safe to perform, and parameterizing the rest stays a person's call.

**423. --components lifts the safe blocks** 🔨
each shared static block becomes a component screen added to the run, and every page that held it is rewritten to name it; because output-react already resolves a tag naming another screen to that component, React, Vue, Svelte and the custom element all compose the shared component with nothing target specific added.

**424. Nested repeats collapse to the largest** 🔨
a block that only ever appears inside a larger shared block is not an independent component; it is dropped so the report proposes the whole card, not the card and its paragraph, and the rewrite replaces the largest non overlapping regions only.

**425. The extraction is deterministic** 🔨
candidates are ranked largest first then by the fragment itself and named from their own words when they have any, so two runs over the same input write byte identical components and byte identical rewrites, held by the determinism gate.

**426. COMPONENTS.md is the catalog** 🔨
written whether or not the flag is set, because knowing the repeats exist is worth as much as removing them: every extractable block with the screens that share it, and every proposed one with why it could not be lifted.


## Phase 35 · 5.1 · The shared component learns what varies

*dsp-components lifts a block that recurs byte for byte. The commoner repeat
is not byte identical: two cards, two rows, the same shape with different
words. dsp-props finds those and proposes one component with a prop for each
slot that changed, and never lifts, because deciding what may vary is the
product's call.*

**427. dsp-props finds the structural twins** 🔨
a block reduced to its skeleton, the markup with every text and attribute value blanked to a marker, so two fragments with the same tags and attribute names read as the same shape however their content differs.

**428. The varying slots become the props** 🔨
across the copies of one shape, a slot whose value is the same everywhere is constant and a slot that changes is a prop, named from the attribute it fills or a word from the copy, with the values actually observed carried beside it.

**429. A byte identical shape is left to dsp-components** 🔨
a shape whose every slot agrees on every screen is an exact repeat, not a parameterized one, so it is dropped here rather than proposed twice, and nested shapes collapse to the largest the same way the exact repeats do.

**430. PROPS.md proposes, never performs** 🔨
the parameterized components are named in PROPS.md with their props and evidence and nothing is emitted from them: which slots are allowed to vary is a decision about the product, so the tool measures the shape and leaves the call to a person.


## Phase 36 · 5.2 · Two more of the old web

*Polymer and Riot read into the one screen shape. Each had its own binding
spelling and none of it survives into the target; it lowers onto the
AngularJS attribute dialect the rest of the tool already reads, so the
translator, the endpoint map and every emitter treat a Polymer element and a
Riot tag exactly as they treat an Angular component.*

**431. input-polymer reads a dom-module** 🔨
the `<dom-module id>` and its inner `<template>` become a screen, its declared `properties` become inputs, `fire`/`dispatchEvent` names become outputs, and `<iron-ajax>` urls and `fetch` calls join the endpoint map.

**432. Polymer bindings lowered** 🔨
`[[x]]` one way and `{{x}}` two way become interpolation and, on a form control, a model; `on-event` becomes the dialect's event calling the method; `<template is="dom-if">` and `<template is="dom-repeat">` become ng-container conditionals and loops, and a two way binding with no honest equivalent is said, not faked.

**433. input-riot reads a tag** 🔨
a `.riot` or `.tag` file's root custom tag becomes a screen, `opts` and `this.props` reads become inputs, `this.trigger` names become outputs, and its `<script>` and `<style>` are set aside from the markup.

**434. Riot bindings lowered** 🔨
`{ expr }` becomes interpolation without doubling an already converted brace, `each={ x in xs }` becomes a loop, `if`/`show`/`hide` become the conditional directives, and `on<event>={ handler }` becomes the dialect's event.

**435. Both land on the dialect, framework blind** 🔨
the lowered markup is read by detectDialect as AngularJS and travels the unchanged pipeline; a Polymer element and a Riot tag each port to React, Vue and Svelte with no printer taught either framework's name, the same claim the Angular and Vue readers make.

**436. The gaps are named, never guessed** 🔨
a delimiter a person changed, an event with no dialect equivalent, a structural template left open, or an expression the reader cannot place is reported through ctx.unverified rather than lowered into something that only looks right.


## Phase 37 · 5.3 · Two more targets, two ways to reach them

*Qwik and Astro, added without a printer either taught the reader anything.
Qwik renders the proven JSX with its own two rules respected; Astro does not
translate a screen twice but composes the React component the run already
emitted, as an island.*

**437. output-qwik renders the proven JSX** 🔨
the same JSX the React printer proves against the other targets, reused whole, because Qwik renders JSX; the printer touches only what Qwik requires and nothing upstream learned its name.

**438. Qwik's two constraints, respected** 🔨
every handler prop carries the `$` the optimizer splits it out by, and local state is a `useSignal` read through `.value` with a plain setter the handler calls, so the output runs rather than merely looking like React.

**439. output-astro composes an island** 🔨
each screen becomes an `.astro` page that imports the emitted React component and hydrates it with `client:load`, the honest Astro port of a screen with client state: the static shell is served and the component keeps every state it already had.

**440. Astro translates nothing twice** 🔨
because the island imports the component rather than rewriting the screen into Astro's own dialect, no handler is dropped to a second translation and the port stays one source; the run notes that Astro's React integration is needed and says how to add it.


## Phase 38 · 5.4 · What the old page told machines

*A screenshot shows what a person sees. It does not show the title a search
result prints, the canonical that resolves a duplicate, the language a screen
reader announces, or the trackers loading in the head. A port that forgets
these loses ranking, identity and a consent decision, all invisibly. dsp-seo
and dsp-analytics read them and report them.*

**441. dsp-seo reads the machine facing signals** 🔨
per page: the title and its length, the meta description, the canonical link, the robots directive, the html lang, the viewport, the Open Graph and Twitter card counts, and the structured data types, read from the markup and never invented.

**442. The SEO gaps are named** 🔨
a missing or overlong title or description, no canonical, no lang, no viewport, no or several h1, and a skipped heading level are each reported as a gap the port should close on purpose; a page with no description is reported with none rather than given one nobody wrote.

**443. dsp-analytics names the trackers** 🔨
the tracking vendors the source loaded, recognised by signature across fifteen of them, from Google Analytics and Tag Manager to Facebook, Segment, Hotjar, Adobe, Matomo and the privacy friendly ones, with where each was seen.

**444. Re-adding a tracker is a decision, not a default** 🔨
none is carried into the output and each is reported as a consent decision a person makes on purpose, especially under a regime that may not have existed when the markup was written; the identifier a tag carries is shown by its prefix only, the same caution the secret gate keeps.


## Phase 39 · 6.0 · portamp reads what it writes

*Every reader lowers a legacy dialect onto the IR. 6.0 adds the one that
reads React, the language portamp most often emits, and closes the loop: a
React front end becomes a source the tool can port onward, and the emitted
React can be read back and checked against what it came from. The claim that
the port keeps the shape it was given stops being a claim and becomes a
comparison that fails out loud.*

**445. input-react lowers JSX onto the dialect** 🔨
a React function component's props become inputs, its `on*` props become outputs, and its JSX return is lowered onto the same AngularJS dialect every other reader targets, so a React screen reaches the translator, the endpoint map and every emitter as any other does.

**446. The JSX shapes with an inverse are reversed** 🔨
`{cond && (<x/>)}` becomes a conditional, `{list.map((item) => <x/>)}` a loop, `{expr}` in text an interpolation, an input with value and onChange a model, an event prop an event, and className a class; a ternary or anything with no clean inverse is left as written and named, never guessed.

**447. vis-roundtrip reads the port back** 🔨
each screen's template is emitted to React by output-react and read back by input-react, and the structure that returns is compared to the structure that went in: the elements, the conditionals, the loops, the models and the set of tags.

**448. A drift fails out loud** 🔨
where the round trip returns the same structure the round trip held and the port provably kept its shape; where it does not, ROUNDTRIP.md names the drift per screen and the run reports it, rather than trusting the emit and the read to agree.

**449. Whitespace is not drift** 🔨
emitting to JSX and reading back re-splits text around interpolations and indentation, so text node count is excluded from the comparison and only the structure that must survive is held, which is the difference between a check that means something and one that always fails.

**450. The loop closes both ways** 🔨
because React lowers onto the IR like any dialect, a React app is now a source portamp ports to Vue, Svelte or a custom element, and the same machinery that proves Angular and Vue emit identical output proves the emitted React reads back to where it started.


## Phase 40 · 6.1 · The asset weight the port should not inherit

*A legacy page ships one fixed size of every image and declares its type in
formats no browser has needed in a decade. None of that is a taste question,
so dsp-images and dsp-fonts measure it and propose the port carry it lighter,
leaving the encoding a person's call.*

**451. dsp-images weighs every image** 🔨
each `<img>` is read for a srcset, a sizes hint, a loading attribute, explicit width and height, an alt, and its format, and what is missing is named per image so a small screen stops downloading the desktop image and the page stops reflowing when one arrives.

**452. The image proposals are named, not applied** 🔨
which srcset to generate and which modern format to encode are build decisions the port's own tooling should own, so IMAGES.md proposes them and rewrites no tag, the same measure then leave it contract the rest of the tool keeps.

**453. dsp-fonts reads how the type loads** 🔨
each `@font-face` is read for its formats and its font-display, hosted Google Fonts links are noted, and the font files actually in the tree are counted, so a face missing its woff2 is told apart from one whose file simply was not shipped.

**454. The font gaps are measurable, not taste** 🔨
a face with no woff2, one declared in eot, svg or ttf that no target needs, and font-display left unset so text is invisible while the font loads are each reported; whether a licence lets a face travel stays general-license's job, and this is about weight and the flash of invisible text.


## Phase 41 · 6.2 · The modes the old app forgot

*Three things a page built before they mattered leaves out: a way to still
its motion, the print styles it once had, and a question before it set a
cookie. dsp-motion, dsp-print and dsp-cookies find each and report it.*

**455. dsp-motion counts the movement** 🔨
the keyframes, animations, transitions and smooth scrolling a stylesheet declares are counted, and whether any `prefers-reduced-motion: reduce` block stills them is reported, because motion nobody can turn off is nausea or a seizure risk for the people who ask.

**456. The reduced-motion fix is named** 🔨
where no reduced-motion block exists MOTION.md prints the one media query that honours the request, because the fix is small and the omission is invisible until it hurts someone.

**457. dsp-print reads the print styles** 🔨
every `@media print` block is read with its balanced body, its rule count and whether it hides the chrome, and print stylesheet links are counted, so a feature that printed an invoice cleanly for a decade is carried across rather than silently regressed.

**458. Print styles are identity, not invention** 🔨
PRINT.md reports the rules to carry into the port's own stylesheet under the same query; the rules that hide the chrome and drop the background are the ones that make a page printable, and losing them is the regression the report exists to catch.

**459. dsp-cookies names what the client set** 🔨
every `document.cookie` write and every js-cookie or jquery.cookie call is read for its cookie name, and the consent mechanism in play, if any, is recognised across six of them, so a cookie set without a question is visible.

**460. A cookie is a decision with a legal shadow** 🔨
a tracking cookie set before consent is a violation the port would inherit, so each is reported as a decision to carry forward on purpose; the cookie's value is never printed, the same caution the secret gate keeps.


## Phase 42 · 6.3 · The meta-frameworks for Vue and Svelte

*output-next and output-remix arranged the site model for React. 6.3 does the
same for the other two targets: Nuxt for the emitted Vue, SvelteKit for the
emitted Svelte, each importing the components the run already produced and
carrying the redirect map in its own host's spelling.*

**461. output-nuxt arranges a Nuxt app** 🔨
`app.vue` carries the lifted chrome, one file per route under `pages/` imports the Vue component the run emitted and rides its head data through `useHead`, and nothing is ported twice: the components under src/features are the single source.

**462. Nuxt carries the redirect map as routeRules** 🔨
the flattened redirect map lands in `nuxt.config.ts` as `routeRules` with a 301 per retired address, the same map every other target carries, and the run asks for --vue when the components the pages import are not there.

**463. output-sveltekit arranges a SvelteKit app** 🔨
`+layout.svelte` carries the chrome, one `+page.svelte` per route imports the Svelte component the run emitted and rides its head data through `<svelte:head>`, importing rather than copying so a fix lands once.

**464. SvelteKit answers old addresses from the server hook** 🔨
the redirect map lands in `src/hooks.server.js`, where SvelteKit throws a 301 for a retired address, because SvelteKit has no config redirect table and the hook is where that decision belongs; the run asks for --svelte when the components are not there.


## Phase 43 · 6.4 · The port measured whole

*A hundred plugins measure a piece each; two more measure the whole. general-size
weighs what the port ships and holds it to a budget the run enforces, and
vis-graph draws the architecture the reports describe in prose as one picture.*

**465. general-size weighs the port** 🔨
what the run wrote, by kind, reading the bytes on disk: components, the api client, tokens and styles, the host arrangement, each with its share; reports and tests are excluded because they do not ship and their volatile files would make the total non deterministic.

**466. --max-kb is the budget the run enforces** 🔨
the component code over the ceiling fails the run, the same shape as the unverified ceiling, so a migration cannot quietly trade a small legacy bundle for a large modern one; the number to watch is the component share, and --components is the cheapest weight a port can lose.

**467. vis-graph draws the shape** 🔨
every screen, a solid arrow where one screen's template names another (the same reference every target resolves to a child component), and a dotted arrow where an endpoint call was recorded from a screen's own file, emitted as a Mermaid flowchart in GRAPH.md that renders where the reports are read.

**468. The graph is the run's own facts, not a guess** 🔨
a composition edge is a tag that exists in a template and an endpoint edge is a call the reader attributed to a screen; a call it could not place is in the endpoint map, not invented onto an arrow, the same measure don't guess contract every plugin keeps.


## Phase 44 · 6.5 · The port defended

*A migration is a chance to close the holes the old markup carried, but only
if someone can see them. dsp-security names the sharp edges in the source and
dsp-supplychain names the third party code it trusts, both proposing the fix
and performing none, because how an app handles events or trusts a dependency
is a decision with consequences.*

**469. dsp-security names the sharp edges** 🔨
inline event handlers a CSP would forbid, eval, a direct innerHTML or dangerouslySetInnerHTML write, document.write, a target=_blank link with no rel=noopener, and a full page shipping no Content Security Policy, each read from the markup and the scripts.

**470. Security findings withhold their values** 🔨
a finding carries only its kind and a structural detail, an attribute name or an href, never the user data or the evaluated string, the same caution the secret gate keeps; each kind is proposed a concrete fix and none is performed.

**471. dsp-supplychain inventories the third party code** 🔨
every external `<script>` and stylesheet loaded from a host the team does not control, with its host and whether it carries a Subresource Integrity hash, de-duplicated across pages with the safe spelling winning.

**472. A dependency without a hash is flagged** 🔨
a CDN script with no integrity can be swapped under the app and run unchallenged, so SUPPLYCHAIN.md names each unpinned dependency and proposes self hosting or an integrity attribute with crossorigin; adopting either is a decision about how the port trusts its dependencies, made on purpose.


## Phase 45 · 7.0 · The port's home

*The site engine already writes a full application and a zero dependency
serve.js beside it. 7.0 gives that port somewhere to run: a container that
wraps the server, and an nginx block that serves the static export with the
same 301s the app enforces. Both compose what the run produced and invent no
build the port does not have.*

**473. output-dockerfile containerizes the port** 🔨
a Dockerfile that wraps the zero dependency serve.js, with no npm install because the port has no runtime dependencies and no build, an EXPOSE and a PORT env matching serve.js's default, and a HEALTHCHECK hitting the /healthz the server already answers; a .dockerignore, a compose file and a deploy README ride beside it.

**474. The image serves exactly what serve.js serves** 🔨
the container runs `node serve.js`, so what it answers is what `npm run serve` answers, redirects and all; the plugin invents no bundler or framework the port does not use, and the Dockerfile says where the absent npm install would have gone.

**475. output-nginx serves the export with its 301s** 🔨
an nginx server block that serves the prerendered static export, answers every retired address with a `return 301` from the flattened redirect map, and falls a client route through to index.html, the same map every other host target carries and no redirect invented.

**476. The deployment targets are gated and honest** 🔨
each writes nothing without its flag and nothing without a site model, and each names in a README what it needs (a folder of pages through --site, the static export through --export) rather than producing a config that only looks deployable.


## Phase 46 · 7.1 · The port cleaned

*A legacy front end carries debug output it forgot to strip and hooks it hung
on the global object. A module port silences the first and has to contain the
second. dsp-console and dsp-globals find both, and report rather than delete,
because which log is load bearing and which global other code still reads is
a person's call.*

**477. dsp-console finds the debug output** 🔨
every `console.<method>` call and every `debugger` statement left in the scripts, with the method and its line, and never the arguments, because a value logged may be one a port should not reprint; shipped to production they leak internal detail to anyone with a console open.

**478. The console debt is grouped, not deleted** 🔨
CONSOLE.md lists the calls per file so a person can strip them or gate them behind a debug flag, because a warn that a user relies on and a stray log look the same to a regex and only a person knows which is which.

**479. dsp-globals finds what the app publishes** 🔨
`window.NAME =` assignments, `$.fn.NAME` jQuery plugins, and column zero script scope `var` and `function` declarations, each the app reaching the global object in a way a module port isolates away; the name and line are kept, the value is not.

**480. The globals must be contained, not lost** 🔨
GLOBALS.md names each so the port can turn a window assignment into an export or a small namespace, keep the jQuery a plugin needs or drop it on purpose, and move a script scope global into a module, rather than silently losing a hook other code depended on.


## Phase 47 · 7.2 · The typed and tested port

*The port emits JSX and a running site; 7.2 gives it a type surface and an end
to end suite, both built from what the run already knows and neither claiming
more than it can prove.*

**481. output-types writes a prop surface** 🔨
one TypeScript interface per screen, each input a prop typed `unknown` because the reader knows the name and not the type, each output a handler, and the loading, error and retry every component takes, written to a types folder beside the components they describe without changing the emitted JSX.

**482. unknown is honest, not any** 🔨
a prop the reader could not prove a type for is `unknown`, which forces a check at the boundary, rather than `any`, which waves the check away; the file says so, so nobody reads the gap as a guarantee.

**483. The endpoint paths become a union** 🔨
the de-duplicated set of paths the app calls is a string literal `ApiPath` union and the methods an `ApiMethod` union, so a call to an address the port never saw is a type error rather than a runtime surprise.

**484. output-cypress walks the routes** 🔨
one end to end spec visits every route of the ported site and asserts the page mounted, another visits each retired address and asserts the browser lands on the new path, run against the port's own serve.js with a baseUrl that matches; the routes and redirects come from the site model and none is invented.


## Phase 48 · 7.3 · The accessible port

*dsp-a11y already measures contrast and target size over the palette the port
will use. 7.3 reads the structure a screen reader navigates: the landmarks a
user jumps between and the form controls a page left with no name. Both
report, because adding a landmark or naming a control is a change to the
markup a person should make on purpose.*

**485. dsp-landmarks reads the region structure** 🔨
per page, the main, nav, header, footer, aside, search and form landmarks present by element or role, and the gaps a screen reader user feels: no main to skip into, more than one main, no navigation landmark, no skip link to jump the chrome.

**486. A page with no main is one you cannot skip into** 🔨
LANDMARKS.md names the landmarks each page has and the ones it lacks, because a user navigating by landmark treats a page with none as a single undifferentiated blob, and a port that rebuilds the markup is the moment to give it the regions it never had.

**487. dsp-labels finds the controls with no name** 🔨
each input, select and textarea that has no `<label for>`, no aria-label or aria-labelledby, no title and no wrapping label, because a control a screen reader announces only as edit text is one nobody relying on it can fill; a placeholder disappears on focus and is not a label.

**488. The unlabelled controls are named, not renamed** 🔨
LABELS.md lists each control by file and line so a person can add the label, the aria-label or the wrapping element, because which name a control should carry is copy a screen wrote for sighted users and a tool cannot invent it.


## Phase 49 · 8.0 · The port's first paint

*A browser stops building the page while it fetches and runs a blocking
resource, and a legacy page carries style and script inline where it can be
neither themed nor allowed by a strict policy. dsp-render-blocking and
dsp-inline name both, because a port is the moment to unblock the paint and
lift the inline out.*

**489. dsp-render-blocking finds what delays first paint** 🔨
a synchronous script in the head with neither async nor defer, a stylesheet the head blocks on, and a CSS `@import` that serializes the fetch, each read from the markup with its source and line and the parser it stalls.

**490. Each blocker is proposed the unblock** 🔨
RENDER.md names a head script that should take async or defer or move to the end of the body, a stylesheet that could be inlined critical or loaded without blocking, and an @import that should be a link or a bundler concat, because the fix is known and the port is the moment to make it.

**491. dsp-inline inventories the inline style and script** 🔨
the elements carrying a `style` attribute, counted per tag, the `<style>` blocks, and the inline `<script>` blocks with no src, each read as a count and never a captured body or value, because an inline style cannot be themed and inline style and script are what a strict CSP forbids.

**492. Lifting the inline out is a theming and a security win** 🔨
INLINE.md names the totals per page so the port can move a style attribute into the design tokens it already emits and an inline block into a stylesheet or a module, closing a theming gap and a Content Security Policy gap at once.

## Phase 50: the port's shape read

**493. dsp-complexity finds the functions grown too tangled to port** 🔨
each function whose body runs past forty lines, nests four deep, or carries ten branches is measured from the source text and named in COMPLEXITY.md, worst first, because a tangle carried across the port unchanged is a tangle nobody chose to keep.

**494. The complexity numbers say plainly they are an approximation** 🔨
length, nesting depth and a rough branch count are a text based reading, not a compiler's metric, and the report says so, so a person straightens the functions on the evidence rather than on a false precision.

**495. dsp-magic finds the numbers and strings with no name** 🔨
a threshold like `4999`, a rate like `0.075`, a status like `PENDING_REVIEW` buried in the logic is a value nobody can grep to change, and MAGIC.md names each per file so the port can lift it into a named constant, an enum, or a config key.

**496. dsp-magic stays out of the secret gate's territory** 🔨
it skips trivial numbers, array indexes and already named const assignments, and never captures a credential shaped string, because the magic it reports is a maintainability finding and the secret gate owns the other kind.

## Phase 51: the port's connections read

**497. dsp-imports reads the module dependency graph** 🔨
each `import`, `require` and re-export is read from the source and the relative specifiers are resolved to the files they name, so IMPORTS.md draws what depends on what across the port before a line of it moves.

**498. dsp-imports names the import cycles a port should break** 🔨
two or more modules that import each other are found by a depth first walk of the graph and named as a cycle, because a cycle is a maintainability hazard that outlives a framework and the port is the moment to break it.

**499. dsp-async finds the callback pyramids buried in the logic** 🔨
a function passed as an argument three or more callbacks deep is the pyramid of doom a legacy app wrote before async/await was common, and ASYNC.md names where each one deepens so the port can straighten it.

**500. dsp-async finds the long promise chains too, and straightens nothing** 🔨
a run of three or more `.then` links reads more clearly as a sequence of awaits, and the report names the chains and the pyramids alike as an approximation from the source text, rewriting no control flow, because how an app sequences its work is the port owner's call.


---

| | |
| --- | --- |
| shipped | 44 |
| new in this branch | 453 |
| planned | 3 |
| total | 500 |

The three open are open for stated reasons, not for lack of time: npm
publish is the one command that belongs to a person, with docs/PUBLISHING.md
waiting beside it, and it appears twice; the calibration corpus grows only
when apps somebody actually shipped can be labelled. Everything else is
built.
5.0 is the port that stops repeating itself: a block three pages carried
verbatim becomes one shared component every target composes from, extracted
framework blind and proposed where a binding would have to become a prop.
3.1 closed nine more — the Next and Remix targets on the site model, the
jQuery inventory landed per route, the store reader, recorded sessions
replayed, the parity structure diff, the console comparing runs, the
Windows audit as a gate, and tokens merged across recordings.
3.0 closed twelve in one batch — the grammar with its positions, slots
everywhere, lit's models, channels, GraphQL, auth flows, guards, races, the
ranked improve report, and the author kit with project plugin discovery.
Seventeen that were open closed in this branch: focus order once the probe
recorded positions, the calibration corpus at v0, the compare pane preview,
the Vue reader once structural scanning matched the regexes it retired byte
for byte, scroll restoration and the port's service worker with phase 30,
and eleven of the site engine's planned entries in one growth batch: asset
hashing, performed tables, locale routes, prefetch, feeds read, code
splitting, the 404 report, floats named, frames proposed, the era corpus,
and the accessibility ceiling.
