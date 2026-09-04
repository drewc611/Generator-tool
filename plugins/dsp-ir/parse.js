/**
 * A tolerant markup parser. It knows nothing about any framework: it returns
 * elements, attributes, text and comments, and whatever dialect wrote the
 * attributes is somebody else's problem one layer up.
 */

export const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

/**
 * The five named entities and the numeric forms, decoded where markup stores
 * text. `&amp;` last, or `&amp;quot;` would decode twice and invent a quote
 * the author escaped on purpose.
 */
export function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function parse(html) {
  const root = { type: "root", children: [] };
  const stack = [root];
  // Every node remembers the line it started on, so a note about it can say
  // where it came from instead of only what it is.
  const breaks = [];
  for (let i = 0; i < html.length; i += 1) if (html[i] === "\n") breaks.push(i);
  const lineOf = (index) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  // `--!>` ends a comment too. Treating it as text lets whatever follows a
  // malformed comment be parsed as markup.
  const re = /<!--([\s\S]*?)--!?>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let last = 0;
  let match;

  const push = (node) => stack[stack.length - 1].children.push(node);
  const text = (value, at) => {
    if (value) push({ type: "text", text: decodeEntities(value), line: lineOf(at) });
  };

  while ((match = re.exec(html))) {
    text(html.slice(last, match.index), last);
    last = re.lastIndex;

    if (match[1] !== undefined) {
      push({ type: "comment", text: match[1], line: lineOf(match.index) });
    } else if (match[2]) {
      // Close the nearest matching open tag. Unbalanced markup closes nothing
      // rather than unwinding the whole document.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === match[2]) {
          stack.length = i;
          break;
        }
      }
    } else {
      const node = { type: "element", tag: match[3], attrs: parseAttrs(match[4] ?? ""), children: [], line: lineOf(match.index) };
      push(node);
      if (!match[5] && !VOID.has(node.tag.toLowerCase())) stack.push(node);
    }
  }
  text(html.slice(last), last);
  return root.children;
}

function parseAttrs(source) {
  const attrs = [];
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(source))) {
    if (!match[1].trim()) continue;
    const raw = match[3] ?? match[4] ?? match[5] ?? null;
    attrs.push({ name: match[1], value: raw === null ? null : decodeEntities(raw) });
  }
  return attrs;
}

/** Split an expression at a top level pipe, ignoring one inside a string. */
export function splitPipes(expression) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < expression.length; i += 1) {
    const c = expression[i];
    if (quote) {
      if (c === quote && expression[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === "|" && depth === 0 && expression[i + 1] !== "|" && expression[i - 1] !== "|") {
      return { value: expression.slice(0, i).trim(), pipes: expression.slice(i + 1).trim() };
    }
  }
  return { value: expression.trim(), pipes: null };
}

/** Entries of an object literal, or null when it is not one. */
export function objectLiteralEntries(code) {
  const inner = code.trim().replace(/^\{/, "").replace(/\}$/, "");
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (quote) {
      if (c === quote && inner[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));

  const entries = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const i = part.indexOf(":");
    if (i < 0) return null;
    entries.push({ key: part.slice(0, i).trim().replace(/^['"`]|['"`]$/g, ""), value: part.slice(i + 1).trim() });
  }
  return entries.length ? entries : null;
}

export function styleEntries(css) {
  return css.split(";").map((s) => s.trim()).filter(Boolean).map((pair) => {
    const i = pair.indexOf(":");
    return i < 0 ? null : { property: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim() };
  }).filter(Boolean);
}
