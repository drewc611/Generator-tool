import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * GTK Builder's `.glade` format, read into a plain element tree. It is XML
 * with no namespaces to worry about, so the shared markup reader already
 * fits: an object, a property and its value are each an element, self
 * closing tags and all. Only the XML declaration, comments and CDATA
 * sections are this file's own business, stripped or unwrapped before the
 * shared reader ever sees them; the same restraint input-qt already keeps
 * for Qt Designer's own `.ui` XML, which this format's widget tree closely
 * resembles.
 */

/** The XML declaration, any doctype, comments and CDATA taken out before the shared tag scanner runs. */
function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return text;
}

/** The `<interface>` root element of a `.glade` file, or null when the file has none. */
export function parseGlade(source) {
  const root = parseMarkup(stripNoise(source));
  return elements(root.children).find((e) => e.tag === "interface") ?? null;
}

/** An element's own child elements with a given tag, direct children only. */
export function childrenOf(el, tag) {
  return elements(el?.children ?? []).filter((c) => c.tag === tag);
}

/** The decoded text an element holds directly, its own text nodes joined. */
export function textOf(el) {
  return decodeEntities((el?.children ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""));
}

/**
 * A `<property>` (or `<attribute>`) element read into its name and its
 * value. GtkBuilder writes almost every property as plain text, whatever the
 * property's own type: `True`, a hex colour, an id another object
 * elsewhere in the file, a translatable string. That text is taken as read.
 * The rare property GtkBuilder encodes structurally instead, a nested
 * `<object>` (a `GdkPixbuf`, a cell renderer's data, anything a build tool
 * embedded rather than wrote as a string), is kept opaque: `value` stays
 * null and `raw` carries the element's own text, so nothing here interprets
 * it and nothing prints it wholesale.
 */
export function readValue(el) {
  const name = attrOf(el, "name");
  const kid = elements(el?.children ?? [])[0];
  if (kid) {
    const type = kid.tag === "object" ? (attrOf(kid, "class") || "object") : kid.tag;
    return { name, type, value: null, raw: textOf(el) };
  }
  const raw = textOf(el).trim();
  return { name, type: "text", value: raw, raw };
}

/** The first `<property name="X">` (or, with `tag: "attribute"`, `<attribute name="X">`) child by name, read, or null. */
export function valueOf(el, name, tag = "property") {
  const found = childrenOf(el, tag).find((p) => attrOf(p, "name") === name);
  return found ? readValue(found) : null;
}

/** Every `<requires lib="..." version="...">` the `<interface>` declares. */
export function readRequires(interfaceEl) {
  return childrenOf(interfaceEl, "requires").map((r) => ({ lib: attrOf(r, "lib"), version: attrOf(r, "version") }));
}

const DATA_CLASSES = new Set(["GtkListStore", "GtkTreeStore", "GtkAdjustment", "GtkTextBuffer", "GtkEntryBuffer", "GtkSizeGroup"]);

/**
 * The `<interface>` element's own first widget: its first top level
 * `<object>` that is not one of the data only classes (a list store, an
 * adjustment) Glade writes beside a screen for a widget to reference. Those
 * are exactly the properties `readValue` already keeps opaque, so this
 * reader never has to parse what they hold.
 */
export function rootObject(interfaceEl) {
  return childrenOf(interfaceEl, "object").find((o) => !DATA_CLASSES.has(attrOf(o, "class") || "")) ?? null;
}

/**
 * An object's own `<child>` wrappers, each holding one `<object>` (or a
 * `<placeholder/>`, an empty slot the Designer left for one). `type` names
 * the child's role when GtkBuilder gives it one (`tab` for a GtkNotebook's
 * page label, `label`, an internal child's own name); `object` is null for a
 * placeholder.
 */
export function childObjects(widgetEl) {
  const out = [];
  for (const child of childrenOf(widgetEl, "child")) {
    const type = attrOf(child, "type");
    const internalChild = attrOf(child, "internal-child");
    const object = childrenOf(child, "object")[0] ?? null;
    const placeholder = !object && childrenOf(child, "placeholder").length > 0;
    out.push({ object, type, internalChild, placeholder });
  }
  return out;
}

/**
 * A widget's own child widgets in document order. A `type="tab"` child is a
 * GtkNotebook's own tab label, not page content, and is left out; every
 * other internal child (a GtkDialog's `vbox` and `action_area` included)
 * holds real widgets GtkBuilder just also keeps a handle to, so it reads
 * the same as any other child. A `<placeholder/>` slot is named through
 * `note` rather than silently skipped; `label` says whose children these
 * are, for the note to name.
 */
export function childWidgets(widgetEl, note = () => {}, label = "") {
  const out = [];
  for (const c of childObjects(widgetEl)) {
    if (c.type === "tab") continue;
    if (c.object) { out.push(c.object); continue; }
    if (c.placeholder) note(`${label ? `\`${label}\`` : "a widget"} has a <placeholder/> child; nothing was read from it.`);
  }
  return out;
}

/** Every direct `<child>` object, tab labels and placeholders included; used only to walk the whole tree once for ids and radio groups. */
export function allChildObjects(widgetEl) {
  return childObjects(widgetEl).map((c) => c.object).filter(Boolean);
}

/** A `<signal name="X" handler="Y">` child by signal name, or null. */
export function signalOf(widgetEl, signalName) {
  return childrenOf(widgetEl, "signal").find((s) => attrOf(s, "name") === signalName) ?? null;
}

/** The inline `<items><item>...</item></items>` a GtkComboBoxText declares, in order, or an empty array when there are none. */
export function inlineItems(widgetEl) {
  const items = childrenOf(widgetEl, "items")[0];
  return items ? childrenOf(items, "item").map((it) => textOf(it).trim()) : [];
}

/** The direct `<child>` objects of a given class, unwrapped; used to find a GtkTreeView's GtkTreeViewColumn definitions. */
export function childObjectsOfClass(widgetEl, klass) {
  return childObjects(widgetEl).map((c) => c.object).filter((o) => o && attrOf(o, "class") === klass);
}

/** True when the widget declares the internal child GtkBuilder always writes for a GtkTreeView's own selection object. */
export function hasInternalChild(widgetEl, name) {
  return childObjects(widgetEl).some((c) => c.internalChild === name);
}
