import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * LibreOffice/OpenOffice Basic's UNO dialog `.xdl` format, read into a plain
 * element tree. It is XML with namespace prefixed tags (`dlg:`, `script:`)
 * the shared markup reader already tokenizes as ordinary tag and attribute
 * names, so no separate namespace handling is needed here. Unlike Qt
 * Designer's `.ui` (a property is a typed child element) and GTK Builder's
 * `.glade` (a property is a `<property name="...">` child holding text),
 * a UNO dialog control's every property, including its caption or value,
 * is a plain XML attribute on the control's own tag, so this reader has no
 * readValue/valueOf pair to speak of: a property is read straight off the
 * element with `attrOf`, decoded for entities since, unlike the other two
 * readers' text nodes, an attribute value here is where the caption lives.
 */

/** The XML declaration, any doctype, comments and CDATA taken out before the shared tag scanner runs. */
function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return text;
}

/** The `<dlg:window>` root element of a `.xdl` file, or null when the file has none. */
export function parseXdl(source) {
  const root = parseMarkup(stripNoise(source));
  return elements(root.children).find((e) => e.tag === "dlg:window") ?? null;
}

/** An element's own child elements with a given tag, direct children only. */
export function childrenOf(el, tag) {
  return elements(el?.children ?? []).filter((c) => c.tag === tag);
}

/**
 * A `dlg:` or `script:` attribute's decoded value, or null when the
 * attribute is not written at all. Entities are decoded here rather than
 * left to a separate text reader, since a UNO dialog control's caption
 * lives in an attribute value, not in a child text node the way input-qt's
 * and input-glade's do.
 */
export function dlgAttr(el, name) {
  const raw = attrOf(el, name);
  return raw === null ? null : decodeEntities(raw);
}

/** The `<dlg:bulletinboard>` container every `<dlg:window>` holds exactly one of, or null. */
export function bulletinboard(windowEl) {
  return childrenOf(windowEl, "dlg:bulletinboard")[0] ?? null;
}

/** A `<dlg:bulletinboard>`'s (or any container's) own direct child elements, in document order: the flat, absolute
 * positioned set of controls a UNO dialog places, with no row/column layout to reproduce. */
export function controlsOf(boardEl) {
  return elements(boardEl?.children ?? []);
}

/**
 * A control's own `<script:event>` children, each read into its event name,
 * the Basic macro it names (kept only as existing: the method after the
 * last `.`, never read for what it does) and the language it declares.
 */
export function readEvents(controlEl) {
  return childrenOf(controlEl, "script:event").map((e) => {
    const macro = dlgAttr(e, "script:macro-name") || "";
    return {
      name: dlgAttr(e, "script:event-name"),
      macro,
      method: macro.includes(".") ? macro.slice(macro.lastIndexOf(".") + 1) : macro,
      language: dlgAttr(e, "script:language"),
    };
  });
}

/**
 * The `<dlg:menuitem dlg:value="...">` options a `<dlg:menulist>`'s
 * `<dlg:menupopup>` child declares, in order; empty when the menulist has no
 * `<dlg:menupopup>` at all, or one with no items in it, so a caller need not
 * tell the two apart.
 */
export function menuItems(menulistEl) {
  const popup = childrenOf(menulistEl, "dlg:menupopup")[0];
  if (!popup) return [];
  return childrenOf(popup, "dlg:menuitem").map((it) => dlgAttr(it, "dlg:value") ?? "");
}
