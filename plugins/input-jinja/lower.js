import { insideAttribute } from "../dsp-ir/markup.js";
import { attrSafe } from "../dsp-ir/text.js";

/**
 * Jinja and Django template syntax, lowered onto the attribute dialect.
 *
 * The two languages share the constructs that matter here: {% if/elif/else %},
 * {% for x in xs %}, {{ interpolation }} with pipes, and {# comments #}.
 * Python's spelling of boolean logic is rewritten to JS at the word level;
 * inheritance tags ({% extends %}, {% block %}) shape files, not screens, so
 * the block contents are kept and the machinery is named.
 */


/**
 * True when a template uses a spelling only Django's engine has: its own tags,
 * its loop variable, or a filter argument after a colon. input-django reads
 * those files and input-jinja leaves them to it.
 */
export function isDjango(text) {
  const t = String(text ?? "");
  // Liquid in an .html page shares comment, cycle and the colon argument; its own tags say which engine this is.
  if (/\{%-?\s*(?:assign|capture|unless|tablerow|liquid|render)\b|\{\{-?\s*site\./.test(t)) return false;
  // jinja's i18n extension spells {% trans %} with no argument and {% autoescape true %}; Django's trans takes a string or a name and its autoescape on or off.
  return /\{%-?\s*(?:load|url|static|csrf_token|blocktrans|blocktranslate|empty|ifequal|ifnotequal|comment|spaceless|now|cycle|firstof|widthratio|lorem|regroup|localize|get_static_prefix)\b/.test(t)
    || /\{%-?\s*(?:trans|translate)\s+(?:["']|[\w.]+\s*(?:-?%\}|as\b|noop\b|context\b))/.test(t)
    || /\{%-?\s*autoescape\s+(?:on|off)\b/.test(t)
    || /\bforloop\./.test(t) || /\{\{[^}]*\|\s*\w+:(?=\S)/.test(t);
}

/** Python operators into JS, outside of strings. */
export function pythonToJs(code) {
  const parts = String(code).split(/('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/);
  return parts
    .map((part, i) => {
      if (i % 2) return part;
      return part
        .replace(/\bnot\s+in\b/g, "NOT_IN")
        .replace(/\band\b/g, "&&")
        .replace(/\bor\b/g, "||")
        .replace(/\bnot\b/g, "!")
        .replace(/\bNone\b/g, "null")
        .replace(/\bTrue\b/g, "true")
        .replace(/\bFalse\b/g, "false")
        .replace(/\bNOT_IN\b/g, "not in");
    })
    .join("");
}

/**
 * The top level `{% set name = expr %}` bindings of a template: removed from the text and substituted into every
 * read that follows, in interpolations and in the expression part of if, elif and for tags, never in a binding head.
 * A set that is not at the top level, is repeated, or names something a for, a macro or a block rebinds is left in
 * place and named, because which value a read sees there is a branch or a scope the port cannot follow.
 */
function bindSets(source, note) {
  let text = source;
  const depthAt = (at) => {
    let d = 0;
    for (const m of text.slice(0, at).matchAll(/\{%-?\s*(end)?(if|for|block|macro|call|set)\b([^%]*)%\}/g)) {
      if (m[2] === "set" && !/=/.test(m[3]) && !m[1]) d += 1;
      else if (m[2] === "set") { if (m[1]) d -= 1; }
      else d += m[1] ? -1 : 1;
    }
    return d;
  };
  const rebound = new Set([
    ...[...text.matchAll(/\{%-?\s*for\s+([\w$]+)(?:\s*,\s*([\w$]+))?\s+in\b/g)].flatMap((m) => [m[1], m[2]].filter(Boolean)),
    ...[...text.matchAll(/\{%-?\s*macro\s+([\w$]+)\s*\(([^)]*)\)/g)].flatMap((m) => [m[1], ...m[2].split(",").map((a) => a.split("=")[0].trim())].filter(Boolean)),
    ...[...text.matchAll(/\{%-?\s*block\s+([\w$]+)/g)].map((m) => m[1]),
  ]);
  const seen = new Map();
  for (const m of text.matchAll(/\{%-?\s*set\s+([\w$]+)\s*=\s*([\s\S]+?)\s*-?%\}/g)) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  const bound = new Map();
  text = text.replace(/\{%-?\s*set\s+([\w$]+)\s*=\s*([\s\S]+?)\s*-?%\}/g, (m, name, expr, at) => {
    if (depthAt(at) > 0) { note(`\`{% set ${name} %}\` binds a name inside a block or a loop, a scope the port cannot follow; the tag was removed and the name is left as written.`); return ""; }
    if (seen.get(name) > 1) { note(`\`{% set ${name} %}\` is set more than once, so which value a read sees is a branch the port cannot follow; the tags were removed and the name is left as written.`); return ""; }
    if (rebound.has(name)) { note(`\`{% set ${name} %}\` names what a loop, a macro or a block binds again; the tag was removed and the name is left as written.`); return ""; }
    // A set may read a name an earlier set bound; the value carries what that name named.
    let e = expr.trim();
    for (const [n, v] of bound) e = e.replace(new RegExp(`(?<![\\w.$])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`, "g"), () => v);
    bound.set(name, /^[\w$.]+$|^"(?:\\.|[^"\\])*"$|^'(?:\\.|[^'\\])*'$/.test(e) ? e : `(${e})`);
    note(`\`{% set ${name} %}\` bound a name for the template; each read of it is what it named.`);
    return "";
  });
  const apply = (t) => {
    if (!bound.size) return t;
    const names = [...bound.keys()].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const re = new RegExp(`(?<![\\w.$])(${names})(?![\\w$])`, "g");
    const swap = (expr) => expr.replace(re, (mm, n) => bound.get(n));
    return t
      .replace(/\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g, (mm, a, expr, b) => `{{${a} ${swap(expr)} ${b}}}`)
      .replace(/\{%(-?)\s*(if|elif)\s+([\s\S]*?)\s*(-?)%\}/g, (mm, a, tag, expr, b) => `{%${a} ${tag} ${swap(expr)} ${b}%}`)
      .replace(/\{%(-?)\s*for\s+([\s\S]+?)\s+in\s+([\s\S]*?)\s*(-?)%\}/g, (mm, a, head, list, b) => `{%${a} for ${head} in ${swap(list)} ${b}%}`);
  };
  return { text: apply(text), apply };
}

const BLOCK_RE = /\{%-?\s*block\s+([\w$]+)\s*-?%\}([\s\S]*?)\{%-?\s*endblock(?:\s+[\w$]+)?\s*-?%\}/g;

/** Comma split that leaves quoted commas alone; for macro call arguments. */
function splitArgs(text) {
  const parts = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === quote && text[i - 1] !== "\\") quote = null; }
    else if (c === "'" || c === '"') quote = c;
    else if (c === ",") { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}


/** The text of a branch as a JS string expression: literal pieces quoted, {{ }} pieces spliced in, a filter dropped and named. */
function branchToJs(body, note) {
  const pieces = [];
  let last = 0;
  for (const mm of body.matchAll(/\{\{-?\s*([\s\S]*?)\s*-?\}\}/g)) {
    if (mm.index > last) pieces.push(`'${body.slice(last, mm.index).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
    // A JS ternary cannot carry a template filter; the value goes in unformatted and the filter is named.
    const [head, ...filters] = mm[1].split(/(?<!\|)\|(?!\|)/);
    for (const f of filters) note(`The filter \`${f.trim().split(/[:(]/)[0]}\` inside a condition inside an attribute was dropped; the value is unformatted there.`);
    pieces.push(`(${pythonToJs(head.trim())})`);
    last = mm.index + mm[0].length;
  }
  if (last < body.length) pieces.push(`'${body.slice(last).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
  return pieces.length ? pieces.join(" + ") : "''";
}

/** A flat if/elif/else chain inside an attribute, read to its endif and folded into one interpolation. */
function attributeTernary(text, re, open, note) {
  const branches = [];
  let test = pythonToJs(open[1].replace(/^if\s+/, ""));
  let cursor = re.lastIndex;
  const scan = new RegExp(re.source, "g");
  scan.lastIndex = cursor;
  let elseBody = null;
  for (;;) {
    const mm = scan.exec(text);
    if (!mm) return null;
    const code = mm[1].trim();
    const body = text.slice(cursor, mm.index);
    if (/^(if|for)\s/.test(code) || /\{%/.test(body)) return null;
    if (test !== null) branches.push({ test, body }); else elseBody = body;
    if (/^elif\s/.test(code)) { test = pythonToJs(code.replace(/^elif\s+/, "")); }
    else if (code === "else") { test = null; }
    else if (code === "endif") { re.lastIndex = scan.lastIndex; break; }
    else return null;
    cursor = scan.lastIndex;
  }
  let js = elseBody === null ? "''" : branchToJs(elseBody, note);
  for (const b of [...branches].reverse()) js = `${b.test} ? ${branchToJs(b.body, note)} : ${js}`;
  note("A condition inside an attribute value was folded into the ternary it means; an element cannot stand inside an attribute.");
  return { text: `{{ ${attrSafe(js)} }}` };
}

export function lowerJinja(source, note = () => {}, resolveInclude = null, depth = 0) {
  // {% raw %} and {% verbatim %} hold text the engine never read, comments included: its braces are spelled as the
  // strings they are, in single quotes so an attribute stays whole, and the dialect prints them rather than reading them.
  let text = String(source ?? "").replace(/\{%-?\s*(raw|verbatim)\s*-?%\}([\s\S]*?)\{%-?\s*end\1\s*-?%\}/g, (m, tag, body) => body.replace(/\{\{|\}\}|\{%|%\}|\{#|#\}/g, (b) => `{{ '${b[0]}' + '${b[1]}' }}`));
  text = text.replace(/\{#[\s\S]*?#\}/g, "");
  // Nunjucks spells an asynchronous loop asyncEach and asyncAll, and an else if branch elseif; the port renders them as what they are.
  text = text.replace(/\{%(-?)\s*async(?:Each|All)\s+/g, "{%$1 for ").replace(/\{%(-?)\s*end(?:each|all)\s*(-?)%\}/g, "{%$1 endfor $2%}").replace(/\{%(-?)\s*elseif\s+/g, "{%$1 elif ");
  // {% set name = expr %} at the top level, set once and shadowing no loop variable, macro parameter or block name, binds
  // the name for the whole template, the parent it extends included: each read of it is what it named. A set inside a
  // block or a loop, one set twice, or one whose name a construct rebinds is a scope or a branch the port cannot follow,
  // so it is left where it stands and named below rather than substituted.
  const sets = bindSets(text, note);
  text = sets.text;

  // {% extends %} composes exactly like the server did: the child's blocks
  // replace the parent's, a block the child leaves alone keeps its default,
  // and {{ super() }} splices the default back in. Only a parent the run
  // does not hold falls through to the note below.
  const extend = /\{%-?\s*extends\s+['"]([^'"]+)['"]\s*-?%\}/.exec(text);
  if (extend && resolveInclude && depth < 6) {
    const parent = resolveInclude(extend[1]);
    if (parent != null) {
      const overrides = new Map();
      for (const b of text.matchAll(BLOCK_RE)) overrides.set(b[1], b[2]);
      const merged = String(parent).replace(BLOCK_RE, (whole, name, fallback) => {
        const own = overrides.get(name);
        if (own === undefined) return fallback;
        return own.replace(/\{\{-?\s*super\(\)\s*-?\}\}/g, fallback);
      });
      // A child's top level set is visible to the parent it extends, the menu highlighting idiom of both engines.
      return lowerJinja(sets.apply(merged), note, resolveInclude, depth + 1);
    }
  }

  // A macro defined in this file expands at its call sites, arguments
  // substituted textually; the note says so because a parameter name that
  // also appears as plain text inside the body would be replaced with it.
  const macros = new Map();
  text = text.replace(/\{%-?\s*macro\s+([\w$]+)\s*\(([^)]*)\)\s*-?%\}([\s\S]*?)\{%-?\s*endmacro\s*-?%\}/g, (whole, name, params, body) => {
    macros.set(name, {
      params: params.split(",").map((p) => p.split("=")[0].trim()).filter(Boolean),
      defaults: new Map(params.split(",").map((p) => p.split("=").map((s) => s.trim())).filter((p) => p.length === 2)),
      body,
    });
    return "";
  });
  if (macros.size) {
    text = text.replace(/\{\{-?\s*([\w$]+)\s*\(([^)]*)\)\s*-?\}\}/g, (whole, name, args) => {
      const mac = macros.get(name);
      if (!mac) return whole;
      const values = splitArgs(args);
      let body = mac.body;
      mac.params.forEach((p, i) => {
        const value = values[i] ?? mac.defaults.get(p);
        if (value === undefined) {
          note(`The macro \`${name}\` was called without \`${p}\` and it has no default. The name is left as written and nothing defines it.`);
          return;
        }
        // The name is escaped whole and the value goes in through a function,
        // so neither a metacharacter in a parameter nor a $& in an argument
        // can change what the substitution means.
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        body = body.replace(new RegExp(`\\b${escaped}\\b`, "g"), () => value);
      });
      note(`The macro \`${name}(...)\` was expanded at its call site with its arguments substituted textually. Check any body text that shares a parameter's name.`);
      return body;
    });
  }

  // An include whose file is in the run can simply be inlined, which is what
  // the server did. Only a file the run does not hold becomes a note. The
  // depth guard stops a template that includes itself.
  if (resolveInclude && depth < 6) {
    text = text.replace(/\{%-?\s*include\s+['"]([^'"]+)['"]\s*-?%\}/g, (m, name) => {
      const body = resolveInclude(name);
      if (body == null) return m;
      return lowerJinja(body, note, resolveInclude, depth + 1);
    });
  }

  const out = [];
  const stack = [];

  let last = 0;
  const re = /\{%-?\s*([\s\S]*?)\s*-?%\}/g;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    last = re.lastIndex;
    const code = m[1].trim();

    const iff = /^if\s+([\s\S]+)$/.exec(code);
    if (iff && insideAttribute(text, m.index, /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g)) {
      // class="{% if a %}on{% else %}off{% endif %}" cannot hold an element; it
      // is the ternary it means. Only a flat chain is taken; a nested one falls through.
      const ternary = attributeTernary(text, re, m, note);
      if (ternary) { out.push(ternary.text); last = re.lastIndex; continue; }
    }
    if (iff) {
      const test = pythonToJs(iff[1]);
      out.push(`<ng-container ng-if="${attrSafe(test)}">`);
      stack.push({ kind: "if", tried: [test] });
      continue;
    }
    const elif = /^elif\s+([\s\S]+)$/.exec(code);
    if (elif || code === "else") {
      const frame = stack[stack.length - 1];
      if (frame?.kind === "if") {
        const nots = frame.tried.map((c) => `!(${c})`);
        const own = elif ? pythonToJs(elif[1]) : null;
        const test = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
        if (own) frame.tried.push(own);
        out.push(`</ng-container><ng-container ng-if="${attrSafe(test)}">`);
      } else if (frame?.kind === "for" && code === "else") {
        // A for's else runs when the list was empty: the empty state.
        out.push(`</ng-container><ng-container ng-if="!${attrSafe(frame.list)} || !${attrSafe(frame.list)}.length">`);
        frame.kind = "if";
        frame.tried = [];
      }
      continue;
    }
    const forLoop = /^for\s+([\w$]+)(?:\s*,\s*([\w$]+))?\s+in\s+([\s\S]+)$/.exec(code);
    if (forLoop) {
      // for key, value in map.items() is the (key, value) loop over an object; any other pair carries its first name.
      const items = forLoop[2] ? /^([\s\S]+?)\.items(?:\(\))?$/.exec(forLoop[3].trim()) : null;
      if (forLoop[2] && !items) note(`\`{% ${code} %}\` unpacked a tuple. Only the first name is carried; rewire the rest in the port.`);
      const list = pythonToJs(items ? items[1] : forLoop[3]);
      out.push(`<ng-container ng-repeat="${attrSafe(items ? `(${forLoop[1]}, ${forLoop[2]}) in ${list}` : `${forLoop[1]} in ${list}`)}">`);
      stack.push({ kind: "for", list, opener: out.length - 1, pair: Boolean(items) });
      continue;
    }
    if (/^end(if|for)$/.test(code)) {
      if (stack.length) {
        const frame = stack.pop();
        // A body that reads the loop index asks the dialect to carry it: track by $index.
        if (frame.opener !== undefined) {
          // loop.index0 and loop.first are the dialect's own index, loop.index counts from one: spelled inside the loop's own
          // template spans, never in prose. The rest is named below. A body that reads the index asks the loop to carry it.
          const spans = /\{\{[\s\S]*?\}\}|\bng-[\w-]+="[^"]*"/g;
          for (let i = frame.opener + 1; i < out.length; i += 1) out[i] = out[i].replace(spans, (span) => span.replace(/\bloop\.index0\b/g, "$index").replace(/\bloop\.index\b/g, "($index + 1)").replace(/\bloop\.first\b/g, "($index == 0)"));
          if (!frame.pair && /\bloop\.(?:revindex0?|last|length)\b|\$index\b/.test(out.slice(frame.opener + 1).join(""))) out[frame.opener] = out[frame.opener].replace(/">$/, ' track by $index">');
        }
        out.push("</ng-container>");
      }
      continue;
    }
    if (/^(block\s|endblock)/.test(code)) continue;
    if (/^(extends|include)\s/.test(code)) {
      note(`\`{% ${code} %}\` composes with a template this run does not hold, so it could not be inlined. The tag was removed; the content of this file stands alone.`);
      continue;
    }
    if (/^(?:import|from)\s/.test(code)) { note(`\`{% ${code.slice(0, 40)} %}\` imports macros from another template; the macros it names are not in the port and a call to one is named where it stands.`); continue; }
    if (/^call\b/.test(code)) { note(`\`{% ${code.slice(0, 40)} %}\` called a macro with a body; the body is kept once where it stood and the macro's own markup around it is not in the port.`); continue; }
    if (code === "endcall") continue;
    if (/^(load|csrf_token|set\s|endset|with\s|endwith|url\s)/.test(code)) {
      note(`\`{% ${code} %}\` is server side machinery with no client equivalent. It was removed and is named here so the gap is visible.`);
      continue;
    }
    note(`A template construct could not be carried across and was removed: \`{% ${code} %}\`.`);
  }
  out.push(text.slice(last));

  while (stack.length) { stack.pop(); out.push("</ng-container>"); }

  // `loop.index` and friends are jinja's loop metadata; naming it beats
  // emitting a variable nothing defines.
  const result = out.join("");
  if (/\{\{[^}]*\bloop\.\w+|\bng-[\w-]+="[^"]*\bloop\.\w+/.test(result)) {
    note("`loop.` metadata beyond index and first inside a for has no counterpart in the dialect. Rewire it from the loop index in the port.");
  }
  return result;
}
