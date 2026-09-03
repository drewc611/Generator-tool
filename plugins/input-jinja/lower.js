/**
 * Jinja and Django template syntax, lowered onto the attribute dialect.
 *
 * The two languages share the constructs that matter here: {% if/elif/else %},
 * {% for x in xs %}, {{ interpolation }} with pipes, and {# comments #}.
 * Python's spelling of boolean logic is rewritten to JS at the word level;
 * inheritance tags ({% extends %}, {% block %}) shape files, not screens, so
 * the block contents are kept and the machinery is named.
 */

const attrSafe = (code) => String(code).replace(/"/g, "'");

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

export function lowerJinja(source, note = () => {}, resolveInclude = null, depth = 0) {
  let text = String(source ?? "").replace(/\{#[\s\S]*?#\}/g, "");

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
      return lowerJinja(merged, note, resolveInclude, depth + 1);
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
        body = body.replace(new RegExp(`\\b${p.replace(/\$/g, "\\$")}\\b`, "g"), value);
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
    const forLoop = /^for\s+([\w$]+)(?:\s*,\s*[\w$]+)?\s+in\s+([\s\S]+)$/.exec(code);
    if (forLoop) {
      if (/,/.test(code.slice(4, code.indexOf(" in ")))) {
        note(`\`{% ${code} %}\` unpacked a tuple. Only the first name is carried; rewire the rest in the port.`);
      }
      out.push(`<ng-container ng-repeat="${forLoop[1]} in ${attrSafe(pythonToJs(forLoop[2]))}">`);
      stack.push({ kind: "for", list: pythonToJs(forLoop[2]) });
      continue;
    }
    if (/^end(if|for)$/.test(code)) {
      if (stack.length) { stack.pop(); out.push("</ng-container>"); }
      continue;
    }
    if (/^(block\s|endblock)/.test(code)) continue;
    if (/^(extends|include)\s/.test(code)) {
      note(`\`{% ${code} %}\` composes with a template this run does not hold, so it could not be inlined. The tag was removed; the content of this file stands alone.`);
      continue;
    }
    if (/^(load|csrf_token|set\s|with\s|endwith|url\s)/.test(code)) {
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
  if (/\{\{[^}]*\bloop\./.test(result)) {
    note("`loop.` metadata inside a for has no counterpart in the dialect. Rewire it from the loop index in the port.");
  }
  return result;
}
