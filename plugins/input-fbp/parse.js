import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * wxFormBuilder's `.fbp` project files, the visual designer XML for wxWidgets
 * dialogs, read into a plain element tree. Every `<object>`, `<property>` and
 * `<event>` is an element the shared markup reader already handles; only the
 * XML declaration and comments are this file's own business, stripped before
 * the shared reader ever sees them. Unlike Qt Designer's `.ui` files, a
 * property here holds its value as plain text directly inside the element,
 * never through a typed child, so reading one is a single text read.
 */

function stripNoise(source) {
  const text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  return stripDelimited(text, "<!--", "-->");
}

/** The `<wxFormBuilder_Project>` root element of a `.fbp` file, or null when the file has none. */
export function parseFbp(source) {
  const root = parseMarkup(stripNoise(source));
  return elements(root.children).find((e) => e.tag === "wxformbuilder_project") ?? null;
}

/** An element's own child elements with a given tag, direct children only. */
export function childrenOf(el, tag) {
  return elements(el?.children ?? []).filter((c) => c.tag === tag);
}

/** The decoded text an element holds directly, its own text nodes joined. */
export function textOf(el) {
  return decodeEntities((el?.children ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""));
}

/** A `<property name="X">` child's own text value, or null when the object declares no such property. */
export function propertyOf(objectEl, name) {
  const found = childrenOf(objectEl, "property").find((p) => attrOf(p, "name") === name);
  return found ? textOf(found) : null;
}

/** Every `<property>` name an object declares, in document order, duplicates included. */
export function propertyNames(objectEl) {
  return childrenOf(objectEl, "property").map((p) => attrOf(p, "name")).filter(Boolean);
}

/** An `<event name="X">` child's handler name, the method wxFormBuilder wired it to call, or null when absent. */
export function eventOf(objectEl, name) {
  const found = childrenOf(objectEl, "event").find((e) => attrOf(e, "name") === name);
  return found ? textOf(found).trim() || null : null;
}

/** The `<object class="Project">` element every `.fbp` wraps its forms in, or null. */
export function readProject(projectRootEl) {
  return childrenOf(projectRootEl, "object").find((o) => attrOf(o, "class") === "Project") ?? null;
}

/**
 * A sizer that draws nothing of its own: purely a layout instruction, so a
 * caller recurses straight through it rather than rendering it. A
 * `wxStaticBoxSizer` is deliberately not in this set: it draws its own box and
 * its `label` property becomes a heading, the way a Qt QGroupBox's title
 * does, so it is handed back as a widget of its own for the caller to render.
 */
export const TRANSPARENT_SIZERS = new Set(["wxBoxSizer", "wxFlexGridSizer", "wxGridSizer", "wxGridBagSizer", "wxWrapSizer"]);

/**
 * The widgets a container `<object>` arranges, in document order: a
 * `sizeritem` wrapper unwrapped to the one widget it holds (the same way Qt
 * Designer's `<item>` is unwrapped), a `spacer` skipped outright since it
 * holds no widget, and a transparent sizer recursed through rather than
 * pushed as a widget of its own.
 */
export function childWidgets(containerEl) {
  const out = [];
  for (const child of childrenOf(containerEl, "object")) {
    const klass = attrOf(child, "class") || "";
    if (klass === "spacer") continue;
    let target = child;
    if (klass === "sizeritem") {
      target = childrenOf(child, "object")[0];
      if (!target) continue;
    }
    const targetClass = attrOf(target, "class") || "";
    if (TRANSPARENT_SIZERS.has(targetClass)) out.push(...childWidgets(target));
    else out.push(target);
  }
  return out;
}

/**
 * The `choices` property of a `wxChoice`, `wxComboBox` or `wxRadioBox`: the
 * space separated, double quote wrapped literals wxFormBuilder writes,
 * parsed structurally rather than split on whitespace, since a choice's own
 * text may itself contain a space. Absent or empty yields no choices, a gap
 * the caller names rather than guesses at.
 */
export function readChoices(objectEl) {
  const raw = propertyOf(objectEl, "choices");
  if (!raw) return [];
  return [...raw.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}
