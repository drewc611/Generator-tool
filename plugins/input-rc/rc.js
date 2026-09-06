/**
 * A Windows resource script, read structurally. The .rc is the source form of
 * what pe.js reads from a compiled executable: the same dialog templates,
 * menus, string table and version block, written as statements by Visual C++
 * and by hand. rc.exe turns the names into numbers through resource.h and the
 * SDK headers; this reader does the same through the header beside the script
 * and a table of the published constants, and where a name is in neither it
 * keeps the name and says so.
 *
 * The scanner is line oriented the way the format is: comments and strings
 * are read with one pass that knows both (a // inside "http://" is text, a
 * quote inside a comment is not), directives are handled before statements
 * are, a statement continues onto the next line after a trailing comma or bar,
 * and BEGIN and END nest. Nothing here evaluates a condition it cannot: an
 * #if on a name the script does not define is named, not decided.
 */
import { matchBracket } from "../dsp-ir/text.js";
import { CLASS_ATOMS, CONTROL_DEFAULTS, DIALOG_DEFAULT_STYLE, STANDARD_IDS, STYLE_BITS, VIRTUAL_KEYS, WS_CHILD, WS_VISIBLE } from "./styles.js";

/** The names the compiler defines or leaves undefined for every build rc.exe runs in; APSTUDIO_INVOKED is the editor's alone. */
const KNOWN = { APSTUDIO_INVOKED: false, RC_INVOKED: true, _WIN32: true, WIN32: true };

/**
 * Comments blanked to spaces so every offset and line number survives. A string is skipped whole, its "" doubling
 * and \ escapes included, because a comment marker inside one is text.
 */
export function stripComments(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") { out += " "; i += 1; }
    } else if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else { out += c; i += 1; }
  }
  return out;
}

/** The index just past the closing quote of the string opening at `at`, or the end of the text when it never closes. */
function stringEnd(text, at) {
  let i = at + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") { i += 2; continue; }
    if (c === '"') { if (text[i + 1] === '"') { i += 2; continue; } return i + 1; }
    i += 1;
  }
  return text.length;
}

/** The characters a string literal spells: "" is one quote, and the C escapes rc.exe honours are decoded. */
function decodeString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c === '"') { if (raw[i + 1] === '"') { out += '"'; i += 1; } continue; }
    if (c !== "\\") { out += c; continue; }
    const n = raw[i + 1];
    i += 1;
    if (n === undefined) { out += "\\"; break; }
    if (n === "t") out += "\t";
    else if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "a") out += "\x07";
    else if (n === "x") { const m = /^[0-9a-fA-F]{1,4}/.exec(raw.slice(i + 1)); if (m) { out += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length; } else out += "x"; }
    else if (/[0-7]/.test(n)) { const m = /^[0-7]{1,3}/.exec(raw.slice(i)); out += String.fromCharCode(parseInt(m[0], 8)); i += m[0].length - 1; }
    else out += n;
  }
  return out;
}

/**
 * Directives applied, one logical line per source line kept. Returns the lines that survive the conditionals, the
 * files named by #include, the #define table in order, and every condition the reader could not decide.
 */
export function preprocess(text, { defines: inherited = [] } = {}) {
  const lines = stripComments(text).split(/\r?\n/);
  const out = [];
  const includes = [];
  const defines = [...inherited];
  const defined = new Set(inherited.map(([name]) => name));
  // A name the script itself takes back is known to be undefined; one it never mentions is not known either way.
  const undefined_ = new Set();
  const unevaluated = [];
  const problems = [];
  // Each open conditional: whether its current branch is live, whether a branch has already been taken, and whether
  // the reader decided it or merely took the first branch.
  const stack = [];
  const live = () => stack.every((f) => f.live);
  const isDefined = (name) => (name in KNOWN ? KNOWN[name] : defined.has(name) ? true : undefined_.has(name) ? false : null);
  const open = (truth, n, source) => {
    const parentLive = live();
    const frame = { live: parentLive && truth !== false, taken: truth !== false, parentLive, decided: truth !== null, n, source, elseSkipped: false };
    if (truth === null) unevaluated.push(frame);
    stack.push(frame);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const n = i + 1;
    let line = lines[i];
    // A directive continued with a trailing backslash is one directive.
    while (/^\s*#/.test(line) && /\\\s*$/.test(line) && i + 1 < lines.length) { i += 1; line = line.replace(/\\\s*$/, " ") + lines[i]; }
    const d = /^\s*#\s*(\w+)\s*(.*?)\s*$/.exec(line);
    if (!d) { if (live()) out.push({ text: line, n }); continue; }
    const [, word, rest] = d;
    switch (word) {
      case "ifdef": open(isDefined(rest), n, line.trim()); break;
      case "ifndef": { const t = isDefined(rest); open(t === null ? null : !t, n, line.trim()); break; }
      case "if": open(evaluate(rest, isDefined), n, line.trim()); break;
      case "elif": {
        const f = stack.at(-1);
        if (!f) { problems.push(`line ${n}: #elif with no #if`); break; }
        if (f.taken) { f.live = false; break; }
        const t = evaluate(rest, isDefined);
        if (t === null && f.decided) { f.decided = false; unevaluated.push({ ...f, n, source: line.trim() }); }
        f.live = f.parentLive && t !== false; f.taken = t !== false;
        break;
      }
      case "else": {
        const f = stack.at(-1);
        if (!f) { problems.push(`line ${n}: #else with no #if`); break; }
        if (!f.decided && f.taken) f.elseSkipped = true;
        f.live = f.parentLive && !f.taken; f.taken = true;
        break;
      }
      case "endif": if (stack.length) stack.pop(); else problems.push(`line ${n}: #endif with no #if`); break;
      case "include": if (live()) { const m = /^["<]([^">]+)[">]/.exec(rest); if (m) includes.push({ file: m[1], n }); } break;
      case "define": if (live()) { const m = /^(\w+)(?:\s+(.*))?$/.exec(rest); if (m) { defines.push([m[1], m[2] ?? ""]); defined.add(m[1]); undefined_.delete(m[1]); } } break;
      case "undef": if (live()) { defined.delete(rest); undefined_.add(rest); } break;
      default: break;
    }
  }
  if (stack.length) problems.push(`${stack.length} conditional(s) never reach #endif`);
  return { lines: out, includes, defines, unevaluated, problems };
}

/**
 * An #if expression over defined(X), names, numbers, !, && and ||, or null the moment it meets a name whose truth the
 * reader does not know. Both sides of every operator are read, so a name after a true || is still checked.
 */
function evaluate(expr, isDefined) {
  let unknown = false;
  const truth = (name) => { const t = isDefined(name); if (t === null) unknown = true; return t ? "1" : "0"; };
  const src = expr.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (m, a, b) => truth(a ?? b)).replace(/\b[A-Za-z_]\w*\b/g, (name) => truth(name));
  if (unknown || /[^\d!&|()\s]/.test(src)) return null;
  const tokens = src.match(/\d+|&&|\|\||[!()]/g) ?? [];
  let i = 0;
  const or = () => { let v = and(); while (tokens[i] === "||") { i += 1; const r = and(); v = v || r; } return v; };
  const and = () => { let v = not(); while (tokens[i] === "&&") { i += 1; const r = not(); v = v && r; } return v; };
  const not = () => {
    if (tokens[i] === "!") { i += 1; return !not(); }
    if (tokens[i] === "(") { i += 1; const v = or(); i += 1; return v; }
    return Number(tokens[i++] ?? 0) !== 0;
  };
  return tokens.length ? or() : null;
}

/** One line's tokens: identifiers, numbers, decoded strings and single character punctuation. */
function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '"' || (c === "L" && text[i + 1] === '"')) {
      const at = c === "L" ? i + 1 : i;
      const end = stringEnd(text, at);
      out.push({ t: "str", v: decodeString(text.slice(at + 1, end - 1)), raw: text.slice(at, end) });
      i = end;
      continue;
    }
    const num = /^(0[xX][0-9a-fA-F]+|\d+)[lL]?/.exec(text.slice(i));
    if (num) { out.push({ t: "num", v: Number(num[1]), raw: num[0] }); i += num[0].length; continue; }
    const id = /^[A-Za-z_]\w*/.exec(text.slice(i));
    if (id) { out.push({ t: "id", v: id[0], raw: id[0] }); i += id[0].length; continue; }
    out.push({ t: "op", v: c, raw: c });
    i += 1;
  }
  return out;
}

const upper = (tok) => (tok && tok.t === "id" ? tok.v.toUpperCase() : tok?.t === "op" ? tok.v : null);
const raw = (tokens) => tokens.map((t) => t.raw).join(" ");

/** Lines joined into statements: a line ending in a comma or a bar, or followed by one starting with either, continues. */
function statements(lines) {
  const out = [];
  const tokenized = lines.map((l) => ({ tokens: tokenize(l.text), n: l.n })).filter((l) => l.tokens.length);
  let cur = null;
  for (let i = 0; i < tokenized.length; i += 1) {
    const l = tokenized[i];
    if (cur) cur.tokens.push(...l.tokens); else cur = { tokens: [...l.tokens], n: l.n };
    const last = upper(cur.tokens.at(-1));
    const nextFirst = upper(tokenized[i + 1]?.tokens[0]);
    if (last === "," || last === "|" || nextFirst === "|" || nextFirst === ",") continue;
    out.push(cur);
    cur = null;
  }
  if (cur) out.push(cur);
  return out;
}

/** Statements as a tree: a BEGIN (or {) hangs its block on the statement before it; END (or }) closes it. */
function nest(stmts, problems) {
  const root = [];
  const stack = [root];
  for (const s of stmts) {
    const word = upper(s.tokens[0]);
    if (s.tokens.length === 1 && (word === "BEGIN" || word === "{")) {
      const owner = stack.at(-1).at(-1);
      const children = [];
      if (owner && !owner.children) owner.children = children;
      else stack.at(-1).push({ tokens: [], n: s.n, children });
      stack.push(children);
    } else if (s.tokens.length === 1 && (word === "END" || word === "}")) {
      if (stack.length > 1) stack.pop(); else problems.push(`line ${s.n}: END with no BEGIN`);
    } else stack.at(-1).push(s);
  }
  if (stack.length > 1) problems.push(`${stack.length - 1} BEGIN(s) never reach END`);
  return root;
}

/** Top level commas split, each argument its own token list. */
function args(tokens) {
  const out = [];
  let cur = [];
  for (const t of tokens) {
    if (t.t === "op" && t.v === ",") { out.push(cur); cur = []; } else cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

const MEMORY = new Set(["DISCARDABLE", "PRELOAD", "LOADONCALL", "FIXED", "MOVEABLE", "PURE", "IMPURE", "SHARED", "NONSHARED"]);
const OPTIONS = new Set(["STYLE", "EXSTYLE", "CAPTION", "FONT", "MENU", "CLASS", "LANGUAGE", "CHARACTERISTICS", "VERSION", "FILEVERSION", "PRODUCTVERSION", "FILEFLAGSMASK", "FILEFLAGS", "FILEOS", "FILETYPE", "FILESUBTYPE"]);
const SKIPPED_TYPES = new Set(["TEXTINCLUDE", "DESIGNINFO", "GUIDELINES"]);
const IMAGE_TYPES = new Set(["ICON", "BITMAP", "CURSOR"]);

/** A numeric expression: a literal, a name in the table, parentheses, or a sum or difference of those; null otherwise. */
export function numeric(text, symbols) {
  let s = String(text).trim();
  while (s.startsWith("(") && matchBracket(s, 0, { strings: false }) === s.length) s = s.slice(1, -1).trim();
  const lit = /^(-?)\s*(0x[0-9a-f]+|\d+)L?$/i.exec(s);
  if (lit) return (lit[1] ? -1 : 1) * Number(lit[2]);
  if (/^[A-Za-z_]\w*$/.test(s)) return symbols.has(s) ? symbols.get(s) : null;
  // The last top level + or - splits the expression; a leading sign is not an operator.
  let depth = 0;
  for (let i = s.length - 1; i > 0; i -= 1) {
    const c = s[i];
    if (c === ")") depth += 1; else if (c === "(") depth -= 1;
    else if (depth === 0 && (c === "+" || c === "-") && !/[+\-(]\s*$/.test(s.slice(0, i))) {
      const l = numeric(s.slice(0, i), symbols); const r = numeric(s.slice(i + 1), symbols);
      return l === null || r === null ? null : c === "+" ? l + r : l - r;
    }
  }
  return null;
}

/**
 * The #define table read as numbers: the SDK's standard ids first, then the headers in the order they were named,
 * then the script's own, so a project's redefinition of an afxres command wins over the SDK's. A define whose value
 * is not a number, or names one that never resolves, is not an id and is left out.
 */
export function buildSymbols(defineLists) {
  const symbols = new Map(Object.entries(STANDARD_IDS));
  let pending = defineLists.flat();
  for (let pass = 0; pass < 4 && pending.length; pass += 1) {
    const next = [];
    for (const [name, value] of pending) {
      const v = numeric(value, symbols);
      if (v === null) next.push([name, value]); else symbols.set(name, v === -1 ? 65535 : v);
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  return symbols;
}

/** The #define table of a header, every conditional the editor guards skipped the way rc.exe skips it. */
export function readHeader(text) {
  return preprocess(text).defines;
}

/** A style expression evaluated left to right over a base: a name or number ORs in, NOT clears; an unknown name is reported. */
function styleOf(tokens, base, symbols, unknown) {
  let value = base;
  let negate = false;
  const apply = (bits) => { value = negate ? (value & ~bits) >>> 0 : (value | bits) >>> 0; negate = false; };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.t === "op" && (t.v === "|" || t.v === "+")) continue;
    if (t.t === "id" && t.v.toUpperCase() === "NOT") { negate = true; continue; }
    if (t.t === "num") { apply(t.v); continue; }
    if (t.t === "op" && t.v === "(") {
      let depth = 0; let j = i;
      for (; j < tokens.length; j += 1) { if (tokens[j].v === "(") depth += 1; else if (tokens[j].v === ")") { depth -= 1; if (!depth) break; } }
      apply(styleOf(tokens.slice(i + 1, j), 0, symbols, unknown));
      i = j;
      continue;
    }
    if (t.t === "id") {
      if (t.v in STYLE_BITS) apply(STYLE_BITS[t.v]);
      else if (symbols.has(t.v)) apply(symbols.get(t.v));
      else { unknown.add(t.v); negate = false; }
      continue;
    }
  }
  return value >>> 0;
}

/** A dialog's font statement: FONT size, "face" [, weight, italic, charset]. */
function fontOf(tokens, ex) {
  const a = args(tokens);
  const font = { size: a[0]?.[0]?.v ?? 8, face: a[1]?.[0]?.v ?? "" };
  if (ex) { font.weight = a[2]?.[0]?.t === "num" ? a[2][0].v : 0; font.italic = a[3]?.[0]?.t === "num" ? a[3][0].v !== 0 : false; }
  return font;
}

/** Everything one resource script declares, the ids resolved through the symbols given. */
export function readScript(text, { headers = [], inherited = [] } = {}) {
  const pre = preprocess(text, { defines: inherited });
  const symbols = buildSymbols([...headers, pre.defines]);
  const problems = [...pre.problems];
  const unresolved = new Set();
  const unknownStyles = new Set();
  const out = {
    dialogs: [], menus: [], strings: [], accelerators: [], images: [], others: [], version: {}, fixedVersion: {},
    includes: pre.includes, unevaluated: pre.unevaluated.map((f) => ({ n: f.n, source: f.source, elseSkipped: f.elseSkipped })),
    defines: pre.defines, symbols, problems, unresolved, unknownStyles,
  };

  /** A control or resource id: the number it resolves to, or the name kept when it does not. */
  const idOf = (tokens, n) => {
    if (!tokens || !tokens.length) return null;
    const v = numeric(raw(tokens), symbols);
    if (v !== null) return v === -1 ? 65535 : v;
    if (tokens.length === 1 && tokens[0].t === "id") { unresolved.add(tokens[0].v); return tokens[0].v; }
    problems.push(`line ${n}: the id \`${raw(tokens)}\` could not be read as a number or a name`);
    return raw(tokens);
  };
  const num = (tokens, n, what) => {
    if (!tokens || !tokens.length) return 0;
    const v = numeric(raw(tokens), symbols);
    if (v === null) { problems.push(`line ${n}: ${what} \`${raw(tokens)}\` is not a number the reader knows; 0 stands in`); return 0; }
    return v;
  };
  const text1 = (tokens) => tokens.filter((t) => t.t === "str").map((t) => t.v).join("");
  /** A resource's name as written, and the id it stands for: a quoted name is its own id and is never unresolved. */
  const nameOf = (tok) => (tok.t === "str" ? tok.v : tok.raw);
  const resourceId = (tok, n) => (tok.t === "str" ? tok.v : idOf([tok], n));

  const readControl = (node, ex) => {
    const kw = upper(node.tokens[0]);
    const a = args(node.tokens.slice(1));
    const c = { helpId: 0, exStyle: 0, style: 0, x: 0, y: 0, cx: 0, cy: 0, id: null, className: "", caption: "", captionOrdinal: null, name: null, line: node.n, styles: "" };
    const finish = (idTokens, styleTokens, exTokens, helpTokens, base) => {
      c.name = idTokens?.length === 1 && idTokens[0].t === "id" ? idTokens[0].v : null;
      c.id = idOf(idTokens, node.n);
      c.styles = styleTokens ? raw(styleTokens) : "";
      c.style = styleOf(styleTokens ?? [], (base | WS_CHILD | WS_VISIBLE) >>> 0, symbols, unknownStyles);
      c.exStyle = exTokens?.length ? styleOf(exTokens, 0, symbols, unknownStyles) : 0;
      if (ex && helpTokens?.length) c.helpId = num(helpTokens, node.n, "a help id");
      return c;
    };
    if (kw === "CONTROL") {
      if (a.length < 8) { problems.push(`line ${node.n}: CONTROL has ${a.length} argument(s) where eight are needed; skipped`); return null; }
      c.caption = text1(a[0]);
      const klass = a[2][0];
      c.className = klass?.t === "str" ? (CLASS_ATOMS[klass.v.toUpperCase()] ?? klass.v) : (CLASS_ATOMS[upper(klass)] ?? raw(a[2]));
      [c.x, c.y, c.cx, c.cy] = a.slice(4, 8).map((t, i) => num(t, node.n, ["x", "y", "width", "height"][i]));
      return finish(a[1], a[3], a[8], a[9], 0);
    }
    const def = CONTROL_DEFAULTS[kw];
    if (!def) { problems.push(`line ${node.n}: \`${kw}\` is not a control statement this reader knows; skipped`); return null; }
    c.className = def.className;
    let rest = a;
    if (def.text) {
      const first = a[0] ?? [];
      // ICON names its image by id rather than by caption; the name is kept as the caption so the placeholder can say it.
      if (kw === "ICON" && first[0]?.t !== "str") { c.caption = raw(first); const o = numeric(raw(first), symbols); c.captionOrdinal = o; }
      else c.caption = text1(first);
      rest = a.slice(1);
    }
    const need = def.sizeOptional ? 3 : 5;
    if (rest.length < need) { problems.push(`line ${node.n}: ${kw} has ${rest.length} argument(s) after its text where ${need} are needed; skipped`); return null; }
    c.x = num(rest[1], node.n, "x"); c.y = num(rest[2], node.n, "y");
    c.cx = rest[3] ? num(rest[3], node.n, "width") : 0; c.cy = rest[4] ? num(rest[4], node.n, "height") : 0;
    return finish(rest[0], rest[5], rest[6], rest[7], def.style);
  };

  const readDialog = (first, type, header, options, body, line) => {
    const ex = type === "DIALOGEX";
    const a = args(header);
    const d = {
      name: nameOf(first), id: resourceId(first, line), ex, title: "", style: DIALOG_DEFAULT_STYLE, exStyle: 0, helpId: 0,
      x: num(a[0], line, "x"), y: num(a[1], line, "y"), cx: num(a[2], line, "width"), cy: num(a[3], line, "height"),
      menu: null, windowClass: null, font: null, controls: [], line, styles: "",
    };
    if (ex && a[4]) d.helpId = num(a[4], line, "a help id");
    let styled = false;
    for (const o of options) {
      const kw = upper(o.tokens[0]);
      const rest = o.tokens.slice(1);
      if (kw === "STYLE") { d.style = styleOf(rest, 0, symbols, unknownStyles); d.styles = raw(rest); styled = true; }
      else if (kw === "EXSTYLE") d.exStyle = styleOf(rest, 0, symbols, unknownStyles);
      else if (kw === "CAPTION") d.title = text1(rest);
      else if (kw === "FONT") d.font = fontOf(rest, ex);
      else if (kw === "MENU") d.menu = rest[0]?.t === "str" ? rest[0].v : idOf(rest, o.n);
      else if (kw === "CLASS") d.windowClass = rest[0]?.t === "str" ? rest[0].v : idOf(rest, o.n);
    }
    // rc.exe sets DS_SETFONT itself when a FONT statement is present; a template without the bit carries no font block.
    if (d.font) d.style = (d.style | STYLE_BITS.DS_SETFONT) >>> 0;
    if (!styled) d.styles = "(default)";
    for (const node of body) { const c = readControl(node, ex); if (c) d.controls.push(c); }
    out.dialogs.push(d);
  };

  /** MENUEX spells type and state as numbers or MFT_/MFS_ names; MENU spells them as flag words after the id. */
  const menuFlags = (lists, ex, item) => {
    if (ex) {
      const type = lists[0]?.length ? styleOf(lists[0], 0, symbols, unknownStyles) : 0;
      const state = lists[1]?.length ? styleOf(lists[1], 0, symbols, unknownStyles) : 0;
      if (type & STYLE_BITS.MFT_SEPARATOR) item.separator = true;
      item.disabled = Boolean(state & 0x3); item.checked = Boolean(state & 0x8);
      return;
    }
    for (const list of lists) {
      const f = upper(list[0]);
      if (f === "GRAYED" || f === "INACTIVE") item.disabled = true;
      else if (f === "CHECKED") item.checked = true;
    }
  };

  const readMenuItems = (nodes, ex, menu, depth) => {
    const list = [];
    for (const node of nodes) {
      const kw = upper(node.tokens[0]);
      const a = args(node.tokens.slice(1));
      if (kw === "POPUP") {
        const item = { text: text1(a[0] ?? []), id: ex ? (a[1]?.length ? idOf(a[1], node.n) : 0) : null, disabled: false, checked: false };
        menuFlags(ex ? a.slice(2) : a.slice(1), ex, item);
        item.children = readMenuItems(node.children ?? [], ex, menu, depth + 1);
        if (!node.children) problems.push(`line ${node.n}: POPUP "${item.text}" has no BEGIN block`);
        list.push(item);
      } else if (kw === "MENUITEM") {
        if (upper(a[0]?.[0]) === "SEPARATOR") { list.push({ text: "", id: 0, disabled: false, checked: false, separator: true }); continue; }
        const full = text1(a[0] ?? []);
        const tab = full.indexOf("\t");
        const item = { text: tab === -1 ? full : full.slice(0, tab), id: a[1]?.length ? idOf(a[1], node.n) : 0, disabled: false, checked: false };
        item.name = a[1]?.length === 1 && a[1][0].t === "id" ? a[1][0].v : null;
        if (tab !== -1) menu.accelerators.push({ item: item.text, key: full.slice(tab + 1).trim() });
        menuFlags(a.slice(2), ex, item);
        list.push(item);
      } else problems.push(`line ${node.n}: \`${kw}\` is not a menu statement; skipped`);
    }
    return list;
  };

  const readVersion = (options, body) => {
    for (const o of options) {
      const kw = upper(o.tokens[0]);
      if (kw === "FILEVERSION" || kw === "PRODUCTVERSION") out.fixedVersion[kw] = args(o.tokens.slice(1)).map((t) => num(t, o.n, kw)).join(".");
    }
    const walk = (nodes) => {
      for (const node of nodes) {
        const kw = upper(node.tokens[0]);
        const a = args(node.tokens.slice(1));
        if (kw === "VALUE" && a[0]?.[0]?.t === "str" && a[1]?.[0]?.t === "str") out.version[a[0][0].v] = text1(a[1]);
        if (node.children) walk(node.children);
      }
    };
    walk(body);
  };

  const readAccelerators = (first, body, line) => {
    const table = { name: nameOf(first), id: resourceId(first, line), entries: [], line };
    for (const node of body) {
      const a = args(node.tokens);
      if (a.length < 2) { problems.push(`line ${node.n}: an accelerator entry needs a key and a command`); continue; }
      const flags = new Set(a.slice(2).map((l) => upper(l[0])));
      const keyTok = a[0][0];
      let key = keyTok.t === "str" ? keyTok.v : keyTok.t === "id" ? VIRTUAL_KEYS[keyTok.v] ?? keyTok.v : String(keyTok.v);
      // "^O" is the ASCII spelling of Ctrl+O; the flags spell the rest.
      if (key.startsWith("^") && key.length === 2) { key = key.slice(1); flags.add("CONTROL"); }
      const mods = [flags.has("CONTROL") && "Ctrl", flags.has("ALT") && "Alt", flags.has("SHIFT") && "Shift"].filter(Boolean);
      table.entries.push({ key: [...mods, key].join("+"), command: a[1].length === 1 && a[1][0].t === "id" ? a[1][0].v : raw(a[1]), id: idOf(a[1], node.n) });
    }
    out.accelerators.push(table);
  };

  const nodes = nest(statements(pre.lines), problems);
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const first = node.tokens[0];
    if (!first) continue;
    const w0 = upper(first);
    if (w0 === "LANGUAGE") continue;
    // A resource header, the option lines that follow it, and the block that closes the last of them.
    const gather = () => {
      const options = [];
      let body = node.children ?? null;
      let j = i;
      while (!body && j + 1 < nodes.length && OPTIONS.has(upper(nodes[j + 1].tokens[0]))) { j += 1; options.push(nodes[j]); if (nodes[j].children) body = nodes[j].children; }
      i = j;
      return { options, body };
    };
    if (w0 === "STRINGTABLE") {
      const { body } = gather();
      for (const s of body ?? []) {
        const toks = s.tokens.filter((t) => !(t.t === "op" && t.v === ","));
        const idTokens = toks.filter((t) => t.t !== "str");
        const entry = { name: idTokens.length === 1 && idTokens[0].t === "id" ? idTokens[0].v : null, id: idOf(idTokens, s.n), text: text1(toks) };
        if (!toks.some((t) => t.t === "str")) problems.push(`line ${s.n}: a string table entry with no string; skipped`);
        else out.strings.push(entry);
      }
      continue;
    }
    const typeTok = node.tokens[1];
    const type = upper(typeTok);
    if (!type || typeTok.t !== "id") { problems.push(`line ${node.n}: \`${raw(node.tokens).slice(0, 60)}\` is not a resource statement this reader knows; skipped`); continue; }
    const name = nameOf(first);
    let k = 2;
    while (MEMORY.has(upper(node.tokens[k]))) k += 1;
    const header = node.tokens.slice(k);
    if (type === "DIALOG" || type === "DIALOGEX") { const { options, body } = gather(); readDialog(first, type, header, options, body ?? [], node.n); continue; }
    if (type === "MENU" || type === "MENUEX") {
      const { body } = gather();
      const menu = { name, id: resourceId(first, node.n), ex: type === "MENUEX", items: [], accelerators: [], line: node.n };
      menu.items = readMenuItems(body ?? [], menu.ex, menu, 0);
      out.menus.push(menu);
      continue;
    }
    if (type === "VERSIONINFO") { const { options, body } = gather(); readVersion(options, body ?? []); continue; }
    if (type === "ACCELERATORS") { const { body } = gather(); readAccelerators(first, body ?? [], node.n); continue; }
    if (SKIPPED_TYPES.has(type) || SKIPPED_TYPES.has(w0)) { gather(); continue; }
    const file = header.at(-1)?.t === "str" ? header.at(-1).v : null;
    if (IMAGE_TYPES.has(type) && file) { out.images.push({ kind: type.toLowerCase(), name, id: resourceId(first, node.n), file, line: node.n }); continue; }
    gather();
    out.others.push({ type, name, file, line: node.n });
  }
  return out;
}
