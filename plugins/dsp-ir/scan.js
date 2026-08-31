/**
 * Balanced delimiter scanning over source text.
 *
 * Three plugins now walk somebody's source looking for the end of a block, and
 * the mistakes available (a brace inside a string, a nested pair) are the same
 * every time, so the walk lives once.
 */

/** Step over a quoted string starting at `i`; returns the index of its close. */
function closeOfString(text, i) {
  const quote = text[i];
  i += 1;
  while (i < text.length && (text[i] !== quote || text[i - 1] === "\\")) i += 1;
  return i;
}

const CLOSER = { "{": "}", "[": "]", "(": ")" };

/** The text of the balanced block starting at `open`, or null if it never closes. */
export function balanced(text, open) {
  const openChar = text[open];
  const closeChar = CLOSER[openChar];
  if (!closeChar) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") { i = closeOfString(text, i); continue; }
    if (c === openChar) depth += 1;
    else if (c === closeChar) {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/** Top level blocks of `openChar` inside a body, nested ones excluded. */
export function topLevelBlocks(body, openChar = "{") {
  const found = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") { i = closeOfString(body, i); continue; }
    if (c === openChar && depth === 0) {
      const block = balanced(body, i);
      if (block) { found.push(block); i += block.length - 1; continue; }
    }
    if (c === "{" || c === "[" || c === "(") depth += 1;
    else if (c === "}" || c === "]" || c === ")") depth -= 1;
  }
  return found;
}

/**
 * Remove script elements from markup, correctly.
 *
 * The obvious one line regex has two well known failures: it does not match
 * `</script >` or `</script foo>`, and a single pass over overlapping tags can leave a `<script`
 * it manufactured by removal. So the close tag tolerates whitespace, the
 * replacement loops to a fixpoint, and an opener that never closes takes the
 * rest of the text with it, which is exactly what a browser would have done.
 */
export function stripScripts(markup) {
  let text = String(markup ?? "");
  const one = /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi;
  for (let i = 0; i < 100; i++) {
    const next = text.replace(one, "");
    if (next === text) break;
    text = next;
  }
  const unclosed = text.search(/<script\b/i);
  return unclosed === -1 ? text : text.slice(0, unclosed);
}
