import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * Qt Designer's `.ui` format, read into a plain element tree. It is XML with
 * no namespaces to worry about, so the shared markup reader already fits: a
 * widget, a property and its value are each an element, self closing tags and
 * all. Only the XML declaration, comments and CDATA sections are this file's
 * own business, stripped or unwrapped before the shared reader ever sees them.
 */

/** The XML declaration, any doctype, comments and CDATA taken out before the shared tag scanner runs. A CDATA body is
 * plain text a translator never treats as markup; escaping its own angle brackets and ampersands lets the scanner
 * read it as ordinary text, and decodeEntities recovers exactly what was written. */
function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return text;
}

/** The `<ui>` root element of a `.ui` file, or null when the file has none. */
export function parseUi(source) {
  const root = parseMarkup(stripNoise(source));
  return elements(root.children).find((e) => e.tag === "ui") ?? null;
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
 * A `<property>` or `<attribute>` element read into its name and its value.
 * `<string>`, `<bool>`, `<number>` and `<double>` are read for real; every
 * other value type Qt Designer writes (`cstring`, `rect`, `size`, `font`,
 * `sizepolicy`, `cursor`, `pixmap`, `iconset`, `palette`, an `<enum>` or a
 * `<set>` of flags, and the rest) is kept opaque: `value` stays null and
 * `raw` carries the element's own text, so a caller with an explicit reason
 * to read it (a buddy's target name, a signal's slot) can, while nothing
 * here interprets it and nothing prints it wholesale.
 */
export function readValue(el) {
  const name = attrOf(el, "name");
  const child = elements(el?.children ?? [])[0];
  if (!child) return { name, type: null, value: null, raw: null };
  const raw = textOf(child);
  if (child.tag === "string") return { name, type: "string", value: raw, raw };
  if (child.tag === "bool") return { name, type: "bool", value: raw.trim() === "true", raw };
  if (child.tag === "number" || child.tag === "double") return { name, type: child.tag, value: Number(raw), raw };
  return { name, type: child.tag, value: null, raw };
}

/** The first `<property name="X">` (or, with `tag: "attribute"`, `<attribute name="X">`) child by name, read, or null. */
export function valueOf(el, name, tag = "property") {
  const found = childrenOf(el, tag).find((p) => attrOf(p, "name") === name);
  return found ? readValue(found) : null;
}

/** The class the `<ui>` element names its form, or null. */
export function readClassName(uiEl) {
  return textOf(childrenOf(uiEl, "class")[0]) || null;
}

/** The `<ui>` element's own root `<widget>`, or null. */
export function rootWidget(uiEl) {
  return childrenOf(uiEl, "widget")[0] ?? null;
}

/** Every `<connections><connection>` entry: the signal/slot wiring Qt Designer recorded. */
export function readConnections(uiEl) {
  const section = childrenOf(uiEl, "connections")[0];
  if (!section) return [];
  return childrenOf(section, "connection").map((c) => ({
    sender: textOf(childrenOf(c, "sender")[0]),
    signal: textOf(childrenOf(c, "signal")[0]),
    receiver: textOf(childrenOf(c, "receiver")[0]),
    slot: textOf(childrenOf(c, "slot")[0]),
  }));
}

/** The class a promoted widget's own `class` attribute names, to the C++ base it extends, from `<customwidgets>`. */
export function readCustomWidgets(uiEl) {
  const section = childrenOf(uiEl, "customwidgets")[0];
  const map = new Map();
  if (!section) return map;
  for (const cw of childrenOf(section, "customwidget")) {
    const cls = textOf(childrenOf(cw, "class")[0]);
    if (cls) map.set(cls, { extends: textOf(childrenOf(cw, "extends")[0]) || null });
  }
  return map;
}

/**
 * The widgets a `<layout>` arranges: `<item>` wrappers and nested layouts
 * unwrapped, in document order. A `<spacer>` holds no widget and is not
 * itself ported.
 */
export function layoutItems(layoutEl) {
  const out = [];
  for (const item of childrenOf(layoutEl, "item")) {
    const widget = childrenOf(item, "widget")[0];
    if (widget) { out.push(widget); continue; }
    const nested = childrenOf(item, "layout")[0];
    if (nested) out.push(...layoutItems(nested));
  }
  return out;
}

/**
 * A widget's own children, in document order: the items its `<layout>`
 * arranges when it has one, or its direct `<widget>` children otherwise (a
 * `QTabWidget`'s pages, a `QMainWindow`'s central widget, menu bar, status
 * bar and toolbars). `note`, when given, is told about a layout whose
 * row/column or label/field arrangement this reader does not reproduce.
 */
export function childWidgets(widgetEl, note = () => {}) {
  const layout = childrenOf(widgetEl, "layout")[0];
  if (!layout) return childrenOf(widgetEl, "widget");
  const layoutClass = attrOf(layout, "class") || "";
  if (/GridLayout|FormLayout/.test(layoutClass)) {
    const label = attrOf(widgetEl, "name") || attrOf(widgetEl, "class") || "a widget";
    note(`\`${label}\`'s layout is a \`${layoutClass}\`; its row and column placement was not reproduced, only the document order of its items.`);
  }
  return layoutItems(layout);
}
