import { matchBracket, splitCommas } from "../dsp-ir/text.js";

/**
 * XAML's markup extensions: `{Binding Path, Mode=TwoWay}`, `{x:Bind
 * ViewModel.Name}`, `{StaticResource Key}`, `{x:Static res:Strings.Login}`.
 * An attribute value that opens with a brace is one of these, read into its
 * type, its positional arguments and its named ones, with a nested extension
 * (`Converter={StaticResource X}`) read the same way. A value opening with
 * `{}` is an escaped literal and stays text.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** XML entities in an attribute value or a text node, the five named and the numeric forms. */
export const decodeEntities = (s) => String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(parseInt(e[1] === "x" || e[1] === "X" ? e.slice(2) : e.slice(1), e[1] === "x" || e[1] === "X" ? 16 : 10));
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** A single quoted extension argument without its quotes; anything else as it is. */
const unquote = (s) => {
  const t = s.trim();
  return /^'[\s\S]*'$/.test(t) ? t.slice(1, -1).replace(/\\'/g, "'") : t;
};

export function parseExtension(value) {
  const text = String(value ?? "").trim();
  if (!text.startsWith("{") || text.startsWith("{}")) return null;
  // A brace that never closes, or text after the closing brace, is not an extension but a caption with a brace in it.
  if (matchBracket(text, 0, { strings: true, ticks: false }) !== text.length) return null;
  const inner = text.slice(1, -1).trim();
  const m = /^([\w:.]+)\s*([\s\S]*)$/.exec(inner);
  if (!m) return null;
  const positional = [];
  const named = {};
  for (const part of splitCommas(m[2], { ticks: false })) {
    const kv = /^([\w:.]+)\s*=\s*([\s\S]*)$/.exec(part);
    const read = (v) => parseExtension(v) ?? unquote(v);
    if (kv) named[kv[1]] = read(kv[2]);
    else positional.push(read(part));
  }
  // The prefix is the namespace's, not the type's: x:Bind and x:Static are read by what they are.
  return { type: m[1].replace(/^\w+:/, ""), positional, named };
}

/**
 * A binding's parts, or null when the extension is not one. `{Binding}` with
 * no path binds the data context itself; `{x:Bind}` is compiled and one time
 * unless it says otherwise; a TemplateBinding reads the templated parent.
 */
export function readBinding(ext) {
  if (!ext || !/^(Binding|Bind|TemplateBinding)$/.test(ext.type)) return null;
  const first = typeof ext.positional[0] === "string" ? ext.positional[0] : null;
  const path = typeof ext.named.Path === "string" ? ext.named.Path : first ?? "";
  const str = (k) => (typeof ext.named[k] === "string" ? ext.named[k] : null);
  return {
    path,
    mode: str("Mode"),
    compiled: ext.type === "Bind",
    template: ext.type === "TemplateBinding",
    elementName: str("ElementName"),
    relative: ext.named.RelativeSource ?? null,
    source: ext.named.Source ?? null,
    converter: ext.named.Converter ?? null,
    format: str("StringFormat"),
  };
}

/** The key a resource extension names, or null: `{StaticResource Key}`, `{DynamicResource Key}`, `{ThemeResource Key}`. */
export function resourceKey(ext) {
  if (!ext || !/^(StaticResource|DynamicResource|ThemeResource)$/.test(ext.type)) return null;
  const key = typeof ext.named.ResourceKey === "string" ? ext.named.ResourceKey : ext.positional[0];
  return typeof key === "string" ? key : null;
}

/** The member an `{x:Static ns:Type.Member}` names, its namespace prefix dropped, or null. */
export function staticMember(ext) {
  if (!ext || ext.type !== "Static" || typeof ext.positional[0] !== "string") return null;
  return ext.positional[0].replace(/^\w+:/, "");
}
