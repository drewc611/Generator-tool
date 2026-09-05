import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { insideAttribute } from "../dsp-ir/markup.js";
import { attrSafe, matchBracket as matchShared, quoteJs, readInputs, resolveTemplate, rewriteReceivers, splitCommas } from "../dsp-ir/text.js";

/** Brackets matched through Scala: a double quoted string is skipped, a 'symbol is not a string, a body of markup may hold an apostrophe. */
const matchBracket = (text, open) => matchShared(text.replace(/'(\w+)\b(?!')/g, "\u0008$1").replace(/'([^'\\])'/g, "\u0008$1\u0008"), open, { strings: text[open] !== "{", ticks: false });
/** Scala arguments split at their commas, a 'symbol never mistaken for an open string. */
const scalaArgs = (text) => splitCommas(text.replace(/'(\w+)\b(?!')/g, "\u0008$1"), { ticks: false }).map((a) => a.replace(/\u0008/g, "'"));

/**
 * Twirl, the Play Framework's template language: a Scala function whose
 * body is markup, its parameters declared on the first line as @(a: A)(b: B),
 * and Scala reached from the markup through one character. @if(c) { } else
 * if (d) { } else { }, @for(x <- xs) { }, @xs.map { x => }, @x match { case
 * Some(v) => { } case None => { } }, @defining(e) { x => }, @x.y.z, @(expr),
 * @{ block }, @Html(raw), @messages("key"), @routes.Ctrl.action(id),
 * @helper.form(action = ...) { @helper.inputText(form("name")) }, and a
 * layout applied as a call, @main("Title") { body }, whose template takes the
 * body as a parameter typed Html. Each construct that shapes markup has an
 * exact spelling in the dialect and is lowered onto it; the Scala inside is
 * spelled as JavaScript outside strings, with the collection and Option
 * methods that have an exact equivalent rewritten and the rest named.
 *
 * Whether .map is a loop or a presence test depends on the receiver's type,
 * which the header declares for a parameter and nothing declares for anything
 * else: a declared Option is a presence test, a declared collection a loop,
 * and an undeclared receiver a loop with the assumption named. A reverse
 * route, a Form, a Messages lookup, the request and a code block with a val in
 * it are named as things the port must supply rather than approximated.
 */

const CONTEXT = { request: "the Play RequestHeader", flash: "the Play flash scope", session: "the Play session", lang: "the request's Lang", messages: "the Play Messages", Messages: "the Play Messages", implicitly: "an implicit the compiler resolved", routes: "Play's reverse router", CSRF: "the CSRF token" };
const OPTION = /^(?:scala\.)?Option\[/;
const COLLECTION = /^(?:scala\.(?:collection\.(?:immutable\.)?)?)?(?:Seq|List|Iterable|Array|Set|Vector|IndexedSeq|Map|Traversable|Stream|LazyList)\[/;

export function freshScope(note = () => {}) {
  const scope = { note, aliases: new Map(), types: new Map(), composed: new Set(), twoWay: false, forms: new Set() };
  scope.child = () => Object.assign(freshScope(note), { aliases: new Map(scope.aliases), types: new Map(scope.types), forms: scope.forms, composed: scope.composed, parent: scope });
  return scope;
}

/** The parameter groups a template declares on its first line, and the body after them. */
export function parseParams(source) {
  const text = String(source ?? "");
  const m = /^\s*@\(/.exec(text);
  if (!m) return { params: [], rest: text };
  let i = m[0].length - 1;
  const params = [];
  let group = 0;
  while (text[i] === "(") {
    const end = matchBracket(text, i);
    if (end < 0) return { params, rest: text.slice(i) };
    let inner = text.slice(i + 1, end - 1).trim();
    let implicit = false;
    if (/^implicit\b/.test(inner)) { implicit = true; inner = inner.replace(/^implicit\s+/, ""); }
    for (const p of splitCommas(inner, { ticks: false })) {
      const pm = /^(\w+)\s*:\s*([^=]+?)\s*(?:=\s*([\s\S]+))?$/.exec(p);
      if (pm) params.push({ name: pm[1], type: pm[2].trim(), fallback: pm[3]?.trim(), implicit, group });
    }
    i = end; group += 1;
    let j = i; while (j < text.length && /\s/.test(text[j])) j += 1;
    if (text[j] === "(") i = j; else break;
  }
  return { params, rest: text.slice(i) };
}

/** A Scala string literal's body, its escapes decoded (they are JSON's), as the JS literal that says the same. */
function jsLiteral(body) {
  let decoded = body;
  try { decoded = JSON.parse(`"${body.replace(/\\'/g, "'")}"`); } catch { decoded = body; }
  return quoteJs(decoded).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

/** A Scala expression as the JS it names, outside of strings. */
export function scalaToJs(code, scope = freshScope()) {
  const holds = [];
  const hold = (s) => { holds.push(s); return `\u0001${holds.length - 1}\u0002`; };
  const unhold = (t) => String(t).replace(/\u0001(\d+)\u0002/g, (m, i) => unhold(holds[Number(i)]));
  let s = String(code).trim();
  s = s.replace(/(?:(?<![\w$])([sf]))?"((?:\\.|[^"\\])*)"/g, (m, interp, body) => {
    if (!interp) return hold(jsLiteral(body));
    if (interp === "f") scope.note("An f interpolated string carries printf formats; its values are joined unformatted.");
    const pieces = []; let last = 0;
    for (const mm of body.matchAll(/\$\{([^}]*)\}|\$(\w+)/g)) {
      if (mm.index > last) pieces.push(quoteJs(body.slice(last, mm.index)));
      pieces.push(`(${scalaToJs(mm[1] ?? mm[2], scope)})`);
      last = mm.index + mm[0].length;
    }
    if (last < body.length) pieces.push(quoteJs(body.slice(last)));
    return hold(pieces.length > 1 ? `(${pieces.join(" + ")})` : pieces[0] ?? "''");
  });
  s = s.replace(/'([^'\\])'/g, (m, c) => hold(`'${c}'`));
  // Play's helper arguments are symbols: 'class -> "x".
  s = s.replace(/'(\w+)\b/g, (m, n) => hold(quoteJs(n)));
  // A held string followed by .format is a formatter; the value is interpolated unformatted and named.
  for (;;) {
    const fm = /\u0001(\d+)\u0002\.format\(/.exec(s);
    if (!fm) break;
    const open = fm.index + fm[0].length - 1;
    const end = matchBracket(s, open);
    if (end < 0) break;
    const args = scalaArgs(s.slice(open + 1, end - 1));
    scope.note(`The formatter \`${unhold(holds[Number(fm[1])]).slice(0, 30)}.format\` has no client equivalent; the value is interpolated unformatted.`);
    s = s.slice(0, fm.index) + (args[0] ?? "''") + s.slice(end);
  }
  s = s.replace(/\bSome\(/g, "(").replace(/\bNone\b/g, "null").replace(/\bNil\b/g, "[]");
  s = s.replace(/\.equals\(/g, " == (").replace(/\s->\s/g, ": ");
  // if (c) a else b is the ternary it means.
  s = s.replace(/^if\s*\(([\s\S]+?)\)\s*([\s\S]+?)\s+else\s+([\s\S]+)$/, "($1) ? $2 : $3");
  // _.name and (_ > 2) are the lambdas Scala spells with a placeholder.
  s = s.replace(/\(\s*_((?:\.\w+(?:\([^()]*\))?)+|\s*[<>=!]=?\s*[^()]+)\s*\)/g, (m, tail) => `((it) => it${tail.trim()})`);
  s = rewriteReceivers(s, /\.(isEmpty|nonEmpty|isDefined|get|getOrElse|orNull|size|length|head|last|headOption|toString|toUpperCase|toLowerCase|trim|mkString|contains|toInt|toDouble|toLong|toFloat|take|exists|forall|reverse)(?![\w])/g, (recv, method, whole) => {
    switch (method) {
      case "isEmpty": return whole ? `!${recv} || !${recv}.length` : `(!${recv} || !${recv}.length)`;
      case "nonEmpty": return whole ? `${recv} && ${recv}.length` : `(${recv} && ${recv}.length)`;
      case "isDefined": return `(${recv} != null)`;
      case "get": case "orNull": case "toString": return recv;
      case "getOrElse": return `(${recv} ?? \u0004`;
      case "size": case "length": return `${recv}\u0007length`;
      case "head": case "headOption": return `${recv}[0]`;
      case "last": return `${recv}\u0007at(-1)`;
      case "toUpperCase": case "toLowerCase": case "trim": return `${recv}\u0007${method}()`;
      case "mkString": return `${recv}\u0007join`;
      case "contains": return `${recv}\u0007includes`;
      case "exists": return `${recv}\u0007some`;
      case "forall": return `${recv}\u0007every`;
      case "take": return `${recv}\u0007slice(0, \u0004`;
      case "reverse": return `${recv}\u0007slice()\u0007reverse()`;
      default: return `Number(${recv})`;
    }
  });
  // The rewrites spell their dot as a marker so none can match itself; the marker is a dot again here.
  s = s.replace(/\u0007/g, ".");
  // \u0004(args) is the argument list a rewrite above still needs, closed after it.
  for (;;) {
    const at = s.indexOf("\u0004");
    if (at < 0) break;
    if (s[at + 1] !== "(") { s = s.slice(0, at) + "'')" + s.slice(at + 1); continue; }
    const end = matchBracket(s, at + 1);
    if (end < 0) { s = s.slice(0, at) + s.slice(at + 2) + ")"; break; }
    s = s.slice(0, at) + s.slice(at + 2, end - 1) + ")" + s.slice(end);
  }
  s = s.replace(/\(\)\(\)/g, "()").replace(/\.join(?![\w(])/g, ".join('')");
  for (const [name, js] of scope.aliases) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`(?<![\\w.$\\u0001])${safe}(?![\\w$])`, "g"), () => js);
  }
  for (const m of s.matchAll(/(?<![\w.$\u0001])([A-Za-z_]\w*)(?=\.|\(|\b)/g)) {
    const what = CONTEXT[m[1]];
    if (what) scope.note(`\`${m[1]}\` is ${what}; it is read on the server and the port must supply its own.`);
  }
  return unhold(s).trim();
}

const CHAIN = /^[A-Za-z_]\w*/;

/** The Scala expression that starts at `from`: an identifier and the .name, (...) and [...] that follow it. */
function readChain(text, from) {
  const m = CHAIN.exec(text.slice(from));
  if (!m) return null;
  let i = from + m[0].length;
  for (;;) {
    const c = text[i];
    if (c === "." && /[A-Za-z_]/.test(text[i + 1] ?? "")) { const w = /^\w+/.exec(text.slice(i + 1)); i += 1 + w[0].length; continue; }
    if (c === "(" || c === "[") { const e = matchBracket(text, i); if (e < 0) return null; i = e; continue; }
    break;
  }
  return { text: text.slice(from, i), end: i };
}

/** `@if(c) {A} else if (d) {B} else {C}` read from the @: the branches with their tests and bodies, and where the chain ends. */
function readIfChain(text, at) {
  const branches = []; let elseBody = null; let i = at + 3;
  for (;;) {
    while (/\s/.test(text[i] ?? "")) i += 1;
    if (text[i] !== "(") return null;
    const ce = matchBracket(text, i); if (ce < 0) return null;
    const test = text.slice(i + 1, ce - 1);
    i = ce; while (/\s/.test(text[i] ?? "")) i += 1;
    if (text[i] !== "{") return null;
    const be = matchBracket(text, i); if (be < 0) return null;
    branches.push({ test, body: text.slice(i + 1, be - 1) });
    i = be;
    const tail = /^\s*else\s*(if\b)?/.exec(text.slice(i));
    if (!tail) return { branches, elseBody, end: i };
    if (tail[1]) { i += tail[0].length; continue; }
    i += tail[0].length; while (/\s/.test(text[i] ?? "")) i += 1;
    if (text[i] !== "{") return null;
    const ee = matchBracket(text, i); if (ee < 0) return null;
    elseBody = text.slice(i + 1, ee - 1);
    return { branches, elseBody, end: ee };
  }
}

/** A block body `{ x => ... }`, `{ case (k, v) => ... }` or `{ ... }` split into its bound names and its body. */
function readBlock(text, at) {
  const end = matchBracket(text, at);
  if (end < 0) return null;
  const inner = text.slice(at + 1, end - 1);
  const m = /^\s*(?:case\s+)?(\(\s*\w+(?:\s*,\s*\w+)*\s*\)|\w+)\s*=>/.exec(inner);
  if (!m) return { names: [], body: inner, end };
  return { names: m[1].replace(/[()]/g, "").split(",").map((n) => n.trim()), body: inner.slice(m[0].length), end };
}

/** A text span as one JS string expression: literal pieces quoted, @expressions spliced in. */
function branchJs(body, scope) {
  const pieces = []; let last = 0; let i = 0;
  while (i < body.length) {
    const at = body.indexOf("@", i);
    if (at < 0) break;
    let expr = null; let end = at + 1;
    if (body[at + 1] === "(") { end = matchBracket(body, at + 1); if (end < 0) break; expr = body.slice(at + 2, end - 1); }
    else { const chain = readChain(body, at + 1); if (chain) { expr = chain.text; end = chain.end; } }
    if (expr === null) { i = at + 1; continue; }
    if (at > last) pieces.push(quoteJs(body.slice(last, at)));
    pieces.push(`(${scalaToJs(expr, scope)})`);
    last = i = end;
  }
  if (last < body.length) pieces.push(quoteJs(body.slice(last)));
  return pieces.length ? pieces.join(" + ") : "''";
}

/** The template a call names, `main("x")` or `views.html.partials.card(p)`: its path and its argument text, or null when the chain is not a call. */
function templateCall(chain) {
  const m = /^((?:\w+\.)*\w+)\(/.exec(chain);
  if (!m || matchBracket(chain, m[0].length - 1) !== chain.length) return null;
  return { path: m[1].replace(/^views\.html\./, "").split(".").join("/"), args: chain.slice(m[0].length, -1) };
}

/** Arguments bound to a template's declared parameters, positional or `name = value`, as aliases in `scope`. */
function bindParams(params, argText, scope, callee, into) {
  const args = scalaArgs(argText);
  const own = params.filter((p) => !p.implicit && !/^(?:play\.twirl\.api\.)?Html$/.test(p.type));
  let positional = 0;
  for (const a of args) {
    const named = /^(\w+)\s*=(?!=)\s*([\s\S]+)$/.exec(a);
    const p = named ? own.find((q) => q.name === named[1]) : own[positional++];
    if (!p) { scope.note(`\`${callee}\` was called with an argument its template does not declare; \`${a.slice(0, 30)}\` was not bound.`); continue; }
    into.aliases.set(p.name, scalaToJs(named ? named[2] : a, scope));
    into.types.set(p.name, p.type);
  }
  for (const p of own) {
    if (into.aliases.has(p.name)) continue;
    if (p.fallback !== undefined) { into.aliases.set(p.name, scalaToJs(p.fallback, scope)); into.types.set(p.name, p.type); }
    else scope.note(`\`${callee}\` was called without \`${p.name}\` and it has no default; the name is left as written.`);
  }
}

const FIELD_HELPERS = { inputText: "text", inputPassword: "password", inputDate: "date", inputNumber: "number", inputEmail: "email", inputFile: "file", checkbox: "checkbox", textarea: "textarea", select: "select", inputRadioGroup: "radio" };

/** `form("name")` as the model path the field binds, `form.name`, the form named as one the port must hold. */
function fieldModel(argText, scope) {
  const m = /^\s*(\w+)\s*\(\s*"([^"]+)"\s*\)\s*$/.exec(argText);
  if (!m) return null;
  scope.forms.add(m[1]);
  scope.note(`\`${m[1]}\` is a Play Form; the port must hold the values its fields bind and post them itself.`);
  scope.twoWay = true;
  return /^\w+$/.test(m[2]) ? `${m[1]}.${m[2]}` : `${m[1]}[${quoteJs(m[2])}]`;
}

/** Play helper arguments beyond the field: 'class -> "x" as attributes, '_label -> "L" as a label, the rest named. */
function helperArgs(args, scope) {
  const attrs = []; let label = null;
  for (const a of args) {
    const m = /^'(_?\w+)\s*->\s*([\s\S]+)$/.exec(a.trim());
    if (!m) { scope.note(`The helper argument \`${a.trim().slice(0, 30)}\` has a shape this reader does not know; it was dropped.`); continue; }
    const js = scalaToJs(m[2], scope);
    const literal = /^'[^']*'$/.test(js) ? js.slice(1, -1) : null;
    if (m[1] === "_label") { label = literal ?? `{{ ${js} }}`; continue; }
    if (m[1].startsWith("_")) { scope.note(`The field constructor option \`'${m[1]}\` shaped Play's dl/dt/dd wrapper, which the port does not reproduce.`); continue; }
    attrs.push(literal !== null ? `${m[1]}="${literal.replace(/"/g, "&quot;")}"` : `${m[1]}="{{ ${attrSafe(js)} }}"`);
  }
  return { attrs: attrs.length ? ` ${attrs.join(" ")}` : "", label };
}

/**
 * Twirl markup lowered onto the dialect. `resolve(path)` returns the template a
 * call names, `{ key, body, params, layout }`, or null.
 */
export function lowerTwirl(source, scope = freshScope(), resolve = () => null, depth = 0) {
  const text = String(source ?? "");
  const out = [];
  let i = 0; let last = 0;
  const flush = (to) => { if (to > last) out.push(text.slice(last, to)); };
  const js = (e) => scalaToJs(e, scope);
  const lowerIn = (body, inner = scope) => lowerTwirl(body, inner, resolve, depth);
  const interpolate = (expr) => { const v = js(expr); return /^'[^'\\]*'$/.test(v) ? v.slice(1, -1) : `{{ ${v} }}`; };
  const chainWithNegations = (tests, own) => { const nots = tests.map((c) => `!(${c})`); return own === null ? nots.join(" && ") || "true" : [...nots, nots.length ? `(${own})` : own].join(" && "); };
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    const next = text[at + 1] ?? "";
    // user@@example.com is one @; an @ after a word or before nothing an expression can start is prose.
    if (next === "@") { flush(at); out.push("@"); last = i = at + 2; continue; }
    if (next === "*") {
      const end = text.indexOf("*@", at + 2);
      flush(at);
      if (end < 0) { scope.note("A @* comment never closes; the rest of the file was dropped."); last = i = text.length; break; }
      last = i = end + 2; continue;
    }
    if (next === "{") {
      const end = matchBracket(text, at + 1);
      if (end < 0) { scope.note("A @{ block never closes; the rest of the file was kept as text."); break; }
      const inner = text.slice(at + 2, end - 1);
      flush(at);
      if (/\b(?:val|var|def|import)\b/.test(inner)) scope.note(`A Scala block \`@{ ${inner.trim().slice(0, 30)} }\` ran code in the template; it has no client equivalent and was removed.`);
      else if (inner.trim()) out.push(interpolate(inner));
      last = i = end; continue;
    }
    if (next === "(") {
      const end = matchBracket(text, at + 1);
      if (end < 0) { scope.note("A @( expression never closes; the rest of the file was kept as text."); break; }
      flush(at); out.push(interpolate(text.slice(at + 2, end - 1))); last = i = end; continue;
    }
    const kw = /^(if|for|import)\b/.exec(text.slice(at + 1));
    if (kw?.[1] === "import") {
      const eol = text.indexOf("\n", at); flush(at); last = i = eol < 0 ? text.length : eol + 1; continue;
    }
    if (kw?.[1] === "if") {
      const chain = readIfChain(text, at);
      if (!chain) { scope.note("An @if could not be read to its closing brace; it was kept as text."); i = at + 1; continue; }
      flush(at);
      if (insideAttribute(text, at, /@if\s*\([^)]*\)/g)) {
        let expr = chain.elseBody === null ? "''" : branchJs(chain.elseBody, scope);
        for (const b of [...chain.branches].reverse()) expr = `${js(b.test)} ? ${branchJs(b.body, scope)} : ${expr}`;
        scope.note("A condition inside an attribute value was folded into the ternary it means; an element cannot stand inside an attribute.");
        out.push(`{{ ${attrSafe(expr)} }}`);
      } else {
        const tried = [];
        for (const b of chain.branches) {
          const own = js(b.test);
          out.push(`<ng-container ng-if="${attrSafe(chainWithNegations(tried, own))}">${lowerIn(b.body)}</ng-container>`);
          tried.push(own);
        }
        if (chain.elseBody !== null) out.push(`<ng-container ng-if="${attrSafe(chainWithNegations(tried, null))}">${lowerIn(chain.elseBody)}</ng-container>`);
      }
      last = i = chain.end; continue;
    }
    if (kw?.[1] === "for") {
      let j = at + 4; while (/\s/.test(text[j] ?? "")) j += 1;
      if (text[j] !== "(" && text[j] !== "{") { i = at + 1; continue; }
      const ge = matchBracket(text, j);
      if (ge < 0) { scope.note("An @for never closes its generators; it was kept as text."); i = at + 1; continue; }
      const gens = text.slice(j + 1, ge - 1).split(/;|\n/).map((g) => g.trim()).filter(Boolean);
      let k = ge; const y = /^\s*yield\b/.exec(text.slice(k)); if (y) k += y[0].length;
      while (/\s/.test(text[k] ?? "")) k += 1;
      if (text[k] !== "{") { scope.note("An @for has no braced body; it was kept as text."); i = at + 1; continue; }
      const be = matchBracket(text, k);
      if (be < 0) { scope.note("An @for body never closes; it was kept as text."); i = at + 1; continue; }
      flush(at);
      const inner = scope.child();
      const opens = []; let closes = 0;
      for (const g of gens) {
        const gm = /^(\(\s*\w+\s*,\s*\w+\s*\)|\w+)\s*<-\s*([\s\S]+?)(?:\s+if\s+([\s\S]+))?$/.exec(g);
        if (!gm) { scope.note(`The generator \`${g.slice(0, 30)}\` has a shape this reader does not know; the body was kept once.`); continue; }
        const names = gm[1].replace(/[()]/g, "").split(",").map((n) => n.trim());
        let list = gm[2].trim();
        for (const n of names) inner.aliases.delete(n);
        let head = names[0]; let track = "";
        if (names.length === 2 && /\.zipWithIndex$/.test(list)) { list = list.replace(/\.zipWithIndex$/, ""); inner.aliases.set(names[1], "$index"); track = " track by $index"; }
        else if (names.length === 2) head = `(${names[0]}, ${names[1]})`;
        opens.push(`<ng-container ng-repeat="${attrSafe(`${head} in ${scalaToJs(list, inner)}${track}`)}">`); closes += 1;
        if (gm[3]) { opens.push(`<ng-container ng-if="${attrSafe(scalaToJs(gm[3], inner))}">`); closes += 1; }
      }
      out.push(opens.join(""), lowerIn(text.slice(k + 1, be - 1), inner), "</ng-container>".repeat(closes));
      last = i = be; continue;
    }
    const chain = readChain(text, at + 1);
    if (!chain) { i = at + 1; continue; }
    flush(at);
    let end = chain.end;
    const after = text.slice(end);
    const root = /^\w+/.exec(chain.text)[0];
    const matchAt = /^\s+match\s*\{/.exec(after);
    const blockAt = /^\s*\{/.exec(after);
    if (matchAt) {
      const open = end + matchAt[0].length - 1;
      const me = matchBracket(text, open);
      if (me < 0) { scope.note("A match never closes; it was kept as text."); last = i = at; i = at + 1; continue; }
      const subject = js(chain.text);
      const inner = text.slice(open + 1, me - 1);
      const tried = [];
      const re = /\bcase\s+([\s\S]+?)\s*=>/g; let cm;
      while ((cm = re.exec(inner))) {
        let bodyStart = cm.index + cm[0].length; while (/\s/.test(inner[bodyStart] ?? "")) bodyStart += 1;
        let body; let bodyEnd;
        if (inner[bodyStart] === "{") { bodyEnd = matchBracket(inner, bodyStart); if (bodyEnd < 0) break; body = inner.slice(bodyStart + 1, bodyEnd - 1); }
        else { const nextCase = inner.slice(bodyStart).search(/\bcase\s/); bodyEnd = nextCase < 0 ? inner.length : bodyStart + nextCase; body = inner.slice(bodyStart, bodyEnd); }
        re.lastIndex = bodyEnd;
        const child = scope.child();
        const pat = cm[1].trim();
        const guard = /^([\s\S]+?)\s+if\s+([\s\S]+)$/.exec(pat);
        const p = guard ? guard[1].trim() : pat;
        let test;
        const some = /^Some\(\s*(\w+)\s*\)$/.exec(p);
        if (some) { test = `${subject} != null`; if (some[1] !== "_") child.aliases.set(some[1], subject); }
        else if (p === "None" || p === "Nil") test = p === "None" ? `${subject} == null` : `!${subject} || !${subject}.length`;
        else if (/^(?:"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|true|false)$/.test(p)) test = `${subject} == ${js(p)}`;
        else if (p === "_") test = null;
        else if (/^\w+$/.test(p)) { child.aliases.set(p, subject); test = null; }
        else { scope.note(`The pattern \`case ${p.slice(0, 30)}\` cannot be tested on the client; its branch is emitted under a false condition for a person to write the test.`); test = "false"; }
        if (guard) { const g = scalaToJs(guard[2], child); test = test === null ? g : `${test} && ${g}`; }
        out.push(`<ng-container ng-if="${attrSafe(chainWithNegations(tried, test))}">${lowerIn(body, child)}</ng-container>`);
        if (test !== null) tried.push(test); else break;
      }
      last = i = me; continue;
    }
    const call = templateCall(chain.text);
    const target = call && depth < 6 ? resolve(call.path) : null;
    if (target) {
      const inner = scope.child();
      bindParams(target.params, call.args, scope, chain.text.slice(0, 40), inner);
      inner.templateKey = target.key;
      if (target.layout && blockAt) {
        const be = matchBracket(text, end + blockAt[0].length - 1);
        if (be < 0) { scope.note("A layout call's body never closes; it was kept as text."); i = at + 1; last = at; continue; }
        const contentParam = target.params.find((p) => /^(?:play\.twirl\.api\.)?Html$/.test(p.type));
        inner.content = `\u0000CONTENT${depth}\u0000`;
        inner.contentName = contentParam.name;
        scope.composed.add(target.key);
        const shell = lowerTwirl(target.body, inner, resolve, depth + 1);
        const body = lowerIn(text.slice(end + blockAt[0].length, be - 1));
        out.push(shell.includes(inner.content) ? shell.replace(inner.content, () => body) : body);
        if (!shell.includes(inner.content)) scope.note(`The layout \`${target.key}\` never renders its \`${contentParam.name}\`; the page stands without the layout.`);
        if (inner.twoWay) scope.twoWay = true;
        last = i = be; continue;
      }
      if (target.key === scope.templateKey) { scope.note(`\`${target.key}\` renders itself; the inner call was removed to end the recursion.`); last = i = end; continue; }
      scope.composed.add(target.key);
      out.push(lowerTwirl(target.body, inner, resolve, depth + 1));
      if (inner.twoWay) scope.twoWay = true;
      last = i = end; continue;
    }
    if (scope.content && chain.text === scope.contentName) { out.push(scope.content); last = i = end; continue; }
    if (root === "defining" && blockAt) {
      const block = readBlock(text, end + blockAt[0].length - 1);
      if (block) {
        const inner = scope.child();
        const expr = js(chain.text.slice("defining".length).replace(/^\(([\s\S]*)\)$/, "$1"));
        const bare = expr.replace(/\([^()]*\)|\[[^\]]*\]|'[^']*'/g, "");
        for (const n of block.names) inner.aliases.set(n, /[\s+\-*/%<>=!&|?:]/.test(bare) ? `(${expr})` : expr);
        out.push(lowerIn(block.body, inner));
        last = i = block.end; continue;
      }
    }
    if (/^CSRF(?:\.formField)?(?:\(\))?$/.test(chain.text)) { scope.note("`CSRF.formField` carried the server's CSRF token; the port must obtain one from its own API."); last = i = end; continue; }
    if (/^CSRF\(/.test(chain.text)) { scope.note("`CSRF(call)` signed a route with the server's CSRF token; the route stands and the token is the port's to obtain."); out.push(interpolate(chain.text.slice(5, -1))); last = i = end; continue; }
    if (root === "Html" && /^Html\(/.test(chain.text)) { out.push(`<span ng-bind-html="${attrSafe(js(chain.text.slice(5, -1)))}"></span>`); last = i = end; continue; }
    if (/^[Mm]essages(?:\.apply)?\(/.test(chain.text)) {
      const args = scalaArgs(chain.text.slice(chain.text.indexOf("(") + 1, -1));
      const key = /^"((?:\\.|[^"\\])*)"$/.exec(args[0] ?? "");
      if (key) { scope.note("`messages(\"key\")` looked a translation up on the server; the key stands as the text and is named so the port can wire its own i18n."); out.push(key[1]); }
      else out.push(interpolate(chain.text));
      last = i = end; continue;
    }
    const helper = /^(?:helper\.)?(form|inputText|inputPassword|inputDate|inputNumber|inputEmail|inputFile|checkbox|textarea|select|inputRadioGroup|repeat|CSRF)(?:\.formField)?\(/.exec(chain.text);
    if (helper && !(helper[1] === "form" && /^(?:helper\.)?form\(\s*"/.test(chain.text))) {
      const args = scalaArgs(chain.text.slice(chain.text.indexOf("(") + 1, -1));
      if (helper[1] === "form" && blockAt) {
        const be = matchBracket(text, end + blockAt[0].length - 1);
        if (be < 0) { scope.note("A helper.form body never closes; it was kept as text."); i = at + 1; last = at; continue; }
        const action = args.find((a) => /^action\s*=/.test(a))?.replace(/^action\s*=\s*/, "") ?? args[0];
        const { attrs } = helperArgs(args.filter((a) => a !== (args.find((x) => /^action\s*=/.test(x)) ?? args[0])), scope);
        out.push(`<form action="{{ ${attrSafe(js(action ?? "''"))} }}"${attrs}>${lowerIn(text.slice(end + blockAt[0].length, be - 1))}</form>`);
        last = i = be; continue;
      }
      if (helper[1] === "CSRF") { scope.note("`CSRF.formField` carried the server's CSRF token; the port must obtain one from its own API."); last = i = end; continue; }
      if (helper[1] === "repeat") { scope.note("`helper.repeat` rendered a field once per element of a Form list; the repetition is a loop the port must write over its own state."); last = i = end; continue; }
      const model = fieldModel(args[0] ?? "", scope);
      if (!model) { scope.note(`\`${helper[1]}\` was called with \`${(args[0] ?? "").slice(0, 30)}\`, not a form field; it was dropped.`); last = i = end; continue; }
      const { attrs, label } = helperArgs(args.slice(1).filter((a) => !/^options\(|^Seq\(|^\w+\.map\(/.test(a.trim())), scope);
      const type = FIELD_HELPERS[helper[1]];
      const labelHtml = label ? `<label>${label}</label>` : "";
      if (type === "textarea") out.push(`${labelHtml}<textarea ng-model="${attrSafe(model)}"${attrs}></textarea>`);
      else if (type === "select") { scope.note("`helper.select` took its options from a server list; the `<select>` is emitted with none and the port must supply them."); out.push(`${labelHtml}<select ng-model="${attrSafe(model)}"${attrs}></select>`); }
      else if (type === "radio") { scope.note("`helper.inputRadioGroup` took its options from a server list; the group is emitted as one radio the port must repeat."); out.push(`${labelHtml}<input type="radio" ng-model="${attrSafe(model)}"${attrs}>`); }
      else out.push(`${labelHtml}<input type="${type}" ng-model="${attrSafe(model)}"${attrs}>`);
      last = i = end; continue;
    }
    if (call && !target && !/^(?:routes|helper|Html|CSRF|Messages|messages|implicitly|request|flash|session|lang)\b/.test(chain.text) && /^[a-z]/.test(root) && !scope.aliases.has(root) && !scope.types.has(root) && /^\w+(?:\.\w+)*\(/.test(chain.text) && !/^\w+\(\s*"/.test(chain.text) && blockAt) {
      // A lowercase call with a block whose template is not in the run is a layout or helper the run does not hold.
      const be = matchBracket(text, end + blockAt[0].length - 1);
      scope.note(`\`@${chain.text.slice(0, 40)}\` calls a template this run does not hold; the call was removed and its body stands without it.`);
      if (be >= 0) { out.push(lowerIn(text.slice(end + blockAt[0].length, be - 1))); last = i = be; continue; }
    }
    if (/\.(?:map|foreach|flatMap)$/.test(chain.text) && blockAt) {
      const block = readBlock(text, end + blockAt[0].length - 1);
      if (block) {
        const recvText = chain.text.replace(/\.(?:map|foreach|flatMap)$/, "");
        const recv = js(recvText);
        const declared = scope.types.get(root);
        const inner = scope.child();
        // .getOrElse after .map proves an Option: a collection has no getOrElse.
        const option = (declared && OPTION.test(declared)) || /^\s*\.getOrElse\s*\{/.test(text.slice(block.end));
        if (option) {
          if (block.names[0] && block.names[0] !== "_") inner.aliases.set(block.names[0], recv);
          let tail = block.end; const orElse = /^\s*\.getOrElse\s*\{/.exec(text.slice(tail));
          out.push(`<ng-container ng-if="${attrSafe(`${recv} != null`)}">${lowerIn(block.body, inner)}</ng-container>`);
          if (orElse) {
            const oe = matchBracket(text, tail + orElse[0].length - 1);
            if (oe >= 0) { out.push(`<ng-container ng-if="${attrSafe(`${recv} == null`)}">${lowerIn(text.slice(tail + orElse[0].length, oe - 1))}</ng-container>`); tail = oe; }
          }
          last = i = tail; continue;
        }
        if (!declared || !COLLECTION.test(declared)) scope.note(`\`${recvText.slice(0, 30)}.map { }\` was read as a loop; the template declares no type for it, and an Option here would be a presence test instead.`);
        let head = block.names[0] ?? "item"; let track = "";
        for (const n of block.names) inner.aliases.delete(n);
        if (block.names.length === 2 && /\.zipWithIndex$/.test(recvText)) { inner.aliases.set(block.names[1], "$index"); track = " track by $index"; }
        else if (block.names.length === 2) head = `(${block.names[0]}, ${block.names[1]})`;
        const list = js(recvText.replace(/\.zipWithIndex$/, ""));
        out.push(`<ng-container ng-repeat="${attrSafe(`${head} in ${list}${track}`)}">${lowerIn(block.body, inner)}</ng-container>`);
        last = i = block.end; continue;
      }
    }
    if (/\.getOrElse$/.test(chain.text) && blockAt) {
      const be = matchBracket(text, end + blockAt[0].length - 1);
      if (be >= 0) {
        const recv = js(chain.text.replace(/\.getOrElse$/, ""));
        out.push(`<ng-container ng-if="${attrSafe(`${recv} == null`)}">${lowerIn(text.slice(end + blockAt[0].length, be - 1))}</ng-container>`);
        last = i = be; continue;
      }
    }
    out.push(interpolate(chain.text));
    last = i = end;
  }
  out.push(text.slice(last));
  return out.join("");
}

export default {
  name: "input-twirl",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.scala\.html$/i.test(f.rel));
      if (!files.length) return log.debug("no Twirl templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => { note(`${f.rel} could not be read; it is not in the port.`); return ""; }));
      const bare = (n) => String(n).replace(/^(\.\.?\/)+/, "").replace(/^(?:app\/)?views\//, "").replace(/\.scala\.html$/i, "");
      const keys = [...bodies.keys()];
      const headers = new Map(keys.map((k) => [k, parseParams(bodies.get(k))]));
      const isLayout = (k) => headers.get(k).params.some((p) => /^(?:play\.twirl\.api\.)?Html$/.test(p.type));
      const resolve = (path) => {
        const k = resolveTemplate(keys, path, bare);
        return k ? { key: k, body: headers.get(k).rest, params: headers.get(k).params, layout: isLayout(k) } : null;
      };
      let count = 0;
      for (const [key, text] of bodies) {
        if (!text.trim()) continue;
        if (isLayout(key)) { note(`${key} takes its body as an Html parameter: it is a layout the pages render inside, composed into each of them rather than ported as a screen of its own.`); continue; }
        const file = files.find((f) => f.rel.replace(/^\.\//, "") === key);
        const scope = freshScope(note);
        scope.templateKey = key;
        for (const p of headers.get(key).params) scope.types.set(p.name, p.type);
        let template = lowerTwirl(headers.get(key).rest, scope, resolve, 0);
        const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(template);
        if (body) template = body[1];
        template = template.trim();
        if (!template) continue;
        const selector = (bare(key) || "page").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file?.rel ?? key,
          inputs: readInputs(template),
          outputs: [],
          template,
          composed: [...scope.composed],
          templateOrigin: [...scope.composed].some((k) => isLayout(k)) ? "a Twirl template, composed into its layout and lowered" : "a Twirl template, lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: Boolean(scope.twoWay),
          rxjs: [],
          readBy: "twirl",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Twirl template(s) lowered onto the dialect`);
    });
  },
};
