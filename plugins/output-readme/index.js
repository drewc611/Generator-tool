/**
 * The index of everything the run wrote. A port that produces fifteen files
 * without a front page is a scavenger hunt; this one file says what each
 * artifact is, in reading order, with the honest numbers beside it. It runs
 * at verify so the list is what was actually written, not what was planned.
 */

const DESCRIBES = [
  [/^PORT_NOTES\.md$/, "every item the run could not verify, which is the file to read first"],
  [/^PORT_README\.md$/, "this index"],
  [/^ARCHITECTURE\.md$/, "what kind of app this is, with the signals for and against"],
  [/^ROUTES\.md$/, "the route table, cross checked against the screens"],
  [/^WEIGHT\.md$/, "how much port each screen is, heaviest first"],
  [/^STATE\.md$/, "where state should live, argued from reads"],
  [/^API_STYLE\.md$/, "the API's house style, for the port to keep"],
  [/^AUTH\.md$/, "the auth scheme and where the token lives"],
  [/^ASSETS\.md$/, "assets held against assets referenced"],
  [/^CSS_STATS\.md$/, "the stylesheet weighed"],
  [/^SECRET_CANDIDATES\.md$/, "strings random enough to be credentials, values withheld"],
  [/^DUPLICATION\.md$/, "screens that are nearly the same screen"],
  [/^A11Y\.md$/, "accessibility findings"],
  [/^COVERAGE\.md$/, "what portion of the legacy app the run accounted for"],
  [/^DEAD_CODE\.md$/, "removal candidates, never verdicts"],
  [/^DESIGN_UPLIFT\.md$/, "the palette brought to contrast without losing the brand"],
  [/^MODERNIZATION\.md$/, "what to build instead, with the evidence"],
  [/^MIGRATION\.md$/, "the order to do it in"],
  [/^ACCESSIBILITY\.md$/, "the accessibility scorecard: every a11y axis the run measured, counted not graded"],
  [/^AGENTS\.md$/, "the playbooks an agent follows against this port, one per skill"],
  [/^ANALYTICS\.md$/, "the tracking vendors the source loaded, none carried into the port"],
  [/^API_CHANNELS\.md$/, "WebSocket channels and GraphQL operations read from source, schemas unclaimed"],
  [/^API_FIELDS\.md$/, "the fields each screen reads from each response, from the templates only"],
  [/^ASPNET\.md$/, "the Web Forms controls and postbacks read, with what each becomes"],
  [/^ASYNC\.md$/, "callback pyramids and promise chains by depth, where the port should flatten"],
  [/^ATTENTION\.md$/, "the transformer demonstration's attention maps, drawn from the weights it learned"],
  [/^BEHAVIOR_BY_ROUTE\.md$/, "the jQuery inventory matched to each route's markup by selector"],
  [/^BEHAVIOR_MODEL\.md$/, "the interaction model observed: what changed when each control was used"],
  [/^BOUNDARIES\.md$/, "the component boundaries proposed from the markup's own repetition"],
  [/^CODEMOD\.md$/, "the mechanical rewrites the port applied, each reversible and named"],
  [/^COGNITIVE\.md$/, "how much a person must hold in mind per screen, from the IR"],
  [/^COMPLEXITY\.md$/, "cyclomatic complexity and nesting per function, the hard ones first"],
  [/^COMPONENTS\.md$/, "blocks more than one screen carried verbatim, and which were lifted"],
  [/^CONSOLE\.md$/, "console calls and debugger statements left in the scripts, arguments withheld"],
  [/^COOKIES\.md$/, "every cookie the client writes and whether consent was asked, values withheld"],
  [/^DATES\.md$/, "the date and time handling found: formats, locales, zones, and where the port must choose"],
  [/^IMPORTS\.md$/, "the module dependency graph from import and require, and the cycles a port should break"],
  [/^DEPENDENCIES\.md$/, "the libraries by version against the support dates their projects published"],
  [/^DIFF\.md$/, "what changed between this run and the previous one"],
  [/^DOM\.md$/, "the size of the tree each screen renders, against the thresholds Lighthouse publishes"],
  [/^DOCS\.md$/, "the PDF documents read, what each gave up and what it could not"],
  [/^ENTITIES\.md$/, "the nouns the app is about, read from routes, endpoints and screens"],
  [/^ENV\.md$/, "the configuration keys read at runtime and where, names only"],
  [/^EQUIVALENCE\.md$/, "the same screen through two dialects, compared byte for byte per target"],
  [/^ERA\.md$/, "the markup dated by its signals, with the evidence for the years"],
  [/^EVENTS\.md$/, "listeners added and never removed, the leak a port inherits"],
  [/^FLAGS\.md$/, "feature flags and their reads, so the port keeps every branch on purpose"],
  [/^FOCUS\.md$/, "the focus order recorded against the reading order"],
  [/^FONTS\.md$/, "each font face's formats and display setting, and the gaps"],
  [/^FORMS\.md$/, "every form with its fields, constraints and the submit it makes"],
  [/^GLOBALS\.md$/, "what the app hangs on the global object, which a module port must contain"],
  [/^GRAPH\.md$/, "the architecture as one flowchart: screens naming screens, screens calling endpoints"],
  [/^HISTORY\.md$/, "every run over this source, in order, with what each wrote"],
  [/^IFRAMES\.md$/, "each iframe with its host, title and sandbox, values withheld"],
  [/^IMAGES\.md$/, "each image's srcset, sizing, loading and alt, and what is missing"],
  [/^IMPROVEMENTS\.md$/, "measured findings ranked by the emitted lines each fix would touch"],
  [/^INLINE\.md$/, "inline style and script counted per tag, for theming and a strict CSP"],
  [/^JSF\.md$/, "the JSF and PrimeFaces components read, with what each becomes"],
  [/^LABELS\.md$/, "form controls with no accessible name, by file and line"],
  [/^LANDMARKS\.md$/, "the landmark structure of each page and the gaps a screen reader feels"],
  [/^LEARNED\.md$/, "the learned archetype model's reading, with its corpus size stated"],
  [/^LIFECYCLE_SCORECARD\.md$/, "timers, listeners and observers never cleaned up, one page"],
  [/^MAGIC\.md$/, "magic numbers and hardcoded status strings in logic, each without a name"],
  [/^MATH\.md$/, "the transformer demonstration's arithmetic, worked by hand beside the code"],
  [/^MEDIA\.md$/, "audio and video without captions, controls or a transcript"],
  [/^MOTION\.md$/, "animation and transitions declared, and whether reduced motion stills them"],
  [/^OBSERVERS\.md$/, "observers created and never disconnected"],
  [/^PARITY_PIXELS\.md$/, "pixel drift between runs, with the number's limits stated beside it"],
  [/^PARITY_STRUCTURE\.md$/, "the recording's elements against each ported screen's structure"],
  [/^PERF\.md$/, "the request patterns that cost: sync XHR, document.write, requests in loops, polling"],
  [/^PERFORMANCE\.md$/, "the performance scorecard: every perf axis the run measured, counted not graded"],
  [/^PERMISSIONS\.md$/, "the roles and permission checks the templates carry"],
  [/^PLATFORM\.md$/, "browser APIs the platform removed or deprecated, with what replaced each"],
  [/^PRINT\.md$/, "the print stylesheets carried across as identity"],
  [/^PROPS\.md$/, "blocks that share a skeleton, with the slots that vary proposed as props"],
  [/^RACES\.md$/, "the debounces and cancellations the port must keep"],
  [/^RENDER\.md$/, "what blocks first paint: sync head scripts, blocking stylesheets, css imports"],
  [/^REPORT\.md$/, "the scaffold's own report on the plugin it generated"],
  [/^REVERSE\.md$/, "the transformer demonstration learning to reverse a sequence, step by step"],
  [/^REVERSE_MULTIHEAD\.md$/, "the same task with several attention heads, compared"],
  [/^ROUNDTRIP\.md$/, "each screen emitted to React and read back, structural drift per screen"],
  [/^SECURITY\.md$/, "the sharp edges: inline handlers, eval, innerHTML, tabnabbing, no CSP"],
  [/^SECURITY_HEADERS\.md$/, "the Content Security Policy built from observed hosts, with the evidence"],
  [/^SECURITY_SCORECARD\.md$/, "the security scorecard: every security axis the run measured, counted not graded"],
  [/^SEO\.md$/, "what each page told machines: title, description, canonical, lang, structured data"],
  [/^SITE\.md$/, "the site model: routes, the link graph, the chrome, the redirect map"],
  [/^SITE_MAP\.md$/, "the routes drawn as the tree the pages link"],
  [/^SITE_STATS\.md$/, "the site weighed: pages, words, links, assets"],
  [/^SIZE\.md$/, "what the run wrote by kind, in bytes on disk"],
  [/^SORT\.md$/, "the transformer demonstration learning to sort, step by step"],
  [/^SPEC_COVERAGE\.md$/, "the OpenAPI document against the calls the app makes, both directions"],
  [/^STORAGE\.md$/, "localStorage, sessionStorage and IndexedDB keys the app reads and writes, values withheld"],
  [/^SUPPLYCHAIN\.md$/, "third party scripts and styles, and whether each carries an integrity hash"],
  [/^TABLES\.md$/, "data tables without headers, scope or captions"],
  [/^TIMELINE\.md$/, "the exploration in order: every step the probe took and what it found"],
  [/^TIMERS\.md$/, "intervals and timeouts set and never cleared"],
  [/^TRAINING\.md$/, "the transformer demonstration's training run, loss by step, nothing smoothed"],
  [/^WIDGETS\.md$/, "the jQuery UI and plugin widgets found, with what each becomes"],
  [/^src\/api\//, "the endpoint map and client; every URL lives here and nowhere else"],
  [/^src\/features\//, "ported components, every state present"],
  [/^src\/tokens/, "design tokens measured from the original"],
  [/^src\/i18n\//, "strings pulled out of the markup"],
  [/^fixtures\//, "response fixtures, types only"],
];

export function describe(file) {
  for (const [re, text] of DESCRIBES) if (re.test(file)) return text;
  return null;
}

export default {
  name: "output-readme",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (!ctx.written.length) return log.debug("nothing was written");

      // PORT_NOTES.md and the coverage reports land later in this same verify
      // stage, after this plugin's turn. PORT_NOTES.md is unconditional, so it
      // is listed by contract; the rest are named as possible late arrivals.
      const reports = [...new Set([...ctx.written.filter((f) => /^[A-Z_]+\.md$/.test(f)), "PORT_NOTES.md"])].sort();
      const code = ctx.written.filter((f) => !/^[A-Z_]+\.md$/.test(f)).sort();
      const lines = [
        "# What this run wrote",
        "",
        `${ctx.written.length + 1} file(s) from \`${ctx.config.src ?? "the source"}\`. ` +
          `${ctx.report.unverified.length} item(s) could not be verified; they are listed in PORT_NOTES.md and nowhere hidden.`,
        "",
        "## Reports",
        "",
        ...reports.map((f) => {
          const author = ctx.provenance?.[f]?.plugin ?? (f === "PORT_NOTES.md" ? "vis-parity" : null);
          return `- \`${f}\`${describe(f) ? ` — ${describe(f)}` : ""}${author ? ` *(${author})*` : ""}`;
        }),
        "",
        "Every artifact names the plugin that wrote it; `portamp explain <file>`",
        "answers the same question from the terminal.",
        "",
        "## Code and data",
        "",
        ...groupedCode(code, ctx.provenance ?? {}),
        "",
        "COVERAGE.md, and TIMELINE.md or DIFF.md when the run has an exploration",
        "or a history, are written moments after this index and may not be in the",
        "counts above.",
        "",
        "Read PORT_NOTES.md before trusting anything else here. `portamp ui`",
        "serves this run as a console on 127.0.0.1, the reports above rendered.",
        "",
      ];
      await ctx.write("PORT_README.md", lines.join("\n"));
      log.info("PORT_README.md indexes the run");
    });
  },
};

function groupedCode(files, provenance) {
  const groups = new Map();
  for (const file of files) {
    const dir = file.includes("/") ? file.split("/").slice(0, -1).join("/") + "/" : "./";
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }
  const lines = [];
  for (const [dir, members] of [...groups.entries()].sort()) {
    const what = describe(members[0]) ?? describe(dir);
    const authors = [...new Set(members.map((f) => provenance[f]?.plugin).filter(Boolean))];
    lines.push(`- \`${dir}\` (${members.length} file(s))${what ? ` — ${what}` : ""}${authors.length ? ` *(${authors.join(", ")})*` : ""}`);
  }
  return lines;
}
