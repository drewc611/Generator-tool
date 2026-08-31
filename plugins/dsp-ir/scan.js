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
