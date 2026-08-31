import { readFile } from "node:fs/promises";

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

const HANDLERS = [
  // $("#a").on("click", ...)  and  $("#a").on("click", ".row", ...)
  /\$\(\s*(['"`])([^'"`]+)\1\s*\)\s*(?:\.[\w$]+\([^)]*\)\s*)*?\.on\s*\(\s*(['"`])([^'"`]+)\3/g,
  // $("#a").click(...) and the rest of the shorthand family
  /\$\(\s*(['"`])([^'"`]+)\1\s*\)\s*\.(click|change|submit|blur|focus|keyup|keydown|input|hover)\s*\(/g,
];

// A write says which part of the page this code owns, which is the closest
// thing a jQuery app has to a component boundary.
const WRITES = /\$\(\s*(['"`])([^'"`]+)\1\s*\)\s*(?:\.[\w$]+\([^)]*\)\s*)*?\.(html|text|val|append|prepend|attr|addClass|removeClass|toggleClass|show|hide|empty|remove)\s*\(/g;

const DOM_WRITES = /document\.(?:getElementById|querySelector)\(\s*(['"`])([^'"`]+)\1\s*\)\s*\.\s*(innerHTML|textContent|value)\s*=/g;

const looksLikeUrl = (s) => /^[./]|^https?:/.test(s) && !/^\s*$/.test(s);

export function readScript(text, rel) {
  const calls = [];
  const widgets = new Map();

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

  for (const m of text.matchAll(HANDLERS[0])) {
    if (looksLikeUrl(m[2])) continue;
    for (const event of m[4].split(/\s+/).filter(Boolean)) {
      const w = widget(m[2]);
      if (!w.events.includes(event)) w.events.push(event);
    }
  }
  for (const m of text.matchAll(HANDLERS[1])) {
    const w = widget(m[2]);
    if (!w.events.includes(m[3])) w.events.push(m[3]);
  }

  for (const m of text.matchAll(WRITES)) {
    if (looksLikeUrl(m[2])) continue;
    const w = widget(m[2]);
    if (!w.writes.includes(m[3])) w.writes.push(m[3]);
  }
  for (const m of text.matchAll(DOM_WRITES)) {
    const w = widget(m[2]);
    const kind = { innerHTML: "html", textContent: "text", value: "val" }[m[3]];
    if (!w.writes.includes(kind)) w.writes.push(kind);
  }

  return { calls, widgets: [...widgets.values()] };
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
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !/\$\(|jQuery|document\.(getElementById|querySelector)/.test(text)) continue;
        const found = readScript(text, file.rel);
        widgets.push(...found.widgets);
        calls.push(...found.calls);
      }
      if (!widgets.length && !calls.length) return log.debug("nothing that reaches the DOM");

      ctx.widgets = [...(ctx.widgets ?? []), ...widgets];
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

    on("emit", async (ctx) => {
      if (!ctx.widgets?.length) return;
      await ctx.write("WIDGETS.md", render(ctx.widgets));
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
