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
  "input-vue": "single file components, into the shape the Angular reader produces",
  "input-jquery": "a front end that declared no components. Inventories, never invents",
  "input-explore": "drives a running app and works out what it is, without the source",
  "input-shots": "catalogs screenshots and infers the state each filename shows",
  "input-record": "drives the running app with Playwright: shots, HAR, computed styles",
  "input-blackbox": "HAR, schema dumps, exports. Passive: nothing driven, nothing fetched",
  "input-static": "a site with no framework: pages are screens, links are the routes",
  "input-stencil": "stencil components: @Component tag, @Prop/@Event, render JSX lowered by the React reader",
  "input-underscore": "the templates input-backbone deferred: <%= %> lowered to the dialect",
  "input-handlebars": "#if, #each and the empty state in else, lowered to the dialect",
  "input-jinja": "server rendered pages read as screens; python logic respelled as JS",
  "dsp-ir": "one representation in the middle, so a target costs a printer",
  "dsp-apistyle": "the API's house style, so the port keeps it, quirks included",
  "general-history": "the run over time, counts only, so trends have a table",
  "general-size": "the port weighed by kind, with --max-kb the budget the run enforces",
  "vis-graph": "the port's shape drawn: screens, what composes what, which endpoints each calls",
  "vis-a11y": "every accessibility axis on one scorecard, each number another plugin's, none invented",
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
  "dsp-globals": "what the app puts on the global object, which a module port has to contain",
  "dsp-landmarks": "the ARIA landmark structure of each page, the regions a screen reader jumps between",
  "dsp-imports": "the module dependency graph from import and require, and the import cycles a port should break",
  "dsp-magic": "the magic numbers and hardcoded status strings buried in logic, each a value with no name to change",
  "dsp-labels": "form controls a page left with no accessible name, which a placeholder does not give",
  "dsp-learn": "a learned second opinion on the app's archetype, from a model trained on the labelled corpus",
  "dsp-render-blocking": "what delays first paint: sync head scripts, blocking stylesheets, css @import",
  "dsp-inline": "the inline style and script a port should extract, for theming and for a strict CSP",
  "input-pdf": "a tech document read from its own text operators, nothing invented",
  "input-polymer": "dom-module elements, [[one way]] and {{two way}}, lowered onto the dialect",
  "input-riot": "riot tags, { expr } and each= and if=, lowered onto the dialect",
  "input-svelte": "svelte components, {#each}/{#if} blocks and on:/bind:, lowered onto the dialect",
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
  "output-types": "TypeScript prop interfaces per screen and the endpoint paths as a union",
  "output-vercel": "a Vercel deploy plan, the redirects as permanent rules in vercel.json",
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
