#!/usr/bin/env node
/**
 * Draws media/plugin-rack.svg from the roster the kernel actually loads.
 *
 * The rack was hand drawn and said "10 loaded" long after there were more than
 * ten. A picture that states a number has to be generated from the thing it
 * counts, or it becomes a claim nobody rechecks.
 *
 * Attributes only, no <style> block: GitHub sanitizes those out of an SVG it
 * renders inline, and the diagram would arrive unstyled.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Kernel } from "../src/core/kernel.js";
import { createLogger } from "../src/core/context.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DOES = {
  "input-alpine": "alpine islands: x-data state, x-for and x-if, x-model, events and binds, onto the dialect",
  "input-angular": "components, bindings, RxJS operators, HttpClient calls, interceptors",
  "input-angularjs": "the 1.x apps that never went anywhere: controllers, components, $http",
  "input-knockout": "data-bind expanded into a dialect; the viewmodel is the component",
  "input-lit": "litelement html templates, @event/.value/?bool and mapped loops, onto the dialect",
  "input-backbone": "views are boundaries somebody drew, and they are read as such",
  "input-openapi": "a spec as a source, cross checked against what the app actually calls",
  "input-jsf": "the facelets inventory, honest that the rendered truth is server side",
  "input-aspnet": "server controls, handlers and postbacks, read from the declarations",
  "input-velocity": "velocity templates: #if, #foreach with its else, $refs and Java methods with a JS spelling lowered, #parse inlined, macros expanded, a $screen_content layout composed around each page",
  "input-vue": "single file components, into the shape the Angular reader produces",
  "input-jquery": "a front end that declared no components. Inventories, never invents",
  "input-explore": "drives a running app and works out what it is, without the source",
  "input-shots": "catalogs screenshots and infers the state each filename shows",
  "input-record": "drives the running app with Playwright: shots, HAR, computed styles",
  "input-blackbox": "HAR, schema dumps, exports. Passive: nothing driven, nothing fetched",
  "input-static": "a site with no framework: pages are screens, links are the routes",
  "input-stencil": "stencil components: @Component tag, @Prop/@Event, render JSX lowered by the React reader",
  "input-webcomponents": "vanilla custom elements: observedAttributes as inputs, CustomEvent as outputs, innerHTML lowered",
  "input-ember": "ember components: Glimmer blocks with block params, @args, {{on}} and {{action}}, <Input @value>, yield; one .hbs, one reader",
  "input-photo": "a photograph of a screen, a sketch or a paper form cut into regions by shape (text lines, fields, check boxes, buttons, bars, cards) and lowered onto the shared dialect laid out as photographed; the words are inputs to fill, never read",
  "input-rc": "a Windows resource script as Visual C++ writes it: DIALOG and DIALOGEX templates, menus, the string table and version block read structurally with ids resolved through resource.h, into the exact control shape input-exe reads from the binary and lowered through the same functions; a style name, id or #if it cannot decide is named",
  "input-asar": "an Electron app archive: the header and the file run read with no dependency, portamp unpack writes it out as the folder it holds, the console's intake does the same to one dropped on it, and one in a source tree is named with what it holds",
  "input-exe": "a native Windows executable: its dialog templates as screens, menus as menu bars, the string table and version block read from the .rsrc section with no dependency; .NET forms named as code",
  "input-winforms": "Windows Forms designer code: InitializeComponent in *.Designer.cs and *.Designer.vb read with a scanner that knows both languages' strings, every control lowered in reading order onto the dialect as input-exe lowers a dialog; handlers named, never read",
  "input-xaml": "WPF, UWP, Xamarin.Forms and MAUI XAML read as XML: every Window, Page, UserControl and ContentPage lowered onto the dialect as input-exe lowers a dialog, bindings read from the markup, code behind named and never read; LAYOUT.md carries the panel tree",
  "input-vb6": "Visual Basic 6 .frm files: the form's controls in twips, its menu bar, the default and cancel buttons, control arrays, the handlers the code wires and the messages MsgBox shows, lowered onto the dialect; the binary .frx named, not read",
  "input-delphi": "Delphi and Lazarus .dfm, .fmx and .lfm files: the form's components in pixels, radio groups with their items, tab pages, the main menu, ModalResult buttons and the data sources, queries and timers that draw nothing, lowered onto the dialect",
  "input-extjs": "Ext.define/Ext.create config trees: xtype panels, forms, fields, comboboxes with their inline store data, buttons and grids lowered onto the dialect; a handler's body, a store named elsewhere and an unrecognised base class are named, never read",
  "input-flex": "Adobe Flex MXML: Application and WindowedApplication trees, Panel/Form/TextInput/CheckBox/ComboBox with inline ArrayCollection data and Button lowered onto the dialect; the inline mx:Script or fx:Script block scanned only for its function names and [Bindable] properties, a {binding}, an unresolved dataProvider and an unmatched click handler named, never read or guessed",
  "input-glade": "GTK Builder .glade files: the widget tree, containers, fields, mnemonic labels, a combo box's inline items, radio groups grouped by one referencing another's id and buttons wired from a <signal> child, lowered onto the dialect as input-qt lowers a Qt Designer form; an opaque property, a combo box filled from a model and a button with no clicked signal are named, never read",
  "input-gwt": "GWT UiBinder: a .ui.xml widget tree paired with its .java class, panels, fields, a list box's inline items and buttons lowered onto the dialect; a template expression in braces, a custom widget and a button with no matching @UiHandler are named, never read",
  "input-qt": "Qt Designer .ui files: the widget tree, panels, fields, a combo box's inline items, radio groups and buttons wired from <connections>, lowered onto the dialect as input-exe lowers a dialog; a promoted widget, an opaque property and a button with no clicked() connection are named, never read",
  "input-fxml": "JavaFX .fxml files: the container and control tree, fields, a combo box's inline FXCollections items, radio buttons grouped by a toggleGroup=\"$id\" reference or, lacking one, a run of consecutive siblings, and buttons wired from onAction=\"#method\", lowered onto the dialect as input-qt lowers a Qt Designer form; an attached property such as GridPane.rowIndex is dropped as layout this reader does not translate, and a combo box with no plain inline items and a button with no #method wired are named, never guessed",
  "input-storyboard": "Apple Interface Builder .storyboard and .xib files: each scene's view tree, labels, fields, switches, a segmented control's inline segments and buttons wired from a touchUpInside action, lowered onto the dialect one screen per scene; a segue is named as the navigation it is, never wired, and an unrecognised control, an empty segmented control and a button with no matching action are named, never read",
  "input-uikit": "raw Objective-C UIKit view construction .m files with no storyboard or xib at all: alloc/init and buttonWithType: constructions read in file order, a field's name taken from the variable a construction was assigned to, a UITextView named present with its content never invented, and a button wired from its own addTarget:action:forControlEvents: call's @selector(methodName); a non-literal caption, an unassigned control and a button with no wiring at all are named, never guessed",
  "input-uno": "LibreOffice/OpenOffice Basic .xdl dialogs: the bulletinboard's own flat control list, fields, a menulist's inline items, radio buttons grouped by an explicit dlg:radiogroup or, lacking one, by this reader's own consecutive-siblings heuristic, and buttons wired from an on-performaction <script:event>, lowered onto the dialect as input-qt lowers a Qt Designer form; a checkbox's ambiguous 0/1 dlg:value, an empty menulist and a button with no event wired are named, never guessed",
  "input-powerbuilder": "PowerBuilder .srw window exports: the forward section read for names and classes only, the real, later type block each control's properties actually come from, radios grouped by this reader's own consecutive-declaration heuristic, a dropdownlistbox's inline item[] array and a commandbutton wired from its own event ...::clicked block found elsewhere in the file, lowered onto the dialect; an opaque property, a groupbox's flat children, a DataWindow and a button with no clicked event are named, never guessed",
  "input-pbwin": "PowerBASIC for Windows .bas source: DIALOG NEW opens the one dialog a TO handle names, CONTROL ADD statements read positionally with a field's name taken from the control's own numeric id, OPTION buttons grouped by this reader's own consecutive-statement heuristic, and a button wired from its own trailing CALL procname clause; an unrecognised control type, a button with no CALL clause and a CONTROL ADD naming a handle no DIALOG NEW opened are named, never guessed",
  "input-fbp": "wxFormBuilder .fbp projects: sizeritems and spacers unwrapped, a wxStaticBoxSizer's label kept as a heading, a choices string parsed to real options, wxRB_GROUP's own radio grouping rule followed, buttons wired from <event name=\"OnButtonClick\">, lowered onto the dialect; an opaque property, an unrecognised widget class and a button with no event wired are named, never read",
  "input-autoit": "AutoIt .au3 scripts: GUICreate opens the one window a file becomes, GUICtrlCreate* calls read positionally with a field's name taken from the variable its return value was assigned to, radios grouped by this reader's own consecutive-call heuristic, and a button wired from the single clean call inside the Case/If block matching its own variable in the event loop; an unassigned field, an unrecognised control and a button with no clean call or no wiring at all are named, never guessed",
  "input-awt": "hand written Java AWT/Swing .java files with no designer file and no generated initComponents at all: new ClassName(...) constructions read in file order, a field's name taken from the variable a construction was assigned to, a JComboBox/Choice named present with its options never invented, and a button wired from a clean, single, zero-argument method call lambda passed to addActionListener; a non-literal caption, an unassigned field, an unwired button and a lambda that is anything else are named, never guessed, and a file already carrying input-swing's own generated-code markers is left to it entirely",
  "input-cics": "IBM CICS BMS .bms map definitions: DFHMDI maps as screens, DFHMDF fields ordered by POS and lowered onto the dialect, PROT/ASKIP a caption and UNPROT a real input; no button, event or navigation exists in BMS, so no output is ever produced, and an unlabeled UNPROT field, a GRPNAME grouping and an unclean INITIAL literal are named, never guessed",
  "input-informix": "Informix 4GL/ESQL .per screen forms: the SCREEN block's own row and column order read as a grid, [tag] placeholders lowered onto the dialect, NOENTRY as a read only interpolation of its column; a field with no declared binding and a binding with no field on screen are named, never guessed",
  "input-cobolscreen": "a standard COBOL program's SCREEN SECTION: 01 level entries as screens, VALUE literals as captions, PIC with USING/TO a real input and PIC with FROM a read only interpolation, all lowered onto the dialect in declaration order; a PIC with none of USING/FROM/TO and a relative LINE PLUS/COLUMN PLUS position are named, never guessed",
  "input-ispf": "IBM ISPF Dialog Manager .panel definitions: )BODY read as ASCII art, an attribute character's TYPE(TEXT)/INPUT/OUTPUT resolved from )ATTR or ISPF's own three built-in defaults, a field's variable name read directly off the body text beside it and lowered onto the dialect; )INIT and )PROC named as present, never read for meaning, and an unresolved attribute character or field with no variable name are named, never guessed",
  "input-xbase": "dBase/Clipper/FoxPro .prg program source: @ row, col SAY/GET statements read wherever they fall in the file, joined across a trailing ; continuation, one screen per READ that closes the run since the last one, lowered onto the dialect; PICTURE is never translated, and a VALID, WHEN, RANGE or DEFAULT clause is named present on its field, never evaluated or read",
  "input-openedge": "Progress OpenEdge ABL .p source: DEFINE VARIABLE and DEFINE BUTTON declarations, one screen per FORM ... WITH FRAME block in the frame's own field and button order, LOGICAL a real checkbox and everything else a real text input; a clean bare RUN wired from ON CHOOSE OF becomes a real output, FORMAT is never translated, and a FORM entry with no matching DEFINE, an unwired button and a not-clean handler body are each named, never guessed",
  "input-tk": "Tcl/Tk scripts: widget-creation commands (label, entry, checkbutton, radiobutton, button, frame/labelframe and ttk:: equivalents) read wherever they fall in the file, joined across a backslash continuation, a whole file as one screen, radio buttons grouped by a shared -variable reference and a button wired from a clean bare -command proc name, lowered onto the dialect; an unbound entry or checkbutton, a brace-quoted -command and an unrecognised widget command are named, never guessed",
  "input-fluid": "FLTK FLUID .fl designer files: a brace nested widget tree read with a small recursive descent parser, one screen per root window, fields, a labeled field's caption read straight off its own node, radio buttons grouped by shared immediate parent (FLTK's own runtime rule) and buttons wired from a clean functionName(...) callback; a messy callback, an unrecognised widget class and a choice filled from code are named, never read",
  "input-jasperreports": "JasperReports .jrxml band layouts: title, header, detail and summary bands as sections, static text and a bare $F/$P/$V reference lowered onto the dialect; a computed textField expression, a subreport and an image's source are named, never evaluated",
  "input-birt": "Eclipse BIRT .rptdesign reports: page-header/body/page-footer as sections, a table's own header/detail/footer bands as a real thead/tbody/tfoot, a bare resultSetColumn reference lowered onto the dialect; a computed expression, a list and an image's source are named, never evaluated",
  "input-ssrs": "SQL Server Reporting Services .rdl reports: PageHeader/Body/PageFooter as sections, a Tablix's row/cell nesting flattened onto a real table, a bare Fields!/Parameters! reference lowered onto the dialect; a computed expression, a subreport and an image's source are named, never evaluated",
  "input-fetch": "portamp fetch <url>: copies one origin's pages and assets into a folder behind --allow-live and the attestation, robots.txt honoured, every skip written down; the folder is then what input-static ports",
  "input-underscore": "the templates input-backbone deferred: <%= %> lowered to the dialect",
  "input-handlebars": "#if, #each and the empty state in else, lowered to the dialect",
  "input-jinja": "server rendered pages read as screens; python logic respelled as JS",
  "dsp-ir": "one representation in the middle, so a target costs a printer",
  "dsp-apistyle": "the API's house style, so the port keeps it, quirks included",
  "general-history": "the run over time, counts only, so trends have a table",
  "general-size": "the port weighed by kind, with --max-kb the budget the run enforces",
  "general-publish": "publish-check: the npm pack dry run read for you, a verdict with an exit code; never publishes",
  "vis-graph": "the port's shape drawn: screens, what composes what, which endpoints each calls",
  "vis-a11y": "every accessibility axis on one scorecard, each number another plugin's, none invented",
  "vis-security": "every security concern on one scorecard: markup, supply chain, sandbox, cookies, trackers",
  "vis-perf": "every performance concern on one scorecard: scripts, first paint, inline, images, fonts, with the port's weight beside",
  "vis-lifecycle": "every teardown on one scorecard: timers uncleared, listeners unremoved, observers open; storage not a leak",
  "output-preact": "the same proven JSX, a tenth the runtime",
  "output-solid": "props as props.x and signals as x(), because Solid punishes spelling",
  "output-alpine": "behavior written on the markup, for apps that never wanted a build",
  "output-cem": "a custom elements manifest, so the elements exist to editors",
  "output-postman": "the requests as a collection; responses deliberately absent",
  "output-curl": "a smoke script, written and never run, GETs only",
  "output-fixtures": "response fixtures with types and no captured values",
  "output-readme": "the index of everything the run wrote, honest numbers beside it",
  "output-ci": "a workflow for the port: parse checks and the endpoint rule, kept",
  "output-cloudflare": "a Cloudflare Pages deploy plan, the redirects in the native _redirects file",
  "output-codemod": "a code transformer: CommonJS lifted to ES modules, only the forms it can prove, the rest refused",
  "output-site": "a folder of old pages as a React app: router, layout, redirects, the maps",
  "dsp-assets": "what the tree holds against what the code points at",
  "dsp-auth": "the auth scheme and where the token lives; values never printed",
  "dsp-css": "the stylesheet weighed: !important, ids, depth, repetition",
  "dsp-duplication": "screens that are nearly the same screen, proposed as one",
  "dsp-entropy": "strings random enough to be credentials, values withheld",
  "dsp-era": "when the site was built, dated by seventeen signals with a spread",
  "dsp-events": "the global addEventListener the port must remove on unmount, and which never got a remove",
  "dsp-components": "blocks two screens repeat, lifted into one shared component",
  "dsp-props": "blocks that share a shape but differ in words, proposed as one with props",
  "dsp-seo": "the signals each page told a machine: title, canonical, cards, the gaps named",
  "dsp-analytics": "the trackers the old front end loaded, named as a consent decision, ids withheld",
  "dsp-images": "images shipped at one fixed size: srcset, dimensions and format proposed",
  "dsp-fonts": "how the old app loaded its type: formats to drop, a display strategy to add",
  "dsp-focus": "the focus habits the port inherits: positive tabindex, autofocus, accesskey, programmatic focus",
  "dsp-media": "the video and audio embedded, the captions track missing, controls and autoplay named; src withheld",
  "dsp-tables": "the tables drawn, and whether a screen reader can read them: caption, headers, scope; cells withheld",
  "dsp-iframes": "the iframes embedded, their missing title and sandbox named, third-party hosts listed; src path withheld",
  "dsp-motion": "the animations and transitions, and whether reduced-motion is ever honoured",
  "dsp-observers": "the IntersectionObserver, ResizeObserver, MutationObserver and PerformanceObserver the port must disconnect, and which never got one",
  "dsp-print": "the print stylesheet the port must not lose, carried as identity not reinvented",
  "dsp-cookies": "the cookies the client sets and whether it asked, values withheld",
  "dsp-security": "the sharp edges: inline handlers, eval, innerHTML, tabnabbing, no CSP",
  "dsp-supplychain": "the third party code the page loads, and whether it carries an integrity hash",
  "dsp-console": "the debug output left in the scripts, the console calls a port should strip",
  "dsp-deps": "the libraries the app stands on by version, against the support dates their own projects published; not assessed means that",
  "dsp-platform": "the browser APIs the scripts call that the platform removed, deprecated or never standardised, with what replaced each",
  "dsp-dom": "the size of the tree each screen renders: elements, depth, widest parent and loops, against the thresholds Lighthouse publishes",
  "dsp-env": "the configuration keys the app reads at runtime and where, names only; a blank .env.example the port asks with",
  "dsp-globals": "what the app puts on the global object, which a module port has to contain",
  "dsp-landmarks": "the ARIA landmark structure of each page, the regions a screen reader jumps between",
  "dsp-imports": "the module dependency graph from import and require, and the import cycles a port should break",
  "dsp-magic": "the magic numbers and hardcoded status strings buried in logic, each a value with no name to change",
  "dsp-keyboard": "click handlers on elements the keyboard cannot reach, with the tabindex, role or key handler each lacks",
  "dsp-labels": "form controls a page left with no accessible name, which a placeholder does not give",
  "dsp-learn": "a learned second opinion on the app's archetype, from a model trained on the labelled corpus",
  "dsp-render-blocking": "what delays first paint: sync head scripts, blocking stylesheets, css @import",
  "dsp-inline": "the inline style and script a port should extract, for theming and for a strict CSP",
  "input-pdf": "a tech document read from its own text operators, nothing invented",
  "input-polymer": "dom-module elements, [[one way]] and {{two way}}, lowered onto the dialect",
  "input-liquid": "liquid themes: if/elsif/unless/case/for lowered, templates wrapped in their layout, sections and snippets inlined, schema settings as inputs",
  "input-twig": "twig templates: elseif, ~, is defined/empty, |e and path() rewritten onto jinja and lowered by the one jinja lowering",
  "input-xslt": "xslt stylesheets: for-each, if, choose, value-of, attribute, apply and call templates lowered, XPath as the JS path it names",
  "input-blade": "blade views: @if, @foreach, @forelse, @switch, @auth, @can lowered, composed into the layout they extend with partials inlined, the variables read as inputs",
  "input-marko": "marko templates: <if>, <for|row|>, bare attribute bindings, on-event(...) and ${} lowered onto the dialect; component.js read beside",
  "input-mithril": "mithril components: hyperscript m() trees walked as the runtime would and printed onto the dialect, attrs as inputs, callbacks as outputs",
  "input-razor": "razor views: @if, @foreach, @switch and @expressions lowered, composed into the layout _ViewStart names with partials and sections in place, Model and ViewBag as inputs",
  "input-freemarker": "freemarker templates: <#if>, <#list> with its else, <#switch>, ${x!\"d\"} defaults and ?built_ins lowered, includes inlined, macros expanded at their calls",
  "input-pug": "pug templates read from their indentation: if, each with index and else, case, mixins, extends and block composed, includes inlined, #{} and !{} lowered",
  "input-cfml": "ColdFusion pages: cfif with its chain, cfloop over arrays, lists, collections and queries, cfswitch, cfoutput's #expressions#, cfset, cfinclude and cfform lowered; queries, cfscript, custom tags and scopes named",
  "input-haml": "Haml templates read from their indentation: if, elsif, else, unless, case, each with index, Ruby spelled as JS, a layout's yield filled by the page, partials rendered, Rails form and link helpers lowered, formats and routes named",
  "input-jsp": "JSP with the standard tag library: c:if, c:choose, c:forEach with its status, c:out, c:set, c:url, includes and Spring form tags lowered, EL spelled as JS, scriptlets and formats named",
  "input-pebble": "Pebble (Java) templates through Twig's front over the jinja lowering: equals, contains, even and odd, ?:, the block wrappers transparent, a block filter and an embed named",
  "input-volt": "Volt (Phalcon) templates on the jinja lowering: content() as the layout slot, partials inlined, link_to and url as the reverse router, tag.* helpers as fields, do and early exits named",
  "input-ejs": "EJS templates on the underscore lowering: escaped and raw output the right way round, comments and whitespace markers, includes inlined with locals bound, JavaScript loops, layout.ejs composed",
  "input-django": "Django templates on the jinja lowering: empty, ifequal, comment, with and blocktrans bound, trans and static and url named as the server's, firstof, forloop, colon filters; the base composed",
  "input-twirl": "Twirl (Play) templates: @if/@for/@match/@defining, .map as a loop or a presence test by declared type, Scala spelled as JavaScript, the layout applied as a call, Form fields, routes and messages named",
  "input-slim": "Slim templates on the Haml lowering: the tag's own name, name=value attributes, | and ' text, == raw output, tag: inline children, embedded engines named; one lowering for both Rails dialects",
  "input-smarty": "Smarty templates rewritten onto jinja's tags and lowered by one lowering: {if}, {foreach} with its properties, {section}, {include}, {extends} and {block} with append and prepend, modifiers rewritten or named",
  "input-thymeleaf": "Thymeleaf natural templates: th:if, th:each with its status, th:text replacing the prototype, link expressions, th:switch, th:field as a model, fragments and the Layout Dialect composed, utilities and message keys named",
  "input-tapestry": "Tapestry .tml templates: t:type textfield/passwordfield/checkbox/select/submit as a real input with ng-model, t:if and t:loop as ng-if and ng-repeat, a bare ${property} interpolated, an unresolved SelectModel and a convention bound submit handler named as gaps",
  "input-riot": "riot tags, { expr } and each= and if=, lowered onto the dialect",
  "input-svelte": "svelte components, {#each}/{#if} blocks and on:/bind:, lowered onto the dialect",
  "input-swing": "Java Swing's initComponents, found by its GEN markers: fields declared, instantiated and configured, radios grouped, combo items and table headers only when literal, a click matched to its real handler and kept as existing, never read",
  "input-netbeansform": "NetBeans Matisse .form XML, the structured sidecar more reliable than the generated Java beside it: a labelFor ComponentRef paired to its field, a combo box's inline StringArray model, radios grouped by an explicit buttonGroup reference to a NonVisualComponents ButtonGroup or, lacking one, a run of consecutive siblings, and a button's own actionPerformed EventHandler read directly rather than matched against generated code; an opaque property and a widget class with no vocabulary entry are named, never read",
  "input-react": "React read back onto the dialect, so the tool can read what it writes",
  "output-next": "the site model as a Next app directory, components imported not copied",
  "output-astro": "each screen as an Astro island hydrating the emitted React component",
  "output-aws": "the site as an AWS deploy plan: S3, CloudFront, the 301 map compiled to a function, no secrets taken",
  "output-azure": "the site as an Azure deploy plan: Storage static site, Front Door, the 301 map as rules, no secrets taken",
  "output-gcp": "the site as a Google Cloud deploy plan: Cloud Storage, Cloud CDN, the 301 map as URL map rules, no secrets taken",
  "output-qwik": "the proven JSX as a Qwik component: handlers split with $, state as signals",
  "output-remix": "the site as route modules, retired addresses as loaders that 301",
  "output-nuxt": "the site model as a Nuxt app, the emitted Vue imported not copied",
  "output-sveltekit": "the site as SvelteKit routes, old addresses answered from the server hook",
  "output-dockerfile": "the port in a container: the zero dependency serve.js wrapped, nothing to install",
  "output-nginx": "an nginx server block that serves the export and answers every old address with its 301",
  "output-caddy": "a Caddyfile that serves the export with automatic HTTPS and the same redirect map as 301s",
  "output-eleventy": "the site as an Eleventy project: chrome as layout, pages printed static, redirects as _redirects; dynamic screens named",
  "output-types": "TypeScript prop interfaces per screen and the endpoint paths as a union",
  "output-vercel": "a Vercel deploy plan, the redirects as permanent rules in vercel.json",
  "output-playwright": "the same end to end walk for Playwright, with the config starting the port's own server",
  "output-cypress": "an end to end suite that walks every route and asserts the redirects land",
  "dsp-state": "where state should live, argued from what each screen reads",
  "dsp-storage": "the localStorage, sessionStorage and IndexedDB the app kept state in; keys named, values never read",
  "dsp-timers": "the setTimeout, setInterval and animation loops the port must clean up, and which never got a clear",
  "dsp-weight": "how much port each screen is, by a formula printed beside it",
  "dsp-archetype": "what kind of app this is, from its structure and its traffic",
  "dsp-boundaries": "components proposed for an app that declared none. Proposals, never results",
  "dsp-routes": "the route table, because the address bar is half the contract",
  "dsp-modernize": "what to build instead, and the evidence for each decision",
  "dsp-uplift": "the old palette, brought to contrast without losing the brand",
  "dsp-tokens": "density, type scale, spacing, color roles. Unresolved is recorded",
  "dsp-apimap": "one endpoint map and a client, so no component holds a URL",
  "dsp-behavior": "an exploration becomes screens, fields, flow and endpoints",
  "dsp-improve": "what the original got wrong, measured while it was running",
  "dsp-a11y": "contrast and target size, over the palette the port will use",
  "dsp-i18n": "copy welded into the markup, and the sentences split around a value",
  "dsp-deadcode": "declared and never used. Candidates, never verdicts",
  "dsp-forms": "the validation rules, recovered as one schema per form",
  "dsp-cognitive": "the attention audit: dense copy, icon only controls, timers, motion",
  "dsp-async": "the callback pyramids and long promise chains a port could straighten into async/await",
  "dsp-complexity": "the functions grown too tangled to port cleanly, measured by length, nesting and branches",
  "dsp-dates": "every place the app touches a date, before each becomes a bug twice",
  "dsp-flags": "the conditions that read like feature flags, each one a decision owed",
  "dsp-permissions": "the visibility rules, assembled into the table nobody had",
  "dsp-perf": "what the old app ships that the port should not",
  "dsp-entities": "the data model, inferred from what actually crossed the wire",
  "dsp-diff": "two runs compared, so a port can see what moved underneath it",
  "output-react": "a component per screen, every state, and the translated body",
  "output-vue": "the third target on the IR",
  "output-angular": "2013's dialect in, this year's out, through a middle that knows neither",
  "output-lit": "the custom element with a rendering library, for teams that want one",
  "output-svelte": "the second target on the IR",
  "output-html": "a custom element, depending on nothing at all",
  "output-storybook": "a story per component, one per state",
  "output-tests": "a conformance suite, written from what the original did",
  "output-openapi": "the requests the port makes, and no response it never saw",
  "output-msw": "something for the port to talk to, carrying nobody's data",
  "output-netlify": "a Netlify deploy plan, the redirects in the native _redirects file",
  "output-tailwind": "the measured tokens as a tailwind config, under extend",
  "output-design-tokens": "the design in the W3C tokens format, measured and proposed apart",
  "output-i18n": "the catalogue as ICU messages, split sentences made whole",
  "output-adr": "one decision record per proposal, every one of them proposed",
  "output-migration": "the cutover one route at a time, ordered by proof",
  "output-forms": "each schema as code, with a validator speaking the app's own words",
  "vis-parity": "what matched, what did not, and what was never checked",
  "vis-readers": "which reader claimed each file the scan kept, and the markup no reader did",
  "vis-roundtrip": "the emitted React read back and held against the structure it came from",
  "vis-ui": "the console: rack, wipe, endpoints, and the unverified list",
  "vis-timeline": "the exploration replayed step by step, records generalised away",
  "vis-transformer": "a real transformer forward pass in pure JS, seeded and deterministic, its attention drawn",
  "vis-coverage": "how much of the old app the port covers, measured per screen",
  "vis-equivalence": "runs the conformance suite and folds the verdict back in",
  "general-doctor": "what is installed, and what each gap turns off",
  "general-scaffold": "portamp new-plugin, with the contract already in the header",
  "general-watch": "rerun the pipeline when the source tree changes",
  "general-policy": "secrets, live calls, billable calls, endpoints in components",
  "general-agents": "a multi agent, retrieval augmented reasoning pass over the port's own reports, via a real external LLM",
  "general-architect": "a cloud architecture proposal from a real external LLM, gated live and billable, marked unverified",
  "general-authorization": "no source path runs without an attestation on disk",
  "general-license": "fonts and icon sets whose licence does not travel",
};

const INK = { input: "#6ee7a8", dsp: "#7dd3fc", output: "#f0a830", vis: "#c4b5fd", general: "#fb7185" };
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x, y, body, { size = 10.5, weight = "normal", fill = "#8b8b96", anchor = "start", spacing } = {}) =>
  `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}"` : ""}>${esc(body)}</text>`;

const ORDER = ["input", "dsp", "output", "vis", "general"];

async function main() {
  const kernel = new Kernel({ log: createLogger({ quiet: true }), policy: {} });
  await kernel.discover({ builtinDir: join(ROOT, "plugins") });

  const rows = [...kernel.plugins].sort(
    (a, b) => ORDER.indexOf(a.class) - ORDER.indexOf(b.class) || a.name.localeCompare(b.name)
  );

  const ROW = 24;
  const TOP = 92;
  const W = 1040;
  const H = TOP + rows.length * ROW + 30;

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The ${rows.length} plugins portamp ships with, listed by class">`,
    `<defs><linearGradient id="chassis" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a42"/><stop offset="1" stop-color="#1b1b1f"/></linearGradient></defs>`,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="7" fill="url(#chassis)" stroke="#0e0e11"/>`,
    `<rect x="2.5" y="2.5" width="${W - 5}" height="${H - 5}" rx="6" fill="none" stroke="#5a5a66" opacity="0.45"/>`,
    `<rect x="10" y="10" width="${W - 20}" height="34" rx="3" fill="#0e0e11" stroke="#0e0e11"/>`,
    `<path d="M11 43 L11 11 L${W - 11} 11" fill="none" stroke="#5a5a66" opacity="0.28"/>`,
    text(24, 32, "PLUGIN RACK", { size: 12, weight: "bold", fill: "#f0a830", spacing: 3 }),
    text(W - 24, 32, `${rows.length} loaded  ./plugins is scanned automatically`, { size: 11, anchor: "end" }),
    `<rect x="16" y="54" width="${W - 32}" height="${H - 70}" rx="3" fill="#0a0a0d" stroke="#0e0e11"/>`,
    `<path d="M17 ${H - 17} L17 55 L${W - 17} 55" fill="none" stroke="#5a5a66" opacity="0.28"/>`,
    text(40, 74, "CLASS", { size: 9.5, weight: "bold", fill: "#6a6a76", spacing: 1 }),
    text(150, 74, "NAME", { size: 9.5, weight: "bold", fill: "#6a6a76", spacing: 1 }),
    text(330, 74, "DOES", { size: 9.5, weight: "bold", fill: "#6a6a76", spacing: 1 }),
    `<rect x="26" y="82" width="${W - 52}" height="1" fill="#5a5a66" opacity="0.25"/>`,
  ];

  rows.forEach((plugin, i) => {
    const y = TOP + i * ROW;
    const ink = INK[plugin.class] ?? "#8b8b96";
    if (i % 2 === 0) out.push(`<rect x="26" y="${y - 12}" width="${W - 52}" height="${ROW}" fill="#111116"/>`);
    out.push(`<rect x="34" y="${y - 7}" width="7" height="7" rx="1.5" fill="${ink}"/>`);
    out.push(text(50, y, plugin.class, { fill: ink }));
    out.push(text(150, y, plugin.name, { size: 11, weight: "bold", fill: "#e6e6ec" }));
    out.push(text(330, y, DOES[plugin.name] ?? "", { size: 10 }));
  });

  out.push("</svg>");

  const missing = rows.filter((p) => !DOES[p.name]).map((p) => p.name);
  if (missing.length) throw new Error(`no description for: ${missing.join(", ")}. Add one rather than drawing a blank row.`);

  await writeFile(join(ROOT, "media/plugin-rack.svg"), out.join("\n") + "\n", "utf8");
  process.stdout.write(`media/plugin-rack.svg: ${rows.length} plugins\n`);
}

main().catch((e) => {
  process.stderr.write(e.message + "\n");
  process.exitCode = 1;
});
