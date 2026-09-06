/**
 * FLTK's own FLUID `.fl` designer files: a brace nested, Tcl-like tree, not
 * XML and not line oriented macros, so neither the shared markup reader nor
 * a BMS-style line scanner fits. Every node in the file, a top level
 * `Function {}` wrapper and every widget inside it alike, has the same one
 * shape: a keyword, an optional name (a bareword, or a brace quoted group
 * when the name itself needs quoting, the way `Function`'s own `{make_
 * window()}` label does), a properties block of `key {value}` pairs and
 * bare flag words, and, only when the source actually wrote a second brace
 * group after the properties block, a nested children block holding more
 * nodes the same shape. That one grammar, read once here recursively, is
 * what makes a `Function` wrapper and an `Fl_Group` the same kind of node to
 * this parser: whether a class is a "container" is a rendering decision
 * lower.js makes, not something this reader has to know to find the tree.
 */

const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";

function skipWs(text, i) {
  while (i < text.length && isWs(text[i])) i += 1;
  return i;
}

function skipLine(text, i) {
  while (i < text.length && text[i] !== "\n") i += 1;
  return i + 1;
}

/** A bareword: everything up to the next whitespace or brace. Empty when the cursor already sits on one of those. */
function readBareword(text, i) {
  const start = i;
  while (i < text.length && !isWs(text[i]) && text[i] !== "{" && text[i] !== "}") i += 1;
  return { value: text.slice(start, i), next: i };
}

/**
 * The `{...}` group opening at `i`, brace matched with a backslash escape
 * kept literal (FLUID's own Tcl-like quoting), or null when it never closes.
 * The inner text is returned unescaped of nothing beyond that: a callback's
 * own C++ body is read as the plain text it is, not reinterpreted.
 */
function readBraceGroup(text, i) {
  if (text[i] !== "{") return null;
  let depth = 0;
  const start = i;
  for (; i < text.length; i += 1) {
    const c = text[i];
    if (c === "\\") { i += 1; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return { value: text.slice(start + 1, i), next: i + 1 }; }
  }
  return null;
}

/**
 * A properties block's own text split into `key {value}` pairs and the bare
 * flag words beside them (`open`, `visible`, `selected`): a flag is any
 * bareword not immediately followed, once whitespace including a newline is
 * skipped, by a `{`. That lookahead is safe because a real key's own value
 * brace always sits right after it; the next line's key name, when there is
 * one, is a letter, never `{`.
 */
function parseProps(text) {
  const props = {};
  const flags = [];
  let i = 0;
  while (i < text.length) {
    i = skipWs(text, i);
    if (i >= text.length) break;
    if (text[i] === "}" ) { i += 1; continue; } // a stray brace; tolerated, not expected
    const bw = readBareword(text, i);
    if (!bw.value) { i += 1; continue; }
    i = bw.next;
    const after = skipWs(text, i);
    if (text[after] === "{") {
      const g = readBraceGroup(text, after);
      if (!g) break; // unterminated value; nothing more can be trusted in this block
      props[bw.value] = g.value;
      i = g.next;
    } else {
      flags.push(bw.value);
    }
  }
  return { props, flags };
}

/** One node (`Keyword [name] { properties } [{ children }]`) starting at `i`, or null when `i` names no keyword at all. */
function parseNode(text, i) {
  i = skipWs(text, i);
  const kw = readBareword(text, i);
  if (!kw.value) return null;
  i = skipWs(text, kw.next);

  let name = null;
  if (text[i] === "{") {
    const g = readBraceGroup(text, i);
    if (!g) return null;
    name = g.value;
    i = g.next;
  } else {
    const bw = readBareword(text, i);
    name = bw.value || null;
    i = bw.next;
  }

  i = skipWs(text, i);
  if (text[i] !== "{") return null; // every node, `Function` included, always has a properties block
  const propsGroup = readBraceGroup(text, i);
  if (!propsGroup) return null;
  i = propsGroup.next;
  const { props, flags } = parseProps(propsGroup.value);

  let children = null;
  const afterProps = skipWs(text, i);
  if (text[afterProps] === "{") {
    const childGroup = readBraceGroup(text, afterProps);
    if (!childGroup) return null;
    children = parseChildren(childGroup.value);
    i = childGroup.next;
  }

  return { node: { class: kw.value, name, props, flags, children }, next: i };
}

/** Every node a children block's own text holds, in the order they were declared. */
function parseChildren(text) {
  const nodes = [];
  let i = 0;
  for (;;) {
    i = skipWs(text, i);
    if (i >= text.length) break;
    const result = parseNode(text, i);
    if (!result) break; // malformed trailing content; what parsed so far still stands
    nodes.push(result.node);
    i = result.next;
  }
  return nodes;
}

/**
 * A whole `.fl` file read into its top level `Function {}` blocks, each one
 * node the same shape every widget inside it is. Everything before the
 * first one (the `#` header comment, `version`, `header_name`, `code_name`)
 * and anything between two `Function` blocks that is not itself a `Function`
 * is this format's own file furniture, not a widget tree, and is skipped a
 * line at a time rather than guessed at. `problems` names a `Function`
 * keyword whose block did not parse, so the reader still recovers rather
 * than losing every block after one bad one.
 */
export function parseFluid(source) {
  const text = String(source ?? "").replace(/\r\n/g, "\n");
  const functions = [];
  const problems = [];
  let i = 0;
  while (i < text.length) {
    i = skipWs(text, i);
    if (i >= text.length) break;
    if (text[i] === "#") { i = skipLine(text, i); continue; }
    const bw = readBareword(text, i);
    if (bw.value === "Function") {
      const result = parseNode(text, i);
      if (result) { functions.push(result.node); i = result.next; continue; }
      problems.push("a Function block did not parse as brace balanced; it is skipped.");
      i = skipLine(text, i);
      continue;
    }
    i = skipLine(text, i);
  }
  return { functions, problems };
}
