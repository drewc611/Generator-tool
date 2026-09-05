import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";

/**
 * Liquid, the template language of Shopify themes and Jekyll sites, is the
 * jinja shape with its own words: {% if %}/{% elsif %}/{% else %}, {% unless %},
 * {% case %}/{% when %}, {% for x in xs limit: 3 %} with an {% else %} for the
 * empty list, {{ x | upcase }} with filters, and a theme composed of a layout
 * that wraps every template, sections with a schema naming their settings,
 * and snippets rendered by name. Each of those has an exact spelling in the
 * dialect, so the reader lowers onto it: the control tags become ng-container
 * blocks with an elsif chain negated the way the runtime evaluates it, a case
 * becomes the equalities it tests, the empty branch of a for becomes the
 * empty state, a template is wrapped in the layout the way the server did and
 * a section or snippet the run holds is inlined at its tag, and a section's
 * schema settings are its inputs.
 *
 * Server side machinery, assign, capture, cycle, increment, paginate, a
 * render with arguments, a loop with limit or offset, has no client
 * equivalent and is named through the notes rather than approximated. A
 * filter with an exact JS or dialect spelling is rewritten; any other stays
 * as written so the translator names it too.
 */

const GLOBALS = ["product", "collection", "collections", "cart", "shop", "customer", "page", "article", "blog", "search", "request", "routes", "settings", "linklists", "all_products", "localization", "block", "blocks", "section"];
const attrSafe = (code) => String(code).replace(/"/g, "'");

/** Liquid's operators and object shorthands into JS, outside of strings. */
export function liquidToJs(code) {
  const parts = String(code).split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
  return parts.map((part, i) => {
    if (i % 2) return part;
    return part
      .replace(/([\w.[\]]+)\s*==\s*blank\b/g, "!($1)")
      .replace(/([\w.[\]]+)\s*!=\s*blank\b/g, "!!($1)")
      .replace(/([\w.[\]]+)\s*==\s*empty\b/g, "!($1 && $1.length)")
      .replace(/([\w.[\]]+)\s*!=\s*empty\b/g, "!!($1 && $1.length)")
      .replace(/\b([\w.[\]]+)\s+contains\s+([\w.[\]]+)/g, "$1.includes($2)")
      .replace(/\band\b/g, "&&")
      .replace(/\bor\b/g, "||")
      .replace(/\bnil\b/g, "null")
      .replace(/\.size\b/g, ".length")
      .replace(/\.first\b/g, "[0]")
      .replace(/\.last\b/g, ".at(-1)");
  }).join("");
}

/** {{ expr | filter: arg }} into a dialect interpolation; exact filters rewritten, the rest kept for the translator to name. */
export function lowerOutput(inner) {
  const [head, ...filters] = splitPipes(inner);
  let expr = liquidToJs(head.trim());
  const kept = [];
  for (const f of filters) {
    const m = /^\s*([\w-]+)\s*(?::\s*([\s\S]+))?$/.exec(f);
    if (!m) { kept.push(f.trim()); continue; }
    const [, name, rawArgs] = m;
    const args = rawArgs ? splitArgs(rawArgs).map((a) => liquidToJs(a.trim())) : [];
    switch (name) {
      case "upcase": kept.push("uppercase"); break;
      case "downcase": kept.push("lowercase"); break;
      case "size": expr = `${expr}.length`; break;
      case "escape": case "escape_once": break;
      case "strip": case "lstrip": case "rstrip": expr = `${expr}.trim()`; break;
      case "default": expr = `(${expr} || ${args[0] ?? '""'})`; break;
      case "append": expr = `(${expr} + ${args[0] ?? '""'})`; break;
      case "prepend": expr = `(${args[0] ?? '""'} + ${expr})`; break;
      case "plus": expr = `(${expr} + ${args[0] ?? 0})`; break;
      case "minus": expr = `(${expr} - ${args[0] ?? 0})`; break;
      case "times": expr = `(${expr} * ${args[0] ?? 1})`; break;
      case "divided_by": expr = `(${expr} / ${args[0] ?? 1})`; break;
      case "join": expr = `${expr}.join(${args[0] ?? '" "'})`; break;
      case "first": expr = `${expr}[0]`; break;
      case "last": expr = `${expr}.at(-1)`; break;
      case "truncate": kept.push(`limitTo:${args[0] ?? 50}`); break;
      default: kept.push(args.length ? `${name}:${args.join(":")}` : name);
    }
  }
  return `{{ ${[expr, ...kept].join(" | ")} }}`;
}

// Filter arguments split on the commas outside of strings, so `join: ', '` keeps its comma.
function splitArgs(text) {
  const out = []; let quote = null; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === ",") { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

function splitPipes(text) {
  const out = []; let depth = 0; let quote = null; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === "|" && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

/** The schema block of a section: its settings' ids, and the source without it. */
export function splitSchema(source) {
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(source);
  if (!m) return { source, settings: [] };
  let settings = [];
  try {
    const json = JSON.parse(m[1]);
    settings = (json.settings ?? []).map((s) => s.id).filter(Boolean);
  } catch { settings = [...m[1].matchAll(/"id"\s*:\s*"([\w-]+)"/g)].map((x) => x[1]); }
  return { source: source.slice(0, m.index) + source.slice(m.index + m[0].length), settings };
}

/** Lower a Liquid template onto the attribute dialect. resolve(kind, name) returns a held section or snippet, or null. */
export function lowerLiquid(source, note = () => {}, resolve = null, depth = 0) {
  let text = String(source ?? "")
    .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, "")
    .replace(/\{%-?\s*(?:style|stylesheet)\s*-?%\}[\s\S]*?\{%-?\s*end(?:style|stylesheet)\s*-?%\}/g, "")
    .replace(/\{%-?\s*schema\s*-?%\}[\s\S]*?\{%-?\s*endschema\s*-?%\}/g, "")
    .replace(/\{%-?\s*javascript\s*-?%\}[\s\S]*?\{%-?\s*endjavascript\s*-?%\}/g, () => { note("A {% javascript %} block ran in the theme; it was not carried, and what it did is not in the port."); return ""; })
    .replace(/\{%-?\s*raw\s*-?%\}([\s\S]*?)\{%-?\s*endraw\s*-?%\}/g, (m, body) => body.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;"));

  // A section or snippet the run holds is inlined where its tag stood, which
  // is what the server did. Arguments to a render are named, not bound.
  if (resolve && depth < 6) {
    text = text.replace(/\{%-?\s*(section|render|include)\s+['"]([^'"]+)['"]([^%]*?)-?%\}/g, (m, tag, name, rest) => {
      const body = resolve(tag === "section" ? "sections" : "snippets", name);
      if (body == null) { note(`{% ${tag} '${name}' %} names a ${tag === "section" ? "section" : "snippet"} this run does not hold; the tag was removed and the content stands without it.`); return ""; }
      if (rest.trim()) note(`{% ${tag} '${name}' ${rest.trim()} %} passed arguments the inlined markup reads by their names; nothing binds them in the port.`);
      return lowerLiquid(body, note, resolve, depth + 1);
    });
  }

  const out = [];
  const stack = [];
  let last = 0;
  const re = /\{%-?\s*([\s\S]*?)\s*-?%\}|\{\{-?\s*([\s\S]*?)\s*-?\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== undefined) {
      const inner = m[2].trim();
      if (inner === "content_for_layout") { out.push("{{ content_for_layout }}"); continue; }
      if (inner === "content_for_header" || inner === "content_for_additional_checkout_buttons") { note(`{{ ${inner} }} is what the platform injects into the page; nothing stands in for it in the port.`); continue; }
      out.push(lowerOutput(inner));
      continue;
    }
    const code = m[1].trim();
    const word = code.split(/\s+/)[0];
    const rest = code.slice(word.length).trim();

    if (word === "if" || word === "unless") {
      const test = word === "if" ? liquidToJs(rest) : `!(${liquidToJs(rest)})`;
      out.push(`<ng-container ng-if="${attrSafe(test)}">`);
      stack.push({ kind: "if", tried: [test] });
      continue;
    }
    if (word === "elsif" || word === "else") {
      const frame = stack.at(-1);
      if (frame?.kind === "if") {
        const nots = frame.tried.map((c) => `!(${c})`);
        const own = word === "elsif" ? liquidToJs(rest) : null;
        const test = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
        if (own) frame.tried.push(own);
        out.push(`</ng-container><ng-container ng-if="${attrSafe(test)}">`);
      } else if (frame?.kind === "for" && word === "else") {
        out.push(`</ng-container><ng-container ng-if="!${attrSafe(frame.list)} || !${attrSafe(frame.list)}.length">`);
        frame.kind = "if"; frame.tried = [];
      } else if (frame?.kind === "case" && word === "else") {
        if (frame.open) out.push("</ng-container>");
        out.push(`<ng-container ng-if="${attrSafe(frame.tried.map((c) => `!(${c})`).join(" && ") || "true")}">`);
        frame.open = true;
      }
      continue;
    }
    if (word === "case") {
      stack.push({ kind: "case", subject: liquidToJs(rest), tried: [], open: false });
      continue;
    }
    if (word === "when") {
      const frame = stack.at(-1);
      if (frame?.kind === "case") {
        const values = rest.split(/\s*,\s*|\s+or\s+/).map((v) => liquidToJs(v.trim())).filter(Boolean);
        const test = values.map((v) => `(${frame.subject}) == ${v}`).join(" || ");
        if (frame.open) out.push("</ng-container>");
        out.push(`<ng-container ng-if="${attrSafe(test)}">`);
        frame.tried.push(test); frame.open = true;
      }
      continue;
    }
    if (word === "for" || word === "tablerow") {
      const loop = /^([\w$]+)\s+in\s+([\s\S]+?)(?:\s+(limit|offset|reversed)\b[\s\S]*)?$/.exec(rest);
      if (loop && !/^\(/.test(loop[2])) {
        if (loop[3]) note(`{% ${code} %} used ${loop[3]}; the port repeats over the whole list and the ${loop[3]} is not applied.`);
        if (word === "tablerow") note("{% tablerow %} laid its items out in table rows and columns; the port repeats them in order without the row breaks.");
        const list = liquidToJs(loop[2]);
        out.push(`<ng-container ng-repeat="${loop[1]} in ${attrSafe(list)}">`);
        stack.push({ kind: "for", list });
      } else {
        note(`{% ${code} %} loops over a range or a shape this reader does not know; its body was kept once, unrepeated.`);
        out.push("<ng-container>");
        stack.push({ kind: "for", list: "[]" });
      }
      continue;
    }
    if (/^end(if|unless|for|tablerow|case)$/.test(word)) {
      const frame = stack.pop();
      if (frame?.kind === "case") { if (frame.open) out.push("</ng-container>"); continue; }
      if (frame) out.push("</ng-container>");
      continue;
    }
    if (word === "form") {
      out.push(`<form data-liquid-form="${attrSafe(rest.split(",")[0].replace(/['"]/g, "").trim())}">`);
      note(`{% form ${rest} %} posted to the platform's own endpoint; the port keeps the form and the action must be given a home in the endpoint map.`);
      stack.push({ kind: "form" });
      continue;
    }
    if (word === "endform") { stack.pop(); out.push("</form>"); continue; }
    if (word === "paginate") { note(`{% paginate ${rest} %} paged on the server; the port shows the list it is given.`); out.push("<ng-container>"); stack.push({ kind: "paginate" }); continue; }
    if (word === "endpaginate") { stack.pop(); out.push("</ng-container>"); continue; }
    if (word === "echo") { out.push(lowerOutput(rest)); continue; }
    if (word === "layout" || word === "break" || word === "continue") { if (word !== "layout") note(`{% ${word} %} inside a loop has no equivalent in a repeat; the loop runs whole.`); continue; }
    if (/^(assign|capture|endcapture|increment|decrement|cycle|liquid|sections|section|render|include)$/.test(word)) {
      note(`{% ${code.slice(0, 60)} %} is server side machinery with no client equivalent. It was removed and is named here so the gap is visible.`);
      continue;
    }
    note(`A template construct could not be carried across and was removed: {% ${code.slice(0, 60)} %}.`);
  }
  out.push(text.slice(last));
  while (stack.length) { const f = stack.pop(); out.push(f.kind === "form" ? "</form>" : f.kind === "case" ? (f.open ? "</ng-container>" : "") : "</ng-container>"); }

  const result = out.join("");
  if (/\{\{[^}]*\bforloop\./.test(result)) note("`forloop.` metadata inside a for has no counterpart in the dialect. Rewire it from the loop index in the port.");
  return result;
}

/** The inputs a lowered template reads: the platform objects it names and the section settings. */
export function readInputs(template, settings) {
  const inputs = new Set(settings);
  // Only the expressions count: `type="search"` is markup, `{{ search.terms }}` is a read.
  const expressions = [
    ...[...template.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]),
    ...[...template.matchAll(/\sng-[\w-]+="([^"]*)"/g)].map((m) => m[1]),
  ].join("\n");
  for (const g of GLOBALS) if (g !== "section" && new RegExp(`\\b${g}\\b`).test(expressions)) inputs.add(g);
  return [...inputs].sort();
}

export default {
  name: "input-liquid",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.liquid$/i.test(f.rel));
      if (!files.length) return log.debug("no Liquid templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      const find = (dir, name) => {
        const want = `${dir}/${name}.liquid`;
        const key = [...bodies.keys()].find((k) => k === want || k.endsWith(`/${want}`));
        return key ? bodies.get(key) : null;
      };
      let pulled = new Set();
      const resolve = (kind, name) => {
        const body = find(kind, name);
        if (body == null) return null;
        const split = splitSchema(body);
        // A section inlined here reads its settings here, so they are this screen's inputs too.
        for (const id of split.settings) pulled.add(id);
        return split.source;
      };
      const layoutKey = [...bodies.keys()].find((k) => /(^|\/)layout\/theme\.liquid$/.test(k));
      const layout = layoutKey ? bodies.get(layoutKey) : null;

      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        if (rel === layoutKey) { note("layout/theme.liquid is the chrome every template is wrapped in; it is composed into each template rather than ported as a screen of its own."); continue; }
        const raw = bodies.get(rel) ?? "";
        if (!raw.trim()) continue;
        pulled = new Set();
        const { source, settings } = splitSchema(raw);
        const isTemplate = /(^|\/)templates\//.test(rel);
        const composed = isTemplate && layout && /\{\{-?\s*content_for_layout\s*-?\}\}/.test(layout)
          ? layout.replace(/\{\{-?\s*content_for_layout\s*-?\}\}/, () => source)
          : source;
        let lowered = lowerLiquid(composed, note, resolve);
        const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(lowered);
        if (body) lowered = body[1];
        lowered = lowered.replace(/\bsection\.settings\.(\w+)/g, "$1").trim();
        if (!lowered) continue;

        const selector = rel.replace(/\.liquid$/i, "").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          inputs: readInputs(lowered, [...settings, ...pulled]),
          outputs: [],
          template: lowered,
          templateOrigin: isTemplate && layout ? "a Liquid template, lowered inside its layout" : "a Liquid template, lowered",
          usesNgIf: /ng-if/.test(lowered),
          usesNgFor: /ng-repeat/.test(lowered),
          usesTwoWay: false,
          rxjs: [],
          readBy: "liquid",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Liquid template(s) lowered onto the dialect`);
    });
  },
};
