import { readFile } from "node:fs/promises";
import { balanced } from "../dsp-ir/scan.js";

/**
 * Reads a jQuery or plain DOM front end.
 *
 * The other readers can answer "what are the components", because their
 * frameworks made somebody declare them. jQuery did not. A page is a script
 * that reaches into markup by selector, and the component boundaries exist only
 * in whoever wrote it.
 *
 * So this does not invent them. It produces an inventory: which selector is
 * written to, which is listened on, and which calls go out. That is genuinely
 * knowable from the source. Drawing the boundaries is left to a person, and the
 * notes say so rather than emitting components that look considered and are not.
 */

const AJAX = [
  // $.ajax({ url: "...", type: "POST" })
  /\$\.ajax\s*\(\s*\{([\s\S]{0,400}?)\}\s*\)/g,
  // $.get("..."), $.post("..."), $.getJSON("...")
  /\$\.(get|post|getJSON)\s*\(\s*(['"`])([^'"`]+)\2/g,
  // fetch("...", { method: "POST" })
  /\bfetch\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*\{[\s\S]{0,200}?method\s*:\s*['"](\w+)['"])?/g,
];

/**
 * A selector, and the chain that follows it.
 *
 * The obvious pattern for a chain is `(?:\.\w+\([^)]*\)\s*)*?` before the call
 * that matters, and it is a nested quantifier: on a long chain that never
 * reaches the terminator the engine backtracks through every split of the
 * text. Capturing a bounded window after the selector and reading the chain
 * out of it is linear, and it is easier to follow.
 */
const SELECTOR = /\$\(\s*(['"`])([^'"`]+)\1\s*\)([^;\n]{0,240})/g;

const HANDLER_IN_CHAIN = /^\s*(?:\.[\w$]+\([^)]{0,120}\))??\s*\.on\s*\(\s*(['"`])([^'"`]+)\1/;
const SHORTHAND_IN_CHAIN = /^\s*\.(click|change|submit|blur|focus|keyup|keydown|input|hover)\s*\(/;

// A write says which part of the page this code owns, which is the closest
// thing a jQuery app has to a component boundary.
const WRITE_IN_CHAIN = /^\s*(?:\.[\w$]+\([^)]{0,120}\))??\s*\.(html|text|val|append|prepend|attr|addClass|removeClass|toggleClass|show|hide|empty|remove)\s*\(/;

const DOM_WRITES = /document\.(?:getElementById|querySelector)\(\s*(['"`])([^'"`]+)\1\s*\)\s*\.\s*(innerHTML|textContent|value)\s*=/g;

const looksLikeUrl = (s) => /^[./]|^https?:/.test(s) && !/^\s*$/.test(s);

const SELECTOR_IN_BODY = /\$\(\s*(['"`])([^'"`]+)\1|document\.(?:getElementById|querySelector)\(\s*(['"`])([^'"`]+)\3/g;

const selectorsIn = (body) => {
  const found = [];
  for (const m of body.matchAll(SELECTOR_IN_BODY)) {
    const selector = m[2] ?? m[4];
    if (selector && !looksLikeUrl(selector) && !found.includes(selector)) found.push(selector);
  }
  return found;
};

/**
 * Every named function in the script, with the selectors its body touches and
 * the other named functions it calls. The handler that only says load() has
 * still drawn a boundary; it drew it one call away, which is where almost
 * every jQuery app keeps its actual work.
 */
export function declaredFunctions(text) {
  const declarations = new Map();
  const patterns = [
    /\bfunction\s+([\w$]+)\s*\([^)]*\)\s*\{/g,
    /\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>|[\w$]+\s*=>)\s*\{/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const body = balanced(text, m.index + m[0].length - 1);
      if (body) declarations.set(m[1], { body, selectors: selectorsIn(body) });
    }
  }
  // Resolve calls to a fixpoint, so load() calling render() still lands the
  // selectors render touches on whoever called load. A visited set per name
  // keeps a pair of mutually recursive functions from spinning.
  for (const [name, fn] of declarations) {
    const seen = new Set([name]);
    const queue = [...declarations.keys()].filter((other) => !seen.has(other) && new RegExp(`\\b${other}\\s*\\(`).test(fn.body));
    while (queue.length) {
      const callee = queue.shift();
      if (seen.has(callee)) continue;
      seen.add(callee);
      const target = declarations.get(callee);
      for (const selector of target.selectors) if (!fn.selectors.includes(selector)) fn.selectors.push(selector);
      for (const other of declarations.keys()) {
        if (!seen.has(other) && new RegExp(`\\b${other}\\s*\\(`).test(target.body)) queue.push(other);
      }
    }
  }
  return declarations;
}

/**
 * The selectors a handler's own body reaches for, the ones reached through the
 * named functions it calls included.
 */
function touchedBy(text, from, functions) {
  const window = text.slice(from, from + 300);
  const call = /\.(on|click|change|submit|blur|focus|keyup|keydown|input|hover)\s*\(/.exec(window);
  if (!call) return [];
  const args = balanced(text, from + call.index + call[0].length - 1);
  if (!args) return [];
  const bodyOpen = args.indexOf("{");
  if (bodyOpen < 0) return [];
  const body = balanced(args, bodyOpen);
  if (!body) return [];

  const found = selectorsIn(body);
  for (const [name, fn] of functions) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(body)) {
      for (const selector of fn.selectors) if (!found.includes(selector)) found.push(selector);
    }
  }
  return found;
}

export function readScript(text, rel) {
  const calls = [];
  const widgets = new Map();
  const edges = [];
  const functions = declaredFunctions(text);

  const widget = (selector) => {
    if (!widgets.has(selector)) widgets.set(selector, { selector, file: rel, events: [], writes: [] });
    return widgets.get(selector);
  };

  for (const m of text.matchAll(AJAX[0])) {
    const url = /url\s*:\s*(['"`])([^'"`]+)\1/.exec(m[1]);
    if (!url) continue;
    const method = /(?:type|method)\s*:\s*(['"`])(\w+)\1/.exec(m[1]);
    const verb = (method?.[2] ?? "GET").toUpperCase();
    calls.push({ method: verb, path: url[2], file: rel, headers: null, body: verb === "GET" ? null : "unknown" });
  }
  for (const m of text.matchAll(AJAX[1])) {
    const verb = m[1] === "post" ? "POST" : "GET";
    calls.push({ method: verb, path: m[3], file: rel, headers: null, body: verb === "GET" ? null : "unknown" });
  }
  for (const m of text.matchAll(AJAX[2])) {
    const verb = (m[3] ?? "GET").toUpperCase();
    calls.push({ method: verb, path: m[2], file: rel, headers: null, body: verb === "GET" ? null : "unknown" });
  }

  for (const m of text.matchAll(SELECTOR)) {
    const selector = m[2];
    const chain = m[3];
    if (looksLikeUrl(selector)) continue;

    const on = HANDLER_IN_CHAIN.exec(chain);
    if (on || SHORTHAND_IN_CHAIN.test(chain)) {
      for (const touched of touchedBy(text, m.index, functions)) {
        if (touched !== selector) edges.push([selector, touched]);
      }
    }
    if (on) {
      // `.on("focus blur", ...)` binds two events, not one named oddly.
      for (const event of on[2].split(/\s+/).filter(Boolean)) {
        const w = widget(selector);
        if (!w.events.includes(event)) w.events.push(event);
      }
    }

    const shorthand = SHORTHAND_IN_CHAIN.exec(chain);
    if (shorthand) {
      const w = widget(selector);
      if (!w.events.includes(shorthand[1])) w.events.push(shorthand[1]);
    }

    const write = WRITE_IN_CHAIN.exec(chain);
    if (write) {
      const w = widget(selector);
      if (!w.writes.includes(write[1])) w.writes.push(write[1]);
    }
  }
  for (const m of text.matchAll(DOM_WRITES)) {
    const w = widget(m[2]);
    const kind = { innerHTML: "html", textContent: "text", value: "val" }[m[3]];
    if (!w.writes.includes(kind)) w.writes.push(kind);
  }

  return { calls, widgets: [...widgets.values()], edges };
}

/**
 * The widget libraries of that era, recognised by the call that summons them.
 * Each carries the modern equivalent as a proposal: what to reach for is a
 * decision, but "this is a datepicker" is a fact.
 */
const WIDGET_LIBS = [
  { call: "datepicker", was: "jQuery UI datepicker", instead: "the platform's <input type=\"date\">, which did not exist when this was written" },
  { call: "autocomplete", was: "jQuery UI autocomplete", instead: "a listbox with aria-autocomplete, or the combobox your design system ships" },
  { call: "dialog", was: "jQuery UI dialog", instead: "the platform's <dialog> element" },
  { call: "accordion", was: "jQuery UI accordion", instead: "<details>/<summary>, which the platform grew for exactly this" },
  { call: "tabs", was: "jQuery UI tabs", instead: "a tablist with roving tabindex, or your design system's tabs" },
  { call: "sortable", was: "jQuery UI sortable", instead: "a drag and drop library chosen on purpose; there is no free platform answer yet" },
  { call: "select2", was: "select2", instead: "a combobox; the multivalue case is the part to check" },
  { call: "chosen", was: "chosen", instead: "a combobox" },
  { call: "dataTable", was: "DataTables", instead: "a table component with server side paging; DataTables was hiding an unbounded fetch" },
  { call: "modal", was: "Bootstrap modal", instead: "the platform's <dialog> element" },
  { call: "tooltip", was: "a tooltip plugin", instead: "title, or a popover with aria-describedby where the content is rich" },
];

export function recogniseWidgets(text) {
  const found = [];
  for (const lib of WIDGET_LIBS) {
    const re = new RegExp(`\\$\\(\\s*(['"\`])([^'"\`]+)\\1\\s*\\)\\s*\\.${lib.call}\\s*\\(`, "g");
    for (const m of text.matchAll(re)) found.push({ selector: m[2], ...lib });
  }
  return found;
}

/** A selector that is written to and listened on is doing more than decoration. */
const interesting = (w) => w.events.length + w.writes.length > 1;

export default {
  name: "input-jquery",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.js$/.test(f.rel) && !/\.min\.js$/.test(f.rel));
      if (!files.length) return log.debug("no scripts");

      const widgets = [];
      const calls = [];
      const edges = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !/\$\(|jQuery|document\.(getElementById|querySelector)/.test(text)) continue;
        const found = readScript(text, file.rel);
        widgets.push(...found.widgets);
        calls.push(...found.calls);
        edges.push(...found.edges);
      }
      if (!widgets.length && !calls.length) return log.debug("nothing that reaches the DOM");

      const recognised = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) recognised.push(...recogniseWidgets(text));
      }

      ctx.widgets = [...(ctx.widgets ?? []), ...widgets];
      ctx.widgetEdges = [...(ctx.widgetEdges ?? []), ...edges];
      ctx.widgetLibs = recognised;
      ctx.api.calls.push(...calls);
      log.info(`${widgets.length} selector(s), ${calls.length} call(s)`);

      // The gap is the point. Saying it here is more useful than a component
      // nobody drew.
      const candidates = widgets.filter(interesting);
      if (candidates.length) {
        ctx.unverified(
          `A jQuery front end declares no components, so portamp did not invent any. ` +
          `${candidates.length} selector(s) are both written to and listened on and are the ` +
          `likeliest boundaries: ${candidates.slice(0, 8).map((w) => w.selector).join(", ")}. ` +
          `See WIDGETS.md and decide the boundaries yourself.`
        );
      }
    });

    // After input-static assembled the site: each handler lands on the route
    // whose markup its selector matches. The join is a matching, never a
    // port: what the handler does stays its own code's business, and the
    // manifest says which routes need which behavior wired by hand.
    on("plan", (ctx) => {
      if (!ctx.site?.pages?.length || !ctx.widgets?.length) return;
      const matches = (selector, template) => {
        const id = /^#([\w-]+)$/.exec(selector);
        if (id) return new RegExp(`\\bid\\s*=\\s*["']${id[1]}["']`).test(template);
        const cls = /^\.([\w-]+)$/.exec(selector);
        if (cls) return new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${cls[1]}\\b`).test(template);
        const tag = /^([a-z][\w-]*)$/i.exec(selector);
        if (tag) return new RegExp(`<${tag[1]}\\b`, "i").test(template);
        return null;
      };
      const byRoute = new Map();
      const homeless = [];
      for (const widget of ctx.widgets.filter((w) => w.events?.length)) {
        let landed = false;
        let judged = false;
        for (const page of ctx.site.pages) {
          const template = ctx.screens.find((s) => s.selector === page.selector)?.template ?? "";
          const hit = matches(widget.selector, template);
          if (hit === null) continue;
          judged = true;
          if (hit) {
            if (!byRoute.has(page.route)) byRoute.set(page.route, []);
            byRoute.get(page.route).push(widget);
            landed = true;
          }
        }
        if (!landed) homeless.push({ widget, judged });
      }
      if (!byRoute.size && !homeless.length) return;
      ctx.jqueryByRoute = [...byRoute.entries()]
        .map(([route, widgets]) => ({ route, widgets }))
        .sort((a, b) => a.route.localeCompare(b.route));
      for (const { widget, judged } of homeless) {
        ctx.unverified(
          judged
            ? `the handler on \`${widget.selector}\` (${widget.file}) matches no page in this run; the markup it wired to may be gone, or built at runtime.`
            : `the handler on \`${widget.selector}\` (${widget.file}) uses a selector this matching does not judge; place it by hand.`
        );
      }
      log.info(`${ctx.jqueryByRoute.length} route(s) own jQuery behavior, ${homeless.length} handler(s) unplaced`);
    });

    on("emit", async (ctx) => {
      if (!ctx.jqueryByRoute?.length) return;
      await ctx.write("src/app/behavior-manifest.js", [
        "/**",
        " * Which routes own which legacy handlers, matched by selector against",
        " * each page's own markup. Nothing here is ported behavior: the wiring",
        " * is a person's work, and this manifest says exactly where it is owed.",
        " */",
        "export const BEHAVIOR = {",
        ...ctx.jqueryByRoute.map(({ route, widgets }) =>
          `  ${JSON.stringify(route)}: ${JSON.stringify(widgets.map((w) => ({ selector: w.selector, events: w.events, file: w.file })))},`
        ),
        "};",
        "",
      ].join("\n"));
      await ctx.write("BEHAVIOR_BY_ROUTE.md", [
        "# The behavior each route is owed",
        "",
        "The jQuery inventory, matched to the routes whose markup each selector",
        "hits. The handlers were never ported, because jQuery declared no",
        "boundaries and portamp does not invent them; this is the work list for",
        "wiring each one into its component, with the file that holds the logic.",
        "",
        ...ctx.jqueryByRoute.flatMap(({ route, widgets }) => [
          `## \`${route}\``,
          "",
          ...widgets.map((w) => `- \`${w.selector}\` listens for ${w.events.join(", ") || "events"} (${w.file})`),
          "",
        ]),
      ].join("\n"));
      log.info(`behavior manifest: ${ctx.jqueryByRoute.length} route(s)`);
    });

    on("emit", async (ctx) => {
      if (!ctx.widgets?.length) return;
      await ctx.write("WIDGETS.md", render(ctx.widgets) + renderLibs(ctx.widgetLibs ?? []));
    });
  },
};

function render(widgets) {
  const rows = [...widgets]
    .sort((a, b) => (b.events.length + b.writes.length) - (a.events.length + a.writes.length) || a.selector.localeCompare(b.selector))
    .map((w) => `| \`${w.selector}\` | ${w.events.join(", ") || "-"} | ${w.writes.join(", ") || "-"} | ${w.file} |`);

  return `# Widget inventory

What the legacy scripts reach for, and what they do with it. This is an
inventory, not a component tree: jQuery never declared one, and portamp does not
guess where the boundaries were.

A selector that is both listened on and written to is usually a component in
everything but name. Start there.

| selector | listens for | writes | file |
| --- | --- | --- | --- |
${rows.join("\n")}

Nothing here is a component until a person says it is.
`;
}

function renderLibs(recognised) {
  if (!recognised.length) return "";
  return `
## Widgets recognised by name

"This is a datepicker" is a fact; what replaces it is a decision. Each row
carries the usual modern answer as a proposal.

| selector | what it was | the usual answer now |
| --- | --- | --- |
${recognised.map((r) => `| \`${r.selector}\` | ${r.was} | ${r.instead} |`).join("\n")}
`;
}
