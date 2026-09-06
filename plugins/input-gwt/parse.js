import { parseMarkup, stripDelimited } from "../dsp-ir/markup.js";

/**
 * A UiBinder .ui.xml file into an element tree, the namespace prefix kept
 * separate from the tag name so lower.js can match a widget against the
 * import a file actually declares rather than assuming the prefix is always
 * `g`. Built on the shared markup parser rather than a second one: comments
 * and CDATA are taken out first, the way any other markup dialect in this
 * tool already is, and the case parseMarkup collapses (it lowers every tag
 * to match generic HTML) is put back from the raw source, because UiBinder
 * is case sensitive about `TextBox` and `usernameBox` alike.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** XML entities in an attribute value or a text node, the five named and the numeric forms. */
export const decodeEntities = (s) => String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(parseInt(e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1), e[1] === "x" || e[1] === "X" ? 16 : 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

/**
 * The file as one normalized tree: `{ prefix, name, attrs, children, text }`.
 * `text` is the literal text sitting directly inside the element, decoded and
 * whitespace collapsed; a child widget's own text is not folded into it, so a
 * `<g:Label>` never picks up words that belong to a sibling element.
 */
export function parseUiXml(source) {
  const withoutDirectives = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "");
  const withoutComments = stripDelimited(withoutDirectives, "<!--", "-->");
  // A CDATA section carries its body as plain text; the markers themselves are never a screen's content.
  const withoutCdata = stripDelimited(withoutComments, "<![CDATA[", "]]>", (body) => body);

  // parseMarkup lowercases every tag; the original spelling is recovered from
  // the source so a note can say `PasswordTextBox`, not `passwordtextbox`.
  const spelling = new Map();
  for (const m of withoutCdata.matchAll(/<\/?([A-Za-z_][\w:.-]*)/g)) if (!spelling.has(m[1].toLowerCase())) spelling.set(m[1].toLowerCase(), m[1]);

  const rootEl = parseMarkup(withoutCdata).children.find((c) => c.type === "el") ?? null;
  if (!rootEl) return { root: null };

  const normalize = (el) => {
    const raw = spelling.get(el.tag) ?? el.tag;
    const colon = raw.indexOf(":");
    const prefix = colon >= 0 ? raw.slice(0, colon) : null;
    const name = colon >= 0 ? raw.slice(colon + 1) : raw;
    const attrs = {};
    for (const a of el.attrs) attrs[a.name] = a.value === null ? null : decodeEntities(a.value);
    const children = [];
    let text = "";
    for (const c of el.children) {
      if (c.type === "text") { text += decodeEntities(c.text); continue; }
      children.push(normalize(c));
    }
    return { prefix, name, attrs, children, text: text.replace(/\s+/g, " ").trim() };
  };
  return { root: normalize(rootEl) };
}

/**
 * The prefix a root element declares for a namespace URI, or null when
 * nothing declares it. UiBinder files are free to name their own prefixes
 * (`xmlns:g`, `xmlns:my`, anything), so the vocabulary is matched against
 * whichever prefix a file actually chose, never the string `g` itself.
 */
export function namespaceOf(root, uri) {
  for (const [key, value] of Object.entries(root.attrs)) {
    if (value !== uri) continue;
    const m = /^xmlns:(.+)$/.exec(key);
    if (m) return m[1];
  }
  return null;
}

/** True when `text` carries a `{...}` UiBinder template expression: a message, a field read, a computed value. */
export const hasBinding = (text) => /\{[^{}]*\}/.test(String(text ?? ""));
