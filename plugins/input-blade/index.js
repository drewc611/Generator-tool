import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { attrSafe, splitCommas } from "../dsp-ir/text.js";

/**
 * Blade, Laravel's template language: directives that begin with @, PHP
 * expressions in {{ }}, and a view composed from a layout it extends, sections
 * it fills and partials it includes. Every construct that shapes markup has an
 * exact spelling in the dialect and is lowered onto it: @if, @elseif, @else,
 * @unless, @isset, @empty, @auth, @guest, @can and @error as conditionals with
 * the chain negated the way the engine evaluates it; @foreach and @forelse as a
 * loop with the @empty branch as the empty state; @switch and @case as the
 * equalities they test; {{ }} as interpolation and {!! !!} as bound html; a
 * PHP expression as the JS it names ($a->b to a.b, empty() and isset() and
 * count() to their checks, $loop->index to the index); @extends, @section,
 * @yield, @parent and @include composed the way the compiler composes them.
 * The variables a view reads are its inputs: the controller supplied them.
 *
 * @php blocks, @csrf and @method, route() and asset() and __() helpers, a
 * @for or @while, an @include with data and a component slot have no honest
 * client equivalent and are named rather than approximated.
 */

const LOOP_META = [[/\$loop->iteration\b/g, "($index + 1)"], [/\$loop->index\b/g, "$index"], [/\$loop->first\b/g, "($index == 0)"]];

/** A PHP expression as the JS path it names, outside of strings. */
export function phpToJs(code, note = () => {}) {
  const parts = String(code).split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
  // 'Hello '.$name: a dot touching a string literal is PHP's concatenation.
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i + 1] !== undefined) parts[i] = parts[i].replace(/\s*\.\s*$/, " + ");
    if (i > 0) parts[i] = parts[i].replace(/^\s*\.\s*/, " + ");
  }
  return parts.map((part, i) => {
    if (i % 2) return part;
    let out = part;
    if (/\$loop->(last|remaining|depth|parent|count|even|odd)\b/.test(out)) note("`$loop->last`, `count`, `remaining`, `depth`, `even`, `odd` or `parent` was read inside a loop; the dialect has only the index, so it is left as written.");
    for (const [re, to] of LOOP_META) out = out.replace(re, to);
    if (/\b(route|asset|url|secure_url|action|mix|__|trans|trans_choice|old|config|csrf_token|auth\(\)->user)\s*\(/.test(out)) {
      note(`\`${part.trim().slice(0, 50)}\` calls a Laravel helper the server resolved; it is kept as written and the port must supply its value.`);
    }
    return out
      .replace(/!\s*empty\(([^()]+)\)/g, "!!($1)")
      .replace(/\bempty\(([^()]+)\)/g, "!($1)")
      .replace(/\bisset\(([^()]+)\)/g, "($1 != null)")
      .replace(/\bcount\(([^()]+)\)/g, "$1.length")
      .replace(/\bstrtoupper\(([^()]+)\)/g, "$1.toUpperCase()")
      .replace(/\bstrtolower\(([^()]+)\)/g, "$1.toLowerCase()")
      .replace(/\bucfirst\(([^()]+)\)/g, "$1")
      .replace(/\bnumber_format\(([^(),]+)[^()]*\)/g, "$1")
      .replace(/\s+\.\s+/g, " + ")
      .replace(/->/g, ".")
      .replace(/::/g, ".")
      .replace(/\band\b/g, "&&")
      .replace(/\bor\b/g, "||")
      // $index is the dialect's own loop index and keeps its sigil; every other $ is PHP's.
      .replace(/\$(?!index\b)(?=[A-Za-z_])/g, "");
  }).join("");
}

const q = attrSafe;
const viewPath = (name) => String(name).replace(/^['"]|['"]$/g, "").replace(/\./g, "/") + ".blade.php";

/** The balanced (...) argument that follows a directive at `at`; returns [inner, endIndex]. */
function argument(text, at) {
  let i = at;
  // Only spaces: `@else` followed by "(No items)" on the next line is prose.
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  if (text[i] !== "(") return [null, at];
  let depth = 0; let quote = null;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (quote) { if (c === "\\") j += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth += 1;
    else if (c === ")") { depth -= 1; if (depth === 0) return [text.slice(i + 1, j), j + 1]; }
  }
  return [text.slice(i + 1), text.length];
}

/** Compose a view into the layout it extends and inline what it includes; returns the composed Blade. */
export function composeBlade(source, resolve, note = () => {}, depth = 0) {
  let text = String(source ?? "").replace(/\{\{--[\s\S]*?--\}\}/g, "");
  const ext = /@extends\s*\(\s*(['"][^'"]+['"])\s*\)/.exec(text);
  if (ext && resolve && depth < 6) {
    const layout = resolve(viewPath(ext[1]));
    if (layout != null) {
      const sections = new Map();
      text = text.replace(ext[0], "");
      text = text.replace(/@section\s*\(\s*(['"][^'"]+['"])\s*,\s*([\s\S]*?)\)\s*(?=\n|$)/g, (m, name, value) => { sections.set(viewPath(name).replace(/\.blade\.php$/, ""), { inline: value.trim() }); return ""; });
      text = text.replace(/@section\s*\(\s*(['"][^'"]+['"])\s*\)([\s\S]*?)@(?:endsection|stop|show|append|overwrite)\b/g, (m, name, body) => { sections.set(viewPath(name).replace(/\.blade\.php$/, ""), { body }); return ""; });
      if (text.trim()) note("Markup outside any @section in a view that extends a layout is never rendered by Blade; it was dropped.");
      const withShows = String(layout).replace(/@section\s*\(\s*(['"][^'"]+['"])\s*\)([\s\S]*?)@show\b/g, (m, name, fallback) => {
        const key = viewPath(name).replace(/\.blade\.php$/, "");
        const sec = sections.get(key);
        if (!sec) return fallback;
        sections.delete(key);
        return sec.inline ? `{{ ${sec.inline} }}` : sec.body.replace(/@parent\b/g, fallback);
      });
      const composed = withShows.replace(/@yield\s*\(\s*(['"][^'"]+['"])\s*(?:,\s*([\s\S]*?))?\)/g, (m, name, fallback) => {
        const key = viewPath(name).replace(/\.blade\.php$/, "");
        const sec = sections.get(key);
        if (!sec) return fallback ? `{{ ${fallback.trim()} }}` : "";
        if (sec.inline) return `{{ ${sec.inline} }}`;
        return sec.body.replace(/@parent\b/g, fallback ? `{{ ${fallback.trim()} }}` : "");
      });
      return composeBlade(composed, resolve, note, depth + 1);
    }
    note(`@extends(${ext[1]}) names a layout this run does not hold; the view stands without it.`);
    text = text.replace(ext[0], "");
  }
  if (resolve && depth < 6) {
    text = text.replace(/@include(?:If|When|Unless|First)?\s*\(([\s\S]*?)\)(?=\s|$|<)/g, (m, args) => {
      const parts = splitCommas(args);
      const nameArg = parts.find((p) => /^['"]/.test(p)) ?? parts[0];
      const body = resolve(viewPath(nameArg));
      if (body == null) { note(`@include(${nameArg}) names a partial this run does not hold; the tag was removed and the content stands without it.`); return ""; }
      if (parts.length > 1) note(`@include(${nameArg}, ...) passed data the partial reads by name; nothing binds it in the port.`);
      return composeBlade(body, resolve, note, depth + 1);
    });
  }
  return text;
}

/** Lower composed Blade onto the attribute dialect. Returns { template, variables }. */
export function lowerBlade(source, note = () => {}) {
  let text = String(source ?? "")
    .replace(/\{\{--[\s\S]*?--\}\}/g, "")
    .replace(/@php\b[\s\S]*?@endphp\b/g, () => { note("A @php block ran code while rendering; it was not carried and its values are not in the port."); return ""; })
    .replace(/@verbatim\b([\s\S]*?)@endverbatim\b/g, (m, body) => body.replace(/\{/g, "&#123;").replace(/\}/g, "&#125;"))
    .replace(/@\{\{/g, "&#123;&#123;");

  const variables = new Set();
  const locals = new Set();
  const expr = (code) => {
    const js = phpToJs(code, note);
    for (const m of code.matchAll(/\$([A-Za-z_]\w*)/g)) if (m[1] !== "loop") variables.add(m[1]);
    return js;
  };

  const out = [];
  const stack = [];
  const re = /\{!!([\s\S]*?)!!\}|\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}|@([a-zA-Z]+)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] !== undefined) { out.push(`<span ng-bind-html="${q(expr(m[1].trim()))}"></span>`); continue; }
    if (m[2] !== undefined || m[3] !== undefined) { out.push(`{{ ${expr((m[2] ?? m[3]).trim())} }}`); continue; }
    const name = m[4];
    const [arg, end] = argument(text, last);
    const take = () => { last = end; re.lastIndex = end; return arg ?? ""; };
    switch (name) {
      case "if": { const t = expr(take()); out.push(`<ng-container ng-if="${q(t)}">`); stack.push({ kind: "if", tried: [t] }); break; }
      case "unless": { const t = `!(${expr(take())})`; out.push(`<ng-container ng-if="${q(t)}">`); stack.push({ kind: "if", tried: [t] }); break; }
      case "isset": { const t = `(${expr(take())} != null)`; out.push(`<ng-container ng-if="${q(t)}">`); stack.push({ kind: "if", tried: [t] }); break; }
      case "empty": {
        const frame = stack.at(-1);
        if (frame?.kind === "forelse") { out.push(`</ng-container><ng-container ng-if="!${q(frame.list)} || !${q(frame.list)}.length">`); frame.kind = "if"; frame.tried = []; break; }
        const v = expr(take()); const t = `!(${v} && ${v}.length)`; out.push(`<ng-container ng-if="${q(t)}">`); stack.push({ kind: "if", tried: [t] }); break;
      }
      case "auth": { take(); variables.add("auth"); out.push(`<ng-container ng-if="auth">`); stack.push({ kind: "if", tried: ["auth"] }); break; }
      case "guest": { take(); variables.add("auth"); out.push(`<ng-container ng-if="!auth">`); stack.push({ kind: "if", tried: ["!auth"] }); break; }
      case "can": case "cannot": { const a = expr(take()); variables.add("can"); const t = name === "can" ? `can(${a})` : `!can(${a})`; out.push(`<ng-container ng-if="${q(t)}">`); stack.push({ kind: "if", tried: [t] }); break; }
      case "error": { const a = take().replace(/^['"]|['"]$/g, ""); variables.add("errors"); const t = `errors.${a}`; out.push(`<ng-container ng-if="${q(t)}">`); stack.push({ kind: "if", tried: [t] }); break; }
      case "elseif": case "else": {
        const frame = stack.at(-1);
        if (frame?.kind === "if" || frame?.kind === "switch") {
          if (frame.kind === "switch") { if (frame.open) out.push("</ng-container>"); out.push(`<ng-container ng-if="${q(frame.tried.map((c) => `!(${c})`).join(" && ") || "true")}">`); frame.open = true; take(); break; }
          const nots = frame.tried.map((c) => `!(${c})`);
          const own = name === "elseif" ? expr(take()) : (take(), null);
          const t = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
          if (own) frame.tried.push(own);
          out.push(`</ng-container><ng-container ng-if="${q(t)}">`);
        } else take();
        break;
      }
      case "foreach": case "forelse": {
        const a = take();
        const lm = /^([\s\S]+?)\s+as\s+(?:\$(\w+)\s*=>\s*)?\$(\w+)\s*$/.exec(a.trim());
        if (!lm) { note(`@${name}(${a}) has a shape this reader does not know; its body was kept once, unrepeated.`); out.push("<ng-container>"); stack.push({ kind: name === "forelse" ? "forelse" : "for", list: "[]" }); break; }
        const list = expr(lm[1]);
        locals.add(lm[3]); if (lm[2]) locals.add(lm[2]);
        out.push(`<ng-container ng-repeat="${q(lm[2] ? `(${lm[2]}, ${lm[3]}) in ${list}` : `${lm[3]} in ${list}`)}">`);
        stack.push({ kind: name === "forelse" ? "forelse" : "for", list });
        break;
      }
      case "for": case "while": { note(`@${name}(${take().slice(0, 40)}) loops over a counter or a condition; the port repeats over a list it must be given.`); out.push("<ng-container>"); stack.push({ kind: "for", list: "[]" }); break; }
      case "switch": { stack.push({ kind: "switch", subject: expr(take()), tried: [], open: false }); break; }
      case "case": {
        const frame = stack.at(-1); const v = expr(take());
        if (frame?.kind === "switch") { const t = `(${frame.subject}) == ${v}`; if (frame.open) out.push("</ng-container>"); out.push(`<ng-container ng-if="${q(t)}">`); frame.tried.push(t); frame.open = true; }
        break;
      }
      case "default": { const frame = stack.at(-1); take(); if (frame?.kind === "switch") { if (frame.open) out.push("</ng-container>"); out.push(`<ng-container ng-if="${q(frame.tried.map((c) => `!(${c})`).join(" && ") || "true")}">`); frame.open = true; } break; }
      case "break": case "continue": take(); break;
      case "endswitch": { const frame = stack.pop(); if (frame?.open) out.push("</ng-container>"); break; }
      case "endif": case "endunless": case "endisset": case "endempty": case "endauth": case "endguest": case "endcan": case "endcannot": case "enderror": case "endforeach": case "endforelse": case "endfor": case "endwhile": {
        if (stack.length) { stack.pop(); out.push("</ng-container>"); }
        break;
      }
      case "csrf": case "method": { take(); note(`@${name} is the form machinery of the server; the port's form must be given a home in the endpoint map.`); break; }
      case "json": { out.push(`{{ ${expr(take())} }}`); note("@json printed a value as JSON for a script to read; it is interpolated as text and the script that read it is not in the port."); break; }
      case "lang": case "choice": { const a = take(); note(`@${name}(${a.slice(0, 40)}) is a translation the server resolved; the key is interpolated and the port must supply the string.`); out.push(`{{ ${expr(a)} }}`); break; }
      case "extends": case "section": case "endsection": case "stop": case "show": case "yield": case "parent": case "include": case "includeIf": case "includeWhen": case "includeUnless": case "includeFirst": case "each": case "push": case "endpush": case "stack": case "once": case "endonce": case "props": case "aware": {
        const a = take();
        if (name === "yield" || name === "include" || name.startsWith("include") || name === "each" || name === "stack") note(`@${name}(${a.slice(0, 40)}) was not composed: its target is not in this run or the compose step did not reach it. The tag was removed.`);
        break;
      }
      // Blade compiles only the directives it knows and prints the rest as text,
      // so help@example.com and @media stay exactly what they were.
      default: out.push(`@${name}`);
    }
  }
  out.push(text.slice(last));
  while (stack.length) { const f = stack.pop(); out.push(f.kind === "switch" ? (f.open ? "</ng-container>" : "") : "</ng-container>"); }
  for (const l of locals) variables.delete(l);
  return { template: out.join(""), variables: [...variables].sort() };
}

export default {
  name: "input-blade",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.blade\.php$/i.test(f.rel));
      if (!files.length) return log.debug("no Blade views");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      const resolve = (path) => {
        const key = [...bodies.keys()].find((k) => k === path || k.endsWith(`/${path}`));
        return key ? bodies.get(key) : null;
      };
      const extended = new Set();
      for (const text of bodies.values()) for (const m of text.matchAll(/@extends\s*\(\s*(['"][^'"]+['"])\s*\)/g)) extended.add(viewPath(m[1]));

      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const raw = bodies.get(rel) ?? "";
        if (!raw.trim()) continue;
        if ([...extended].some((p) => rel === p || rel.endsWith(`/${p}`))) { note(`${rel} is a layout other views extend; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const composed = composeBlade(raw, resolve, note);
        let { template, variables } = lowerBlade(composed, note);
        const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(template);
        if (body) template = body[1];
        template = template.trim();
        if (!template) continue;
        const selector = rel.replace(/^(resources\/)?views\//, "").replace(/\.blade\.php$/i, "").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          inputs: variables,
          outputs: [],
          template,
          templateOrigin: "a Blade view, composed and lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "blade",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Blade view(s) composed and lowered onto the dialect`);
    });
  },
};
