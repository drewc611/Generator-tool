# The roadmap, all of it

Six hundred and eighty one features across one hundred and eighty four phases. The statuses are
honest: ✅ shipped and under test, 🔨 new in this branch, ▢ planned. A planned
feature carries its phases where it is big enough to need them; nothing here
is a name invented to round out a number, and anything that turns out to be a
bad idea gets deleted rather than built.

The count that matters more: everything marked shipped or new runs today, under
1100 tests, on Node 18, 20 and 22, and on Windows in CI.


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

## Phase 52: the transformer, in both senses

**501. vis-transformer runs a real transformer forward pass in pure JavaScript** 🔨
token embeddings, sinusoidal positions, multi head scaled dot product self attention, softmax, residual and layernorm, and a feed forward block, all in plain arithmetic with no dependency, so the plugin host loads a transformer the same way it loads everything else and the core still does not know what it is.

**502. The transformer's math is proven, and it predicts nothing** 🔨
the softmax, the layernorm and the attention are held to known answer values by test, the weights are seeded so two runs are byte identical, and the input is a fixed declared sequence, because an untrained forward pass is a demonstration of the mechanism and never a claim about the port; ATTENTION.md draws the attention and says so.

**503. output-codemod is the other transformer, one that only moves what it can prove** 🔨
a mechanical rewrite of CommonJS to ES modules, performing the default require, the destructured require, the default export and the named export where the form is unambiguous, and writing the transformed file beside the report rather than mutating the source.

**504. The codemod refuses what it cannot prove, out loud** 🔨
a dynamic `require`, an inline `require`, a multi line `module.exports` or a duplicate export is left verbatim and named in CODEMOD.md as a construct a person must lift by hand, because a wrong rewrite that looks right is exactly the failure this tool exists to avoid.

## Phase 53: the port knows the cloud

**505. output-aws turns the site model into an AWS deploy plan** 🔨
the prerendered static export becomes an S3 bucket behind a CloudFront distribution, emitted as a Terraform configuration the user reviews and applies, so the port that already serves itself now knows how to host itself on somebody's account.

**506. The redirect map is compiled to a CloudFront function** 🔨
every retired address the run flattened becomes an entry in a frozen lookup table inside a viewer request function that answers a real 301, because a static host that forgets the old URLs breaks every link the port promised to keep.

**507. The deploy plan takes no credentials, and says so** 🔨
the deploy script uses the user's own `aws` CLI configuration and reads the bucket and distribution from the environment, portamp emits a plan and applies nothing and never touches a key, because taking a credential is exactly what the secret gate refuses.

**508. output-aws names what a plan cannot know** 🔨
DNS, certificates and the account's own specifics are named in the plan's README as the user's to fill in rather than guessed, because an infrastructure value invented to look complete is the failure this tool exists to avoid.

## Phase 54: the port knows the other clouds

**509. output-gcp emits a Google Cloud deploy plan** 🔨
the static export becomes a Cloud Storage bucket behind an external HTTPS load balancer with Cloud CDN, as Terraform the user applies, so the same site model that knew AWS now knows Google Cloud.

**510. output-gcp carries the redirects in the URL map** 🔨
every retired address becomes a URL map redirect rule answering a 301, the same flattened map every other host target carries, because a static host that forgets the old links breaks what the port promised to keep.

**511. output-gcp takes no credentials and names its gaps** 🔨
the deploy script uses the user's own `gcloud` and `gsutil` configuration, portamp applies nothing and touches no key, and DNS, the managed certificate and the project's specifics are named in the README as the user's to fill in.

**512. output-azure emits a Microsoft Azure deploy plan** 🔨
the static export becomes a Storage account static website behind Azure Front Door, as Terraform the user applies, so the third major cloud reads from the same site model with nothing about the port reinvented.

**513. output-azure carries the redirects in the Front Door rules engine** 🔨
each retired address becomes a Front Door rule matching the path and issuing a 301 to the new one, the flattened redirect map once more, so a move to Azure keeps every old address answering.

**514. output-azure takes no credentials and names its gaps** 🔨
the deploy script uses the user's own `az` login, no account key or connection string is ever emitted, and DNS, the certificate and the subscription's specifics are named in the README rather than guessed.

## Phase 55: the transformer learns

**515. vis-transformer trains by hand written backpropagation** 🔨
a cross entropy loss, a backward pass through the differentiable block (embedding, one head of self attention with its residual, a two layer perceptron with a ReLU and its residual, an output projection), and gradient descent, all in plain arithmetic with no dependency, so the transformer that only ran forward now learns.

**516. The gradients are proven correct by a numerical check** 🔨
the analytic gradient of each sampled parameter is compared to the finite difference `(L(θ+ε) − L(θ−ε)) / 2ε` and the maximum relative error is held under a thousandth by test, because a training loop with a wrong gradient descends toward the wrong answer while looking like it works, and that silent wrong answer is the failure this tool refuses.

**517. The trained model reaches the answer, and the run proves it** 🔨
training overfits one fixed next token sequence to completion, the loss falls from about two to under a thousandth and every position's top logit becomes its target, deterministically from a seed, so TRAINING.md is a comparison that fails out loud rather than a claim; it learns to continue port into the legacy app into react.

**518. The training says plainly what it is** 🔨
it overfits one example on purpose to demonstrate the loop is correct, the trainable block leaves out layer norm so every gradient is exactly checkable, and the report states it is a proof of the mechanism and not a general language model, because the point is a result you can check rather than a number to trust.

## Phase 56: every deploy target

**519. output-cloudflare emits a Cloudflare Pages deploy plan** 🔨
the static export becomes a Cloudflare Pages project with the flattened redirect map carried in Cloudflare's native `_redirects` file, a wrangler config and a deploy script the user runs with their own `wrangler login`, no token ever emitted.

**520. output-vercel emits a Vercel deploy plan** 🔨
the export becomes a Vercel deployment whose `vercel.json` carries each retired address as a permanent redirect, applied with the user's own `vercel login`, the same site model reaching a fifth host with nothing reinvented.

**521. output-netlify emits a Netlify deploy plan** 🔨
the export becomes a Netlify site whose native `_redirects` file forces each 301 and whose `netlify.toml` publishes the export, applied with the user's own `netlify login`, so the port knows the big three clouds and the three static hosts alike, and each takes no credential.

## Phase 57: the transformer learns arithmetic and an algorithm

**522. vis-transformer learns addition, and the honest gap is measured** 🔨
the same trainable block learns addition modulo a small prime on a training split of the pairs and is graded on a held out split it never saw, reusing the proven backward pass over a full batch; MATH.md reports both accuracies as measured.

**523. The arithmetic result is reported as memorization, not dressed up** 🔨
at this size the block reaches the training pairs and not the held out ones, so the report states plainly that it memorized the table rather than learning the rule, because a held out number quietly rounded up is exactly the lie the whole tool refuses.

**524. vis-transformer learns sequence reversal as a rule** 🔨
reversal is a rule about positions and not about the tokens, so the block trains on some sequences and is graded on sequences it never saw, and REVERSE.md carries the loss curve, the train and held out accuracy, and a sample of reversed held out inputs.

**525. The reversal result is genuine generalization, and the run proves it** 🔨
the held out full sequence accuracy lands far above the fraction a guess would score, so the block learned the algorithm rather than the examples, and the claim is a measured comparison in the report and a test rather than a hope.

## Phase 58: the transformer learns to sort

**526. vis-transformer learns to sort a short sequence** 🔨
sorting is a harder rule than reversal because it must preserve the count of each duplicate rather than move fixed positions, so the block trains on some sequences over a small alphabet with repetition and is graded on ones it never saw, reusing the proven backward pass; SORT.md carries the loss curve and the train and held out accuracy.

**527. The sort held out result is genuine generalization, measured against chance** 🔨
a sequence counts correct only when every output position matches the sorted target, so chance is a tiny fraction of a percent, and the held out accuracy landing far above it is the block sorting sequences it never trained on rather than reciting a table.

**528. The sort gap from the training set is reported, not rounded away** 🔨
the held out accuracy is high and still short of the training accuracy, and SORT.md states that gap plainly as partial generalization on a hard task for a one block model, because a held out number quietly rounded to the training one is the lie the whole tool refuses.

**529. The sort model is proven correct by its own gradient check** 🔨
the numerical gradient check runs on the sort model's loss and holds the maximum relative error under a thousandth, so the training that produced the result descended on a true gradient rather than a plausible looking wrong one.

## Phase 59: the transformer grows a second opinion

**530. vis-transformer grows genuine multi head attention in the trained path** 🔨
the trainable block splits the model dimension into several heads, attends per head and recombines through an output projection, so the network can look at more than one relation at once, the single head path preserved exactly as the one head case.

**531. The multi head backward pass is proven before it is trusted** 🔨
the hand derived gradient through the head split, the concatenation and the output projection is held against the numerical check under a thousandth (it measures a few parts per million), because a multi head model whose gradient is not verified is exactly the unproven training this tool refuses to ship.

**532. Whether the extra heads help is measured, not assumed** 🔨
reversal is trained at one, two, four and eight heads on the same split and graded on the held out sequences, and REVERSE_MULTIHEAD.md reports the real numbers: two and four heads each recover one more held out sequence and eight heads do worse, a small honest gain rather than a story.

**533. The growth costs the existing results nothing** 🔨
every single head export trains to the same number it did before, the seed draw is undisturbed because the output projection was already in the stream, and two multi head trainings are byte identical, so the new capacity is added without moving anything that was already proven.

## Phase 60: a real model advises on the cloud

**534. general-architect asks a genuine LLM to design the cloud, not the toy transformer** 🔨
portamp's own transformer is a two thousand parameter demonstration that cannot design a system, so this plugin asks a real frontier model through the Anthropic Messages API with a plain fetch and no dependency, and is honest in the report that the answer is the external model's, never the tool's own.

**535. The call is gated live and billable, and takes no secret** 🔨
the request leaves the machine and charges an account, so it runs only under `--allow-live` and `--allow-billable` with an attestation, refusing by default like every live plugin; the API key is read from the environment at call time and never read from source, printed, or written anywhere.

**536. The proposal is built from the run's own facts and marked unverified** 🔨
the prompt carries the endpoints the app calls, the routes it serves and the archetype dsp read, and ARCHITECTURE.md wraps the answer in a header stating plainly it is a proposal a human architect must prove, because a confidently wrong design adopted as fact is exactly the failure this tool refuses.

**537. It is testable without a network or a key** 🔨
the model call is an injectable function, so the prompt building, the response parsing and the honest wrapper are held by unit tests with no live call, and CI proves the plugin refuses cleanly when live authorization is absent rather than reaching the network.

## Phase 61: a system of agents reasons over the port

**538. general-agents retrieves from the port's own reports, the R in RAG** 🔨
the reports this run wrote are the retrieval corpus, and a small BM25 style ranker over their paragraphs, dependency free and deterministic, pulls the passages relevant to a question, so the agents reason over the port's own analysis rather than a guess and the retrieval is the tool's own words.

**539. Specialised agents each review their slice through a real model** 🔨
an architect, a security reviewer, a cost analyst and a reliability engineer each run as a call to an external large language model with their own role prompt and their own retrieved context, and a synthesiser agent reconciles their answers into one recommendation, a genuine multi agent pass and not the toy transformer.

**540. The report is auditable and marked unverified** 🔨
AGENTS.md shows which report fed each agent so the retrieval can be checked, and states plainly that every architecture, risk, cost and failure mode is a proposal from an external model for a person to prove, because a confidently wrong review adopted as fact is the failure this tool refuses.

**541. The agents obey the live gate and take no secret, and are tested without a network** 🔨
the calls are billable and live, refused by default like every live plugin, the key is read from the environment at call time and never stored, and the retrieval, the prompts and the honest wrapper are held by unit tests with an injected corpus and model, CI proving the refusal.

## Phase 62: the agents ground their answers in current sources

**542. The architect and the agents can search the web, through the model's own tool** 🔨
with `--web-search` the request offers the model its built in web search tool rather than any scraper portamp wrote, so an answer about a service released after the model's training is current, and the network is reached only through the one gated, billable call that was already authorized.

**543. A grounded answer carries the sources it cites** 🔨
the citations the model returns are collected, deduplicated and appended to the report as a Sources list of real links, so the reader can open what the model read and check it, which is the difference between a grounded answer and a confident one.

**544. The server side search loop is handled and bounded** 🔨
the model pauses the turn to run the search server side, so the call resumes the turn a bounded number of times until it ends rather than dropping the partial answer, and the whole loop is driven in a plain fetch with no dependency.

**545. Grounding stays off by default and is tested without a network** 🔨
web search is opt in and adds no tool unless asked, and the tool offer, the paused turn resume and the cited Sources list are all held by unit tests with an injected fetch, so the behaviour is proven without a key or a live call.

## Phase 63: a learned second opinion on what the app is

**546. dsp-learn names the archetype with a model trained on the labelled corpus** 🔨
dsp-archetype names the app with hand written rules; dsp-learn names it with a nearest prototype model trained on the same eleven labelled miniatures, turning each screen into a vector of the features the rules already trust and placing a new screen by its nearest exemplar in a standardization learned from the corpus. LEARNED.md is a companion to ARCHITECTURE.md, ranks every archetype by distance with a softmax confidence, and is honest about its size: one exemplar per class means a held out accuracy is undefined, so it reports a reproducible robustness curve instead of a number it cannot compute, marks the reading unverified, and names the disagreement with the rule based reading as the thing to look at. No dependency, no network, deterministic; the embedded corpus is held byte equal to the fixtures.

## Phase 64: another framework read, Svelte in

**547. input-svelte reads Svelte components onto the shared dialect** 🔨
a `.svelte` file's `export let` props become inputs, its `createEventDispatcher` dispatches become outputs, and its markup lowers onto the same AngularJS attribute dialect every other reader targets: `{#each}` and `{#if}` blocks become transparent `<ng-container>` wrappers the IR sees through, `on:event` becomes an event with its arrow reduced to the call, `bind:value` becomes a two way model, and `{expr}` becomes interpolation, so a Svelte front end reaches the translator, the endpoint map and every emitter as any other component and ports on to React, Vue or the custom element. An event modifier, a class directive, an `{:else if}` chain and `{@html}` have no honest equivalent and are named through a note rather than guessed. No dependency, structural, deterministic; test/svelte.test.js holds the lowering and the parse into the IR.

## Phase 65: portamp reads the framework it emits, Lit in

**548. input-lit reads LitElement components onto the shared dialect** 🔨
the inverse of output-lit closes another loop: a LitElement's `static properties` (its top level keys, not the `{ type }` inside them) and `@property` fields become inputs, its `dispatchEvent(new CustomEvent(...))` names become outputs, and its `render()` html tagged template lowers onto the dialect. A mode stack matches the template through its nested `html` templates, `@event=${h}` becomes an event with the arrow reduced to the call, `?disabled=${c}` a boolean directive, `.value=${x}` a two way model, `${list.map((x) => html`...`)}` a loop and `${cond ? html`...` : ''}` a conditional, with the tag scanner skipping `${...}` so a `>` inside an arrow never closes a tag early. A two branch ternary, an unknown event and a property with no dialect directive are named through a note. No dependency, deterministic; test/lit.test.js holds it and a CI step ports a Lit component through to React.

## Phase 66: portamp reads the framework it emits, Alpine in

**549. input-alpine reads Alpine islands onto the shared dialect** 🔨
the inverse of output-alpine, and the third emitted framework read back: each `x-data` element on a page is a component, the object it declares is the state, and its subtree lowers onto the dialect. Alpine and the dialect are both attribute languages, so it is close to a rename: `x-for` is `ng-repeat`, `x-if`/`x-show` conditionals, `x-model` a two way model, `@event`/`x-on:event` the dialect event, `:attr`/`x-bind:attr` the bound attribute (a bound boolean becoming a directive, not a string that reads "false"), and `x-text` is `ng-bind`, which the IR carries natively. A `$dispatch` names an output. Because a page is also read as a static screen, an island takes its `id` or an `-app` suffix so the two readings never collide, and a modifier, an `x-init` or an `x-html` is named through a note. No dependency, deterministic; test/alpine.test.js holds it and a CI step ports an Alpine island through to React.

## Phase 67: the round trip closes through three targets, not one

**550. input-lit reads Lit's repeat() directive, not only .map()** 🔨
output-lit emits a loop as Lit's `repeat(items, keyFn, (item) => html`...`)` directive, so input-lit now reads it: a top level argument splitter respecting parens, brackets, strings and templates pulls out the list, the item name and the item template, the `?? []` default and `this.` are stripped, and it lowers to `ng-repeat` exactly as `.map()` does. Real Lit code uses `repeat` for keyed lists, so this reads more of it, and it is what makes the Lit round trip close.

**551. vis-roundtrip reads the port back through React, Svelte and Lit** 🔨
each target now has a reader that is the inverse of its emitter, so vis-roundtrip closes the loop through all three: a template is emitted to React, Svelte and Lit and read back by that target's reader, and the structure that returns, the real (tagged) elements, the conditionals, loops and models, is compared to what went in. Only tagged elements count, so a reader that wraps a block in a transparent container the IR sees through does not read as drift. ROUNDTRIP.md names any drift per screen and per target, and the run reports it, so the claim that the port keeps its shape is a comparison that fails out loud through three frameworks rather than one. test/readback.test.js holds it.

## Phase 68: the learned model earns a real held out number

**552. dsp-learn grows to two exemplars per class and reports a leave one out accuracy** 🔨
the calibration corpus grows from eleven miniatures to twenty two, a second labelled exemplar per archetype, each of which the rule based reader also classifies as its label so the two agree. Two per class is what makes a held out accuracy defined: dsp-learn now leaves each exemplar out in turn, retrains on the rest (its class still represented by its sibling) and classifies the held out one, reporting the real leave one out accuracy and the exemplars it missed when unseen, alongside the robustness curve it already carried. LEARNED.md stops saying a held out accuracy is undefined and prints the number instead, honest that two per class is still a floor to raise. test/learn.test.js holds the cross validation and the guard that the embedded corpus stays equal to the fixtures.

## Phase 69: the state the markup does not show

**553. dsp-storage names the browser storage the app kept state in** 🔨
a page that read and wrote localStorage, sessionStorage or IndexedDB held state the server never saw, and a port that rebuilds the screens but not the storage loses it on the first load, silently, because nothing in the markup shows it. dsp-storage finds every getItem, setItem, removeItem, clear, literal bracket access and IndexedDB open, names the keys and the store each belongs to, and says which state survives a reload, which lasts a tab, and which is a database of its own. It names the key, never the value: a key is an identifier the code chose, a value can be a token or a payload, exactly what the secret gate keeps out, so a computed key is not captured as a literal and no value is read. It measures and migrates nothing. test/storage.test.js holds it and a CI step names the storage a small page uses.

## Phase 70: the loops the port must remember to stop

**554. dsp-timers names the timers and animation loops the port must clean up** 🔨
a setInterval that polls, a setTimeout that retries, a requestAnimationFrame that drives a loop: each is work the page kept doing after the line that started it ran, and in a component world each has to be cleaned up on unmount or the port leaks a loop that keeps running, keeps fetching and keeps holding its closure. dsp-timers finds every setTimeout, setInterval, requestAnimationFrame and requestIdleCallback, pairs each with its own clear (clearTimeout with setTimeout, cancelAnimationFrame with requestAnimationFrame, not any clear with any scheduler) and reports whether that clear appears in the same file, so TIMERS.md separates the loops the port inherits with a stop from the ones that most likely leaked. It counts and changes nothing; which timer belongs in an effect with a cleanup, which moves to the server and which was a leak to drop is the owner's call. test/timers.test.js holds it and a CI step names a polling page's timers.

## Phase 71: the learned model reads each screen, not just the app

**555. dsp-learn classifies each screen on its own, not only the merged app** 🔨
the whole app reading weighs every screen's shape and the endpoints together; dsp-learn now also places each screen on its own markup shape alone, so a multi screen app is not flattened to one label. LEARNED.md gains a per screen table, and the disagreement is the finding: the demo's one screen reads as crud-table for the whole app, endpoints included, but as search-and-filter on its markup alone, because the table and filters pull one way and the GET/POST/DELETE on the same resource pull another. A per screen reading rests on shape without the traffic, so it is weaker and is reported as exactly that. test/learn.test.js holds it.

## Phase 72: another framework read, Stencil in

**556. input-stencil reads Stencil components onto the shared dialect** 🔨
a Stencil component is a class with a `@Component({ tag })` decorator, `@Prop` fields for its inputs, `@Event` emitters for its outputs, `@State` for local state, and a `render()` that returns JSX. The tag is the selector, and because the render JSX is the same shape React emits, it lowers with the React reader's own lowering, reused not reinvented, once `this.` is stripped from the expressions: `this.items.map(...)` a loop, `this.open && (...)` a conditional, `onClick={() => this.pick(x)}` an event, `{this.name}` interpolation. A design system's elements reach the translator and every emitter as any other component, and because input-react keys on function components a Stencil class is read only by this reader, no collision. No dependency; test/stencil.test.js holds it and a CI step ports a Stencil component through to React.

## Phase 73: the listeners the port must remember to remove

**557. dsp-events names the global event listeners the port must remove on unmount** 🔨
the third of the lifecycle trilogy beside dsp-storage (data) and dsp-timers (loops): a window or document addEventListener is a subscription that outlives the function that made it, and in a component world each has to be removed on unmount or the port leaks a listener that keeps firing, keeps holding its closure, and stacks a second copy on every remount. dsp-events finds every addEventListener, names the event and the target where it is a plain global, pairs each with a removeEventListener for the same event in the same file, and reports which listeners the port inherits with a teardown and which most likely leaked. It counts and changes nothing. test/events.test.js holds it and a CI step names a page's uncleared listener.

## Phase 74: the observers the port must remember to disconnect

**558. dsp-observers names the observers the port must disconnect on unmount** 🔨
the fourth cleanup reader beside dsp-storage, dsp-timers and dsp-events: an IntersectionObserver, ResizeObserver, MutationObserver or PerformanceObserver is a long-lived subscription the same way a global addEventListener is, keeping its callback and everything it closed over alive until disconnect() is called, and in a component world one made on mount has to be torn down on unmount or the port leaks it and stacks another on every remount, each still firing against detached nodes. dsp-observers finds every construction of the four DOM observers, names the kind and the line, reports whether a disconnect() appears in the same file, and calls out those with none. Like dsp-events it reports presence in the file, not proof of teardown on every path; a look-alike class named ...Observer is not counted. It counts and changes nothing. test/observers.test.js holds it and a CI step names a page's unclosed observer.

## Phase 75: the focus the port must not drop

**559. dsp-focus names the focus management the port inherits** 🔨
where a landmark says what a screen reader can reach and a label says what a control announces, focus is the third axis a screenshot never shows: where the keyboard is and where it goes next. dsp-focus reads the source for a positive tabindex (which pulls an element ahead of source order and breaks tab order; tabindex 0 and -1 are left alone), autofocus (which takes the keyboard on load, and more than one in a file is a conflict the browser resolves, not the author), accesskey (which collides with the shortcuts a browser and screen reader already own), and a programmatic .focus() call (a move the port must reproduce on the path that used it or a keyboard user is dropped somewhere they did not ask to be). It names the file and line for each, counts and changes nothing; which move is load-bearing and which tabindex was a mistake is the port owner's call. test/focus.test.js holds it and a CI step names a page's positive tabindex.

## Phase 76: the second track the port must carry

**560. dsp-media names the video and audio the port embeds** 🔨
a media element is the one place accessibility is not contrast or a label but a second track: a video with speech and no captions is unusable to anyone who cannot hear it, a track a screenshot never shows and a pixel diff never catches. dsp-media finds every <video> and <audio>, records which of controls, autoplay, loop, muted and a captions track are present, and names the gaps: a video with no captions track (the WCAG failure), a media element with neither controls nor autoplay (nothing starts it), and an autoplay (which browsers block with sound and a port keeps on purpose, not by default). It reads the markup and the attribute names only and never records a src, which can carry a signed URL, the caution the secret gate keeps. It counts and changes nothing; captions are content a person writes. test/media.test.js holds it and a CI step names a page's uncaptioned video.

## Phase 77: the grid a screen reader must be able to read

**561. dsp-tables names the tables the port draws and whether a reader can read them** 🔨
a data table is a grid of relationships a sighted user reads from the layout and a screen reader recovers only from the markup: a caption that names it, a th that marks a header, and a scope that ties a cell to its header. Strip those and the table is a flat wall of numbers, and the old web also built layout out of tables a reader announces as data unless they say role=presentation. dsp-tables finds each table, balanced across nested ones, records whether it has a caption, header cells, scope and a presentational role, and names the gap: a data table with no caption, headers with no scope, or a table with no headers and no presentational role. It reads structure only and never records a cell's content. It counts and changes nothing; whether a table was layout or data, and what its caption should say, is the port owner's call. test/tables.test.js holds it and a CI step names a page's uncaptioned data table.

## Phase 78: the other document dropped into the page

**562. dsp-iframes names the iframes the port embeds and the contracts they carry** 🔨
an iframe drops a whole other document into the page, and a port inherits two things a screenshot never shows: a title, without which a screen reader announces only "frame" with nothing to say what is inside, and a sandbox, without which the embedded document runs with the page's own powers, which for a third-party embed is the whole page's trust handed to code the team does not control. dsp-iframes finds each iframe, records whether it has a title and a sandbox and whether its src points at a host the page is not served from, and names the gaps. It records the host of a cross-origin src only, never the path or query, which can carry a token, the caution the secret gate keeps. It counts and changes nothing; a title is copy a person writes and which sandbox tokens an embed needs is a decision about what it may do. test/iframes.test.js holds it and a CI step names a page's untitled iframe.

## Phase 79: every accessibility axis on one page

**563. vis-a11y gathers the accessibility axes into one scorecard** 🔨
the port's accessibility is read by seven plugins, each on its own axis: dsp-landmarks (regions), dsp-labels (control names), dsp-a11y (contrast and target size), dsp-focus (the keyboard), dsp-media (captions), dsp-tables (grids) and dsp-iframes (embedded documents), each writing its own report. A port owner who wants the whole picture opens seven files. vis-a11y reads what those plugins left on the context and writes ACCESSIBILITY.md, one table of every axis with the count it reported and exactly what that count is. It invents nothing: every number is another plugin's, an axis whose plugin did not run is named "not measured" rather than scored zero, and it writes nothing when none ran. It is a count, not a grade; portamp does not know which gap matters most to this product, so it does not rank them. It does not collide with dsp-a11y's own A11Y.md. test/a11y-scorecard.test.js holds it.

## Phase 80: a third host for the port

**564. output-caddy serves the export with automatic HTTPS** 🔨
the host-target family already wraps the port in a Dockerfile around its own serve.js and in an nginx server block over the static export; output-caddy adds Caddy, the server that provisions and renews its own TLS certificate with no configuration. It writes a Caddyfile that serves the export from /srv, answers every retired address with the same 301 the app enforces, falls client routes back to index.html, and carries the same safe headers and immutable-asset caching the nginx block does. Like every other host target the redirect map is not invented: it is the flattened map the run produced, the same one nginx.conf, _redirects, vercel.json and netlify.toml carry in their own spellings, and a test asserts Caddy and nginx emit the same number of 301s. It is gated by --caddy and a site model, and ports nothing twice. test/caddy.test.js holds it.

## Phase 81: the platform's own component, read

**565. input-webcomponents reads vanilla custom elements onto the dialect** 🔨
before Lit, Stencil, Polymer or Riot, a team could reach for the platform itself: a class extends HTMLElement, a static observedAttributes lists the attributes it reacts to, a connectedCallback writes its markup with innerHTML, and dispatchEvent(new CustomEvent('name')) speaks back out, with customElements.define giving it a tag. input-webcomponents reads that shape: the registered tag is the component's name so it reaches the translator and every emitter as any other component, observedAttributes are its inputs, the CustomEvent names it dispatches are its outputs, and the innerHTML template literal is its markup, where a ${x} interpolation lowers to {{ x }} once this. is stripped. An expression with no plain interpolation, a .map, a ternary or a nested template, has no honest lowering and is named through the note rather than guessed, and an element that builds its DOM imperatively with no innerHTML template has only its inputs and outputs read. No dependency. test/webcomponents.test.js holds it.

## Phase 82: every security concern on one page

**566. vis-security gathers the security concerns into one scorecard** 🔨
the port's trust surface is read by several plugins: dsp-security (the sharp edges in markup and scripts), dsp-supplychain (third-party code loaded with no Subresource Integrity), dsp-iframes (embedded documents running with no sandbox), dsp-cookies (cookies set with no consent mechanism in play) and dsp-analytics (trackers whose return is a consent decision), each writing its own report. vis-security reads what those plugins left on the context and writes SECURITY_SCORECARD.md, one table of every concern with the count it reported and exactly what that count is. Cookies with a consent mechanism present are not counted as a definite gap, since portamp cannot prove ordering; they are noted for the reviewer instead. It invents nothing, marks a concern whose plugin did not run as "not measured", writes nothing when none ran, carries no value or secret, and does not collide with dsp-security's own SECURITY.md. It is a count, not a grade. test/security-scorecard.test.js holds it.

## Phase 83: every performance concern on one page

**567. vis-perf gathers the performance concerns into one scorecard** 🔨
the third scorecard beside vis-a11y and vis-security. The port's weight and its first paint are read by several plugins: dsp-perf (the script habits that stall a page: a synchronous XHR, a request in a loop, an interval poll), dsp-render-blocking (what the parser waits on before it can paint), dsp-inline (style and script that cannot be cached or themed), dsp-images (pictures shipped at one fixed size), dsp-fonts (faces with no woff2 or no font-display) and general-size (the bytes the port itself weighs), each writing its own report. vis-perf reads what those plugins left on the context and writes PERFORMANCE.md, one table of every concern with the count it reported and exactly what that count is. The port's size is shown beside the table as a measurement and never summed into the flagged items, because a byte is not a defect. It invents nothing, marks a concern whose plugin did not run as "not measured", writes nothing when none ran, and does not collide with dsp-perf's PERF.md or general-size's SIZE.md. It is a count, not a grade. test/perf-scorecard.test.js holds it.

## Phase 84: the last manual step before publishing, made mechanical

**568. publish-check proves the package is ready to ship without shipping it** 🔨
docs/PUBLISHING.md ends with a step a person does by eye: run npm pack --dry-run and read the file list, because a recorded screenshot or a real attestation must never be in it. general-publish turns that into one command. publish-check runs the same dry run, reads the same list, and holds it against what the package promises: only the top levels `files` declares ship plus what npm always adds; nothing forbidden ships (an attestation, a local config, a screenshots or recordings directory, a dotenv, a private key, matched as whole path segments so a plugin named input-shots is not mistaken for a shots directory); dependencies is empty, the zero runtime dependency invariant; the version is a plain semver; and every bin target is in the tarball. Each check prints ok or FAIL and the command exits 1 on any FAIL. The pure check is tested without spawning npm and one test runs the real dry run against this repository, which is the actual proof. It never runs npm publish: entries 96 and 325 stay open on purpose, because publishing is a decision with an owner, and this only makes sure the last check before it cannot be skipped by accident. test/publish.test.js holds it.

## Phase 85: the trust surface, capped

**569. --max-security turns the security scorecard into a ceiling the run enforces** 🔨
the scorecards report; the repository's honest pattern is that a report can become an opt in ceiling, the same shape as --max-unverified, --max-kb and --max-a11y, that fails the run and prints what would clear it, and only ever adds a gate. --max-security N fails the run when the security scorecard's flagged count exceeds N, naming SECURITY_SCORECARD.md as where each concern is listed, and refuses a ceiling that is not a number out loud. The gate lives in general-policy beside the other ceilings and reckons the total through vis-security's own exported function from what the analyzers left at plan, so it agrees with the scorecard to the item and does not depend on which verify handler ran first, since the kernel runs same stage handlers in discovery order and general-policy fires before vis-security. With no flag nothing is enforced and the scorecard still reports. test/security-ceiling.test.js holds it, including the reckoning, the fail, the pass, the opt in, and the refusal; a CI step runs a leaky page under a ceiling of zero and expects the failure.

## Phase 86: weight and first paint, capped

**570. --max-perf turns the performance scorecard into a ceiling the run enforces** 🔨
the ceiling set was asymmetric: accessibility and security had budgets and performance did not. --max-perf N fails the run when the performance scorecard's flagged count exceeds N, naming PERFORMANCE.md as where each concern is listed, refuses a ceiling that is not a number out loud, and only ever adds a gate. It lives in general-policy beside the other ceilings and reckons the total through vis-perf's own exported perfTotal from what the analyzers left at plan, so it agrees with the scorecard to the item and does not depend on verify handler order. The port's size is never in the count, because a byte is not a defect and --max-kb already budgets it. With no flag nothing is enforced and the scorecard still reports. test/perf-ceiling.test.js holds it, including that a megabyte of size adds nothing to the count; a CI step runs a heavy page under a ceiling of zero and expects the failure, then under 99 and expects the pass.


## Phase 87: every teardown on one page

**571. vis-lifecycle gathers the cleanup axes into one scorecard, with --max-leaks the ceiling** 🔨
a component port has to tear down what the old page only set up, and three plugins read that debt on their own axes: dsp-timers (a setInterval or setTimeout with no matching clear), dsp-events (a global addEventListener with no matching remove) and dsp-observers (an observer with no disconnect), each writing its own report. vis-lifecycle reads what those plugins left on the context and writes LIFECYCLE_SCORECARD.md, one table of every axis with the count it reported and exactly what that count is, every number another plugin's, an axis whose plugin did not run named "not measured" rather than scored zero, and nothing written when none ran. dsp-storage is deliberately not in the count: a storage write is a persistence surface, not a teardown the old page forgot, and it keeps its own report. --max-leaks turns the total into a ceiling the run enforces, the same shape as --max-security, --max-perf, --max-a11y, --max-kb and --max-unverified, reckoned through vis-lifecycle's own function so the gate agrees with the scorecard; a non-number is refused out loud and no flag means no check. test/lifecycle-scorecard.test.js and test/leaks-ceiling.test.js hold it.


## Phase 88: the words held to the numbers

**572. The README's headline counts are held by the suite** 🔨
the sanitation pass the contract asks for after a sprint, and the gate that makes the next one unnecessary. The README swore to 137 plugins and 651 tests while 153 shipped and 745 ran, and its size table carried a line count with no measure that still produced it; only the core's 718 was ever held by a test, which is exactly why the rest rotted. Every figure is trued up and each row is now defined by the measure that produces it: the tool's lines are the .js under src and plugins, the sizes are byte sums rather than du blocks so Windows counts the same, and the plugin and test file counts are read off the tree. test/hygiene.test.js holds the plugin count exactly, everywhere the README states it, and the test file count exactly; the two rows that move on every commit are held to within three percent, a tolerance the test and the README both name, because an exact gate would fail every push and the practice is to true them up at a sprint's end. Nothing was rounded to a nicer number.


## Phase 89: the site with no framework at all

**573. output-eleventy arranges the site as an Eleventy project** 🔨
the site engine arranges a folder of old pages into Next, Remix, Astro, Nuxt and SvelteKit; output-eleventy adds Eleventy, the most common destination for exactly that folder because it needs no client framework at all. The lifted chrome becomes _includes/layout.njk with the page's title and description in the head, one template per route carries that screen's markup printed to static HTML by the same printer output-html proves, with the route as its permalink, and the redirect map lands as _data/redirects.json plus a template that writes _redirects at the site root, the file Netlify and Cloudflare Pages read and the same flattened map every other host target carries. The ported markup is wrapped in Nunjucks raw blocks, because Eleventy's default engine would otherwise read the page's own interpolations as its variables and render them empty. Eleventy runs nothing on the client, so a screen that carries handlers, two way bindings or events is arranged as its static markup and named in the notes and the README rather than flattened silently; the port owner decides whether it stays static or lives as an Astro island. Gated by --eleventy and a site model; nothing is translated twice. test/eleventy.test.js holds it.


## Phase 90: the enterprise framework that was everywhere

**574. input-ember reads Ember components onto the dialect, and .hbs reaches the scan** 🔨
an Ember component is a Glimmer template beside or under a class that names what it takes and what it says, and Ember was the enterprise front end of a decade. input-ember lowers the template onto the attribute dialect with the same spellings the handlebars reader uses: {{#each list as |row|}} becomes ng-repeat naming the block param, with an index param reshaping the loop to track by $index and an {{else}} becoming the empty state; {{#if}} with its else if chain; {{on "click" this.save}} and classic {{action "save"}} become the event attributes with their arguments; <Input @value={{this.q}}> becomes a real input with ng-model; a child component <UserBadge @user={{x}} @onPick={{fn}}> becomes its kebab tag with ng-attr for an arg and an event attribute for a callback; {{yield}} becomes ng-transclude; and a helper with an exact JS spelling (if, unless, eq, not, and, or, concat, gt, lt, fn) becomes that expression while any other becomes a named call a person confirms. Inputs are the @args the template reads and the this.args the class reads, outputs the this.args.onX(...) the class calls and any @onX the template wires as a handler, and a @onX written on a child tag is the child's arg, not this component's. The scan never kept .hbs files, so the handlebars reader's .hbs path never ran; .hbs and .handlebars now reach the scan, and one exported predicate decides which reader owns each file so a template is read by exactly one of them, which a run test holds. test/ember.test.js holds it.


## Phase 91: what the port asks its environment for

**575. dsp-env names the configuration keys the app reads at runtime, and never a value** 🔨
a legacy front end reads process.env.API_URL, import.meta.env.VITE_KEY, an Angular environment module, or a config object the server dropped on window, and each read is a value someone supplies before the port runs; the source states the name and never the value, so the port has exactly that gap and must not fill it with a guess. dsp-env reads every script for those four spellings, keeps the key with the file and line it is read at and whether the read carries a || or ?? fallback (never the fallback literal, which is where a value lives), and reads any .env file in the tree for its names only, the right hand side of each line never read. .env files now reach the scan, which also puts a live .env through the secret gate it had been walking past. ENV.md tables every key by source with its state (fallback in source, declared in .env, or neither), names the keys nobody supplies yet, the names a .env declares that no script reads, and a live .env as a file that must not be copied into the port or committed; .env.example lands beside it with every process environment key blank, so the port asks for what it needs by name. Keys a window object or an environment module supplies are named and left out of the example, because how the deploy hands them over is a decision and not a value. test/configuration.test.js holds it.


## Phase 92: what the port stands on

**576. dsp-deps names the libraries by version against the dates their own projects published** 🔨
a legacy front end stands on libraries a manifest declares, a script tag loads by a path that carries a version (jquery-1.8.3.min.js, a cdnjs path, an @version on a CDN), or a vendored copy states in its first line banner, and every one of those is a version somebody chose. dsp-deps reads the root package.json and bower.json (a nested manifest belongs to another package and is left alone), every page's script tags, and the banner line of every script, merges the witnesses of one version into one row with its evidence, and assesses each against a short table of what the projects published about themselves: the day AngularJS, Bootstrap 2, 3 and 4, Vue 2 and each Angular major from 12 to 19 left support, the release that ended jQuery 1 and 2, the day moment declared itself finished, the last release of Prototype and MooTools. A version newer than every dated major the table holds is said to be exactly that, and a library not in the table is marked not assessed, which means that and not that it is fine. A library loaded at two versions and a dependency pinned to nothing are named as facts. bower.json in the tree is noted as a deprecated tool. DEPENDENCIES.md carries the table; nothing is upgraded or removed, because what the port does about a dated library is a decision about the product and the code that calls it. test/dependencies.test.js holds it.


## Phase 93: markup written as calls

**577. input-mithril walks hyperscript onto the dialect, and a child component's event reaches every target** 🔨
Mithril has no template; its markup is a tree of m() calls, so there is nothing to lower and everything to walk. input-mithril reads each call the way the runtime would: the selector string gives the tag, id, classes and bracket attributes; the attrs object gives attributes, with on<event> becoming the dialect's event, value plus oninput the model, class with an expression ng-class, and an expression valued attribute ng-attr; a string child is text, an expression an interpolation, cond ? m() : null and cond && m() a conditional, list.map((row, i) => m()) a loop with track by $index, m.trust bound html, m.fragment a container, and m(Child, { attrs }) that component's tag with its callbacks as events. A component is any object or closure with a view, block or arrow bodied; its inputs are the vnode.attrs it reads, rewritten to the input itself in the template, its outputs the vnode.attrs.onX it calls, named as the event the way every reader names them, and m.request reaches the API surface with its method. A ternary choosing between two values, a spread in attrs and a computed tag are named rather than approximated. Two shared defects surfaced beside it and are fixed for every reader: an object literal parser that read a ternary as key value pairs and produced a class named `late ? 'late'`, and an event wired on a child component (ng-pick on a tag the run knows, hyphenated or a one word screen) that reached React as a raw attribute; the IR now learns the run's own tag names from every printer that builds one, so the callback lands as onPick in React, @pick in Vue and on:pick in Svelte, and an unknown directive on a plain element is still not guessed to be an event. The Ember reader's outputs are renamed the same way, so a React prop comes out as onPick once instead of onOnPick. test/mithril.test.js holds it.


## Phase 94: the browser that is gone

**578. dsp-platform names the browser APIs the scripts call that the platform has moved on from** 🔨
the browser a legacy front end was written for is gone, and some of what it called went with it: document.all, Web SQL, mutation events, showModalDialog, attachEvent, the application cache, event.keyCode, escape(), getYear, synchronous XMLHttpRequest, the unload event, the document.domain setter, vendor prefixed names, user agent sniffing and the rest of a table of twenty one. A script that calls one still parses and still ships, and fails or degrades only when it runs, which is the worst time to learn it. dsp-platform reads every script and page for each, locates the call by file and line, and reports it with the status the specification or the engines published (removed with the year the last major engine dropped it, deprecated, strict mode error, prefixed, never standard, reduced) and the API the same documents name as its replacement; a current API is never a finding, a look alike name is not one, and arguments are never captured because what a page wrote to a database or passed to escape() is a value the report must not repeat. PLATFORM.md leads with what fails today in a current browser. Nothing is rewritten, because whether a fallback for an old engine still matters is a decision about who the port's users are. test/platform.test.js holds it.


## Phase 95: control flow as tags

**579. input-marko lowers Marko onto the dialect, and the port README describes every report** 🔨
Marko writes control flow as tags and bindings as bare attributes, and every one has an exact spelling in the dialect: <if>, <else-if> and <else> become ng-if blocks with the chain negated the way the runtime evaluates it, <for|row, i| of=rows> becomes ng-repeat with track by $index and the index renamed in its body, <for|k, v| in=obj> the (key, value) form, a bare attribute value becomes ng-class, ng-style, ng-disabled, ng-href or ng-attr as its name decides, on-click("pick", row) becomes ng-click with its method and arguments, ${expr} an interpolation and $!{expr} bound html, and <section.card#main> carries its class and id on the tag name. The class in the file or component.js beside it supplies the inputs, the input.x reads rewritten to the input itself, and the outputs from this.emit; fetch calls reach the API surface. The concise indentation syntax, a dynamic tag, <include>, <await>, <macro>, a spread and an inline $ statement are named rather than approximated. The dialect's event list grows to the events AngularJS itself shipped plus input, which three readers already spelled ng-input with nowhere for it to land. Beside it a sanitation pass: PORT_README.md described twelve of the ninety two reports a run can write; it now describes every one, and a hygiene gate fails the suite when a plugin writes a report the README cannot name. test/marko.test.js holds the reader and test/hygiene.test.js the index.


## Phase 96: the theme that wraps every page

**580. input-liquid lowers Liquid themes onto the dialect, composed the way the server composed them** 🔨
Liquid is the jinja shape with its own words, and a Shopify or Jekyll theme is a layout that wraps every template, sections that declare their settings in a schema, and snippets rendered by name. input-liquid lowers each construct with an exact spelling: if, elsif and else with the chain negated the way the runtime evaluates it, unless as the negated test, case and when as the equalities they test with the else as their negation, for with its else as the empty state, and and or and contains and blank and empty and nil and size and first and last as their JS, filters with an exact spelling rewritten (upcase, downcase, size, default, append, prepend, plus, minus, times, divided_by, join, first, last, truncate, strip) and any other kept as written so the translator names it too. A template is wrapped in layout/theme.liquid at content_for_layout the way the server did and the body is what becomes the screen; a section or snippet the run holds is inlined at its tag and a missing one is named; a section's schema settings are its inputs and travel with it into the template it is inlined into; the platform objects a screen reads (product, collection, cart, shop, customer, routes and the rest) are its inputs, read from its expressions and never from its markup, so a search input does not invent a search object. assign, capture, cycle, increment, paginate, a loop's limit or offset, a render's arguments, a javascript block and the platform's content_for_header have no client equivalent and are named through the notes. A form posts to the platform and is kept as a form whose action the endpoint map must be given. test/liquid.test.js holds it.


## Phase 97: the size of the tree

**581. dsp-dom measures the tree each screen renders against the thresholds Lighthouse publishes** 🔨
a page with thousands of nodes, a parent with sixty children or markup nested thirty levels deep costs memory, style recalculation and layout on every change, and a port carries the shape forward unless someone sees it. dsp-dom reads each screen's IR and measures the elements it renders once, how deep they nest, the widest parent and its tag, the loops that multiply the count at runtime and how deeply they nest, and holds the numbers against the three thresholds Lighthouse publishes for its DOM size audit: more than 1,500 nodes, a depth over 32, a parent with more than 60 children. The element count is stated as a floor, because a loop renders its body once per row and nothing guesses how many rows; loops inside loops are named because the inner body renders once per row of every enclosing list. DOM.md tables every screen and leads with the ones over a threshold; the performance scorecard gains a sixth axis counting them, so --max-perf holds it. Nothing is restructured, because where a screen should split is a decision about the product. test/dom.test.js holds it.


## Phase 98: the same walk for the other runner

**582. output-playwright walks the ported site with Playwright, the config starting the port's own server** 🔨
output-cypress walks every route and every retired address of a ported site; teams that run Playwright asked for the same walk in their runner, and the port already leans on Playwright for input-record. output-playwright emits one spec that visits every route from the site model and asserts the layout mounted and the document has a title, one that visits every retired address and asserts the browser landed on the path the flattened redirect map promised, and a playwright.config.js whose webServer starts the port's own zero dependency serve.js on 4173 and waits for its /healthz, so npx playwright test is the whole invocation with @playwright/test the one dev dependency. Routes and redirects come from the site model and nothing asserts a pixel; without --site there is no model to walk and the run says so. Gated by --playwright. test/playwright-suite.test.js holds it.


## Phase 99: the words, again

**583. The prose counts in the README, CLAUDE.md and the roadmap header are held to the roadmap** 🔨
9.36 held the README's digits to the measures that produce them, and the words kept drifting: the README's "still open" paragraph swore to four hundred and twenty six features in thirty four phases while the roadmap held five hundred and eighty two in ninety eight, and CLAUDE.md's pointer to the roadmap said four hundred and twenty in thirty three, because a number spelled out in words is invisible to a regex that looks for digits. Every such sentence is trued up, and test/hygiene.test.js now reads the words: the README's "across N features", its "N features in N phases, N shipped, N new in the current branch, N planned", CLAUDE.md's "N features in N phases" and the roadmap's own header are each parsed from English numerals and held equal to the roadmap's counted entries, its counted phase headings and its counted statuses. A sentence that spells a number the file no longer holds fails the suite, in words as it already did in digits. Nothing was added to make a number nicer; the words were made true.


## Phase 100: one lowering, three dialects

**584. input-twig reads Twig through the jinja lowering, its own spellings rewritten at the word level** 🔨
Twig, the template language of Symfony, Drupal and Craft, is jinja's grammar with a handful of its own spellings, and a second lowering for it would be a second place for the same bug. input-twig rewrites the spellings onto jinja's outside of strings: elseif to elif, ~ to +, is defined and is not defined and is empty and is null to the null comparisons they are, is same as to strict equality, the escape, raw and translation filters dropped because the target escapes and the port owns its strings, and a path(), url() or asset() call kept as written and named because the route table is the server's and an address belongs in the endpoint map. The result goes through the one jinja lowering, which already composes extends and block, inlines a held include by exact path or basename with Twig's namespace prefix stripped, names a missing one, and turns the else of a for into the empty state. A layout other templates extend is composed into each of them and not ported as a screen of its own, the body is what becomes the screen, and a range loop is named rather than repeated. .twig reaches the scan. test/twig.test.js holds it.


## Phase 101: the front end of the early web

**585. input-xslt reads a stylesheet as the template it is, XPath as the path it names** 🔨
XSLT was the front end of the early 2000s, an XML document and a stylesheet the browser or the server ran to make the page, and the stylesheet is a template in a strict grammar. input-xslt parses it with a small strict XML reader and lowers it onto the dialect: xsl:for-each is a loop over the selected nodes with the loop variable named for the last path step and an xsl:sort named, xsl:if and xsl:choose with when and otherwise are the conditional chain negated the way the processor evaluates it, xsl:value-of is an interpolation and with output escaping disabled bound html, xsl:attribute sets an attribute on its parent and an attribute value template binds one, xsl:element names an element, xsl:apply-templates over a select with a matching template repeats that template's body, xsl:call-template inlines the named template with its parameters named, and a variable with a select is substituted at its uses. XPath lowers to the JS path it names, a/b/@c to a.b.c, count() to .length, not() to !, position() to the index, and and or to their operators, the root to the one input called data; a predicate filter, an axis, a key or a function the table does not know is kept as written and named, because this is not an XPath engine and a wrong path that looks right is the defect the tool exists to avoid. .xsl and .xslt reach the scan. test/xslt.test.js holds it.


## Phase 102: the contract catches up

**586. CLAUDE.md, the README's captions, the package description and the plugin API describe the tool that ships** 🔨
the contract's account of the tool stopped at 8.0 while the code reached 9.49, the README's test run caption named the Svelte, Lit, Alpine and Stencil readers as the newest, the package description listed six readers of thirty two and no host arrangement, and docs/PLUGIN-API.md gave a screen six fields where every reader pushes twelve. Each is trued up: CLAUDE.md carries a 9.x paragraph naming the scorecards and their ceilings, the six readers from Ember to XSLT and what each refuses to guess, the four analyzers of a source's own dependencies, the two hosts, the two defects fixed for every reader at once and the gates that hold the words like the digits; the caption names the newest readers; the description counts the input plugins and names the hosts; and the API doc lists every field a screen carries so a plugin author can guess the shape, which is what the contract promised. Nothing was added to the tool; the words about it were made true.


## Phase 103: the view the controller filled

**587. input-blade composes Laravel views the way the compiler does and lowers them onto the dialect** 🔨
Blade is Laravel's template language, directives that begin with @ and PHP expressions in braces, and a view is composed from a layout it extends, sections it fills and partials it includes. input-blade composes first, the way the compiler does: @extends pulls the layout, each @section fills the @yield it names with @parent splicing the default back and an inline @section a value, a held @include is inlined by its dotted view name and a missing one named, and a layout other views extend is chrome rather than a screen. Then it lowers: @if, @elseif, @else, @unless, @isset, @empty, @auth, @guest, @can, @cannot and @error as conditionals with the chain negated the way the engine evaluates it, @foreach and @forelse as a loop with the @empty branch as the empty state and the key value form kept, @switch and @case as the equalities they test, {{ }} as interpolation and {!! !!} as bound html, and a PHP expression as the JS it names: $a->b to a.b, empty() and isset() and count() to their checks, string functions to their methods, concatenation to +, $loop->index and iteration and first to the dialect's index. The variables a view reads are its inputs, because the controller supplied them, with auth, can and errors named as inputs where a directive read them. @php, @csrf and @method, route() and asset() and __() helpers, @for and @while, @json and an @include with data are named rather than approximated. A .blade.php file is read by this reader alone; the static page reader steps aside for it. test/blade.test.js holds it.


## Phase 104: what the run did not even look at

**588. vis-readers accounts for every file the scan kept: the reader that claimed it, or nobody** 🔨
thirty four readers each take the files they recognise, and a legacy tree carries pages, templates and scripts none of them knows. COVERAGE.md counts screens; vis-readers counts files, so the question of what the run did not even look at has an answer instead of an assumption. At verify, when the readers have done what they will do, every file the scan kept lands in exactly one of five rows: read as a screen, with the reader credited by name and a count per reader; a script the analyzers scanned that produced no screen, which is what a script that is not a component should do; a style; an asset or data file; or markup no reader claimed, the row a port owner reads first, named in the notes so a page the port has nothing from is a visible gap and not a silent one. Whether each unclaimed file is a page the port needs, and which reader should learn its shape, is a person's call. test/readers-census.test.js holds it.


## Phase 105: four dialects, one component

**589. The same page in jinja, Twig, Liquid and Blade is one React, one Vue and one Svelte component, byte for byte** 🔨
CI already asserts that a screen written in Angular and in Vue produces byte identical React, Vue, Svelte and custom element output, which is the only honest way to claim the middle is framework blind. The server dialects now get the same proof: one product page, a heading, a three way stock condition and a tag list with its empty state, is written four times in jinja, Twig, Liquid and Blade, each is run through its own reader, and the emitted React, Vue and Svelte components are compared byte for byte once the two provenance lines naming the source file and its dialect are set aside, and asserted to still differ with them, because the port must say where it came from. A reader that lowers a conditional chain or an empty state one character differently from the others now fails the suite and CI rather than shipping a quiet divergence. test/dialects.test.js holds it.


## Phase 106: the button that was a div

**590. dsp-keyboard names every click target the keyboard cannot reach, in every dialect the readers know** 🔨
a <div> or <span> with onclick, ng-click, @click, (click), on-click or onClick looks like a button and works like one for a mouse, and for a keyboard user it does not exist: not in the tab order without a tabindex, announced as nothing without a role, deaf to Enter and Space without a key handler. WCAG 2.1.1 is the rule. dsp-keyboard reads every opening tag that carries a click handler in any dialect the readers know, skips the elements interactive by nature (a with an href, button, input, select, textarea, summary, option, label) and an anchor with no href is not one of them, and names the rest by tag, file and line with which of the three it lacks; the handler's expression is never captured, because it is source and a value in it is not for a report. KEYBOARD.md carries the list and the accessibility scorecard gains the axis, so --max-a11y holds it. Nothing is rewritten; which of these becomes a real button is a change to the markup a person makes on purpose. test/keyboard.test.js holds it.


## Phase 107: the view the view engine composed

**591. input-razor composes ASP.NET views the way the view engine does and lowers them onto the dialect** 🔨
Razor is the view language of ASP.NET MVC and ASP.NET Core: C# after an @ and markup everywhere else, a view composed from the layout _ViewStart or its own code block names, the body rendered where the layout says, sections landing where the layout asks and dropped with a note where it does not, and partials rendered by name from Shared or beside the view. input-razor composes first, then lowers: @if with its else if and else chain negated the way the runtime evaluates it, @foreach as a loop naming its variable, @switch and case as the equalities they test, @expr and @(expr) as interpolation, @Html.Raw as bound html, @Html.DisplayFor as the value it displays and DisplayNameFor as the property's name, @: as a literal line and @@ as the sign itself, and a C# expression as the JS it names: .Count and .Length and .Any() to length checks, string.IsNullOrEmpty to a truth test, ToUpper and ToLower and Trim to their methods, is null to a null test. Model, ViewBag, ViewData and User are the inputs where the view read them, and @model names the C# type the port's Model carries without knowing its shape. A @{ } code block, @for and @while, @Url.Action and @Html.ActionLink and the form helpers, tag helpers and a section no layout renders are named rather than approximated, because Razor's parser is a C# parser and this is not one. .cshtml reaches the scan. test/razor.test.js holds it.


## Phase 108: the review pass

**592. Eight defects a review found in the new readers are fixed, each with the input that exposed it as a test** 🔨
a review of the nine plugins written in this stretch found eight defects worth the name, and each is fixed with the exact input that exposed it held as a test. In input-razor: an apostrophe in prose inside a control body was read as a C# string opener, so "Don't panic" swallowed the block's closing brace or hung the lowering; brackets are now C# only inside a condition or a code block and markup bodies read their braces plainly. An unbalanced bracket sent the scanner to minus one and looped forever; every bracket match is now checked and an expression that never closes is kept as text and named. A @using namespace line, which heads most views, was read as a using block and dropped everything to the next brace; directives now take their line first and only a @using with a parenthesis is a block. An email address in prose became an interpolation of a nonexistent variable; an @ glued to the word before it is now the sign itself, as Razor's own parser reads it. A @: literal line was pushed raw so the expressions Razor still evaluates in it printed as text; it is now lowered. A code block was removed up to its first closing brace, leaving a nested brace's tail on the page; blocks are now matched balanced. In input-blade: a directive Blade does not know was deleted with its argument, so help@example.com became help.com and a CSS @media rule lost its query; an unknown directive is now printed as text, which is what Blade does. In vis-readers: an Angular component's external template, read by input-angular from a second file, was reported as markup no reader claimed; a template a reader read from a second file is now credited to it, and a Razor view counts as markup. input-twig's no-op rewrite of set is gone. test/razor.test.js, test/blade.test.js and test/readers-census.test.js hold them.


## Phase 109: the second review pass

**593. The analyzers and scorecards of this stretch reviewed: one lineAt for seventeen, the Ember reader lowering once, the words made true** 🔨
a second review over the analyzers, hosts and scorecards written in this stretch found four things worth fixing. input-ember lowered the helper inside a quoted attribute twice, so class="btn {{if this.busy 'a' 'b'}}" came out as a call to a helper named busy with a bogus note; a quoted value is now lowered first and once, with a quote inside it swapped so the attribute survives. It also counted {{@index}} as an input and an @onSave wired as a handler as both the input onSave and the output save; loop metadata is skipped and an input that names an output is dropped, so the React prop appears once. Seventeen analyzers each carried a private copy of lineAt and each rescanned the file from the top for every match; one exported lineAt in dsp-ir/emit.js builds the newline table once per text and answers by binary search, the seventeen copies are gone, and the hygiene gate that holds pascal and unique to one definition now holds lineAt too. vis-a11y's own prose said seven axes and A11Y.md where it gathers eight and writes ACCESSIBILITY.md, and its list of per axis reports left out KEYBOARD.md; the words are true again. test/ember.test.js and test/hygiene.test.js hold them.


## Phase 110: the template Spring shipped with

**594. input-freemarker lowers FreeMarker onto the dialect, its expression language rewritten where a JS spelling exists** 🔨
FreeMarker was the template language Spring MVC shipped with for a decade: directives as tags with a hash and an expression language of its own for defaults, existence and built ins. input-freemarker lowers each construct that shapes markup: <#if> with its <#elseif> and <#else> chain negated the way the engine evaluates it, <#list> as a loop with its <#else> as the empty state, the key value form kept and the <#list>/<#items> pair read as one loop, <#switch> and <#case> as the equalities they test, ${expr} as interpolation with x!"none" as a default, x?? as an existence test, ?size, ?upper_case, ?lower_case, ?trim, ?first, ?last and ?join as their methods, the formatting built ins dropped because the target formats, and gt, lt, gte and lte as their operators; a built in with no JS spelling and a range are named. A held <#include> is inlined where its tag stood, a macro defined in the file is expanded at its <@call> with its arguments substituted and named, and <#assign>, <#import>, <#function>, <#attempt> and the rest of the server's machinery are removed and named. The data model's top level names are the inputs, read from the expressions and never from the markup. .ftl and .ftlh reach the scan. test/freemarker.test.js holds it.


## Phase 111: the third review pass, and a fifth dialect in the proof

**595. Eight more defects fixed with the inputs that exposed them, and FreeMarker joins the byte identical page** 🔨
a third review over the newest readers found eight defects worth the name. In input-freemarker: a directive whose parameter carried a > inside parentheses, the form the manual documents for a comparison, ended the tag early; a tag now ends at the first > outside parentheses and quotes. A self closing macro call before a block call of the same macro swallowed everything between them as the nested body; self closing calls expand first and a block call must not end in a slash. The else of a list written with items closed a container the items had already closed; it closes nothing now, and the test counts openers against closers. A ! inside a string became a default; defaults are joined to the string part that follows a code part, so "Done! Next" stays prose. In input-blade: PHP's concatenation touching a string literal survived as property access, so 'Hello '.$name reached the port as the name property of a string; a dot touching a string is +. @else followed by parenthesised prose on the next line consumed the prose as its argument; an argument sits at most a space away. A layout's @section ... @show block was never overridden by the child's section, so the override and its @parent were dropped without a note; the child overrides it and @parent splices the default back. In input-razor: @await was read as an expression named await with the call left as page text; the keyword is skipped and a view component call is named. @try looked for a parenthesis it does not have; a partial with a nested call left a stray parenthesis; both matched balanced now. In dsp-keyboard: an anchor routed by Angular's bound [routerLink] was a false positive; it is a link. And the same product page written in FreeMarker produces the same React, Vue and Svelte byte for byte as the four dialects before it, so the proof now holds five. test/freemarker.test.js, test/blade.test.js, test/razor.test.js, test/keyboard.test.js and test/dialects.test.js hold them.


## Phase 112: the template of the early Java web

**596. input-velocity lowers Velocity onto the dialect and joins the byte identical page as its sixth dialect** 🔨
Velocity was the template language of the early Java web frameworks: directives that begin with a hash, references that begin with a dollar, and a page composed by #parse of shared pieces or by a layout servlet that drops the page into $screen_content. input-velocity lowers each construct that shapes markup: #if with its #elseif and #else chain negated the way the engine evaluates it, #foreach as a loop with its #else as the empty state and $foreach.count and $velocityCount as the index, $ref and ${ref} and $!ref as interpolation, a reference's Java methods with a JS spelling rewritten (size, length, isEmpty, get, equals, toString dropped) and the word operators and, or, not, eq, ne, lt, le, gt and ge as their symbols, a double quoted string interpolating and a single quoted one literal, an escaped dollar or hash and a hash in prose as the text they are. A held #parse is inlined where its tag stood and #include lands as literal text; a macro defined in the file is expanded at its call with its arguments substituted and named; the one template that reads $screen_content is the layout, composed around every other page and not ported as a screen of its own. #set, #define, #evaluate, a range and a method with no JS spelling are named rather than approximated. The context's top level names are the inputs, read from the expressions only. And the same product page written in Velocity is the same React, Vue and Svelte byte for byte as the five dialects before it. test/velocity.test.js and test/dialects.test.js hold it.


## Phase 113: the fourth review pass

**597. Eight more defects in the two Java template readers and the readers census, fixed with the inputs that exposed them** 🔨
a fourth review over the two newest readers found what a single test page cannot. In input-freemarker: a macro whose body called another macro left the inner call as a raw tag, because the expansion never rescanned what it inserted, and the parameter substitution mangled the inner call's t=t; expansion now runs until no call is left and a parameter is substituted only as an expression, never as the name of an argument. ?string with a format selector, ?string.currency, was stripped to a property read that looked right; the selector is named as a formatting built in with no client equivalent and the value is interpolated unformatted. The implicit loop variables user_index and user_has_next surfaced as phantom inputs; the index is the dialect's own and the rest is named. A block <#assign> or <#function> leaked its captured body into the page; both are removed and named. A positional macro argument was reported as missing; positional arguments take the declared order. In input-velocity: a macro calling a macro lost the inner call, because the expanded body was lowered with an empty macro table; the table is shared down every expansion and every #parse. A string literal argument landed in the page with its quotes; it keeps them inside a directive's parentheses and sheds them in the page, as Velocity renders it. An unclosed #define dropped the rest of the file; it is named and the text kept. $foreach.last is carried as the $last the dialect's repeat provides, not a mangled name. In vis-readers, the extensions the jinja and underscore readers claim were missing from the markup row, so an unclaimed .j2 or .ejs was filed as an asset; they are markup. test/freemarker.test.js, test/velocity.test.js and test/readers-census.test.js hold them.


## Phase 114: one bracket matcher for the readers

**598. The string helpers eight readers each wrote are one module, held to one definition** 🔨
every template reader does three things to a string of source: finds the bracket that closes an open one, splits an argument list at its top level, and makes an expression safe inside a double quoted attribute. Eight readers written in this stretch each wrote their own, and the review passes found the same defect more than once because it had been written more than once: a quote opened by an apostrophe in prose, an unbalanced bracket that never returned. dsp-ir/text.js now carries one matchBracket that returns the index past the close or minus one and reads quotes only where told (false inside markup, where an apostrophe is prose) and backticks only where the language has them (JS yes, C# and the Java templates no), one splitCommas and one splitWords that keep brackets and strings whole, and one attrSafe. The Mithril, Marko, Razor, Velocity, FreeMarker, Liquid, Blade, XSLT and Ember readers import them, Razor and the Java readers through a two line wrapper that fixes their language's quoting, and the two splitters with semantics of their own, Ember's helper arguments and Velocity's comma or space call arguments, keep names of their own. The hygiene gate that holds pascal, unique and lineAt to one definition holds these four too, so the next reader cannot quietly write a fifth. test/text.test.js holds the helpers.


## Phase 115: the tree written as indentation

**599. input-pug reads Pug from its indentation and composes it the way the compiler does** 🔨
Pug, once Jade, was the template language of the Express era: a tree written as indentation, tags with .class#id(attrs) shorthand, text after a tag or behind a pipe, and control flow as keywords at the start of a line. input-pug reads the tree from the indentation and lowers it onto the dialect: if with its else if and else chain negated the way the engine evaluates it, unless as the negated test, each and for as a loop with an index renamed to the dialect's own and an else as the empty state, case and when as the equalities they test, #{expr} as interpolation and !{expr} as bound html, a tag's = and != as buffered output, a dot as block text, an attribute with an expression as ng-class, ng-href, ng-disabled or ng-attr as its name decides and a value that carries spaces read as the JS expression it is, li: a as a tag and its inline child. extends and block compose the way the compiler composes them, block append and prepend included, a held include is inlined and a non Pug include lands as text, and a mixin defined in the file, in the child or the layout, expands at its call with its arguments substituted and named. Unbuffered code, a filter, &attributes and a mixin called with a block are named rather than approximated. The locals a view reads are its inputs, from the expressions only. .pug and .jade reach the scan. test/pug.test.js holds it.

## Phase 116: the fifth review pass

**600. The Pug reader reviewed on its own, eight defects fixed with the inputs that exposed them** 🔨
The review cadence held for the fifth time: input-pug was read on its own before the next reader began, and eight shapes real Pug writes came back wrong. An attribute list written over several lines never closed on its first line and became text, so parseTree now joins lines until the bracket that opened closes. A bare boolean between two valued attributes (type="checkbox" checked name="x") was swallowed into the value before it, so the splitter now ends a value where the next word is a bare attribute followed by another. An include at the top of a template that extends a layout, the usual home of a project's mixins, was dropped before the page composed, so includes inline first and their mixins are declared before the blocks fill. A mixin's block was replaced by a node with no line, which read as a div, so the caller's children are spliced in where block stood and the note that once named the gap is gone because the gap is. An outer loop's index read inside a nested loop was renamed to the inner $index, a silent wrong value, so inside a nested repeat it is written as $parent.$index, the dialect's own spelling for the outer scope, and named for the port to carry. An empty when, which falls through to the next in Pug, rendered nothing under its own test, so its equality now joins the next body's test with an or. A parameter followed by == was skipped by the guard that protects attribute names, so the guard now excepts a second equals. And a layout named relatively (extends ../layout) was not recognised as a layout and was ported as a screen of its own, so names are bared of their leading dots and their extension before they are compared, in .jade as in .pug. Three smaller ones came too: a hyphenated mixin name, a single quoted attribute carrying double quotes (kept as entities, not rewritten), and #[strong word] lowered as the tag it is. Each fix carries the input that exposed it in test/pug.test.js.

## Phase 117: the natural template

**601. input-thymeleaf reads Thymeleaf, the natural template of the Spring world, and composes it the way the engine does** 🔨
Thymeleaf is valid HTML whose prototype text and attributes are replaced at render time by th: attributes that sit beside them, which makes it the server dialect closest to the attribute dialect the rest of the tool reads; the lowering is mostly a renaming and the prototype text is what the engine throws away. th:if and th:unless lower onto ng-if, th:each with its status variable onto ng-repeat with the status fields (index, count, first, last, odd, even, size) written as the arithmetic on $index every target already carries, th:text onto the interpolation that replaces the prototype text, th:utext onto bound html, th:href and th:src with their link expressions (@{/products/{id}(id=${p.id},q=${q})}) onto ng-href and ng-src with the path variables and query filled, th:class and th:classappend onto one ng-class, th:attr onto each attribute it names, th:switch and th:case onto the equalities they test with * as the negation of the rest, th:field onto a two way model with the name and id the engine would have generated, th:with onto substituted aliases, th:object onto the prefix *{...} selects with, th:remove onto its four spellings, th:block onto a transparent container, [[...]] and [(...)] inline output onto an interpolation and bound html, and a prototype only comment onto the markup it hid. The expression language's words (and, or, not, eq, gt, the Elvis ?:, a ? with no else) are spelled as JavaScript outside strings, the utility objects with an exact equivalent (#lists.isEmpty, #strings.toUpperCase, #strings.listJoin) are rewritten, a formatter (#dates, #numbers) keeps its value unformatted and named, and any other utility stays the call it was with the object named as something the port must supply. th:fragment with th:insert, th:replace and th:include compose the way the engine composes them, positional and named parameters substituted and a fragment passed as an argument inserted where ${it} is asked for; the Layout Dialect's layout:decorate and layout:fragment compose a page into its layout, the layout and a fragment only file skipped as chrome. A message key (#{...}) is kept as its key and named, because the bundle is not in the markup and no text is invented; a th:onclick that built script from data is named and never carried; th:errors is named as validation the port must do itself. The same product page written in Thymeleaf is the seventh dialect the byte identity gate holds to jinja's React, Vue and Svelte. And the four readInputs the readers each wrote are one, in dsp-ir/text.js, reading an address around an expression as the expression alone, held to one definition by the hygiene gate. test/thymeleaf.test.js holds it.

## Phase 118: the sixth review pass

**602. The Thymeleaf reader reviewed on its own, ten defects fixed with the inputs that exposed them** 🔨
The review cadence held for the sixth time, and two of the ten reached past the new reader into the IR every reader shares. The older fragment spelling, th:replace="frags :: legal" with no ~{}, still the commonest in Spring apps, was read as an expression and dropped as a render time choice; it is a fragment spec. A void element carrying both th:each and th:if left with a closing tag, because the repeat and test path returned before the void check. A selection with a utility inside it, *{#maps.isEmpty(attrs)}, had the object prefixed onto names the rewrite itself introduced (f.Object.keys, f.fields); the fields are prefixed first, on the source, and the rewrite runs after. th:classappend written before th:class produced two ng-class attributes, because the attributes were applied in source order rather than the engine's; appends now apply after what they append to. th:field named only the last segment of its path, so billing.zip and shipping.zip collided on name and id; the whole path under the object is what the engine renders. A :: selector inside a fragment cloned from another file resolved against the host page's fragments, and crashed a direct caller with none; a fragment now remembers the file it came from. A whole template inserted with ~{footer} brought its html and body wrapper, and the screen's body extraction stopped at the first close it met, dropping everything after; the wrapper is unwrapped and the extraction reads to the last. A template was found by its basename alone when its path did not match, so ~{admin/nav} silently composed public/nav.html; that was a guess, and a template is now found by its path or a suffix of it or named as missing. In the IR, rootIdentifiers took every name before a colon for an object key, so the then branch of a ? b : c was never a read and never a prop in any target; a key is only a key after { or a comma. And the $ boundary fix let $ctrl, $root and $scope surface as props verbatim; every $ name is the scope's machinery and none is a prop. Each fix carries the input that exposed it in test/thymeleaf.test.js and test/ir.test.js.

## Phase 119: the PHP generation's template

**603. input-smarty reads Smarty through the jinja lowering, one lowering serving three dialects** 🔨
Smarty was the template engine of a generation of PHP applications, and its grammar is jinja's shape under different braces: {$var} with its |modifier chains, {if}/{elseif}/{else}/{/if}, {foreach ... as} with {foreachelse}, {section}, {include file=}, {extends file=} with {block name=} and its append and prepend, {assign}, {literal}, {* comments *} and a library of function plugins that rendered widgets on the server. input-smarty rewrites the Smarty spellings onto jinja's at the tag level and hands the result to the jinja lowering, which already composes inheritance, inlines held includes and names what it cannot carry, as input-twig does; one lowering, three dialects. Expressions are spelled as JavaScript on the way: $var loses its sigil, -> becomes a dot, $a.$b becomes a[b], the word operators (eq, ne, gt, lt, ge, le, mod, is even, is odd) become their signs, a modifier binds to the variable or string just before it as Smarty reads it, and a modifier with an exact equivalent (upper, lower, count, default, cat, replace, trim, truncate) is rewritten while one that formatted its value on the server (date_format, number_format, string_format) is dropped and named, leaving the value unformatted. The foreach properties, $item@index, @iteration, @first, @last and @total and their $smarty.foreach.name spellings, are the arithmetic on $index every target already carries; a named key reads as the index; a section's $items[i] reads as the row it stands on. {block name=x append} and prepend are super() on the side they name, which the jinja lowering composes. A function plugin ({html_options}, {cycle}, {math}) rendered on the server and is named, never approximated; {php} is named and never carried; {capture} leaves its content where it was captured and names the later read; $smarty.get, .post, .session and .server are context the port must supply, named as such; a brace followed by whitespace is the literal text Smarty 3 reads it as, and {literal} keeps its braces. A template is found by its path or a suffix of it, never by its basename alone. .tpl reaches the scan, and a .tpl file that holds <% is left to the underscore reader. The same product page written in Smarty is the eighth dialect the byte identity gate holds to jinja's React, Vue and Svelte. test/smarty.test.js holds it.

## Phase 120: the seventh review pass

**604. The Smarty reader and the shared lowering reviewed, ten defects fixed with the inputs that exposed them** 🔨
The review cadence held for the seventh time, and this pass reached the jinja lowering three dialects share and the readInputs every reader shares. The ternary a condition inside an attribute folds into was spliced in raw, so a double quote in its test ended the attribute; it goes through attrSafe like every other test. A filter inside such a branch ({{ t|truncate(5) }}) became a JavaScript bitwise or, so the filter is dropped and named and the value goes in unformatted. A > inside an earlier {% if a > 1 %} in the same attribute read as a tag close and the second chain fell back to a container inside the attribute; template spans are set aside before the markup is scanned. readInputs stripped a filter's arguments with its name, so a variable passed to a filter ({{ items | filter:search }}) was no longer an input; only the name goes, and track by is never a name. In the Smarty reader, PHP functions called in expressions (isset, empty, count, in_array, strlen, implode, str_replace) carried into the port as calls nothing defines, so the ones with an exact equivalent are rewritten, a formatter (number_format, date, sprintf) keeps its value unformatted and is named, and any other is kept and named as something the port must supply. A numeric key ($list.0) became list.0, a syntax error; it is the index it means. |replace replaced the first occurrence where Smarty replaces every one. nl2br, strip_tags, wordwrap, indent and spacify changed a value and were dropped in silence; they are named with the other formatters. An {assign} inside a branch or a loop was substituted as if it were the only one, a wrong value that looks right; inside a branch or loop it is carried as a set and named. A layout in a subdirectory was composed into its children and still ported as a screen, because the skip matched the whole path where the resolver matched a suffix; both match the same way. Each fix carries the input that exposed it in test/smarty.test.js.

## Phase 121: a screen named like an element

**605. A screen whose name is an HTML element's is never what an element of that name refers to** 🔨
The Smarty fixture's partial is nav.tpl, and a partial is also a screen of its own, so the run held a screen called nav. Every target resolves a tag naming another screen in the run to that ported component, which is how a shared component composes with nothing target specific added; here it made every <nav> element in every screen a reference to the nav partial, in React by the components map, in Vue and Svelte by the tag rewrite and in the graph by the composition edge, and CI caught it where the suite had not, because the suite checked the lowered template and not the React the partial was composed into. An element is never a reference to a screen named like it. dsp-ir now carries the one list of HTML and SVG element names, and every place a selector is taken for a tag, the IR's known set, output-react's components map, output-vue's and output-svelte's rewrite and vis-graph's edges, skips a selector on that list; the screen is still ported under its own name and a note says nothing composes it by that name. The hygiene gate holds the list to one home, and the Smarty run test now reads the React and not only the template.

## Phase 122: the CI's own steps, before the push

**606. tools/ci-local.mjs runs the workflow's exercise steps locally and names the first that fails** 🔨
The suite proves what the tests assert; the workflow's hundred odd exercise steps prove what the emitted files hold, with grep and cmp over real runs, and those only ran on the server. 9.69 was caught by one of them after the suite had passed here, which is the wrong order. tools/ci-local.mjs reads the workflow file, whose shape is regular (a named step and its run, one line or a block), and runs the check job's steps in order with bash under set -e and pipefail, printing ok or FAIL per step with the failing step's last lines, stopping at the first failure unless told to keep going. Steps are chosen by name (--only smarty), skipped by name or by a word in their script (--skip "npm test"), listed (--list), the one step that reaches the network to install the optional reader is skipped unless named, and the three that can only pass with that reader installed are skipped and say so when it is not. The parser is held to the workflow: a test counts the named steps in the file and asserts every one was parsed with its run, so a step written in a shape the parser does not read fails the suite rather than being silently skipped; another runs a real step of this repository's workflow from the command line. npm run ci-local is the script and the run it playbook names it. test/ci-local.test.js holds it.

## Phase 123: the enterprise Java page

**607. input-jsp reads JSP with the standard tag library, and the markup tree Thymeleaf and JSP share has one home** 🔨
JSP with JSTL was the enterprise Java page for twenty years: HTML with <c:if>, <c:choose>, <c:forEach> and <c:out> around it, the expression language's ${...} inside it, <fmt:> for messages and formats, fn: functions, jsp: actions, the directives that name tag libraries and include other pages, and the scriptlets that ran Java where a tag would not do. input-jsp lowers the tags onto the dialect: c:if onto ng-if, c:choose with its when and otherwise onto the chain negated the way the container evaluates it, c:forEach with its varStatus onto ng-repeat with index, count, first and last as arithmetic on $index and a bounded range named, c:out onto an interpolation, a default folded in, or bound html when escapeXml is false, c:set onto a substituted alias where the value is fixed and named where it depends on a branch or reads itself, c:url with its params onto the address it builds, a static include (<%@ include %>) and a dynamic one (<jsp:include>) onto the page they name with passed params named, jsp:getProperty onto its read, and the Spring form tags (form:form with its model, input, textarea, select with items, checkboxes, label, errors named) onto a two way model with the name and id the tag would have rendered. EL is spelled as JavaScript outside strings (and, or, not, eq, empty, the fn: functions with an exact equivalent rewritten), a formatter (fmt:formatNumber, fmt:formatDate) keeps its value unformatted and is named, a message key (fmt:message, spring:message) is kept as its key, an implicit object (param, sessionScope, pageContext) is named as context the port must supply, and a tag from a library the reader does not know is named with its content standing. A scriptlet is named and never carried; a Java expression (<%= %>) is kept as written inside an interpolation and named; a .jspf fragment is composed, not ported as a screen. The markup tree the Thymeleaf reader built is now dsp-ir/markup.js, one parser both readers import and the hygiene gate holds to one home. JSTL pages leave input-static's hands, .jspf and .jspx reach the scan, and the same product page written in JSP is the ninth dialect the byte identity gate holds to jinja's React, Vue and Svelte. test/jsp.test.js holds it.

## Phase 124: the eighth review pass

**608. The JSP reader and the local CI runner reviewed, ten defects fixed with the inputs that exposed them** 🔨
The review cadence held for the eighth time. In the JSP reader, six places still quoted a literal by hand after the hygiene pass had introduced quoteJs, so an apostrophe in a c:out default or a fmt value broke the expression; one helper now spells a value wherever JavaScript is wanted, an expression as itself, a literal quoted, text around expressions as a concatenation, and c:out prints a literal or an interpolation as the text it is rather than an interpolation inside an interpolation. A dynamic include was parsed without its scripts and styles stripped, unlike the page and a static include, so a footer's script landed in the template; it is stripped the same way. A Spring form cssClass was copied raw, so an expression in it survived unlowered; it goes through the text lowering, an own id or name is kept rather than doubled, and checkboxes honour itemValue and itemLabel like a select. A test with a trailing space or two expressions became a quoted string and read as always true; it is trimmed and a mixed one is read as the concatenation it is and named. An inner c:forEach that reused the outer loop's status name deleted the outer aliases when it closed, leaving a later read unlowered and an input invented; the outer status is restored. The bare function stripped jsp, views or pages without requiring a slash after them, so viewstate.jsp became tate, and two pages that bare to one name overwrote each other's emitted file; the slash is required and a colliding page keeps its whole path or a counted suffix, named. A spaceless ternary (a ? b:c(x) : d) read as a tag library call; only a declared prefix names one, which is what the prefixes the directives record are for. In the runner, a step that fails or is interrupted may leave files it would have removed on success, one of them a planted secret that makes every later demo fail at the secret gate with no hint why; the runner now names what appeared and removes those untracked paths with --clean and nothing else; a spawn failure names the missing shell instead of printing NaN; and zero parsed or matched steps is a failure, because nothing run proves nothing. The template resolver the tag readers and Smarty and Pug each wrote is one, in dsp-ir/text.js, held to one home. Each fix carries the input that exposed it in test/jsp.test.js and test/ci-local.test.js.

## Phase 125: the intranet's page

**609. input-cfml reads ColdFusion Markup, the tag language a generation of intranets and shops were written in** 🔨
CFML is HTML with <cfif>, <cfloop>, <cfswitch> and <cfoutput> around it, #expressions# inside a cfoutput, <cfset> and <cfparam> for variables, <cfinclude> for shared markup, <cfquery> for SQL in the page, <cfscript> for code, and a library of functions whose names are its own. input-cfml lowers the tags onto the dialect: cfif with its cfelseif and cfelse onto the chain negated the way the engine evaluates it, and a cfif inside an attribute value onto the ternary it means; cfloop over an array onto ng-repeat (with item and index tracked), over a list onto ng-repeat over the list split on its delimiter, over a collection onto the key and value form, over a query onto rows with unqualified names read as the row's columns the way the engine resolves them and named, and a counted or conditional loop kept once and named; cfswitch and cfcase with their value lists onto the equalities they test; cfoutput onto the interpolations it turned on, a doubled ## the literal # it is; cfset onto a substituted alias where the value is fixed and named where it depends on a branch or reads itself, cfparam's default named; cfinclude onto the page it names; cfform, cfinput, cftextarea and cfselect onto a form and its inputs with the server side validation attributes named. Expressions are spelled as JavaScript outside strings: EQ, NEQ, GT, LT, GTE, LTE, IS, AND, OR, NOT, MOD and the spelled out forms become their signs, a lone & becomes +, a doubled quote inside a string is the quote and a #x# inside one is a concatenation; Len, ArrayLen, UCase, Trim, IsDefined, StructKeyExists, ArrayIsEmpty, Replace with ALL, Left, Right, Val, ListLen and their kin are rewritten, DateFormat, NumberFormat, DollarFormat and the other formatters keep their value unformatted and are named, and a function the reader does not know or the application defined is kept and named. CFML arrays are one based, so a literal index is shifted and a variable index is shifted and named. A query, a cfscript block, a custom tag, a cflocation, a cfsilent's output and the url, form, cgi and session scopes are named as what the server did or supplied and never carried, and Application.cfm and OnRequestEnd.cfm are the application's own files, not screens. .cfm and .cfml reach the scan and the census. The same product page written in CFML is the tenth dialect the byte identity gate holds to jinja's React, Vue and Svelte. test/cfml.test.js holds it.

## Phase 126: the ninth review pass

**610. The ColdFusion reader reviewed on its own, ten defects fixed with the inputs that exposed them** 🔨
The review cadence held for the ninth time. Inside a query loop every name was prefixed as a column, variables.x and session.x and the name of a nested query among them, a wrong value that looks right; a bare name is a column and a dotted or scoped name is a variable, the way the engine falls through, the nested query's own name is resolved outside the row, and the note says exactly that. Twenty odd tags that stand alone (cffile, cfhttp, cfimage, cfschedule and the rest) were parsed as containers, so the rest of the page nested inside them and vanished with their silence; where the page never closes one it closes itself. cfsilent zeroed the output counter and never restored it, turning interpolation off inside its cfoutput and on for the rest of the page; the previous state is restored. A cfif folded from attribute position evaluated only inside a cfoutput; it evaluates always, as a tag does. Only files with cf tags could be included, so a plain HTML header was reported missing though it stood in the run; every .cfm can be included and only those with cf tags are screens. The alias check inside a row was case sensitive where CFML is not, and a nested query loop deleted the outer loop's currentRow; aliases read case blind and the outer loop's are restored. yes and no were rewritten to booleans after a dot, so invoice.no became invoice.false; a key stays a key. A cfelse buried inside an element the cfif opened, the idiomatic table row shape, was silently merged into the true branch; it is named. The cfscript strip was the one case sensitive match in the reader, so <CFSCRIPT> survived into the tree unnamed; it is case blind. And a bracket inside a string literal read as a function call with a false note; strings are set aside before functions are read. Text outside a cfoutput is now literal, ## included, as the engine leaves it. The value spelling helper and the attribute lookup the JSP and ColdFusion readers each wrote are one, in dsp-ir/text.js and dsp-ir/markup.js, held to one home. Each fix carries the input that exposed it in test/cfml.test.js.

## Phase 127: the Rails view

**611. input-haml reads Haml from its indentation and composes a page into its layout with its partials** 🔨
Haml was the template language of a generation of Rails applications: a tree written as indentation, %tag.class#id with a Ruby hash or a bracket list of attributes, text after the tag, = for an expression's value, - for a line of Ruby that shapes the tree, #{} inside text, and the helpers Rails gave a view. input-haml reads the tree from the indentation, a hash or bracket list left open running onto the next line, and lowers it onto the dialect: if with its elsif and else chain negated the way the engine evaluates it, unless as the negated test, case and when with their value lists as the equalities they test, each and each_with_index and for onto ng-repeat with the index as the dialect's own and a pair of block variables as the key and value form, an attribute with an expression as ng-class, ng-href, ng-disabled or ng-attr as its name decides, = as an interpolation and != as bound html, a local set with = substituted where its value is fixed and named where it depends on a branch or a loop, a layout's yield filled by the page (app/views/layouts/application.html.haml is chrome and every page renders inside it), render "shared/nav" resolved to shared/_nav.html.haml and lowered where it is asked for with its locals named, link_to and image_tag and content_tag as the elements they render, form_for and its f.text_field, text_area, collection_select, label and submit as a form with two way models named the way Rails names them. Ruby is spelled as JavaScript outside strings: @ivar is the input it is, a symbol is a string and a symbol index a property, present?, blank?, empty?, any? and nil? are the tests they mean with empty? on a collection the dialect's own empty state, size, upcase, downcase, strip, first, last and to_s are their equivalents, and a string's #{} is a concatenation. number_to_currency, pluralize, time_ago_in_words and the other formatters keep their value unformatted and are named; a route helper (root_path, product_path) is a route the server owns and is named; t(...) keeps its key; a filter (:javascript, :markdown), content_for, a Ruby line the reader cannot read and a helper it does not know are named rather than approximated. .haml reaches the scan and the census, and the same product page written in Haml is the eleventh dialect the byte identity gate holds to jinja's React, Vue and Svelte. test/haml.test.js holds it.

## Phase 128: the tenth review pass

**612. The Haml reader reviewed on its own, ten defects fixed with the inputs that exposed them** 🔨
The review cadence held for the tenth time. A line of prose under a tag was parsed as a tag, so every multi line paragraph became a div per line; a line that does not begin a tag is text. A sentence ending in a comma ran onto the next line as if it were a Ruby argument list; only a line of Ruby continues on a comma. A block helper other than a form or an each (= link_to ... do, content_tag do) dropped its indented body and printed the do; link_to and content_tag wrap their body in the element they render and any other block helper keeps its body and is named. empty? lowered unbracketed everywhere, so !x.empty? read as (!x)... and inverted the branch; it is bracketed except as the whole test, which the byte identity gate holds. A form field's arguments were cut at a bracket that was never opened, so a select over options_for_select(sizes) lost its close; the argument list reads to its own bracket, and fields_for nests its model. A predicate's receiver stopped at a bracket, so foo(x).present? and items[0].blank? became syntax errors; the receiver is found by walking back over balanced brackets, and to_i, to_f and capitalize ride the same walk. A bare partial name resolved by path suffix across the whole tree, so products/new could be composed with orders' form; a bare name is found beside the view that renders it first, and a partial that renders itself is named where the reader stops following. A postfix if or unless passed into the binding as invalid JavaScript; it wraps the line in the container it means, and &:name is the block that reads one method. A nested data: hash became one attribute holding an object; it is the data-* attributes Haml renders. And the lines into a tree by indentation that Pug and Haml each wrote are one, in dsp-ir/markup.js, each dialect saying only when a line runs on, held to one home. Each fix carries the input that exposed it in test/haml.test.js.

## Phase 129: one lowering, two Rails dialects

**613. input-slim reads Slim on the Haml lowering, the line grammar the only thing its own** 🔨
Slim is Haml's terser successor in the Rails world: the same tree written as indentation and the same Ruby in it, with the tag's own name where Haml writes %, attributes as name=value pairs after the tag or inside brackets, | and ' for text, == for unescaped output, / and /! for comments, tag: for an inline child, and javascript: or css: for an embedded block. The Haml lowering now takes a line grammar, what a comment, a filter, a text line, an output line, a code line and a tag look like, and the plugin body that composes the layout around a page, resolves partials beside the view and pushes screens is one factory both readers call, so input-slim is a line grammar and nothing else: a tag parser that reads the tag's own name with its classes and id, its attributes bare or wrapped with a value that may hold spaces inside brackets, a splat named, = and == output, : an inline child and / a self close, and a parse of the tree in which a bracket left open or a Ruby line ending in a comma runs on. Everything else, the control lines, the loops, the layout's yield, the partials, the form and link helpers, the Ruby spelled as JavaScript and every note, is the Haml reader's, which is how the two dialects cannot drift apart. .slim reaches the scan and the census, and the same product page written in Slim is the twelfth dialect the byte identity gate holds to jinja's React, Vue and Svelte. test/slim.test.js holds it.

## Phase 130: the eleventh review pass

**614. The Slim reader read again, and the Haml lowering with it** 🔨
A review pass over input-slim and the shared Rails lowering, each finding fixed with the input that exposed it as a test. A lone * in a tag's text was read as a splat and dropped; now only * before a name spreads attributes, and the text keeps its asterisk. Slim's whitespace markers, < and > after the tag, were read as the tag's name running on; they stand after the tag and change spacing only. A Ruby line ending in a backslash continues onto the next, as a comma does, and the backslash is stripped. Inside a wrapped attribute list a splat before the pairs stopped the read, so `a(*link_attrs href="/x")` lost its href; the read now names the splat and goes on, and a bare name in the wrapper is the boolean Slim renders as an empty value. A text block nested more than one level deep lost its inner lines; they are flattened into the text. An inline `li:` with nothing after the colon lowers its children as the tag's body. The grammar predicate that told Haml's plain lines from Slim's was an identity check on the grammar object; it is now a `plain` entry each grammar carries. The Slim tag parser returns the notes it gathered so the lowering can voice them, and a fallback branch that dropped its children lowers them. test/slim.test.js holds it.

## Phase 131: the Play view

**615. input-twirl reads Twirl, the Play Framework's template language, with the Scala inside spelled as JavaScript** 🔨
A Twirl template is a Scala function whose body is markup: its parameters declared on the first line as `@(product: Product)(implicit request: RequestHeader)`, and Scala reached from the markup through one character. The reader parses the header into typed parameter groups and lowers each construct that shapes markup onto the dialect: `@if(c) { } else if (d) { } else { }` as the chain negated the way the compiler evaluates it, `@for(x <- xs) { }` with `(x, i) <- xs.zipWithIndex` as a loop whose index is the dialect's own and a guard as a condition inside it, `@xs.map { x => }` as a loop, `@x match { case Some(v) => { } case None => { } case "a" => { } case n if n > 2 => { } case _ => { } }` as the tests those patterns mean with a pattern the client cannot test named, `@defining(e) { x => }` as an alias, `@Html(raw)` as bound html, `@@` as one @, `@* *@` dropped, `@{ block }` interpolated when it is an expression and named when it declares a val. Whether `.map { }` is a loop or a presence test depends on the receiver's type: a parameter the header declares as an Option is a presence test, one declared as a collection a loop, an undeclared receiver a loop with the assumption named, and a `.getOrElse { }` after the block proves an Option whatever was declared, because a collection has none. The Scala is spelled as JavaScript outside strings, with s interpolation as concatenation, Some and None, getOrElse, isEmpty, nonEmpty, isDefined, size, head, last, mkString, contains, take, exists, forall, the placeholder lambdas and the inline if rewritten, and a formatter named with its value interpolated unformatted. What the server supplied is named rather than approximated: the reverse router, a Form and the fields `helper.inputText(form("name"))` bind (emitted as the input with its model), `helper.form(action = ...)` as the form, `messages("key")` as its key, `CSRF.formField`, the request, the flash and the session. A layout is applied as a call, `@main(product.name) { body }`, whose template takes the body as a parameter typed Html: the reader binds the call's arguments to the layout's parameters, substitutes the body where the Html parameter is rendered, and skips the layout as a screen of its own with a note; a partial called the same way is inlined with its arguments bound and is a screen of its own besides. Twirl is the thirteenth dialect the byte identity gate holds to jinja's React, Vue and Svelte. Three defects the new reader exposed are fixed for every reader at once: a `class` attribute that interpolates is now a static class and an expression class in the IR rather than a literal `{{ }}` in the output, input-react reads a loop over a call chain such as `related.slice(0, 3).map(...)`, and the reader census counts a layout a reader composed into its pages as read rather than as markup no reader claimed, for the Rails readers as well. test/twirl.test.js holds it.

## Phase 132: the twelfth review pass

**616. The Twirl reader read again** 🔨
A review pass over input-twirl, each finding fixed with the input that exposed it as a test. A licence comment before the header made the header leak into the page as an interpolation and lose its types; the comment is dropped and the header read. Aliases were substituted one after another on the already substituted text, so a partial called with `(related.head, product.related)` rewrote `product` twice; every alias is now one pass. `getOrElse` and `get` assumed an Option, so a Map's `getOrElse(k, d)` became a comma expression and `get(k)` a call; the argument list is read after the receiver, and two arguments index the map. `isEmpty` and `nonEmpty` were always a length test, which inverted the condition on an Option of a value; the declared type decides, and an Option of anything without a length is a presence test. `.map` decided loop or presence by the root's declared type, not the receiver's, and `@for` never consulted a type at all; the receiver's own declaration decides and a declared Option in a `@for` runs once when present. A layout call whose first argument was a literal, or that passed a second argument group, fell through to interpolation with its braces in the page; both are calls, and the extra group is named as unbound. A child scope did not carry the layout's content marker, so a layout rendering `@content` inside a `@defining` was judged never to render it and dropped; the marker travels with the scope, as the two way flag now does, so a field inside a loop makes the screen two way. A form passed into a partial under another parameter name bound its fields to the partial's local name; the alias is applied. The attribute test stripped only `@if` spans, so an earlier `@(a > 1)` in the same tag put an element inside an attribute; every Twirl span is stripped. A typed lambda, `{ (p: Product) => }`, leaked its header as text; the types are read past. And the notes carried argument text, a code block's body, a pattern's arguments and a format string, any of which could be a value; each now names positions, declared names and the extractor alone. input-static's ownership marks were words after an @, so a page carrying an e-mail address was left to no reader; they are Twirl's shapes. test/twirl.test.js holds it.

## Phase 133: bound html keeps its element

**617. An element that binds html stays the author's element in every target, and the round trip reads back what the printers write** 🔨
`<p class="note" ng-bind-html="x">` became a bare html node in the IR, so every target printed a `<div>` the author never wrote and lost the `<p>` and its class; React nested that div inside the parent, which is invalid inside a paragraph, and the round trip counted the extra element and reported eight fixtures drifted. The element now stays, with the html as its only child, and each target carries it its own way: React as `dangerouslySetInnerHTML` on the element, Vue as `v-html`, Angular as `[innerHTML]`, Alpine as `x-html`, Solid as `innerHTML`, Svelte as `{@html}` inside the element and Lit as `unsafeHTML` inside it. The React reader reads that prop back as the dialect's binding, reads a textarea, a select and a checkbox bound with onChange as the models they are (an attribute list is read past the `>` inside an arrow handler), and reads `Object.entries(map).map(([key, value]) => ...)` as the (key, value) loop the printer wrote for an object; the Svelte reader reads `{#each Object.entries(map) as [key, value]}` the same way. Every dialect fixture now round trips with no drift, and test/boundhtml.test.js holds the element in seven targets, the read-back, and the three fixtures that drifted most.

## Phase 134: the thirteenth review pass

**618. The bound html change read again, across the IR, five printers and two readers** 🔨
A review pass over the bound html change, each finding fixed with the input that exposed it. The React reader's model regex allowed one brace level, so a handler with a block body or an object literal lost its model silently, and that included the printer's own model plus change handler output, so the round trip the change claimed regressed; the tag is now read to the > at brace depth zero and the handler removed by its matching brace. The entries loop matched `Object.entries(`, its `)` and the `[k, v]` head independently, so a map over tuples and a chain after `Object.entries` were lowered as the object loop over the wrong list; the two shapes are matched whole, a tuple map and a chained entries are kept once and named, and a map index the dialect spells `$index` is named when it carries another name; the Svelte reader's entries argument must be balanced and whole, or the each is left as written with its closing marker. The IR converted the children an html binding replaces, so placeholder content registered reads that became props; they are set aside and named. A void element cannot hold html and a control's value is its content, so those two bindings are dropped and named rather than printed as what React throws on. A tagless wrapper carrying html reached Vue as `v-html` on a `<template>`; it falls to the html case. Knockout's wrapping loop over an element that also binds html per row has no row element of its own, and says so. The sole html child test the five printers each restated is one helper, `boundHtml`, in the IR with one home. test/boundhtml.test.js holds it.

## Phase 135: the Django view

**619. input-django reads Django's template language on the jinja lowering, its own spellings rewritten and what the server did named** 🔨
Django's template language is jinja's grandparent with spellings of its own, and a template using any of them was read by input-jinja with those spellings dropped: `{% empty %}` fell through so the empty state rendered always, `{% ifequal %}` lost its test, a `{% comment %}` block kept its body, `{% url %}` inside an href left it empty, `forloop.counter` reached the port as a name nothing defines, and a filter argument after a colon reached it as written. input-django claims a template by a spelling only Django has (its tags, `forloop.`, a colon filter argument) and input-jinja leaves those files to it. The reader rewrites Django onto jinja and hands the result to the jinja lowering: `{% empty %}` is a for's else, `{% ifequal %}` and `{% ifnotequal %}` are the tests they mean, a `{% comment %}` block is gone, `{% with %}` and `{% blocktrans with %}` bind names for their block and each read is replaced with what it named (the plural form named and the singular carried), `{% trans %}` stands as its source text and is named, `{% static %}` keeps its path with the prefix named as the deployment's, `{% url %}` is kept as a call to `url`, the reverse router the port must supply, and the `as` forms of all three bind where they are read, `{% firstof %}` is the `||` chain, `{% widthratio %}` the ratio unrounded and named, `{% cycle %}`, `{% now %}`, `{% regroup %}` and `{% lorem %}` are removed and named, an include's `with` names are named, `reversed` is named, `forloop.*` is jinja's `loop.*`, and `{{ x|date:"Y" }}` is the call jinja spells with parentheses. The jinja lowering learned two things for every dialect riding it: `for key, value in map.items()` is the (key, value) loop over an object rather than a tuple that dropped its second name, and `loop.index0`, `loop.index` and `loop.first` are the dialect's own index spelled, with the rest still named. `{% extends "base.html" %}` composes the page into its base, the base is chrome the census counts as composed, and an include is a screen besides. Django is the fourteenth dialect the byte identity gate holds to jinja's React, Vue and Svelte. test/django.test.js holds it.

## Phase 136: the fourteenth review pass

**620. The Django reader read again** 🔨
A review pass over input-django, each finding fixed with the input that exposed it. Django was detected per file, so a child template written only in the tags jinja shares, extending a Django base, was read by input-jinja against the raw base and lost every url, trans and static while the census called the base unread; a template is Django's by its own spellings and so is every template in its tree, the base it extends, the include it names, the child that extends it, and input-jinja leaves alone every file another reader already read or composed. Two apps' templates of one name collapsed to one selector and the second overwrote the first on disk, and `{% extends "base.html" %}` took the first of two bases by path; the selector keeps the app when the bared path would collide, a child's own app answers first, and a tie across apps is named. `|safe`, `|urlencode`, `|linebreaks`, `|striptags` and their kin were dropped silently, changing what the value meant; each dropped filter is named by what it meant. `{% url %}` keyword arguments lost their names and became positional; they travel as an object. A `{% blocktrans with %}` value quoted with a space was cut at the space and an unbalanced quote reached every emitter; the quoted alternation the `{% with %}` parser already had is shared. `{% blocktrans asvar %}` printed its text where the block stood and left the name unbound; the name is bound to the text and nothing is printed. A colon filter argument in a for's list or a url's argument survived into an expression no target evaluates; every tag's expression is rewritten. The include note printed the bound expressions and fired for `only`; it names the names, and `only` is its own fact. A name a removed tag defined, `regroup ... as` and `cycle ... as`, and a `trans ... as` name read inside a tag's test, reached the port as an input nothing supplies; defined names are excluded from the inputs and named, and aliases are read inside tags too. The detector claimed jinja's own `{% trans %}` block and `{% autoescape true %}` and a Liquid page's `{% comment %}` and colon filter; it knows those spellings apart. `loop.index` was rewritten in prose and outside any loop; it is spelled only inside a loop's own template spans. And a `{% with %}` name a loop inside the block rebinds keeps the loop's own. test/django.test.js holds it.

## Phase 137: the Express view

**621. input-ejs reads EJS on the underscore lowering, the escaping the right way round and the includes inlined with their locals bound** 🔨
EJS is the template language of a decade of Express apps: underscore's delimiters with the escaping the other way round, `<%= %>` escaped and `<%- %>` raw, plus `<%# %>` comments, `<%_ _%>` and `-%>` whitespace control, `<%%` for a literal `<%`, and `include('path', { locals })` that inlines another file with names bound. Until now an .ejs file was read by input-underscore with underscore's meaning, so every escaped output was warned about as raw and every raw output interpolated as text. input-ejs claims .ejs, rewrites the EJS spellings onto the shapes the underscore lowering reads and hands the result over: the comments are gone, the whitespace markers are read past, a literal `<%` survives the lowering, escaped output is the interpolation it is with nothing to warn about, raw output is bound html, the same trust decision under every target's name, and an include is inlined relative to the including file with each local's reads replaced by what it named and a missing one named. The control flow is JavaScript and the underscore lowering learned the shapes EJS authors write, for both dialects: a forEach with an arrow as well as a function, a list that is a call such as `Object.keys(o)`, `Object.entries(o).forEach(([k, v]) =>` as the (key, value) loop, and an index argument as the dialect's `$index`, named where the body reads it by its own name; the reader spells `for...of` as a forEach, `for...in` as a loop over the keys, and a counted `for (i = 0; i < xs.length; i++)` as a loop over the list with the body's `xs[i]` reads as the item, named. `<%- body %>` is the layout's slot: a layout.ejs beside the views is composed around every page that is not a layout or a partial, counted as composed by the census, and partials are screens besides. EJS is the fifteenth dialect the byte identity gate holds to jinja's React, Vue and Svelte. test/ejs.test.js holds it.

## Phase 138: the fifteenth review pass

**622. The EJS reader read again, and the underscore lowering with it** 🔨
A review pass over input-ejs and the underscore lowering it rides, each finding fixed with the input that exposed it. When a loop with an index closed, every read of that index inside it was spelled `$index`, including reads inside an inner loop, so an outer index read from a nested loop silently became the inner one; the inner loop's range is known to the loop that encloses it, and the outer index inside it is reached through `$parent`, one per level of nesting. An include whose path was computed reached the lowering as an interpolation and its rows became text; it is removed and named. Locals were split at every comma and brace, so a nested literal or a call with commas was cut and its inner keys reported as bound; they are split at the top level and a key read before its first colon, and a shorthand local binds its own name. A nested counted loop's marker was passed over and its bytes reached the emitted markup; each counted loop finds the closer that matches it by depth, innermost first. A dropped opener such as `while` still let its closer pop the enclosing container, so what followed rendered unconditionally; a dropped opener owns its closer. The layout was only ever `layout.ejs`, so `layouts/main.ejs` became a screen carrying the body sentinel; the layout is whichever file renders `<%- body %>`, two are named and one chosen, and the layout is lowered once per run rather than once per page. An include path beginning with `/` resolved against the including file and was reported as not held; it is against the views root. An include cycle was cut only by depth, six copies deep and with the wrong reason; the chain is known and the cycle is named where it repeats. And `for (const [k, v] of Object.entries(o))`, the commonest EJS spelling of an object loop, was dropped; it is the (key, value) loop. test/ejs.test.js holds it.

## Phase 139: jinja's JavaScript port

**623. Nunjucks is read by the jinja lowering, which learned raw blocks, set bindings, the asynchronous loops, and to name an import and a call** 🔨
Nunjucks is jinja ported to JavaScript, and its .njk files never reached a reader because the scan did not keep the extension. input-jinja now reads .njk and .nunjucks, credits them to Nunjucks by name in the census and the provenance, and the lowering learned four things every dialect riding it gets: a `{% raw %}` or `{% verbatim %}` block holds text the engine never read, so its braces are spelled as the strings they are and the dialect prints them rather than reading them; `{% set name = expr %}` binds a name for the rest of the template and each later read is what it named, the note naming the name and never the value, where before the tag was removed as machinery and the reads left dangling; Nunjucks's `asyncEach` and `asyncAll` are the loops they are; and `{% import %}`, `{% from %}` and `{% call %}` are named rather than falling through as unknown, a call's body kept once where it stood. Nunjucks is the sixteenth dialect the byte identity gate holds to jinja's React, Vue and Svelte. test/nunjucks.test.js holds it.

## Phase 140: the sixteenth review pass

**624. The set binding read again, and the Nunjucks path with it** 🔨
A review pass over the Nunjucks change, each finding fixed with the input that exposed it. `{% set %}` substituted every read template wide with the first value it found, so a name set in both branches of an if, a total accumulated in a loop, a set inside one block read from a sibling, and a set inside a loop read after it each became one wrong value that looked right, and a set sharing a loop variable, a macro parameter or a block name rewrote that construct's binding head and broke it; the binding now applies only to a set at the top level, set once, that no for, macro or block rebinds, and only inside interpolations and the expression part of if, elif and a for's list, never a binding head, while every other set is left in place and named as the scope or branch the port cannot follow, which is also what input-smarty's branch assigns asked for. A child's top level set never reached the parent it extends, though both engines make it visible there, the menu highlighting idiom; it is applied to the merged parent. Nunjucks's `elseif` was read as an unknown tag and its branch merged into the one before; it is elif. Raw braces were spelled in double quotes and broke an attribute; they are single quoted. Comments were stripped before a raw block was read, deleting text the block existed to protect; raw is read first. `verbatim` marked a file as Django's, so a .njk using Nunjucks's alias for raw was dropped between the two readers; it is no mark. The layout's scripts and styles came back raw from the loader and reached the port; they are stripped after composing. And the loader search existed twice in input-jinja; it exists once. test/nunjucks.test.js holds it.

## Phase 141: every composed file is counted

**625. Eight more readers record the layout and the fragments they composed, so the census never calls a file it read unread** 🔨
The reader census (READERS.md) counted a file as read only when it became a screen, so a layout a reader composed into every page, blade's `layouts/app.blade.php`, liquid's `layout/theme.liquid`, pug's `layout.pug`, razor's `_Layout.cshtml` and the `_ViewStart.cshtml` that chose it, smarty's and twig's extended templates, thymeleaf's layout and its fragment files, velocity's `$screen_content` chrome, was reported as markup no reader claimed, the row a port owner reads first, and the port owner would have gone looking for a reader that already existed. Each of those readers now records, on every screen it pushes, the files it composed into that screen, the way the Rails, Twirl, Django, EJS and jinja readers already did: blade, pug, smarty and twig the parent they extend, razor the layout and the view start that named it, liquid and velocity the theme or the chrome, and thymeleaf every file its fragment library resolved for the page, the layout and the fragments alike, recorded by the library as it resolves them. A test runs seventeen fixtures and asserts that no fixture leaves a composed file in the unread row, so the honesty holds for every reader at once and a new reader that forgets it fails the suite. test/readers-census.test.js holds it.

## Phase 142: two more of jinja's family

**626. input-pebble reads Pebble, the Java engine modelled on Twig, through Twig's front over the jinja lowering** 🔨
Pebble is Twig's grammar in Java with a handful of spellings of its own, and its .peb files never reached a reader. The reader rewrites Pebble's own spellings onto Twig's and hands the result to the front and the lowering that already exist: `equals` is `==`, `contains` asks a collection or a string through `includes`, `is even` and `is odd` are the remainders they test, `?:` falls back as `||` does, `{% parallel %}`, `{% cache %}` and `{% autoescape %}` wrap a block the port renders once, `{% flush %}` is gone, a `{% filter %}` over a block stands unfiltered and is named, an `{% embed %}` is included as it stands with its block overrides named rather than applied, and a test of a runtime type the client cannot know is left as written and named. A base other templates extend is chrome, composed and counted so. Pebble is the seventeenth dialect the byte identity gate holds. test/pebble.test.js holds it.

**627. input-volt reads Volt, Phalcon's engine, with its framework helpers as the elements they render and the calls the port must supply** 🔨
Volt is jinja's grammar with Twig's tests and PHP framework helpers, and its .volt files never reached a reader. `{{ content() }}` is where a controller drops the view into its layout, so the one layout that renders it is composed around every view that is not itself a layout or a partial, and more than one is named, because Phalcon picks per controller and the run cannot see that. `{{ partial('x') }}` inlines a file, named when it passes parameters or is not held; `{{ link_to('route', 'Text') }}` is the anchor it renders with its route as a call to `url`, the reverse router the port must supply, and `url()` and `static_url()` are kept as that call; `tag.textField`, `tag.select`, `tag.textArea` and their siblings are the fields they render with their models, a field named through an expression dropped and named rather than guessed, and `tag.select` emitted with no options and named; `{% do %}` and an early `{% break %}`, `{% continue %}` or `{% return %}` are named; `{% cache %}` is transparent; `{{ flash.output() }}` is named; `{% elseif %}` is elif. Volt is the eighteenth dialect the byte identity gate holds. test/volt.test.js holds it.

## Phase 143: the seventeenth review pass

**628. The Pebble and Volt readers read again, and the Twig front and the set scope with them** 🔨
A review pass over the two new readers, each finding fixed with the input that exposed it. Pebble counts `loop.index` from zero where Twig and jinja count from one, so every striped table flipped; it is the dialect's own index. `contains` was rewritten inside a string literal and `equals` matched the `.equals(` method; the operator is read outside strings with its right operand in the string part that follows, and the method is left alone. `is even`, `is odd` and `is divisible by` moved into the Twig front so Volt has them too, and a test of a runtime type is named there for every dialect riding the front. The `%` those tests emit into a tag body broke the set scope scan, so a set inside such a condition was bound globally; the scan reads tags whole. Volt's `{% set a = 1, b = 2 %}` bound one name to a comma expression; each is its own set. `{% for x in xs if cond %}` reached the loop as its list; the condition is the loop's first child, closed before the loop's end. Volt spells every helper in snake_case as well as camelCase, and `submit_button`, `image`, `form`, `end_form`, the asset includes and the rest of the tag helpers were interpolations of calls nothing defines; each is the element it renders, removed and named, or named as a helper this reader does not render, and `tag` is no input. A helper's `'key': value` pairs were dropped; they are the attributes they set, a `value` named as the initial model. A partial cycle was cut by depth with the wrong reason; the chain is known and the cycle named. A macro's `{% return %}` was stripped as an early exit; it is the macro's value. And the layout was picked by a name heuristic when several rendered `content()`, with the skipped ones claimed composed; Phalcon's hierarchy is knowable from the tree, views/index.volt around everything and layouts/<controller>.volt around that controller's views first, and a file rendering `content()` outside that rule is named as applied by configuration the run cannot see. test/pebble.test.js and test/volt.test.js hold it.

## Phase 144: a nested loop's index is its own name

**629. Every loop's index is one name in the IR, $parent.$index is the loop above, and Svelte's index is not a store** 🔨
The dialect spells every loop's index `$index` and the loop above it `$parent.$index`, and every printer named each level `$index`, so a nested loop shadowed the outer and a body reading the outer index read the inner one, a wrong value that looked right in every target at once. The IR now converts a repeated node's children inside a frame for its loop, with a name of its own, `$index` for the outermost and `$index2`, `$index3` beneath, resolves a body's `$index` to the innermost frame and each `$parent.` to the frame above, spells the key the same way, and carries the index only when the loop named one or the body read it, so a body reading `$index` under a loop that tracked nothing gets its index where before the name reached the port unbound. An authored index name is kept as the frame's own. Svelte reserves a `$` prefixed name for a store subscription, so its printer spells `$index` and `$index2` as `index` and `index2` throughout the loop's subtree, through one expression walker in the IR that the Lit printer now rides too instead of its own copy. test/loopindex.test.js holds the IR, four printers and an EJS grid through the pipeline.

## Phase 145: the eighteenth review pass

**630. The loop frame stays open for everything a row owns, Angular aliases every index, and a React map's index is spelled by depth** 🔨
A review pass over the nested index change, each finding fixed with the input that exposed it. The frame a loop opened closed before the row's own key, its html binding and the condition AngularJS evaluates per row were read, so `ng-if="$index > 0"` on a repeated row, `track by row.id + '-' + $index` and a bound html reading `$index` each resolved to the loop above or to nothing; every expression a row owns is now read inside its loop, the list alone outside it, and the loop takes its index name once the key or the moved condition turns out to be what read it. Where knockout repeats the children the element's own attributes are outside the rows and were inside; they are outside. knockout spells the same two things `$index()` and `$parentContext.$index()`, and neither was read; both are. A `$parent.$index` beyond the loops open was silently left; a read no open loop answers is kept as written and said. Angular declares `$index` itself in every `@for`, so a nested loop's `$index2` was undeclared and an outer `$index` read inside the inner loop was the inner's; every index is a `let` alias of Angular's own, named through the same rename Svelte uses, which now picks the first of index, idx and nth the screen does not already read rather than colliding with a prop named index, and the block reader carries `let i = $index` back as `index as i` so the emitted Angular reads back byte for byte. Lit's `repeat` calls its key function with the index too, so a key reading it has it. `mapExpressions` skipped an element's dynamic tag and its model; it maps both. A Svelte model indexed into a collection, `vals[$index]`, was bound to a name mangled from it; it binds `vals[idx]` and declares the collection. And the React reader named a map index that was not spelled `$index` and left it as written, so a body reading `i` reached the port reading a prop that does not exist; each row carries the name its map gave the index until one pass over the finished markup spells every read by how many loops up it lives, `$index` in its own rows and `$parent.$index` in the rows below, in code only, copy and static attribute values never touched, and a read inside a template string named rather than rewritten. test/loopindex.test.js holds it.

## Phase 146: the console takes what you have

**631. input-exe reads a native Windows executable as the legacy front end it is: dialogs as screens, menus as menu bars, the string table and the version block** 🔨
A Win32 program's interface is data in its resource section, and none of it needs the code to run: every dialog template names its controls with their class, caption, id, position in dialog units and styles; every menu is a tree of captions and command ids; the string table holds the messages the code shows; the version block names the product. `plugins/input-exe/pe.js` reads the PE headers, PE32 and PE32+ alike, the section table, the resource directory tree and the DIALOG, DIALOGEX, MENU, MENUEX, RT_STRING and VS_VERSIONINFO formats with no dependency and every offset bounds checked, so a truncated or hostile file is a set of problems named, never an exception. The plugin lowers each dialog onto the shared dialect in reading order: a static text beside or above a field is its `<label for>`, an edit is an input typed by its style (password, number, multiline as a textarea, read only), a check box and a radio are what they are with radios grouped by WS_GROUP and named after the group box that holds them, a group box is a fieldset with its legend around the controls inside its rectangle, a combo or list box is a select whose options the code fills at runtime and so is named as a list the port must be handed, a mnemonic ampersand is an `accesskey`, OK is the form's submit handing every field back by name as the dialog's return did, Cancel and every other button are events, a control that starts hidden is shown by a named state and one that starts disabled keeps it, an icon or bitmap is a placeholder, and a common control (list view, tree view, tab control, progress, trackbar, date picker, rich edit, link) is the element nearest it with what the code supplies named. Menus become a `<nav>` of buttons with access keys, nested popups, separators and commands as events. DIALOGS.md carries every control's rectangle, MENUS.md every tree with its command ids, STRINGS.md every message by id. A .NET assembly keeps its forms in code, so the reader says so and reads the native resources it does hold; a file with no resources or no templates says what it has. Three fixes reached every reader on the way: a select's options are never the collection an emitter's empty state guards on, `ng-submit` swallows the navigation in the port as AngularJS did, and React spells `accesskey` as `accessKey`. The fixture is built in memory by test/fixtures/exe/build.mjs; no binary is committed. test/exe.test.js holds it.

**632. A PNG screenshot is measured, not just catalogued: its pixels are decoded with no dependency and the page background is taken from them** 🔨
input-shots used to record a screenshot's name and byte count and match it to a screen by name; its colours were evidence only when a recording of computed styles sat beside it. `plugins/input-shots/png.js` decodes a PNG with node's own inflate: every colour type and bit depth the format defines, the five scanline filters, a palette with transparency, and interlacing named as not read rather than approximated. The colours a screenshot is made of are counted and binned at five bits per channel, each bin reported as the exact colour seen most inside it, never a blend nobody drew, and PALETTE.md lists them per screenshot with their shares. dsp-tokens takes one thing from the pixels, where nothing declared or observed already answered: the page background, the colour covering at least four tenths of a screenshot, with the screenshot named in the provenance and any disagreement between screenshots written down. The ink is deliberately not taken: a header bar and body text are both dark and both read against the page, and a share cannot tell them apart, so the evidence says how many colours read against the background and names none of them. A JPEG or WebP stays catalogued because decoding it would need a dependency. The PNGs are drawn by the suite; none is committed. test/shots.test.js holds it.

**633. The console has an intake: drop an executable, a screenshot or a folder of old pages on it, press the flags, and the run reads exactly that** 🔨
The console could show a run and run it again, but everything it ran over was a path typed at the command line, and the transformer's flags were the command line's too. It now has a drop zone: files or a whole folder (dragged, or picked with the folder picker) are sent one request each to `POST /intake?path=`, the path held to a relative file path with no dot or dot dot segment, and land in the intake the `ui` command owns under the run's own sidecar directory, never in the port; the server hands bytes to that intake and writes nothing itself, which the suite still asserts of the server's whole body. A rerun request names its source, the intake or the tree the command was started with, and the flags the console offers as pressed keys (transformer, train, reverse, sort, vue, svelte); anything else in the request is dropped, and no switch that weakens a gate is offered. The command points the run's source and screenshots at the intake for that rerun and back at the originals for the next plain one, because the core reads the config when a run starts and the command it was handed to is what may change it. So an .exe becomes dialog screens, a PNG a measured screenshot, a folder of pages a site, from the browser, and the transformer's reports appear in the reports tab of the run that asked for them. `GET /intake.json` lists what is held and `DELETE /intake` empties it. The console's line budget rose to 1750 for it, on the record. test/ui.test.js holds it.

## Phase 147: the nineteenth review pass

**634. The executable reader, the PNG decoder and the console's intake read again** 🔨
A review pass over 10.0, each finding fixed with the input that exposed it. A caption spelling a JavaScript keyword (a group box named Export, a checkbox named Default, a static Class beside an edit) became a field the emitted component could not declare; a reserved word gets a suffix. A doubled ampersand is a literal one, and the mnemonic was looked for before it was set aside, so `Search && Replace` named a space as its access key; the pair is set aside first. Every default push button was treated as OK and made the form's submit; only IDOK is, and a default button with another id is its own event, named as what Enter fired in the original. The creation data count on a control had DIALOG and DIALOGEX swapped, so a control carrying creation data threw every control after it out of alignment; DIALOGEX counts the bytes that follow and a DIALOG's word counts itself. An RVA in a section's virtual tail, zero fill in memory, was followed through the file into the next section's bytes and parsed as a dialog; only the raw bytes map, and the phantom is named. A string the block ended inside was reported as the message; it is kept as far as it goes and marked cut off, in the problems, the notes and STRINGS.md. A version value with a pipe or a line break broke the DIALOGS.md table; every cell is escaped the same way. The PNG decoder honoured tRNS for palette images only, so a colour keyed transparent border in a greyscale or truecolour image was counted as the picture's colour; the key is compared at the image's own depth and the pixel is transparent. The console's rerun wrote every offered flag, pressed or not, onto the live config and never restored what the command line gave, so `--vue true` was switched off by the first run and the watch ran with whatever the last rerun left; a pressed key now rides on top of the command line's flags, an unpressed one leaves the command line's value in force, every rerun is patched from the originals, and the watch reruns through the same door. And the server captured the screenshots directory once at startup, so an intake rerun's screenshots were looked for in the wrong place; it asks where they are each time. test/exe.test.js, test/shots.test.js and test/ui.test.js hold it.

## Phase 148: a site you can reach, and a package you can install

**635. The package is proven installed, and the release is a tag** 🔨
publish-check proved the file list npm would pack; nothing proved the files in it worked away from the checkout, where a plugin that reached for example/, test/ or node_modules/ would still find them and the first person to install would not. test/installed.test.js packs the real tarball, unpacks it with the platform's tar into a temp directory and runs the shipped cli from there, with the temp directory as cwd and no repository around it: the roster it loads is the checkout's roster name for name, and a run over the example writes PORT_NOTES.md and the port's source. CI runs that file alone as its own step so the failure names itself, and the same step runs locally through ci-local. The release workflow gains an npm job beside the desktop installers: on a v* tag it runs the suite and publish-check, fails naming both values when the tag is not v plus package.json's version, fails naming the secret and where a person adds it when NPM_TOKEN is absent, and only then publishes with provenance under id-token: write and contents: read, the token read into one step and written nowhere else. package.json counts its readers honestly, forty nine input plugins, pack:check names publish-check, and the private flag that refused every publish is gone at the owner's word. docs/PUBLISHING.md describes that flow and nothing else. test/installed.test.js and test/publish.test.js hold it.

**636. input-fetch copies a site you can reach but do not have, behind the recorder's gates, and the console takes a URL** 🔨
The no source path had a recorder and a black box reader, both driving a browser; it had no way to take a plain site's pages. `portamp fetch <url>` copies one origin the way a careful person would: link by link to a depth, with the stylesheets, scripts, images and fonts the pages and the stylesheets name, saved byte for byte under the paths the site served them at, so input-static and the site engine read the copy exactly as they read a folder of old pages. Every request asks the policy first, so nothing moves without --allow-live and, where the attestation names domains, a domain it names, and the command refuses outright without portamp.authorization.json, the same two gates input-record stands behind. robots.txt is read and its rules for every agent honoured; a redirect is followed on the origin and the page saved once under the address it lives at; a redirect off the origin, a page beyond the depth, one over the page or byte or file limit, a 404 and a request with no answer are each skipped with the reason; a form's action is recorded and never submitted; another host is named and never fetched; no cookie or credential is sent. FETCH.md and portamp.fetch.json in the copy list all of it, and when a run reads such a folder the manifest's gaps become the run's notes, so a page the copy skipped is never mistaken for a page the site lacked. The console's intake gains a URL: the page hands it to the server, the server to the fetch command's own function, so a URL typed into the page can do nothing the command line could not, and a refusal is shown in the policy's own words. test/fetch.test.js holds it, against a site the test serves itself.

## Phase 149: the desktop's own forms, and an archive on the intake

**637. input-winforms reads a Windows Forms designer file as the form it declares: the .NET half input-exe named and could not read** 🔨
A .NET desktop application keeps its forms in code the designer wrote, so where input-exe finds a CLR header it can only say the forms are code; `plugins/input-winforms` reads that code. The InitializeComponent body of every `*.Designer.cs` and `*.Designer.vb` is cut into statements by a scanner that knows each language's strings and comments (C# escapes, verbatim `@"…"` with a backslash before its closing quote, interpolated strings, character literals; VB doubled quotes, apostrophe comments, explicit and implicit line continuation) and never runs a regular expression over the file whole, so a code behind file that calls the method and a helper class that never names it are both left alone. Each statement is read by its shape: a `new` declares a control with its type, a property set configures it (Location and Size as pairs, `new decimal(new int[] {…})` by its scale and sign bits, anchors through casts and `Or`, enums by their last name, anything not exactly readable left null and named), `+=` and `AddHandler` wire an event to a handler the reader records and never opens, `Controls.Add` and `AddRange` place it, `Items.AddRange` declares its options, `Columns.AddRange` its headers, and `resources.ApplyResources` marks its text as living in the .resx. The lowering makes the choices input-exe makes for a native dialog so the two readers agree: reading order by pixel position inside each container, a label beside or above a field as its `<label for>`, radios grouped by the group box or panel that holds them, the AcceptButton as the form's submit handing every field back by name, the CancelButton as `cancel`, a mnemonic as an access key, a hidden control shown by a named state, a disabled one kept so, a combo box with declared items as real options and one without as a list the port is handed. Where Windows Forms has more than a dialog template does, the reader keeps it: a TabControl's pages as labelled sections with the switch named as state, a grid's designer columns as a table head, a MenuStrip as the same menu bar input-exe draws, a ToolStrip as a toolbar with its own text boxes as fields, a StatusStrip as a footer, a ContextMenuStrip after the body with the control that opens it named, a SplitContainer's two panels. A text box's initial text is a value and is printed nowhere; a caption from the .resx is stood in for by the control's name and said; a third party control type is a div naming the type; a VB designer file wires nothing, which is said once rather than per button. WINFORMS.md carries one table per form: name, type, caption, location, size, tab index, anchor or dock, events wired. test/winforms.test.js holds it.

**638. input-xaml reads a XAML window, page or control as the legacy desktop front end it is, with the same choices input-exe makes** 🔨
A WPF, UWP, Xamarin.Forms or .NET MAUI screen is XML: a tree of panels and controls, each naming its bindings in its attributes, and the code behind holds nothing the layout needs. `plugins/input-xaml` parses the file structurally with the shared tree reader, namespaces resolved from the root so the xaml prefix is whatever the file bound, comments and the declaration set aside, property elements (`<Grid.RowDefinitions>`, `<ListView.ItemTemplate>`, `<Window.Resources>`) split from children, and every markup extension read into its parts, nested converters and single quoted arguments included, with a `{}` prefix honoured as the escape it is. Each Window, Page, UserControl and ContentPage, or any root with an `x:Class`, becomes a screen on the dialect in the order a reader meets the controls, a Grid's by row then column and a Canvas's by top then left, so a label written after its field in the file still comes first in the port. The choices mirror the executable reader's so the two agree: a TextBlock or Label before a field is its `<label for>`, a Label's `Target` names its field outright and a UWP `Header` labels its own control; a TextBox is an input typed by its PasswordBox, IsPassword, Keyboard or InputScope, a textarea when it accepts return, readonly when it says so; radios group by GroupName or by panel and are named after the GroupBox that holds them; a ComboBox, ListBox or Picker with literal items is a select of real options and one with a bound `ItemsSource` repeats over that list as a real input with `DisplayMemberPath` and `SelectedValuePath` as the shown text and value; a mnemonic underscore is an `accesskey` where the flavour has mnemonics and never in MAUI; the first `IsDefault` button is the form's submit handing every field back by name, `IsCancel` is `onCancel`, and every other Click, Clicked or Command is an event named from the handler, the command or the caption; a collapsed control is shown by a named state and a bound Visibility shows on the value with its converter named; a literal `IsEnabled="False"` is the attribute and a bound one is `ng-disabled` inverted; a Menu or ContextMenu is a `<nav>` menu bar with separators and checked items; a DataGrid or GridView with declared columns is a table with its headers and cells and one without is named as the data's; a DataTemplate of text is the row with its bindings in the row's scope; TabControl, Pivot and TabbedPage render every tab as a section named by its header; Expander is details, Image a placeholder, a tag from the app's own namespace the screen it names with its bindings as bound attributes. What the markup cannot say is named through `ctx.unverified` and never guessed: x:Uid and x:Static captions as `strings.<key>` the port is handed, ElementName, RelativeSource and Source bindings as the nearest name with the reach said, one way and x:Bind fields as two way with the write back to wire, every other handler as a behaviour in code behind, initial values by field name with the values never reprinted, resources referenced and declared by key, and a ResourceDictionary or App.xaml as not a screen. LAYOUT.md carries each file's panel tree with the grid's rows and columns, each control's cell and every binding as written. test/xaml.test.js holds it.

**639. An archive dropped on the console's intake is unpacked with no dependency, every entry held to the intake's own path rule** 🔨
A legacy app arrives zipped more often than as a folder, and a browser cannot drop a folder everywhere. `plugins/vis-ui/zip.js` reads a zip the way the format is written: the end of central directory record found from the tail past any comment, the central directory naming every entry, each local header saying where its bytes are, stored entries taken as they are and deflated ones inflated with node's own zlib under a cap per entry, utf8 names and extra fields honoured. What it cannot do is named rather than guessed at: an encrypted entry (no password is asked for), a compression method node cannot undo, an entry over the cap, a directory not where the record says, an archive with no record at all. The intake unpacks an archive under the archive's own name, each entry through the same `intakePath` and `within` checks a dropped file goes through, so an entry that climbs out of the intake is refused and named, a rooted name loses its root as a dropped path would, and an archive that does not read is neither unpacked nor kept. The page shows the count landed and every refusal with its reason. test/zip.test.js holds it, against archives the suite builds.

**640. input-vb6 reads a Visual Basic 6 form file: the .frm's controls, menu, default button, control arrays, wired handlers and MsgBox messages become a screen, and the .frx is named, not read** 🔨
A .frm is text: one `Begin VB.Form` block nesting a block per control with its class, name, caption, rectangle in twips, tab index and initial state, the menu as nested `VB.Menu` blocks, and after the form the code. input-vb6 walks the blocks with a stack, skipping `BeginProperty` groups whole, and lowers the form through the one lowering input-delphi shares: controls flow in reading order, top then left within each container, a label on the row of a field or the row above it names the field, option buttons share their frame's name, `PasswordChar` is a password input, `MultiLine` a textarea and `Locked` read only, a control array is one field per index, `Visible = 0` is `ng-show="shown.<name>"` and `Enabled = 0` is `disabled`, each with a note. The default button is the form's submit and hands every field back by name exactly as input-exe's IDOK does; the cancel button is `onCancel` whatever its caption; a second default is its own event and says so. The menu bar lowers as input-exe's does, mnemonics as access keys, `Caption = "-"` a separator, `Shortcut = ^O` spelled `Ctrl+O` and named as a binding the port does not carry. The code is not ported, but `Sub name_Event` handlers are read so a button's Click is its wired event and every other handler is named as behaviour to reimplement, and the string literals in `MsgBox`'s first argument are the messages a user saw, which FORMS_VB6.md lists under the form with its control table, menu tree and the components that draw nothing; no other literal is printed. A combo box's `List` lives in the binary .frx, so it is a list the port is handed as `<name>Options`, and the companion is named in the report and never read. An OCX class is a named div, never guessed at. test/vb6.test.js holds it.

**641. input-delphi reads a Delphi or Lazarus form file: the .dfm, .fmx and .lfm's components, radio groups, tab pages, main menu, ModalResult buttons and the data components that draw nothing become a screen** 🔨
A text form file is nested `object name: TClass … end` blocks, each a list of properties; a value is a string with doubled quotes and `#13#10` codes, a list in parentheses spanning lines, a collection of `item … end` blocks in angle brackets, or binary data in braces, and input-delphi joins the lines a value spans by matching its bracket rather than by pattern. It lowers through the lowering input-vb6 shares, so a `TLabel` with `FocusControl` is an explicit label that geometry never overrides, a `TRadioGroup` with `Items.Strings` is a fieldset of radios and a `TComboBox` with them a select of real options, while one without is a list the port is handed; `TMemo` is a textarea whose lines are noted to exist and never printed, `TSpinEdit` a number, `TTrackBar` a range, `TDateTimePicker` a date or a time by its `Kind`, `TPageControl` a tablist with every page in the template and which page shows named as state, `TGroupBox` a fieldset, `TPanel` a section, a `TDBGrid` a table whose columns the code supplies, and a `TDB*` control the control it wraps with a note that a data source binds it. `ModalResult = 1` or `bkOK` is the submit and `ModalResult = 2`, `bkCancel` or `Cancel = True` the cancel; `Default = True` is the submit where no ModalResult says otherwise. A `TMainMenu` is the menu bar and a `TPopupMenu` one named as the context menu it was, with `ShortCut = 16463` decoded to `Ctrl+O`. A component with no rectangle draws nothing and is named in FORMS_DELPHI.md as what the port must supply: a data source, a query whose SQL is present and not printed, a connection, a timer whose OnTimer is behaviour. FireMonkey's `Position.X`, `Size.Width` and `Text` read the same, a binary dfm is refused by its `TPF0` signature with the setting that writes text, and no property value other than a caption is printed. test/delphi.test.js holds it.

## Phase 150: the twentieth review pass

**642. The site copy, the console's intake and the four desktop form readers read again** 🔨
A review pass over 10.2 and 10.3, each finding fixed with the input that exposed it. The fetcher let fetch follow redirects, so a hop to another host was requested and its body downloaded before the policy was asked about that host; the fetcher follows each hop itself, asks the policy before every one, records a hop off the origin and never requests it, and stops after five. A robots rule with a wildcard was cut at the star, so `Disallow: /*.php$` blocked every page, and Allow lines were ignored; rules are patterns as the standard spells them, the longest match decides and an Allow wins a tie. A link with a literal percent threw out of the whole copy and a page under a path already saved as a file aborted it; a bad escape is kept as written and a page that cannot be saved is a skip with its reason, and two queries that clean to the same letters no longer share a file. The console reran a copied site from the intake's root, where the copy's manifest was not and its routes would have carried the folder's name; the rerun names the copy's own folder, held to the intake's path rule. The shared form lowering called push on a Set, so a Delphi menu item with a drawing handler killed the extract stage; it is a behaviour named. Delphi's IDE wraps a long caption onto the lines after `Caption =`, which the reader skipped as neither property nor block; the wrapped string is read whole. The WinForms and XAML readers printed a disabled or hidden text box's initial value in a note and baked it into the shown state's name, where the report withheld it; a field's Text is a value and its name is used instead, in the XAML layout report too. A second label on a field's row relabelled it and renamed its field; a field already labelled is left alone. A control placed on a container the reader did not know vanished, and a property the scanner could not read exactly was dropped in silence; children render inside the unknown container, in WinForms and the shared lowering alike, and each unread property is named. VB6's MsgBox was read from any line carrying the word, a string or a comment included, and a message continued with an underscore was cut at its first line; it is read as a call only, outside strings and comments, with continuation lines joined. test/review20.test.js holds it.

## Phase 151: what you have in your hand

**643. An Electron app's archive is a folder the port reads** 🔨
A desktop app built on Electron is a web front end packed into resources/app.asar beside its .exe, so the folder a person drops on the console holds the whole legacy front end in one file no reader could see into. plugins/input-asar/asar.js reads the archive with no dependency: the size pickle, the header pickle, the JSON tree with each file's size and offset into the run of bytes that follows, every offset bounds checked; a file marked unpacked is named as living beside the archive and not in it, a link is named and never followed, and a header or a file cut short is a reason rather than bytes. `portamp unpack <file.asar>` writes the files out as the folder they are through the same path rule the intake keeps, refusing an entry that climbs out, and says where the folder landed and the run command that ports it. An archive dropped on the console's intake is unpacked under its own name in place of the file, so the rerun over the intake reads the app as it reads any folder of pages. In a source tree an archive is named with how many files it holds and how many of them are pages, scripts or styles, and never unpacked in place, because the run writes only into its output. test/asar.test.js holds it, over archives the suite builds and never commits.

**644. input-winforms reads the .resx beside a localized form, so a caption the designer left to ApplyResources is a caption and not a control's name** 🔨
A form marked Localizable keeps no caption in its designer code: every Text, Location and Size moves into `<Form>.resx` and `resources.ApplyResources(this.btnSave, "btnSave")` loads them back, so the reader stood each control's name in for its caption and said so. Now the neutral .resx beside the designer is read from disk by the designer's own name, parsed structurally with the markup parser every reader shares, its entities decoded once and the Visual Studio header comment's example entries stripped before the tree is built, and applied exactly as the designer asked: `<name>.Text` becomes the caption so the label pairing, the mnemonic and the field naming work as for an inline one, `.Location`, `.Size`, `.Visible`, `.Enabled` and `.TabIndex` are taken only where the designer set nothing inline, `.Items`, `.Items1`, `.Items2` are the declared options in index order, `.HeaderText` a column head, and `$this.Text` the title. An entry for a control the designer never passed to ApplyResources is not applied and is listed in WINFORMS.md as present; a `ResXFileRef` or a base64 object is named and never decoded; a property outside that set is named by its name alone, because a value that is neither a caption nor an item is never printed. `Localized.de.resx` is named as a culture variant and never opened, because the language the port speaks is a decision about the product, and a localized form with no .resx beside it keeps exactly the note it had. WINFORMS.md marks each caption that came from the file and says which entries were applied, which were present and not asked for, and which variants exist. test/winforms.test.js holds it.

**645. input-vb6 reads the .frx for the two things a port needs from it: a combo or list box's items become real options, and a long text is known to exist and never printed** 🔨
A .frm points into its binary companion by offset, `List = "frmLogin.frx":0012`, one record per property whose value would not fit on a line, and until now the companion was named and the list handed to the port as `<name>Options`. `plugins/input-vb6/frx.js` reads the record at each pointer against every layout its property is known to take and accepts a reading only when every length it claims fits inside the file and the bytes it names are printable ANSI: a list as a 2 byte count of items, each a 2 byte length and that many Windows 1252 bytes, or the same behind a 4 byte count of the payload it must fill exactly; a long text as a 4 byte length and its bytes, or a 2 byte one; a picture as its size, the `lt` marker VB writes and the image's own size, with the format named from its first bytes; ItemData as a count of 4 byte numbers that are counted and not read. A ComboBox or ListBox whose List read becomes a select of real options, so the port is no longer handed `regionOptions` and the note says the items came from the companion and that what the code adds at runtime is not read; a list that held nothing, or sat on a control that is not a select, is described and still handed in. A Text is a value: the reader keeps its length and never its bytes, and the note says it exists. A Picture, Icon or MouseIcon is an image resource not carried, an empty one said to be empty. A List pointer at a record that reads as one string says so, a Text pointer at a list says so, a record that fits no layout and an offset past the end of the file are each named with the reason and never guessed at, and a companion not in the tree is named as before. FORMS_VB6.md lists every record in offset order with what it was and no value but a list's count; a pointer's file is read from beside the .frm by the name it spells. The fixture's .frx is built by test/fixtures/vb6/frx.mjs, which writes both list layouts and both text layouts, so the bytes on disk, the offsets the .frm spells and the assertions are one source, and the end to end run emits `<option>North</option>` into the React component with the text nowhere in the port. test/vb6.test.js holds it.

**646. input-rc reads a Windows resource script as the source of what input-exe reads from the binary, and the two readings are one screen** 🔨
A Visual C++ or MFC project keeps its dialogs, menus, string table and version block in an .rc file, its symbolic ids in the resource.h beside it, and what the editor will not touch in an .rc2; `plugins/input-rc` reads all three with a scanner that knows the format's own rules rather than a regular expression over the file: one pass reads comments and strings together (a `//` inside a string is text, `""` is one quote, the C escapes rc.exe honours are decoded), the directives run first with APSTUDIO_INVOKED never set and _WIN32 and RC_INVOKED always, so the editor's TEXTINCLUDE and DESIGNINFO blocks are skipped and the `#ifndef APSTUDIO_INVOKED` include of the .rc2 is followed, `#define` and `#undef` are tracked, and a condition on a name the reader cannot decide takes its first branch and is named by line with whether an `#else` was skipped, never evaluated by guess. A statement continues after a trailing comma or bar, BEGIN and END nest, and each DIALOG or DIALOGEX is read into exactly the control shape pe.js produces from a compiled template: every shorthand statement carries the class atom and the style bits rc.exe adds (LTEXT is Static with SS_LEFT and WS_GROUP, EDITTEXT is Edit with ES_LEFT, WS_BORDER and WS_TABSTOP, DEFPUSHBUTTON is 1, AUTOCHECKBOX 3, AUTORADIOBUTTON 9, GROUPBOX 7, every control WS_CHILD and WS_VISIBLE), `NOT` clears and `|` unions over a table of the published WS_, DS_, BS_, ES_, SS_, CBS_, LBS_, WS_EX_ and common control constants, a FONT statement sets DS_SETFONT as rc.exe does, and a symbolic id resolves through resource.h with the SDK's own ids underneath, an expression like `(IDC_LIST + 10)` read through its brackets, IDC_STATIC as the 65535 the template stores, and an .rc2 inheriting the symbols of the .rc that includes it. The dialog then goes through input-exe's own `lowerDialog` and the menu through `lowerMenu`, and the suite proves the claim rather than stating it: the same login dialog spelled as rc.exe would compile it, built into a real DIALOGEX template and read by pe.js, agrees with the script's reading on every control's class, caption, id, rectangle and style bit, and lowers to the byte identical template and the identical React. Menus lose their `\t` accelerator text to a note naming the key binding the port does not carry, GRAYED and MFS_CHECKED land as disabled and checked, the string table lands by symbolic and numeric id, VERSIONINFO's string pairs name the product, ACCELERATORS tables, icons, bitmaps, cursors and every other resource type are named and not carried, and RESOURCES.md carries one table per dialog in DIALOGS.md's columns plus the style as written. What the script cannot say is said: a style name in no table contributes no bits and is named, an id in no header keeps its name, a header a `#include` names and the tree does not carry is a note unless it is the SDK's, and a statement the reader does not know is a problem with its line, never an exception. test/rc.test.js holds it.

**647. A picture of anything becomes a screen: a photograph is decoded, cut into regions by shape, and lowered onto the shared dialect with every word left as an input to fill** 🔨
Take a picture of a screen, a sketch on paper, a printed form or a whiteboard and the console ports it. plugins/input-shots/jpeg.js decodes a JPEG with no dependency, because a phone's picture is one and a reader that knew only PNG could not look at it: the quantization and Huffman tables, the frame, every scan with its restart intervals, the coefficients back through the inverse cosine transform, the chroma planes sampled up and turned to RGB, and the orientation the camera recorded in its Exif block applied so the picture is the way up the person saw it; a progressive, arithmetic, lossless, twelve bit or CMYK file is a reason with the format's own name in it, never an approximation. plugins/input-photo/regions.js cuts the pixels into the regions a screen is made of, with no model: shrunk to a working width so noise averages out, each pixel foreground where it differs from the light around it (by a summed area mean, so a photograph's uneven lighting is background and not a shape), grouped into connected components, small components on one row joined into a line of writing, the light left inside a filled block read as the writing on it, a small square outline read as a check box, and every remaining shape read by its proportions alone: an outline the height of a line or two is a field, a filled block with one line on it a button, a wide low block a bar, an outline holding other regions a card, a filled block with nothing on it an image. The reading is asserted identical on a clean render and on the same screen lit unevenly and speckled as a camera would have it. plugins/input-photo lowers the regions onto the dialect every reader targets, each kept where the picture had it as a share of the page, so React, Vue and Svelte lay the screen out as photographed: writing lined up above a field is its label, writing inside a field its placeholder, writing beside a check box its caption, the writing on a button its caption and the button an event, the first bar's writing the title; and because no words are read from a picture (there is no OCR here), every line of writing is an input the component takes, named by its role and listed in PHOTO.md with where it sits and how many marks long it is, for a person to type in what it said. Not one word is invented: a test asserts the template holds no text between its tags. Which box is a field and which a button is a reading from shape, and the notes say so with the counts. The console gains a photograph key that opens a phone's camera straight into the intake, pictures dropped alone turn the photo flag on by themselves, and `--photo <file or folder>` does the same from the command line; input-shots now counts a JPEG's colours as it counted a PNG's. test/jpeg.test.js holds the decoder against an encoder the suite carries, at every subsampling, with restarts, in grayscale and through all eight orientations; test/photo.test.js holds the rest, over pictures the suite draws and never commits.

## Phase 152: the twenty first review pass

**648. The twenty first review pass: the photograph reader read again** 🔨
The JPEG decoder was fed the shapes the format forbids and the shapes it barely allows, and eight of the former came back as pictures that were not: a file cut between a stuffed pair decoded to grey with no complaint because the bit reader stepped back onto the trailing marker byte, a scan naming no components or only the luma one came back as a flat colour, a frame repeating a component id blamed the scan, an empty frame header spoke of "a undefined bit JPEG", a quantization table short of its sixty four entries filled with zeros, and a Huffman table with too many symbols, too few, or more codes than its lengths allow was decoded into garbage rather than refused. Each is now a named reason, a component no scan wrote fails the file, and the suite's encoder learned to write every code sixteen bits long so the decoder's last row is exercised; a one pixel picture, a strip twenty thousand wide, vertical only sampling, truncation at every byte of a scan and an Exif directory pointing past its block were checked and held. The segmenter needed no fix: a black page, one dot, five thousand dots, a card in a card and two buttons in a row all read as they should and are now asserted. The lowering learned that writing on the same row just left of a field labels it, the way a paper form is written, and names a region kind it has not met instead of silently boxing it. test/jpeg.test.js and test/photo.test.js hold it.

**649. The twenty first review pass: the archive and resource script readers read again** 🔨
The asar reader stopped trusting the header it was handed: a files field that was a list or a string had yielded one entry per character with a native method as its link, a size spelled as a string or a boolean or left out had become a file, an offset in hex or empty had been read as zero, and a tree past sixty four folders had been dropped without a word. Each shape is now a reason by entry name, the ceiling names the folder it stopped at, and unpacking refuses a NUL in a name, drops a drive root the way it drops a leading slash, refuses the second of two entries that fold onto one path instead of overwriting the first, and turns a file standing where a folder is needed into a refusal instead of an exception; the console intake reads through the same guard, and the intake itself now refuses the second of two archive entries that fold onto one path and a file standing where a folder is needed, with the code, instead of overwriting or throwing the whole drop. The resource script reader learned to name what rc.exe would refuse: a string or a comment that never closes, a condition that does not parse (which had been decided false in silence), a second else, a dialog or menu with no block, a control or string with no id, a block hanging on a control or on nothing. Popups are read to the same sixteen levels the binary reader keeps, the version walk and the style brackets moved from recursion onto stacks, and expressions past a length no person writes are named rather than walked, closing four stack overflows and a quadratic bracket match. A script Visual Studio saved as UTF 16 is decoded by its mark, a NUL ridden one with no mark is named and yields nothing, and a NUL escape ends a caption where the compiled template's does. test/asar.test.js and test/rc.test.js hold it.

## Phase 153: the console offered what the command line already could

**650. The intake's flags grow from seven to forty six, grouped, scrollable, and one source of truth with the server** 🔨
The console offered seven flags because that was what fit in a wrapping row: two targets, three transformer modes, one for photo. Every other target, host, deploy plan, meta-framework and document the command line already accepts (`--qwik true`, `--nginx true`, `--aws true`, and forty more) had no button, so pressing them meant leaving the console for a terminal. `plugins/vis-ui/lib.js` now names every one of them in `FLAG_GROUPS`, nine named groups the page reads at runtime through the same `/lib.js` module the suite imports, so the panel can never offer a flag the server would refuse: `RERUN_FLAGS` is `FLAG_GROUPS` flattened, and a test parses the panel's own title map to assert the two lists agree exactly, in both directions. The panel renders itself from that one array into a scrollable box, group labels first, so forty six real buttons fit in the same fixed pane without turning the console into a page that scrolls.

Making room for them found what a fixed fourteen year old layout does not forgive: the sparkline that draws plugins per stage set no floor under itself, so once the intake needed real height the flex column starved it to nothing, and its bars, each an unshrinkable line of text-free `<i>` tags with no ceiling on how many render, painted straight through the layout below when a run this size (a hundred and eighty eight plugins, run on portamp by portamp) gave a stage a bar count in three figures. The chart now holds a fixed slice of the deck regardless of what else grows, its bars a fixed three cells scaled to a ratio rather than one cell per plugin, and its own column no longer lets an empty pixel-art tag shrink to nothing while its own label refuses to move an inch. The deck's fixed height rose once, on the record, to hold all of it with nothing hidden behind anything else. test/ui.test.js holds the panel against the server's own list; the sparkline is proven at three sizes so a small run and a run of the whole plugin set still draw the same shape.

## Phase 154: the enterprise desk

**651. input-extjs reads Sencha ExtJS, the classic Ext.define and Ext.create API, and lowers a real component boundary onto the dialect the rest of the tool already reads** 🔨
An xtype config tree is a real component boundary somebody drew on purpose, so a panel, a form, a textfield, a combobox with its inline store data, a checkbox, a button and a grid lower onto the dialect the way input-vb6 and input-exe already lower a form, rather than the inventory input-jquery is left with when a library declares no boundaries at all. A structural scanner over the source, string, comment and brace aware and no dependency, finds every `Ext.define` and `Ext.create` call and reads the object literal each is handed as a tree of keys and values; a function or a bare reference bound to `handler` or `listeners.click` is kept only as where it sits and how many lines it runs, never as its body, because a handler's own behaviour is exactly what this tool refuses to guess at. A combobox's inline store data becomes real options; a store named elsewhere, a layout other than the default, a `vtype` validator, an unresolved combo and an `Ext.define` that extends a base class the reader does not recognise are each named through the report rather than approximated, and an `Ext.data.Store` or `Ext.data.Model` beside a screen is read as the data definition it is and kept out of the screen tree entirely. EXTJS.md carries every class this run read, what it became, and what was named as a gap. test/extjs.test.js holds it, including a full pipeline run proving a login form ports to a real React component with no handler body, store name or ExtJS syntax surviving into the port or its notes.

## Phase 155: what the scan never opened is named too

**652. Every file the scan does not open is its own named row, not a silent absence, so dropping something the tool cannot yet read gets an honest answer instead of nothing at all** 🔨
The scan kept a whitelist of extensions it would even look inside, so a file that landed on the console's intake or in a source tree with an extension no reader has asked for simply never existed as far as the run knew: not read, not named, not counted anywhere, indistinguishable from a file that was never dropped at all. That silence is exactly what the readers census exists to close for the files the scan already kept, and it now closes it for the ones the scan never opened too. The scan names every file it steps over as it walks the tree, and vis-readers' census carries the list as its own row, distinct from a markup file a reader looked at and did not recognise, because failing to open a file and failing to recognise its contents are different gaps with different fixes. READERS.md gets a Not scanned section naming each one, and the run's own report names the count with the first few files, the same bounded shape every other gap in this tool is reported in. The console reads the same census back over the sidecar every other measurement rides, so the moment after a drop is the moment it says plainly: read as a screen, or not understood yet, and where to look. test/readers-census.test.js and test/ui.test.js hold it.

## Phase 156: Google Web Toolkit

**653. input-gwt reads UiBinder, a .ui.xml widget tree paired with its .java class, and lowers it onto the dialect the rest of the tool already reads** 🔨
A view is two files together, and both are read: a `.ui.xml` widget tree structurally parsed with its namespace prefixes kept separate from tag names, and its paired `.java` class scanned only far enough to find which `@UiHandler` methods exist and how long each runs, never what it does. HTMLPanel and the other panels recurse into their children, labels and checkboxes carry their literal text, a list box's inline `<g:item>` children become real options, and a button wires `ng-click` to an event named from its resolved handler where one is found. A `{...}` template expression, a `<ui:with>` resource injection and a widget from an unrecognised import namespace are each named rather than approximated, and a `.ui.xml` with no paired `.java` beside it still becomes a screen, with the missing pairing said plainly. GWT.md carries every file's widget tree, what lowered, and every gap. test/gwt.test.js holds it.

## Phase 157: Adobe Flex

**654. input-flex reads MXML, the RIA framework whose script lives in the same file as its markup, and separates the two the way the rest of the tool already separates template from behaviour** 🔨
An Application or WindowedApplication tree is read structurally, shielding every CDATA block before the markup pass so a Script element's ActionScript is never mistaken for tags; a Panel's title becomes a heading, a text input and a password style text input become fields, and a checkbox and a combo box backed by an inline ArrayCollection lower onto the dialect the rest of the tool already reads. The script sitting in the same file is scanned only for the functions it declares and the properties it marks Bindable, comment and string aware the way input-rc and input-vb6 already scan their own languages, so a button naming a real function is wired and one naming nothing found is named as a gap instead. A curly brace data binding is recognised wherever it sits and becomes the dialect's own interpolation rather than a value printed as if it were literal; a dataProvider bound to a variable, an mx:Style block and a custom component are each named rather than approximated. test/flex.test.js holds it.

## Phase 158: Qt Designer

**655. input-qt reads Qt Designer's .ui XML forms, laid out in the document order its own layouts recorded, with its signal and slot wiring read as the handler naming it is** 🔨
A `<widget class="...">` tree is a real component boundary somebody drew with the Designer, so it becomes a screen the way input-winforms and input-delphi already read one from a form. QDialog, QGroupBox and the other containers lower onto a div, a QLabel's buddy pairs it to its field, a QLineEdit's echo mode becomes a password field, a QComboBox's inline items become real options, and a QPushButton's `clicked()` connection in the file's own `<connections>` section becomes an output named after the slot it calls. A property whose value is not a string, a bool or a number (a size policy, a palette, a geometry) is named by its name and type alone, never printed; a promoted widget is named with the class it is promoted to, and a widget class with no vocabulary entry is named rather than approximated. test/qt.test.js holds it.

## Phase 159: Java Swing

**656. input-swing reads a NetBeans style GUI builder's initComponents method exactly as it is generated, no separate declarative file to read** 🔨
The method is found by the GEN-BEGIN/GEN-END or editor fold markers a builder brackets it with, cut into statements by a scanner that knows Java's own strings and comments, and each statement classified against the handful of shapes a builder always writes: a field declared and instantiated, a caption set with `setText` only when the argument is a plain string literal, a label paired to its field through `setLabelFor`, radio buttons grouped by a shared ButtonGroup, a combo box's items taken only from literal `addItem` calls, and a click matched from the generated anonymous ActionListener straight through to its real handler, kept as existing and how many lines it ran and never read for what it does. GroupLayout and GridBagLayout, which bury a form's containment inside their own builder calls, are named as present and never reproduced, with every control rendered in the order it was declared. A caption built at runtime, a combo box filled by code, and any statement outside these shapes are named through ctx.unverified rather than approximated. test/swing.test.js holds it.

## Phase 160: the GNOME desktop

**657. input-glade reads GTK Builder's .glade files, GTK2 and GTK3's own declarative UI format, and lowers the widget tree onto the dialect the rest of the tool already reads** 🔨
An `<object class="...">` tree is a real component boundary somebody drew with the Glade Interface Designer, so it becomes a screen the way input-qt already reads one from a Qt Designer form, laid out in the document order the file's own `<child>` wrappers recorded. GtkWindow, GtkDialog, GtkBox, GtkGrid, GtkFrame and GtkScrolledWindow lower onto a div, a GtkFrame's label becomes a heading, a GtkLabel's mnemonic_widget pairs it to its field the way a Qt buddy does, a GtkEntry's visibility becomes a password field, and a GtkComboBoxText's inline items become real options. A GtkButton wires its own `<signal name="clicked">` child straight to an output, simpler than chasing Qt's separate connections section, and a GtkRadioButton's group property names another radio's id directly rather than a shared button group, so grouping is resolved transitively rather than by name. A property GtkBuilder encoded as a nested object rather than plain text, a combo box bound to a model instead of inline items, a widget class outside GTK's own set, and a `<placeholder/>` left where the Designer never filled one are each named rather than approximated. Because Qt Designer's own `.ui` files can share this format's shape under the same extension in the wild, this reader answers only to `.glade`, leaving `.ui` entirely to input-qt. GLADE.md carries every file's widget tree, what lowered and every gap. test/glade.test.js holds it.

## Phase 161: wxWidgets

**658. input-fbp reads wxFormBuilder's .fbp project files, the visual designer for wxWidgets, and follows the toolkit's own radio grouping rule exactly rather than guessing at proximity** 🔨
An `<object class="...">` tree is a real component boundary somebody placed with the designer, so it becomes a screen the way input-qt does from a Qt Designer form, laid out in the document order the sizers already recorded: a sizeritem or a spacer unwrapped to the one widget it holds or skipped outright, a plain sizer recursed through transparently, and a wxStaticBoxSizer's own label kept as a heading the way a Qt QGroupBox's title already is. A wxChoice, wxComboBox or wxRadioBox's choices property, a single string of quoted literals, is parsed to real options rather than split on whitespace; a wxTextCtrl's style is read for wxTE_PASSWORD and wxTE_MULTILINE since wxWidgets has no separate multiline class of its own; a wxButton's OnButtonClick event names the handler wired, the same wiring Qt's connections section already names. wxWidgets' own radio grouping rule is followed exactly: a wxRadioButton's wxRB_GROUP style starts a new group that every radio after it joins, across sizers, until the next wxRB_GROUP one starts another. A property this reader does not interpret is named by its own name only, never its value, and a widget class with no vocabulary entry is named rather than approximated. test/fbp.test.js holds it.

## Phase 162: the enterprise's own printed page

**659. input-jasperreports reads JasperReports' .jrxml band layouts as the document they are, a read only screen with no input, button or event to wire** 🔨
Every invoice, statement and printed report a Java back office produced was very often designed as a .jrxml band layout in iReport or Jaspersoft Studio, and it is a document the way a PDF data sheet is, so title, pageHeader, columnHeader, detail, columnFooter, pageFooter and summary each become a section in the order the page prints them; background, noData and lastPageFooter are read and named present but never laid out, since none of the three is the plain top to bottom flow the rest already is, and a group's own header and footer bands are named the same way, since which rows belong to a group is a data grouping this reader does not compute. A bare `$F{name}`, `$P{name}` or `$V{name}` reference is the one shape this reader evaluates, lowered onto the dialect's own interpolation the way a field, a parameter or a report variable is honestly read; anything a textField expression does beyond that single reference, a SimpleDateFormat call, string concatenation, a conditional, is a computed value this reader does not evaluate, named through the report rather than partly reproduced, and an image's source expression and a subreport are named the same restrained way. JASPERREPORTS.md carries every report's parameters, fields, bands and gaps in one place. test/jasperreports.test.js holds it.

## Phase 163: the office suite's own dialog editor

**660. input-uno reads LibreOffice and OpenOffice Basic's .xdl UNO dialog files, flat and absolutely positioned with no layout manager to reproduce** 🔨
A `<dlg:bulletinboard>` is a real component boundary somebody drew with the Dialog Editor the Basic IDE has shipped since the early 2000s, so a text, a textfield, a checkbox, a menulist with its inline `<dlg:menupopup>` items and a button wired through an on-performaction `<script:event>` lower onto the dialect the way input-qt already lowers a Qt Designer form. A control's every property is an attribute rather than a nested element, unlike Qt's or GTK Builder's own shapes, and a checkbox's `dlg:value` can name either a caption or a checked state default with nothing in the file to tell them apart, so a bare zero or one with no `dlg:label` beside it is named rather than guessed. Radio buttons group by an explicit `<dlg:radiogroup>` when a file writes one and, failing that, by a run of consecutive siblings this reader names as its own structural convenience rather than a rule the format states. test/uno.test.js holds it.

## Phase 164: the enterprise's other report designer

**661. input-birt reads Eclipse BIRT's .rptdesign reports, a table's own header, detail and footer bands kept as a real thead, tbody and tfoot rather than a flow this reader would have to invent** 🔨
Eclipse BIRT ran banking, insurance and government back office reporting alongside JasperReports from the mid two thousands onward, visually designed in the BIRT Report Designer, and it is a document the way a JasperReports layout is, so a page header, a body and a page footer each become a section in the order the page prints them. A bare resultSetColumn reference is the one value read for real, lowered onto the dialect's own interpolation; a data element's computed expression, an aggregate or any other formula, is named rather than evaluated, and named the same way when a real file carries both a resultSetColumn and an expression, since the expression is what BIRT would actually compute. A list, BIRT's own repeating container, is named present with the dataset it binds to and never inlined, the same deliberate boundary a subreport already draws; a grid is named as the layout only table it is, its rows read the same way a table's are. test/birt.test.js holds it.

## Phase 165: the desk Interface Builder built

**662. input-storyboard reads Apple's .storyboard and .xib files, one screen per scene, with a segue named as the navigation it is and never wired** 🔨
A `.storyboard`'s `<scene>` is a real screen boundary the way a Qt Designer form or a UNO dialog is, so a multi scene storyboard becomes one screen per scene, each named from its own view controller's customClass or, absent one, the scene's own id; a `.xib` is the same vocabulary with no `<scene>` wrapper at all, read through the identical code path. A label, a text field with its secure entry read as a password, a text view, a switch with the nearest label read as its caption when one sits beside it, a segmented control's inline segments as real options, and a button's `<connections><action eventType="touchUpInside">` wired the way every other reader already names a handler, all lower onto the shared dialect; an image view is named as existing and never rendered, a table or collection view lands as a header only placeholder, and a `<segue>` is named as the navigation it is and never wired, because routing between scenes is out of scope for a single screen reader. A control with no honest equivalent is named through the report, never approximated. test/storyboard.test.js holds it.

## Phase 166: the enterprise intranet framework the other readers skipped

**663. input-tapestry reads Apache Tapestry's .tml templates, translating only what actually carries Tapestry meaning and leaving the rest of the markup exactly as a designer wrote it** 🔨
A `.tml` template is valid HTML with `t:` namespaced attributes and elements marking exactly the spots a designer's plain markup turns dynamic, so `t:type="textfield"` and `"passwordfield"` on any element become a real text or password input with ng-model, `t:type="checkbox"` and the `<t:checkbox>` element form both become a real checkbox the same way, `<t:if test="...">` and `<t:loop source="..." value="...">` wrap their contents in the same ng-if and ng-repeat containers input-jinja and input-twig already use for `{% if %}` and `{% for %}`, and a bare `${property.path}` becomes `{{ property.path }}` verbatim. Two things Tapestry hides in the Java class behind the template stay honest gaps: a select's `t:model` names a SelectModel this reader cannot see, so its options are named the way input-qt and input-glade already name an unresolved combo box, and a submit button gets no invented ng-click, since Tapestry wires its handler by naming convention, never written in the template at all; a `${...}` expression with a method call or an operator is a computed value this reader does not evaluate, and a `t:type` or `t:` namespaced element with no vocabulary entry is named rather than approximated, its wrapper dropped and its content kept rather than guessed at. test/tapestry.test.js holds it.

## Phase 167: the format banking, insurance and government back offices have run since SQL Server 2000

**664. input-ssrs reads Microsoft's own .rdl report definitions, a Tablix's deeply nested row and cell layout flattened onto a real HTML table** 🔨
PageHeader, Body and PageFooter, RDL's own names for the parts input-jasperreports's bands and input-birt's sections already are, each become a section in page order, and a Tablix, the modern replacement for the older Table and List elements some files still carry, has its deeply nested row and cell layout flattened onto a real HTML table; RDL draws no header, detail or footer distinction inside a Tablix the way BIRT's table does, so every row lands in one body rather than a split this reader would invent. A bare `=Fields!name.Value` or `=Parameters!name.Value` reference is the one expression shape read for real, lowered onto the dialect's own interpolation; anything else a VB.NET expression does, a function call, a concatenation, an `IIf`, is named rather than partly reproduced, the same restraint kept over a subreport it does not follow and an image whose source it does not evaluate. test/ssrs.test.js holds it.

## Phase 168: the interface that was text

**665. input-powerbuilder reads Sybase/Appeon PowerBuilder's exported .srw window sources, and finds each control's real property block by walking past the shell that only declares it exists** 🔨
A `.srw` file forward-declares every control's name and PowerBuilder class before the file's real content, so this reader takes the forward section for names and classes only and never for a value; a control's actual properties live in a second, later `type <name> from <class> within <window>` block that sits outside `forward`, and telling the two apart is one parent check in a small block stack, not a second pass over the file. Statictext becomes a paragraph, singlelineedit an input whose own `password` property makes it one, multilineedit a textarea, checkbox and radiobutton lower the ordinary way, radios grouped by a run of consecutive siblings in the window's own declaration order since a `.srw` states no group of its own; a dropdownlistbox's inline `string item[]` array becomes real options, and a commandbutton wires an output from its own `event <name>::clicked` block found elsewhere in the file, any other event on it named as behaviour the port must reimplement rather than invented wiring. A groupbox's own children are never reparented beneath it, because PowerBuilder places every control flat within the window with no tree to reflect, only a heading from its own text; a DataWindow is named as the separate `.srd`/`.pbl` artifact it is, an empty structural table standing in for it. An opaque property, one whose type keyword is not `integer`, `string` or `boolean`, is named by key and never by value, and a control class with no vocabulary entry is named rather than approximated. test/powerbuilder.test.js holds it.

## Phase 169: the desktop Java toolkit that outlived Swing's own editors

**666. input-fxml reads JavaFX's .fxml files, an attached property dropped as the layout it is with no per-control note to spell out** 🔨
A container or control tree in a `.fxml` file is a real component boundary somebody drew with Scene Builder or by hand, so it becomes a screen the way input-qt and input-glade already do from a desktop form, laid out in the document order the file's own nesting recorded. A GridPane, VBox, HBox and the rest of JavaFX's own containers lower onto a div; a label, a text field with a password field read as one, a checkbox, and a combo box filled from a plain inline `<items><FXCollections fx:factory="observableArrayList">` list of literal strings all lower the ordinary way; a button's own `onAction="#method"` attribute becomes an output named after the controller method it calls, simpler than chasing a separate connections section. Radios group by an explicit `toggleGroup` reference, an id or an inline `<ToggleGroup fx:id>`, resolved however far apart the two controls sit in the file, and fall back to a run of consecutive siblings, this reader's own structural convenience, only when neither carries one. An attached property, positioning a parent container assigns a child through its own dotted element or attribute form, carries no rendering meaning this reader reproduces and is dropped without a per-control note, since there would be one per positioned control and it would be noise rather than a gap; a combo box filled from code, a button whose handler is a binding expression rather than a controller method, and an element outside JavaFX's own control set are each named through FXML.md rather than approximated. test/fxml.test.js holds it.

## Phase 170: the generated method the other NetBeans reader could not see

**667. input-netbeansform reads a NetBeans GUI Builder's own .form XML sidecar directly, an explicit label and button-group reference read as the ground truth it is rather than a proximity guess** 🔨
Where input-swing reverse engineers a generated initComponents method, a `.form` file is the Matisse designer's own declarative save format sitting beside the same class's `.java` file, and it states outright what input-swing has to infer: a `<Property>`'s bare `value` attribute or one of its typed child shapes (`<String value>`, an ordered `<StringArray>` of `<StringItem>`, a `<ComponentRef name>`) is read for real, and anything else is kept opaque by its own child tag name rather than guessed at; an `<Events><EventHandler event listener handler>` names a button's wiring directly, its handler stripped of the `ActionPerformed` suffix and never run through the same case folding that would flatten a name like `loginButton` into one word; a label's own `labelFor` and a radio's own `buttonGroup` are `<ComponentRef>` references resolved against `<NonVisualComponents>`, the file's own ground truth, with a run of consecutive siblings kept only as the fallback for a radio group with no reference at all. JPanel, JScrollPane and JSplitPane lower to a div, JTextField, JFormattedTextField, JSpinner and JPasswordField to an input, JTextArea to a textarea, JCheckBox, JRadioButton, JComboBox and JButton the ordinary way, and JTable to a header only placeholder; a widget class with no vocabulary entry is named through NETBEANSFORM.md rather than approximated. test/netbeansform.test.js holds it.

## Phase 171: the mainframe green screen

**668. input-cics reads IBM CICS BMS .bms map definitions, a mainframe 3270 screen's macro assembler source rather than markup, and produces no output because BMS states none** 🔨
A `DFHMSD` opens a mapset and a `DFHMDI` opens one map inside it, a real screen boundary the same way a scene is in a storyboard, so a mapset with more than one `DFHMDI` becomes more than one screen; a `DFHMDF` defines one field, positioned absolutely by `POS=(row,col)` with no container to nest it in, so fields are ordered by position rather than by declaration, the same "no tree, sort by position" reading input-exe already gives a native dialog template. A field's own assembler label, present only on some, is the symbolic name CICS and COBOL code refer to it by and becomes its field name; `ATTRB=(PROT)` with an `INITIAL` literal is a caption, `ATTRB=(UNPROT)` is a real input, and a protected field with neither is empty screen furniture, skipped. There is no button, no submit and no event anywhere in BMS, since a 3270 screen is driven by whichever program the operator's AID key handed control to, a fact BMS itself never states, so this reader is honest that it produces zero outputs; an unlabeled unprotected field, a `GRPNAME` grouping and an `INITIAL` value that is not a clean quoted literal are each named rather than guessed. test/cics.test.js holds it.

## Phase 172: the screen drawn as the text it is

**669. input-informix reads Informix 4GL/ESQL .per screen forms, the SCREEN block's own row and column position read directly off the ASCII art rather than from a coordinate attribute** 🔨
A `.per` file's `SCREEN` section is a literal character grid between `{` and `}`, so unlike every other desktop or mainframe reader in this tool, position is not stated in an attribute at all, it is where the text sits in the block; a bracketed run, `[tag]`, is a field placeholder whose own width is the bracket's width and whose tag, read from the `ATTRIBUTES` section's `tag = table.column, MODIFIER;` statements, resolves what it binds to and how, while everything outside brackets is a literal caption kept exactly as written. `NOENTRY` renders a field read only rather than as a real input, and `REQUIRED` is named for the port to enforce rather than written as an invented HTML attribute this reader has not verified matches the port's own validation; a `COMMENTS = "..."` string is carried onto the rendered field as a title, an honest reuse of real text rather than a guess. Like BMS, a `.per` file names no button and no event, since the actual 4GL program that reads a screen's fields lives elsewhere, so this reader too produces zero outputs; a field placeholder with no matching attributes statement and an attributes statement whose tag never appears on screen are each named as the mismatch they are rather than silently dropped or bound anyway. test/informix.test.js holds it.

## Phase 173: the interface declared inside the language itself

**670. input-cobolscreen reads a standard COBOL program's SCREEN SECTION, one 01 level entry per screen, and produces no output because the section states none** 🔨
Since the COBOL-85 standard, a program's DATA DIVISION can carry a `SCREEN SECTION.` declaring a character-cell terminal screen directly in COBOL's own level-number syntax, no separate designer file at all; each `01` level entry is a real screen boundary the same way a `DFHMDI` map or a storyboard scene is, so more than one in a file becomes more than one screen, read top to bottom in declaration order. A `VALUE "literal"` is a caption; a `PIC` clause together with `USING` or `TO` is a real input, its hyphenated COBOL data name camelCased into a legal field name, while `PIC` with `FROM` is read only, the program writing to the screen but the operator never typing into it. `BLANK SCREEN` is a screen clearing directive, not a field, and formatting clauses (`HIGHLIGHT`, `REVERSE-VIDEO`, colors) are never named per occurrence, the same restraint every other reader already keeps over what it does not translate. There is no button, no submit and no event anywhere in a SCREEN SECTION, since the actual `ACCEPT`/`DISPLAY` statements and what a function key does live entirely in the PROCEDURE DIVISION this reader does not read, so it is honest that it produces zero outputs; a `PIC` clause naming none of `USING`/`FROM`/`TO` and a relative `LINE PLUS`/`COLUMN PLUS` position whose exact placement this reader does not compute are each named rather than guessed. test/cobolscreen.test.js holds it.

## Phase 174: the mainframe dialog the operator drove by hand

**671. input-ispf reads IBM ISPF Dialog Manager .panel definitions, a field's own variable name read directly off the body text beside it rather than from a separate declaration** 🔨
An ISPF panel's `)BODY` section is a literal character grid the same way a `.per` screen block is, read row by row with position coming from where each run of text sits rather than a coordinate attribute; but where Informix marks a field with brackets, ISPF marks it with a single attribute character whose meaning, `TYPE(TEXT)`, `TYPE(INPUT)` or `TYPE(OUTPUT)`, is resolved from a `)ATTR` section when the panel declares one, and otherwise falls back to ISPF's own three real built-in defaults. The text immediately following an input or output attribute character, up to the next blank or attribute character, is literally the panel's own variable name, a naming mechanism no other reader in the tool uses, since nothing declares the field elsewhere; a `TYPE(OUTPUT)` field is read only the same honest way an Informix `NOENTRY` field already is. `)INIT` and `)PROC` hold real Dialog Manager statements, variable defaults and `VER` validation calls, named as present once per panel and never read for meaning. Like every mainframe format this tool has read, a panel's `)BODY` names no button and no event at all, driven instead by PF keys and `)PROC` logic outside it, so this reader is honest that it produces zero outputs; an attribute character with no `)ATTR` entry and no built-in default, and a body run that does not resolve to a clean variable name, are each named rather than guessed. test/ispf.test.js holds it.

## Phase 175: the screen built one executable statement at a time

**672. input-xbase reads dBase/Clipper/FoxPro .prg source for its @ row, col SAY/GET statements, a READ closing the run since the last one as the real screen boundary it is** 🔨
Where every other reader in this tool finds a screen declared, xBase's `@ row, col SAY "..." GET variable` statements are ordinary executable code, interspersed anywhere in a `.prg` file among assignments and control flow, with no wrapping section or region marker at all; a `READ` statement is the one real, load-bearing boundary the language itself gives, closing every `SAY`/`GET` statement since the file's start or the previous `READ` into one screen, so a file with several `READ`s becomes several screens. A bare `SAY` is a caption; `SAY` with `GET` pairs it to a real input bound to the GET's own variable, and a `GET` alone is an unlabelled input; a trailing semicolon continues one logical statement onto the next physical line, joined before parsing the same way input-cics and input-cobolscreen already tolerate their own formats' line continuations. `PICTURE` is formatting this reader does not translate, and `VALID`, `WHEN`, `RANGE` and `DEFAULT` are each named present on their field rather than evaluated, since what a validation expression actually checks is a decision this reader cannot verify. Like every legacy format with no separate event mechanism, xBase decides what a `READ` returning means entirely in code around the screen statements, so this reader is honest that it produces zero outputs; an `@` statement with no clean row, col pair is named as the structural problem it is rather than skipped silently. test/xbase.test.js holds it.

## Phase 176: the fourth native toolkit this tool reads

**673. input-fluid reads FLTK's FLUID .fl designer files, a radio button grouped by its shared immediate parent, the one real structural signal the format gives** 🔨
A `.fl` file is a brace nested, Tcl-like widget tree, the fourth native GUI toolkit format this tool reads after Qt Designer's `.ui`, GTK Builder's `.glade` and wxFormBuilder's `.fbp`, so a root `Fl_Window` becomes a screen the same way a form in any of the other three does, and more than one root window across a file's `Function {}` blocks becomes more than one screen. A control's own `label` is read straight off its node, paired to the field directly rather than through a separate mnemonic or buddy reference, since FLUID attaches the caption to the input itself; a `callback` resolves to an output only when its C++ body is a clean `functionName(...)` call, and is named present rather than invented when it is anything else, the same restraint input-fxml already keeps over a binding expression it will not evaluate. FLTK gives `Fl_Round_Button` no explicit group reference at all, grouping instead by runtime behaviour, any `Fl_Group` holding more than one becomes a group automatically, so this reader groups radios by their shared immediate parent container, the one honest structural signal the format actually provides, rather than a consecutive siblings guess. A messy callback, an unrecognised widget class and a choice filled from code are each named through FLUID.md rather than approximated. test/fluid.test.js holds it.

## Phase 177: the toolkit that has not changed its widget commands in decades

**674. input-tk reads Tcl/Tk scripts for their widget-creation commands, radio buttons grouped by a shared -variable, the real reference the language gives** 🔨
A Tk GUI is built by ordinary executable Tcl statements, `label`, `entry`, `checkbutton`, `radiobutton` and `button` calls each taking `-option value` pairs, with no separate declarative designer file at all, so this reader scans a whole `.tcl` file for the recognised widget-creation commands wherever they occur, a `ttk::`-prefixed command read the same as its classic equivalent. An `entry`'s `-textvariable` names its bound field, a `-show` value marks it a password, and a `checkbutton`'s `-variable` does the same; a `radiobutton`'s own `-variable` is Tk's real grouping mechanism, every radio sharing one variable belongs to one group however far apart in the file, a stronger signal than any consecutive-siblings fallback this tool's other readers fall back to when a format gives none. A `button`'s `-command` resolves to an output only when it is a bare proc name; a brace-quoted inline script is named present rather than evaluated, and its own text is never printed. A backslash at end of line continues one logical command onto the next, joined the same way input-cics, input-cobolscreen and input-xbase already tolerate their own formats' continuations; an unbound entry or checkbutton and an unrecognised widget command are each named rather than guessed. test/tk.test.js holds it.

## Phase 178: the automation language whose screen has no designer at all

**675. input-autoit reads AutoIt .au3 scripts, a field's name taken from the variable a GUICtrlCreate call's return value was assigned to, since the language gives it no other** 🔨
An AutoIt script opens one window with `GUICreate` and populates it with `GUICtrlCreate*` calls, positional arguments only, no keyword binding the way Tcl's `-textvariable` or COBOL's `USING` gives a field its name, so this reader reads the field's name from whichever variable the call's own return value was assigned to, `$custNo = GUICtrlCreateInput(...)` naming the field `custNo`; a call left unassigned is a real gap, named rather than invented. `GUICtrlCreatePassword` is its own dedicated function, a genuine signal rather than a style flag to infer from. AutoIt wires a button entirely through its event loop, so this reader resolves a button's action by matching its own variable against a `Case`/`If` block in the file's `GUIGetMsg` loop and reading the one clean function call inside it, naming anything more complex present rather than approximated; radios, given no explicit grouping reference at all, group by a run of consecutive `GUICtrlCreateRadio` calls, this reader's own structural convenience the same restraint input-uno, input-powerbuilder and input-fxml already keep for their own ungrouped formats. test/autoit.test.js holds it.

## Phase 179: the 4GL that still runs the back office

**676. input-openedge reads Progress OpenEdge ABL .p source, a FORM ... WITH FRAME block the one real screen boundary the language gives** 🔨
A `DEFINE VARIABLE name AS type LABEL "text"` and `DEFINE BUTTON name LABEL "text"` declare a field or button anywhere in the file, but neither belongs to a screen until a `FORM ... WITH FRAME framename` block lists it, so this reader treats each `FORM`/`WITH FRAME` block as its own screen, rendered in the frame's own listed order rather than declaration order; a name the frame lists with no matching `DEFINE` anywhere is named rather than invented, and a `DEFINE`d field never listed in any frame is simply not part of a screen, not a gap. `AS LOGICAL` becomes a real checkbox, everything else a real text input, and `FORMAT` is formatting this reader does not translate, the same restraint input-xbase already keeps over `PICTURE`. A button wires from its own `ON CHOOSE OF ... DO: ... END` block only when the block holds exactly one clean bare `RUN name.` statement; anything else in the block, or no block at all, is named through a note rather than approximated, the same restraint input-autoit already keeps over a multi-statement event handler. test/openedge.test.js holds it.

## Phase 180: the dialog built by numbered controls, not named ones

**677. input-pbwin reads PowerBASIC for Windows .bas source, a control's field name taken from its own numeric id since DDT gives it no other** 🔨
PowerBASIC's Dynamic Dialog Tools build a window entirely through `DIALOG NEW ... TO handle` and `CONTROL ADD type, handle, id, "text", x, y, w, h` statements, one screen per `DIALOG NEW`; unlike every other statement-built screen this tool reads, a DDT control's identity is a plain integer id, not a variable a value was assigned to or a name a keyword argument bound, so this reader names each field after its own id, a naming convention it documents rather than a name PowerBASIC itself gives. A `CHECKBOX`'s own text is its label, paired directly, and an `OPTION` groups by a run of consecutive statements, the same restraint input-autoit already keeps for its own ungrouped radios; a `BUTTON` wires from its own trailing `CALL procname` clause on the same statement, the cleanest wiring reference this tool's statement-built readers get, needing no separate event loop to match against the way input-autoit's `Case`/`If` search does. A `CONTROL ADD` naming a handle no `DIALOG NEW` opened, an unrecognised control type and a button with no `CALL` clause are each named rather than guessed. test/pbwin.test.js holds it.

## Phase 181: the desktop before the builder existed

**678. input-awt reads hand written Java AWT/Swing .java files, a file already carrying input-swing's own generated-code markers left to it entirely** 🔨
Before GUI builders were common, and still today when a developer deliberately avoids one, a Java window is built through plain `new ClassName(...)` construction and `add(...)` calls, no designer file and no generated `initComponents` method at all; this reader shares the same `.java` extension input-swing and input-gwt already scan, importing input-swing's own generated-code marker check directly rather than a second copy of it, so the two readers can never disagree about which file belongs to which. A `JLabel`/`Label` with a literal constructor argument is a caption; a `JTextField`/`JCheckBox`/their AWT equivalents take their field name from whichever variable the construction was assigned to, since nothing else names them, and a construction never assigned to anything is a real gap. A button wires from a clean, single, zero-argument method call passed to `addActionListener`; an anonymous inner class or a multi-statement lambda body is named present rather than read for what it does. A non-literal caption, an unassigned field, a `JComboBox`'s inline options and an unwired button are each named rather than guessed. test/awt.test.js holds it.

## Phase 182: the code-only sibling of the file this tool already reads declaratively

**679. input-uikit reads raw Objective-C UIKit view construction in .m files, a button's own @selector(methodName) the cleanest wiring reference any statement-built reader in this tool gets** 🔨
The same screen input-storyboard already reads from a `.storyboard` or `.xib` file can be built entirely in code instead, `[[UILabel alloc] initWithFrame:...]` and `[UIButton buttonWithType:...]` construction followed by `addSubview:`, common in pre-Storyboard iOS code and still written today by choice; this reader is that code-only sibling, one screen per file, controls rendered in the order their own construction statement appears rather than the order they were added to the view. A field's name comes from the variable its construction was assigned to, the same rule input-awt keeps for Java; `secureTextEntry` marks a password field, a real UIKit property rather than a guessed one. A button wires from its own `addTarget:action:forControlEvents:` call, and `@selector(methodName)` names the real method directly, the same clean, unambiguous reference PowerBASIC's `CALL procname` already gives this tool's statement-built readers, needing no lambda body or event loop to search through. A non-literal caption or title, an unassigned field, a `UITextView`'s content and a button with no target at all are each named rather than guessed. test/uikit.test.js holds it.

## Phase 183: the workbench gets a solver of its own

**680. general-study adds an arithmetic and one-variable equation solver to the console, an offline reader for the PDFs already dropped on it** 🔨
A person asked for a "one soft solution" that could read documents and do math homework directly in the interface; rather than a network dependent retrieval system, this plugin answers both asks the way every other plugin in this tool does, deterministically and offline. `solve.js` is a hand written recursive descent parser and evaluator, honest about what it can prove: it evaluates pure arithmetic, and for an equation with exactly one variable it tracks a `{coeff, constant}` pair through the expression so `2x + 3 = 11` solves for `x`, but a nonlinear term (`x * x`, `x` multiplied by itself), a second variable, an expression with none at all, or more than one `=` each refuse by name through `SolveError` rather than guessing at an answer. Implicit multiplication (`2x`, `3(x + 1)`) is read as the real `*` it stands for. `pdftext.js` reuses `input-pdf`'s own zero dependency reader to pull a dropped PDF's text out for the console to show; no new PDF parsing was written; there was already one, and this only calls it. The console's Study tab wires both live through two new routes and STUDY.md demonstrates the solver on one fixed equation with its real steps, in the same voice every other trained demonstration in this tool uses. test/study.test.js holds it.

## Phase 184: the sort task with more than one head

**681. vis-transformer's sort task gets the multi head port trainReverseMultiHead already proved, its own gradients checked rather than assumed to carry over** 🔨
The single head block already learns to sort a repetition allowed sequence, the harder task reversal is not, and a person asked for the transformer built out further; rather than a second guess at a new architecture, this reuses the exact multi head machinery (the per head split, the concatenation, the output projection Wo) that `trainReverseMultiHead` already proved correct, aimed instead at the sort task. `trainSortMultiHead` and `sortMultiHeadGradientCheck` mirror their reversal counterparts exactly, and the numerical gradient check runs again on the harder task rather than trusting the earlier proof to transfer; SORT_MULTIHEAD.md reports the held out accuracy exactly as measured, whether more heads actually help a one block model generalize sorting being a real question this only answers by training and grading rather than by assuming more heads must help. test/transformer.test.js holds it.

---

| | |
| --- | --- |
| shipped | 44 |
| new in this branch | 634 |
| planned | 3 |
| total | 681 |

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
