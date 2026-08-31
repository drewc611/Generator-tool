/**
 * A tolerant markup parser. It knows nothing about any framework: it returns
 * elements, attributes, text and comments, and whatever dialect wrote the
 * attributes is somebody else's problem one layer up.
 */

export const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

export function parse(html) {
  const root = { type: "root", children: [] };
  const stack = [root];
  // `--!>` ends a comment too. Treating it as text lets whatever follows a
  // malformed comment be parsed as markup.
  const re = /<!--([\s\S]*?)--!?>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let last = 0;
  let match;

  const push = (node) => stack[stack.length - 1].children.push(node);
  const text = (value) => {
    if (value) push({ type: "text", text: value });
  };

  while ((match = re.exec(html))) {
    text(html.slice(last, match.index));
    last = re.lastIndex;

    if (match[1] !== undefined) {
      push({ type: "comment", text: match[1] });
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
      const node = { type: "element", tag: match[3], attrs: parseAttrs(match[4] ?? ""), children: [] };
      push(node);
      if (!match[5] && !VOID.has(node.tag.toLowerCase())) stack.push(node);
    }
  }
  text(html.slice(last));
  return root.children;
}

function parseAttrs(source) {
  const attrs = [];
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(source))) {
    if (!match[1].trim()) continue;
    attrs.push({ name: match[1], value: match[3] ?? match[4] ?? match[5] ?? null });
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
