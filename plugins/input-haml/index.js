import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { parseIndented, VOID_ELEMENTS } from "../dsp-ir/markup.js";
import { attrSafe, matchBracket, quoteJs, readInputs, resolveTemplate, splitCommas } from "../dsp-ir/text.js";

/**
 * Haml, the template language of a generation of Rails applications: a tree
 * written as indentation, %tag.class#id with a Ruby hash or a bracket list
 * of attributes, text after the tag, = for an expression's value, - for a
 * line of Ruby that shapes the tree (if, elsif, else, unless, case and when,
 * each and each_with_index, a local set with =), #{} inside text, and the
 * Rails helpers that render partials, layouts, links, forms and translations.
 * The tree is read from the indentation and lowered onto the dialect: the
 * control lines onto the containers they mean, each onto ng-repeat with the
 * index as the dialect's own, an attribute with an expression as ng-class,
 * ng-href, ng-disabled or ng-attr as its name decides, a layout's yield
 * filled by the page and a partial rendered where it is asked for. Ruby is
 * spelled as JavaScript outside strings: @ivar is the input it is, a symbol
 * key is a property, the predicates (present?, blank?, empty?, any?, nil?)
 * and the common methods (upcase, downcase, strip, size, first, last, to_s)
 * with an exact equivalent are rewritten, and a helper that formatted a
 * value (number_to_currency, pluralize, time_ago_in_words) keeps its value
 * unformatted and is named. A route helper (root_path, product_path) is a
 * route the server owns and is named; a translation key is kept as its key;
 * a Ruby line the reader cannot read, a filter, content_for and a helper it
 * does not know are named rather than approximated.
 */

const HTML_FORM = /^(text_field|email_field|password_field|number_field|search_field|url_field|telephone_field|phone_field|date_field|hidden_field|check_box|radio_button|text_area|select|collection_select|label|submit|button|file_field)$/;
const FORMATTERS = /^(number_to_currency|number_with_delimiter|number_with_precision|number_to_percentage|number_to_human|number_to_human_size|pluralize|time_ago_in_words|distance_of_time_in_words|l|localize|humanize|titleize|truncate_words|word_wrap|highlight|excerpt)$/;

/** Ruby spelled as JavaScript, outside strings; #{} inside a string is a concatenation. */
export function rubyToJs(expr, scope = freshScope()) {
  const hold = (js) => `\u0001${scope.holds.push(js) - 1}\u0002`;
  let s = String(expr).trim();
  s = s.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, (p) => {
    if (p[0] === "'" || !/#\{/.test(p)) return hold(quoteJs(p.slice(1, -1).replace(/\\(['"\\])/g, "$1")));
    const body = p.slice(1, -1);
    const pieces = []; let last = 0;
    for (let i = body.indexOf("#{"); i >= 0; i = body.indexOf("#{", last)) {
      const end = matchBracket(body, i + 1, { ticks: false });
      if (end < 0) break;
      if (i > last) pieces.push(quoteJs(body.slice(last, i)));
      pieces.push(`(${rubyToJs(body.slice(i + 2, end - 1), scope)})`);
      last = end;
    }
    if (last < body.length) pieces.push(quoteJs(body.slice(last)));
    return hold(`(${pieces.join(" + ")})`);
  });
  s = s.replace(/\[:([a-z_]\w*)\]/g, ".$1");
  // &:name is the block that reads one method.
  s = s.replace(/\(&:(\w+)\)/g, "((x) => x.$1)");
  s = s.replace(/(?<![\w?]):([a-z_]\w*[?!]?)(?![\w:])/g, (m, sym) => hold(quoteJs(sym)));
  s = s.replace(/@@?([a-z_]\w*)/g, "$1");
  s = s.replace(/\bunless\b/g, "!").replace(/(?<![\w.$])not\s+/g, "!").replace(/(?<![\w.$])and(?![\w$])/g, "&&").replace(/(?<![\w.$])or(?![\w$])/g, "||");
  // Predicates and conversions apply to the receiver before them, found by walking back over balanced brackets.
  s = rewriteReceivers(s, /\.(present\?|blank\?|empty\?|any\?|nil\?|none\?|to_i|to_f|capitalize)(?![\w?])/g, (recv, method, whole) => {
    switch (method) {
      case "empty?": return whole ? `!${recv} || !${recv}.length` : `(!${recv} || !${recv}.length)`;
      case "blank?": return `(!${recv} || !${recv}.length)`;
      case "present?": return `(!!${recv} && ${recv}.length !== 0)`;
      case "any?": return `(${recv}.length > 0)`;
      case "none?": return `(${recv}.length === 0)`;
      case "nil?": return `${recv} == null`;
      case "to_i": return `Math.trunc(Number(${recv}))`;
      case "to_f": return `Number(${recv})`;
      default: return `(${recv}.charAt(0).toUpperCase() + ${recv}.slice(1))`;
    }
  });
  s = s.replace(/\bnil\b/g, "null");
  s = s.replace(/\.(size|length|count)(?![\w?(])/g, ".length").replace(/\.upcase\b/g, ".toUpperCase()").replace(/\.downcase\b/g, ".toLowerCase()").replace(/\.strip\b/g, ".trim()")
    .replace(/\.first\b(?!\()/g, "[0]").replace(/\.last\b(?!\()/g, ".at(-1)").replace(/\.to_s\b/g, ".toString()").replace(/\.html_safe\b/g, "").replace(/\.reverse\b(?!\()/g, ".reverse()").replace(/\.include\?\(/g, ".includes(");
  // Helpers: a formatter keeps its value; a route names a route; a translation keeps its key; raw marks html.
  for (;;) {
    const m = /(?<![\w.$])([a-z_]\w*[?!]?)\s*\(/.exec(s);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const end = matchBracket(s, open, { ticks: false, strings: false });
    if (end < 0) break;
    const args = splitCommas(s.slice(open + 1, end - 1), { ticks: false }).map((a) => a.trim()).filter(Boolean);
    const rep = helper(m[1], args, scope, hold);
    s = s.slice(0, m.index) + hold(rep) + s.slice(end);
  }
  if (/^(yield|render)$/.test(s)) s = helper(s, [], scope, hold);
  if (/\b(Time\.now|Date\.today|DateTime\.now)\b/.test(s)) scope.note("Time.now or Date.today was read on the server at render time; the port must supply the moment itself.");
  s = s.replace(/(?<![\w.$])(params|session|cookies|request|flash)(?=\.|\[|$)/g, (w) => { scope.note(`${w} is the request the server had; the port must supply \`${w}\` itself.`); return w; });
  // A helper called without brackets: t "key", raw x, truncate x, length: 20.
  const bare = /^([a-z_]\w*[?!]?)\s+([\s\S]+)$/.exec(s);
  if (bare && /^(t|raw|link_to|image_tag|truncate|number_to_\w+|pluralize|render|yield|content_tag|simple_format|sanitize|strip_tags|h|escape_once|time_ago_in_words|button_to|mail_to)$/.test(bare[1]) && !/^\s*[+\-*/%<>=!&|?]/.test(bare[2])) {
    s = helper(bare[1], splitCommas(bare[2], { ticks: false }).map((a) => a.trim()).filter(Boolean), scope, hold);
  }
  s = s.replace(/\b([a-z_]\w*)_(path|url)\b(?!\s*\()/g, (m, name, kind) => { scope.note(`${m} is a route helper the server resolved; the port must supply the address, and the endpoint map is where it belongs.`); return m; });
  for (const [alias, js] of scope.aliases) s = s.replace(new RegExp(`(?<![\\w.$])${alias}(?![\\w$])`, "g"), () => js);
  return scope.unhold(s);
}

/** `expr if cond` or `expr unless cond` at the top level of a line, split. */
export function splitPostfix(code) {
  let depth = 0; let quote = null;
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (depth === 0 && i > 0 && /\s/.test(code[i - 1])) {
      const m = /^(if|unless)\s+([\s\S]+)$/.exec(code.slice(i));
      if (m && code.slice(0, i).trim()) return { kind: m[1], body: code.slice(0, i).trim(), test: m[2].trim() };
    }
  }
  return null;
}

/** A Rails helper as the value or markup it stood for. */
function helper(name, rawArgs, scope, hold) {
  const args = rawArgs.map(scope.unhold);
  const arg = (i) => (args[i] === undefined ? "null" : rubyToJs(args[i], scope));
  switch (name) {
    case "t": case "translate": {
      const key = /^['"]\.?([^'"]*)['"]$/.exec(args[0] ?? "");
      scope.note("Translation keys (t(...)) were kept as their keys; the port renders the key until a locale file is wired, and no text was invented.");
      return key ? quoteJs(key[1]) : arg(0);
    }
    case "raw": case "html_safe": case "sanitize": case "simple_format": scope.html = true; return arg(0);
    case "h": case "escape_once": case "strip_tags": return arg(0);
    case "truncate": { const len = args.slice(1).map((a) => /length:\s*(\d+)|:length\s*=>\s*(\d+)/.exec(a)).find(Boolean); return `${arg(0)} | limitTo:${len ? len[1] ?? len[2] : 30}`; }
    case "link_to": {
      const text = arg(0); const href = args[1] !== undefined ? rubyToJs(args[1], scope) : "'#'";
      const extra = args.slice(2).map((a) => /^(?::?([\w-]+)|['"]([\w-]+)['"])\s*(?:=>|:)\s*([\s\S]+)$/.exec(a)).filter(Boolean).map((m) => [m[1] ?? m[2], rubyToJs(m[3], scope)]);
      const attrs = extra.map(([k, v]) => (/^'[^']*'$/.test(v) ? `${k}="${v.slice(1, -1)}"` : ["disabled", "checked", "hidden"].includes(k) ? `ng-${k}="${attrSafe(v)}"` : k === "class" ? `ng-class="${attrSafe(v)}"` : `ng-attr-${k}="{{ ${attrSafe(v)} }}"`)).map((a) => ` ${a}`).join("");
      scope.markup = `<a ng-href="{{ ${attrSafe(href)} }}"${attrs}>${/^'[^']*'$/.test(text) ? text.slice(1, -1) : `{{ ${text} }}`}</a>`;
      return "";
    }
    case "image_tag": { const src = arg(0); scope.markup = /^'[^']*'$/.test(src) ? `<img src="${src.slice(1, -1)}">` : `<img ng-src="{{ ${attrSafe(src)} }}">`; return ""; }
    case "content_tag": { const tag = (args[0] ?? "'div'").replace(/^:|['"]/g, ""); scope.markup = `<${tag}>{{ ${arg(1)} }}</${tag}>`; return ""; }
    case "render": case "yield": scope.render = { name, args }; return "";
    case "number_to_currency": case "number_with_delimiter": case "number_with_precision": case "number_to_percentage": case "number_to_human": case "number_to_human_size": case "time_ago_in_words": case "distance_of_time_in_words": case "l": case "localize": case "humanize": case "titleize": case "truncate_words": case "word_wrap": case "pluralize":
      scope.note(`${name}() formatted its value on the server; the value is unformatted in the port and the format is not carried.`);
      return name === "pluralize" ? `${arg(0)} + ' ' + ${arg(1)}` : arg(0);
    default:
      if (/_(path|url)$/.test(name)) {
        scope.note(`${name}() is a route helper the server resolved; the port must supply the address, and the endpoint map is where it belongs.`);
        const keyed = args.map((a) => /^(?::?([\w-]+)|['"]([\w-]+)['"])\s*(?:=>|:)\s*([\s\S]+)$/.exec(a));
        const positional = args.filter((a, i) => !keyed[i]).map((a) => rubyToJs(a, scope));
        const options = keyed.filter(Boolean).map((m) => `${m[1] ?? m[2]}: ${rubyToJs(m[3], scope)}`);
        return `${name}(${[...positional, ...(options.length ? [`{ ${options.join(", ")} }`] : [])].join(", ")})`;
      }
      if (HTML_FORM.test(name) || /^f\./.test(name)) return `${name}(${args.map((a, i) => arg(i)).join(", ")})`;
      scope.note(`${name}() is a helper this reader does not know, or one the application defined; the call was kept and the port must supply \`${name}\`.`);
      return `${name}(${args.map((a, i) => arg(i)).join(", ")})`;
  }
}

/** Each `receiver.method` match rewritten with its receiver, the receiver being the balanced path just before the dot. */
function rewriteReceivers(s, re, rewrite) {
  let out = s;
  for (;;) {
    const m = re.exec(out);
    re.lastIndex = 0;
    if (!m) return out;
    let i = m.index - 1; let depth = 0;
    for (; i >= 0; i -= 1) {
      const c = out[i];
      if (c === ")" || c === "]") depth += 1;
      else if (c === "(" || c === "[") { if (depth === 0) break; depth -= 1; }
      else if (depth === 0 && !/[\w$.@\u0001\u0002]/.test(c)) break;
    }
    const start = i + 1;
    const recv = out.slice(start, m.index);
    const whole = start === 0 && m.index + m[0].length === out.length;
    out = out.slice(0, start) + rewrite(recv, m[1], whole) + out.slice(m.index + m[0].length);
  }
}

export function freshScope(note = () => {}) {
  const scope = { note, holds: [], aliases: new Map(), depth: 0, form: null, dir: "" };
  scope.unhold = (t) => String(t).replace(/\u0001(\d+)\u0002/g, (mm, i) => scope.unhold(scope.holds[Number(i)]));
  return scope;
}

/** Lines into a tree by indentation; a brace or bracket left open, or a Ruby line ending in a comma, runs onto the next line. */
export function parseTree(source) {
  return parseIndented(source, (line) => {
    const open = /^[%.#][\w.#-]*[({[]/.exec(line);
    if (open && matchBracket(line, open[0].length - 1, { ticks: false }) < 0) return true;
    // Only a line of Ruby continues on a comma; prose ending in one does not.
    return /^[-=!&~]/.test(line) && /,\s*$/.test(line);
  });
}

/** #{} in text. */
export function lowerText(text, scope) {
  let out = ""; let i = 0;
  while (i < text.length) {
    const at = text.indexOf("#{", i);
    if (at < 0) { out += text.slice(i); break; }
    if (text[at - 1] === "\\") { out += text.slice(i, at - 1) + "#{"; i = at + 2; continue; }
    const end = matchBracket(text, at + 1, { ticks: false });
    if (end < 0) { out += text.slice(i); break; }
    out += text.slice(i, at) + `{{ ${rubyToJs(text.slice(at + 2, end - 1), scope)} }}`;
    i = end;
  }
  return out;
}

/** A tag line: %tag.class#id{...}(...) and what follows. */
export function parseTag(line) {
  if (!/^[%.#]/.test(line)) return null;
  let i = 0; let tag = "div";
  const tm = /^%([\w:-]+)/.exec(line);
  if (tm) { tag = tm[1]; i = tm[0].length; }
  const classes = []; let id = null;
  for (;;) { const m = /^([.#])([\w-]+)/.exec(line.slice(i)); if (!m) break; if (m[1] === ".") classes.push(m[2]); else id = m[2]; i += m[0].length; }
  let hash = null; let list = null;
  for (;;) {
    if (line[i] === "{") { const e = matchBracket(line, i, { ticks: false }); if (e < 0) return null; hash = line.slice(i + 1, e - 1); i = e; continue; }
    if (line[i] === "(") { const e = matchBracket(line, i, { ticks: false }); if (e < 0) return null; list = line.slice(i + 1, e - 1); i = e; continue; }
    if (line[i] === "[") { const e = matchBracket(line, i, { ticks: false }); if (e < 0) return null; i = e; continue; }
    break;
  }
  let selfClose = false; if (line[i] === "/") { selfClose = true; i += 1; }
  while (line[i] === "<" || line[i] === ">") i += 1;
  let mode = "text"; let rest = line.slice(i);
  if (rest.startsWith("!=")) { mode = "html"; rest = rest.slice(2).trim(); }
  else if (rest.startsWith("&=")) { mode = "code"; rest = rest.slice(2).trim(); }
  else if (rest.startsWith("=")) { mode = "code"; rest = rest.slice(1).trim(); }
  else rest = rest.replace(/^ /, "");
  return { tag, classes, id, hash, list, selfClose, mode, rest };
}

/** Attributes onto the dialect: a string stays, an expression becomes the binding its name calls for. */
export function lowerAttrs(head, scope) {
  const entries = [];
  if (head.hash) {
    for (const part of splitCommas(head.hash, { ticks: false })) {
      const m = /^\s*(?::?([\w:-]+)|['"]([^'"]+)['"])\s*(?:=>|:)\s*([\s\S]+)$/.exec(part);
      if (!m) { if (part.trim()) scope.note(`The attribute \`${part.trim().slice(0, 30)}\` has a shape this reader does not know; it was dropped.`); continue; }
      entries.push([m[1] ?? m[2], m[3].trim()]);
    }
  }
  if (head.list) {
    for (const m of head.list.matchAll(/([\w:-]+)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/g)) entries.push([m[1], m[2]]);
  }
  if (head.entries) entries.push(...head.entries);
  for (const n of head.notes ?? []) scope.note(n);
  const classes = [...head.classes]; let id = head.id;
  const parts = [];
  // data: { id: 1 } is data-id="1", as Haml renders it.
  const flat = entries.flatMap(([name, raw]) => {
    const nested = /^(data|aria)$/.test(name) && /^\{[\s\S]*\}$/.test(raw.trim());
    if (!nested) return [[name, raw]];
    return splitCommas(raw.trim().slice(1, -1), { ticks: false }).map((part) => /^\s*(?::?([\w-]+)|['"]([^'"]+)['"])\s*(?:=>|:)\s*([\s\S]+)$/.exec(part)).filter(Boolean).map((m) => [`${name}-${m[1] ?? m[2]}`, m[3].trim()]);
  });
  for (const [name, raw] of flat) {
    const isString = (/^(["'])[\s\S]*\1$/.test(raw) && !/#\{/.test(raw)) || /^-?\d+(\.\d+)?$/.test(raw.trim());
    if (/^-?\d+(\.\d+)?$/.test(raw.trim())) { parts.push(`${name}="${raw.trim()}"`); continue; }
    if (name === "class" && isString) { classes.push(...raw.slice(1, -1).split(/\s+/).filter(Boolean)); continue; }
    if (name === "id" && isString) { id = raw.slice(1, -1); continue; }
    if (isString) { parts.push(`${name}="${raw.slice(1, -1).replace(/"/g, "&quot;")}"`); continue; }
    const js = rubyToJs(raw, scope);
    if (/^'[^']*'$/.test(js)) { parts.push(`${name}="${js.slice(1, -1).replace(/"/g, "&quot;")}"`); continue; }
    if (name === "class") { parts.push(`ng-class="${attrSafe(js)}"`); continue; }
    if (["disabled", "checked", "selected", "readonly", "required", "hidden", "multiple"].includes(name)) { parts.push(`ng-${name}="${attrSafe(js)}"`); continue; }
    if (name === "href" || name === "src") { parts.push(`ng-${name}="{{ ${attrSafe(js)} }}"`); continue; }
    parts.push(`ng-attr-${name}="{{ ${attrSafe(js)} }}"`);
  }
  const head2 = [];
  if (id) head2.push(`id="${id}"`);
  if (classes.length) head2.push(`class="${classes.join(" ")}"`);
  const all = [...head2, ...parts];
  return all.length ? " " + all.join(" ") : "";
}

/** Haml's line grammar: what a comment, a filter, a text line, an output line, a code line and a tag look like; `plain` says a line that is not a tag is prose. */
export const HAML = {
  comment: (line) => line.startsWith("-#") || line.startsWith("/") || line.startsWith("!!!"),
  filter: (line) => (line.startsWith(":") ? line.split(/\s/)[0] : null),
  text: (line) => (line.startsWith("\\") ? line.slice(1) : null),
  output: (line) => { const m = /^(!=|&=|=|~)\s*([\s\S]*)$/.exec(line); return m ? { code: m[2], html: m[1] === "!=" } : null; },
  code: (line) => (line.startsWith("-") ? line.slice(1).trim() : null),
  plain: (line) => !/^[%.#]/.test(line),
  parseTag,
  parseTree,
};

/** Lower a tree onto the dialect under a line grammar; `resolve(name, dir)` returns a partial's text (or { body, dir }) or null. */
export function lowerTree(root, scope = freshScope(), resolve = () => null, depth = 0, grammar = HAML) {
  const out = [];
  const lowerChildren = (children, isRoot = false) => {
    for (let idx = 0; idx < children.length; idx += 1) {
      if (isRoot && idx > 0) out.push("\u0000NL\u0000");
      const node = children[idx];
      const line = node.line;
      if (grammar.comment(line)) continue;
      const filter = grammar.filter(line);
      if (filter) { scope.note(`The filter \`${filter}\` transformed its block on the server; the block was not carried.`); continue; }
      const text = grammar.text(line);
      if (text !== null) {
        // A text block's lines, however deep they are indented, are its text.
        const lines = (nodes) => nodes.flatMap((c) => [c.line, ...lines(c.children)]);
        out.push(lowerText(text, scope)); for (const l of lines(node.children)) out.push(lowerText(` ${l}`, scope));
        continue;
      }
      if (line.startsWith("<")) { out.push(lowerText(line, scope)); lowerChildren(node.children); continue; }
      const output = grammar.output(line);
      if (output) { out.push(expression(output.code, output.html, node, depth)); continue; }
      const codeLine = grammar.code(line);
      if (codeLine !== null) {
        const code = codeLine;
        if (control(code, node, children, () => idx, (v) => { idx = v; }, depth)) continue;
        const assign = /^([a-z_]\w*)\s*(\|\|)?=\s*([\s\S]+)$/.exec(code);
        if (assign) {
          const js = rubyToJs(assign[3], scope);
          if (scope.depth > 0 || new RegExp(`(?<![\\w.$])${assign[1]}(?![\\w$])`).test(js)) { scope.note(`\`- ${code.slice(0, 40)}\` set a local inside a branch or loop, or from itself; the port must carry it.`); continue; }
          scope.aliases.set(assign[1], /^[\w$.]+$/.test(js) || /^'[^']*'$/.test(js) || /^-?\d+(\.\d+)?$/.test(js) ? js : `(${js})`);
          continue;
        }
        if (/^content_for\b/.test(code)) { scope.note(`\`- ${code.slice(0, 40)}\` handed a block to the layout's yield; that block is not in the port and is named here.`); continue; }
        if (/^(cache|capture|javascript_tag|provide|end)\b/.test(code)) { lowerChildren(node.children); continue; }
        scope.note(`Ruby ran while rendering: \`- ${code.slice(0, 40)}\`. It was not carried and its values are not in the port.`);
        lowerChildren(node.children);
        continue;
      }
      // An element.
      const head = grammar.parseTag(line);
      if (!head) {
        if (!(grammar.plain ?? (() => false))(line)) scope.note(`\`${line.slice(0, 40)}\` could not be read as a tag; it was kept as text.`);
        out.push(lowerText(line, scope)); lowerChildren(node.children);
        continue;
      }
      const attrs = lowerAttrs(head, scope);
      if (VOID_ELEMENTS.has(head.tag) || head.selfClose) { out.push(`<${head.tag}${attrs}>`); continue; }
      out.push(`<${head.tag}${attrs}>`);
      if (head.mode === "inline") { if (head.rest) lowerChildren([{ line: head.rest, children: node.children, indent: node.indent + 1 }]); else lowerChildren(node.children); out.push(`</${head.tag}>`); continue; }
      if (head.mode === "code") out.push(expression(head.rest, false, node, depth));
      else if (head.mode === "html") out.push(expression(head.rest, true, node, depth));
      else if (head.rest) out.push(lowerText(head.rest, scope));
      lowerChildren(node.children);
      out.push(`</${head.tag}>`);
    }
  };

  /** = expr: a value, a partial, a yield, a link, or a form. */
  const expression = (code, html, node, depthNow) => {
    const form = /^(form_for|form_with|form_tag|simple_form_for)\b(.*)\s+do\s*(?:\|(\w+)\|)?\s*$/.exec(code);
    if (form) {
      const model = /@(\w+)/.exec(form[2])?.[1] ?? /model:\s*@?(\w+)/.exec(form[2])?.[1] ?? null;
      const previous = scope.form;
      scope.form = { var: form[3] ?? "f", model };
      const url = /url:\s*([^,]+)/.exec(form[2]) ?? /:url\s*=>\s*([^,]+)/.exec(form[2]);
      out.push(`<form${url ? ` ng-attr-action="{{ ${attrSafe(rubyToJs(url[1], scope))} }}"` : ""} method="post">`);
      lowerChildren(node.children);
      out.push("</form>");
      scope.form = previous;
      return "";
    }
    const field = scope.form && new RegExp(`^${scope.form.var}\\.(\\w+)\\s*([\\s\\S]*)$`).exec(code);
    if (field && HTML_FORM.test(field[1])) {
      let args = field[2].trim();
      if (args.startsWith("(")) { const end = matchBracket(args, 0, { ticks: false }); args = end > 0 ? args.slice(1, end - 1) + args.slice(end) : args.slice(1); }
      return formField(field[1], splitCommas(args, { ticks: false }).map((a) => a.trim()).filter(Boolean));
    }
    const fields = scope.form && new RegExp(`^${scope.form.var}\\.fields_for\\s+:?(\\w+)[\\s\\S]*\\bdo\\s*\\|(\\w+)\\|\\s*$`).exec(code);
    if (fields) {
      const previous = scope.form;
      scope.form = { var: fields[2], model: previous.model ? `${previous.model}.${fields[1]}` : fields[1] };
      lowerChildren(node.children);
      scope.form = previous;
      return "";
    }
    const block = /^(.*?)\.each(?:_with_index)?\s+do\s*\|([^|]*)\|\s*$/.exec(code);
    if (block) return eachLoop(block[1], block[2], node, /each_with_index/.test(code));
    const postfix = splitPostfix(code);
    if (postfix) {
      const t = postfix.kind === "if" ? rubyToJs(postfix.test, scope) : `!(${rubyToJs(postfix.test, scope)})`;
      out.push(`<ng-container ng-if="${attrSafe(t)}">`);
      scope.depth += 1; const inner = expression(postfix.body, html, node, depthNow); scope.depth -= 1;
      if (inner) out.push(inner);
      out.push("</ng-container>");
      return "";
    }
    const doBlock = /^(\w+)\b([\s\S]*?)\s+do\s*(?:\|[^|]*\|)?\s*$/.exec(code);
    if (doBlock) {
      const name = doBlock[1];
      const args = splitCommas(doBlock[2], { ticks: false }).map((a) => a.trim()).filter(Boolean);
      if (name === "link_to" || name === "button_to") {
        const href = args[0] !== undefined ? rubyToJs(args[0], scope) : "'#'";
        out.push(`<a ng-href="{{ ${attrSafe(href)} }}">`); lowerChildren(node.children); out.push("</a>");
        return "";
      }
      if (name === "content_tag") {
        const tag = (args[0] ?? "'div'").replace(/^:|['"]/g, "");
        out.push(`<${tag}>`); lowerChildren(node.children); out.push(`</${tag}>`);
        return "";
      }
      scope.note(`\`= ${code.slice(0, 40)}\` wrapped its block in a helper this reader does not know; the block stands and the helper is not in the port.`);
      lowerChildren(node.children);
      return "";
    }
    scope.markup = null; scope.render = null; scope.html = false;
    const js = rubyToJs(code, scope);
    if (scope.render) return renderCall(scope.render, node, depthNow);
    if (scope.markup) return scope.markup;
    if (html || scope.html) return `<span ng-bind-html="${attrSafe(js)}"></span>`;
    if (/^'[^']*'$/.test(js)) return js.slice(1, -1);
    return `{{ ${js} }}`;
  };

  const formField = (kind, args) => {
    const f = scope.form;
    const name = (args[0] ?? "''").replace(/^:|['"]/g, "");
    const bind = f.model ? `${f.model}.${name}` : name;
    const attrName = f.model ? `${f.model}[${name}]` : name;
    scope.twoWay = true;
    switch (kind) {
      case "label": return `<label for="${f.model ? `${f.model}_${name}` : name}">${args[1] ? rubyToJs(args[1], scope).replace(/^'|'$/g, "") : pascal(name)}</label>`;
      case "text_area": return `<textarea name="${attrName}" id="${f.model ? `${f.model}_${name}` : name}" ng-model="${attrSafe(bind)}"></textarea>`;
      case "select": case "collection_select": { const list = args[1] ? rubyToJs(args[1], scope) : "[]"; return `<select name="${attrName}" id="${f.model ? `${f.model}_${name}` : name}" ng-model="${attrSafe(bind)}"><option ng-repeat="o in ${attrSafe(list)}" ng-attr-value="{{ ${kind === "collection_select" && args[2] ? `o.${args[2].replace(/^:/, "")}` : "o"} }}">{{ ${kind === "collection_select" && args[3] ? `o.${args[3].replace(/^:/, "")}` : "o"} }}</option></select>`; }
      case "submit": return `<input type="submit"${args[0] ? ` value="${rubyToJs(args[0], scope).replace(/^'|'$/g, "")}"` : ""}>`;
      case "button": return `<button type="submit">${args[0] ? rubyToJs(args[0], scope).replace(/^'|'$/g, "") : "Save"}</button>`;
      case "check_box": return `<input type="checkbox" name="${attrName}" id="${f.model ? `${f.model}_${name}` : name}" ng-model="${attrSafe(bind)}">`;
      case "radio_button": return `<input type="radio" name="${attrName}" ng-attr-value="{{ ${args[1] ? rubyToJs(args[1], scope) : "''"} }}" ng-model="${attrSafe(bind)}">`;
      case "hidden_field": return `<input type="hidden" name="${attrName}" ng-model="${attrSafe(bind)}">`;
      case "file_field": return `<input type="file" name="${attrName}">`;
      default: { const type = { text_field: "text", email_field: "email", password_field: "password", number_field: "number", search_field: "search", url_field: "url", telephone_field: "tel", phone_field: "tel", date_field: "date" }[kind] ?? "text"; return `<input type="${type}" name="${attrName}" id="${f.model ? `${f.model}_${name}` : name}" ng-model="${attrSafe(bind)}">`; }
    }
  };

  const eachLoop = (recv, vars, node, withIndex) => {
    const names = vars.split(",").map((v) => v.trim()).filter(Boolean);
    const list = rubyToJs(recv, scope);
    const item = names[0] ?? "item";
    const index = withIndex ? names[1] : null;
    const pair = !withIndex && names.length === 2;
    if (index) scope.aliases.set(index, "$index");
    out.push(`<ng-container ng-repeat="${attrSafe(pair ? `(${names[0]}, ${names[1]}) in ${list}` : `${item} in ${list}${index ? " track by $index" : ""}`)}">`);
    scope.depth += 1; lowerChildren(node.children); scope.depth -= 1;
    if (index) scope.aliases.delete(index);
    out.push("</ng-container>");
    return "";
  };

  const renderCall = (call, node, depthNow) => {
    if (call.name === "yield") { if (call.args.length) scope.note(`yield ${call.args[0]} took a block a page handed it with content_for; that content is not in the port.`); else out.push(scope.yieldMarker ?? ""); return ""; }
    const first = call.args[0] ?? "";
    const named = /partial:\s*(['"][^'"]+['"])/.exec(call.args.join(",")) ?? /:partial\s*=>\s*(['"][^'"]+['"])/.exec(call.args.join(","));
    const name = (named ? named[1] : first).replace(/^['"]|['"]$/g, "");
    if (!/^['"]/.test(named ? named[1] : first)) { scope.note(`render ${first.slice(0, 40)} chose its partial at render time; the port must render it itself.`); return ""; }
    if (/locals:|:locals/.test(call.args.join(","))) scope.note(`render "${name}" passed locals into the partial; the port reads them from the same scope.`);
    if (depthNow >= 6) { scope.note(`render "${name}" renders deeper than this reader follows; a partial that renders itself stops here.`); return ""; }
    const answer = resolve(name, scope.dir);
    const found = typeof answer === "string" ? { body: answer } : answer;
    if (found == null) { scope.note(`render "${name}" names a partial this run does not hold; the page stands without it.`); return ""; }
    const previousDir = scope.dir;
    scope.dir = found.dir ?? previousDir;
    out.push(lowerTree(grammar.parseTree(found.body), scope, resolve, depthNow + 1, grammar));
    scope.dir = previousDir;
    return "";
  };

  /** if, elsif, else, unless, case and when as the containers they mean. */
  const control = (code, node, siblings, getIdx, setIdx, depthNow) => {
    const iff = /^(if|unless)\s+([\s\S]+)$/.exec(code);
    if (iff) {
      const tests = [];
      let test = iff[1] === "if" ? rubyToJs(iff[2], scope) : `!(${rubyToJs(iff[2], scope)})`;
      tests.push(test);
      scope.depth += 1;
      out.push(`<ng-container ng-if="${attrSafe(test)}">`); lowerChildren(node.children); out.push("</ng-container>");
      let idx = getIdx();
      while (siblings[idx + 1] && /^-\s*(elsif\b|else\s*$)/.test(siblings[idx + 1].line)) {
        idx += 1; setIdx(idx); const sib = siblings[idx];
        const own = /^-\s*elsif\s+([\s\S]+)$/.exec(sib.line)?.[1];
        const nots = tests.map((c) => `!(${c})`);
        const t = own ? [...nots, `(${rubyToJs(own, scope)})`].join(" && ") : nots.join(" && ");
        if (own) tests.push(rubyToJs(own, scope));
        out.push(`<ng-container ng-if="${attrSafe(t)}">`); lowerChildren(sib.children); out.push("</ng-container>");
      }
      scope.depth -= 1;
      return true;
    }
    const each = /^(.*?)\.each(?:_with_index)?\s+do\s*\|([^|]*)\|\s*$/.exec(code);
    if (each) { eachLoop(each[1], each[2], node, /each_with_index/.test(code)); return true; }
    const forIn = /^for\s+(\w+)\s+in\s+([\s\S]+?)(?:\s+do)?\s*$/.exec(code);
    if (forIn) { eachLoop(forIn[2], forIn[1], node, false); return true; }
    const cas = /^case\s+([\s\S]+)$/.exec(code);
    if (cas) {
      // The when lines stand at the case's own indent, as Haml writes them; each body is indented under its when.
      const subject = rubyToJs(cas[1], scope); const tried = [];
      scope.depth += 1;
      let idx = getIdx();
      const arms = [...node.children];
      while (siblings[idx + 1] && /^-\s*(when\b|else\s*$)/.test(siblings[idx + 1].line)) { idx += 1; setIdx(idx); arms.push(siblings[idx]); }
      for (const w of arms) {
        const wm = /^-\s*when\s+([\s\S]+)$/.exec(w.line);
        if (wm) { const t = splitCommas(wm[1], { ticks: false }).map((v) => `(${subject}) == ${rubyToJs(v.trim(), scope)}`).join(" || "); tried.push(t); out.push(`<ng-container ng-if="${attrSafe(t)}">`); lowerChildren(w.children); out.push("</ng-container>"); }
        else if (/^-\s*else\s*$/.test(w.line)) { out.push(`<ng-container ng-if="${attrSafe(tried.map((c) => `!(${c})`).join(" && ") || "true")}">`); lowerChildren(w.children); out.push("</ng-container>"); }
      }
      scope.depth -= 1;
      return true;
    }
    if (/^(elsif|else|when)\b/.test(code)) return true;
    return false;
  };

  // Root siblings stand on their own lines; a chain is one statement.
  lowerChildren(root.children, depth === 0);
  return out.join("").split("\u0000NL\u0000").filter(Boolean).join("\n");
}

/** A Rails view reader for one indentation dialect: the layout composed, partials resolved, screens pushed. */
export function railsReader({ name, extension, grammar, readBy, origin, label }) {
  const ext = new RegExp(`\\.${extension}$`, "i");
  const bareExt = new RegExp(`\\.html\\.${extension}$|\\.${extension}$`, "i");
  return {
    name,
    version: "0.1.0",
    class: "input",
    setup({ on, log }) {
      on("extract", async (ctx) => {
        const files = ctx.sources.files.filter((f) => ext.test(f.rel));
        if (!files.length) return log.debug(`no ${label} templates`);
        const notes = [];
        const note = (t) => { if (!notes.includes(t)) notes.push(t); };
        const bodies = new Map();
        for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => { note(`${f.rel} could not be read; it is not in the port.`); return ""; }));
        const bare = (n) => String(n).replace(/^(\.\.?\/)+/, "").replace(/^(?:app\/)?views\//, "").replace(bareExt, "");
        const keys = [...bodies.keys()];
        // A partial is asked for as "shared/nav" and lives at shared/_nav; a bare "form" lives beside the view that renders it.
        const resolve = (n, dir = "") => {
          const parts = bare(n).split("/");
          const underscored = [...parts.slice(0, -1), `_${parts[parts.length - 1]}`].join("/");
          const beside = parts.length === 1 && dir ? keys.find((k) => bare(k) === `${dir}/${underscored}`) : null;
          const k = beside ?? resolveTemplate(keys, underscored, bare) ?? resolveTemplate(keys, n, bare);
          return k ? { body: bodies.get(k), dir: bare(k).split("/").slice(0, -1).join("/") } : null;
        };
        const layoutKey = keys.find((k) => new RegExp(`(^|/)layouts/application\\.html\\.${extension}$`).test(k));
        let count = 0;
        for (const [key, text] of bodies) {
          if (/(^|\/)layouts\//.test(key)) { note(`${key} is a layout the pages render inside; it is composed into each of them rather than ported as a screen of its own.`); continue; }
          const file = files.find((f) => f.rel.replace(/^\.\//, "") === key);
          const scope = freshScope(note);
          scope.dir = bare(key).split("/").slice(0, -1).join("/");
          let template = lowerTree(grammar.parseTree(text), scope, resolve, 0, grammar);
          const partial = /(^|\/)_[^/]+$/.test(key);
          if (layoutKey && !partial) {
            const layoutScope = freshScope(note);
            layoutScope.yieldMarker = "\u0000PAGE\u0000";
            layoutScope.aliases = scope.aliases;
            layoutScope.dir = bare(layoutKey).split("/").slice(0, -1).join("/");
            const shell = lowerTree(grammar.parseTree(bodies.get(layoutKey)), layoutScope, resolve, 0, grammar);
            template = shell.includes("\u0000PAGE\u0000") ? shell.replace("\u0000PAGE\u0000", () => template) : template;
            if (layoutScope.twoWay) scope.twoWay = true;
          }
          const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(template);
          if (body) template = body[1];
          template = template.trim();
          if (!template) continue;
          const selector = (bare(key).replace(/(^|\/)_/g, "$1") || "page").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
          ctx.screens.push({
            selector,
            className: pascal(selector),
            file: file?.rel ?? key,
            inputs: readInputs(template),
            outputs: [],
            template,
            templateOrigin: layoutKey && !partial ? `${origin}, composed into its layout and lowered` : `${origin}, lowered`,
            usesNgIf: /ng-if/.test(template),
            usesNgFor: /ng-repeat/.test(template),
            usesTwoWay: Boolean(scope.twoWay),
            rxjs: [],
            readBy,
          });
          count += 1;
        }
        for (const n of notes) ctx.unverified(n);
        log.info(`${count} ${label} template(s) lowered onto the dialect`);
      });
    },
  };
}

export default railsReader({ name: "input-haml", extension: "haml", grammar: HAML, readBy: "haml", origin: "a Haml template", label: "Haml" });
