/**
 * Markup into a tree, for the readers whose dialect rides on HTML tags and
 * attributes (Thymeleaf's th: attributes, JSP's <c:> tags). Elements, text
 * and nothing else: comments and directives are each dialect's own business
 * and are taken out before the tree is built. Names and unquoted values
 * exclude the quote characters, so the three value shapes never overlap and
 * the attribute list matches in one pass.
 */

export const VOID_ELEMENTS = new Set(["img", "input", "br", "hr", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);

export function parseMarkup(source) {
  const text = String(source ?? "");
  const root = { type: "root", children: [] };
  const stack = [root];
  const re = /<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[^\s=>/"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) stack[stack.length - 1].children.push({ type: "text", text: text.slice(last, m.index) });
    last = re.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      const at = stack.findLastIndex((n) => n.type === "el" && n.tag === tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const tag = m[2].toLowerCase();
    const attrs = [];
    for (const a of m[3].matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) attrs.push({ name: a[1], value: a[2] ?? a[3] ?? a[4] ?? null });
    const el = { type: "el", tag, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!VOID_ELEMENTS.has(tag) && !m[4]) stack.push(el);
  }
  if (last < text.length) stack[stack.length - 1].children.push({ type: "text", text: text.slice(last) });
  return root;
}

export const elements = (nodes) => nodes.filter((n) => n.type === "el");
export const cloneNode = (n) => JSON.parse(JSON.stringify(n));

/**
 * Text between an opening and a closing marker, walked by the markers rather
 * than a pattern, so a span a removal exposes is removed too and nothing is
 * reintroduced. `keep(body)` may return text to stand in a span's place.
 */
export function stripDelimited(text, open, close, keep = () => null) {
  let out = ""; let i = 0;
  for (;;) {
    const at = text.indexOf(open, i);
    if (at < 0) { out += text.slice(i); break; }
    const end = text.indexOf(close, at + open.length);
    if (end < 0) { out += text.slice(i, at); break; }
    out += text.slice(i, at);
    const kept = keep(text.slice(at + open.length, end));
    if (kept !== null) out += kept;
    i = end + close.length;
  }
  return out;
}
