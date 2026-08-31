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
  "input-angular": "components, bindings, RxJS operators, HttpClient calls, interceptors",
  "input-angularjs": "the 1.x apps that never went anywhere: controllers, components, $http",
  "input-knockout": "data-bind expanded into a dialect; the viewmodel is the component",
  "input-backbone": "views are boundaries somebody drew, and they are read as such",
  "input-openapi": "a spec as a source, cross checked against what the app actually calls",
  "input-vue": "single file components, into the shape the Angular reader produces",
  "input-jquery": "a front end that declared no components. Inventories, never invents",
  "input-explore": "drives a running app and works out what it is, without the source",
  "input-shots": "catalogs screenshots and infers the state each filename shows",
  "input-record": "drives the running app with Playwright: shots, HAR, computed styles",
  "input-blackbox": "HAR, schema dumps, exports. Passive: nothing driven, nothing fetched",
  "dsp-ir": "one representation in the middle, so a target costs a printer",
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
  "dsp-dates": "every place the app touches a date, before each becomes a bug twice",
  "dsp-flags": "the conditions that read like feature flags, each one a decision owed",
  "dsp-permissions": "the visibility rules, assembled into the table nobody had",
  "dsp-perf": "what the old app ships that the port should not",
  "dsp-entities": "the data model, inferred from what actually crossed the wire",
  "dsp-diff": "two runs compared, so a port can see what moved underneath it",
  "output-react": "a component per screen, every state, and the translated body",
  "output-vue": "the third target on the IR",
  "output-svelte": "the second target on the IR",
  "output-html": "a custom element, depending on nothing at all",
  "output-storybook": "a story per component, one per state",
  "output-tests": "a conformance suite, written from what the original did",
  "output-openapi": "the requests the port makes, and no response it never saw",
  "output-msw": "something for the port to talk to, carrying nobody's data",
  "output-tailwind": "the measured tokens as a tailwind config, under extend",
  "output-design-tokens": "the design in the W3C tokens format, measured and proposed apart",
  "output-i18n": "the catalogue as ICU messages, split sentences made whole",
  "output-adr": "one decision record per proposal, every one of them proposed",
  "output-migration": "the cutover one route at a time, ordered by proof",
  "output-forms": "each schema as code, with a validator speaking the app's own words",
  "vis-parity": "what matched, what did not, and what was never checked",
  "vis-ui": "the console: rack, wipe, endpoints, and the unverified list",
  "general-policy": "secrets, live calls, billable calls, endpoints in components",
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
