import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * Apple Interface Builder's `.storyboard` and `.xib` XML, read into a plain
 * element tree. Both files share one widget vocabulary: a `.xib` is a single
 * scene's worth of it with no navigation, a `.storyboard` wraps several
 * `<scene>` elements plus the `<segue>`s connecting them. It is XML with no
 * namespaces, so the shared markup reader already fits, the same restraint
 * input-qt and input-glade already keep for their own XML dialects.
 */

/** The XML declaration, any doctype, comments and CDATA taken out before the shared tag scanner runs. */
function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return text;
}

/** The `<document>` root element of a `.storyboard` or `.xib` file, or null when the file has none. */
export function parseStoryboard(source) {
  const root = parseMarkup(stripNoise(source));
  return elements(root.children).find((e) => e.tag === "document") ?? null;
}

/** An element's own child elements with a given tag, direct children only. */
export function childrenOf(el, tag) {
  return elements(el?.children ?? []).filter((c) => c.tag === tag);
}

/** An element's own child elements, any tag, direct children only. */
export function allChildren(el) {
  return elements(el?.children ?? []);
}

/** An attribute's value, entity decoded, or null. Interface Builder writes every caption (a label's `text`, a
 * button state's `title`, a segment's `title`) as an attribute, never as element text, so this is the one place
 * this reader ever needs to recover an escaped `&amp;` or `&apos;`. */
export function attrText(el, name) {
  const raw = attrOf(el, name);
  return raw === null ? null : decodeEntities(raw);
}

/**
 * Every scene this file declares, as the objects it holds to walk: a
 * `.storyboard`'s own `<scenes><scene><objects>` wrapper, one entry per
 * `<scene>`, or a `.xib`'s single top level `<objects>` held directly under
 * the document root, with no `<scene>` wrapper of its own. Both shapes hand
 * the rest of this reader the same thing, a scene id (null for the xib
 * shape) and the `<objects>` element to walk, so one code path lowers both.
 */
export function scenesOf(documentEl) {
  const wrap = childrenOf(documentEl, "scenes")[0];
  if (wrap) {
    return childrenOf(wrap, "scene").map((sceneEl) => ({
      sceneId: attrOf(sceneEl, "sceneID"),
      objectsEl: childrenOf(sceneEl, "objects")[0] ?? null,
    }));
  }
  const objectsEl = childrenOf(documentEl, "objects")[0] ?? null;
  return objectsEl ? [{ sceneId: null, objectsEl }] : [];
}

/** The scene's own view controller: the direct child of `<objects>` whose tag Interface Builder names
 * `...ViewController` (`viewController`, `tableViewController`, `navigationController` and the rest); null when
 * the scene declares none, the shape a `.xib` with no controller of its own takes. The shared markup reader
 * lowercases every tag it reads, so the match is spelled lowercase too: `viewcontroller$`, never `ViewController$`. */
export function viewControllerOf(objectsEl) {
  return allChildren(objectsEl).find((e) => /viewcontroller$/.test(e.tag)) ?? null;
}

/** A view controller's own root view, the `<view key="view">` child it declares. */
export function rootViewOf(viewControllerEl) {
  return childrenOf(viewControllerEl, "view").find((v) => attrOf(v, "key") === "view") ?? childrenOf(viewControllerEl, "view")[0] ?? null;
}

/** A `.xib` with no view controller of its own: its first top level `view` or `window`, the File's Owner
 * pattern where the controller lives outside the file entirely. */
export function topLevelViewOf(objectsEl) {
  return allChildren(objectsEl).find((e) => e.tag === "view" || e.tag === "window") ?? null;
}

/** The widgets a `<subviews>` wrapper holds, in document order; a leaf control declares none. */
export function subviewsOf(el) {
  const wrap = childrenOf(el, "subviews")[0];
  return wrap ? allChildren(wrap) : [];
}

/** A widget's own `<connections>` entries with a given tag (`action` or `outlet`). */
export function connectionsOf(el, tag) {
  const wrap = childrenOf(el, "connections")[0];
  return wrap ? childrenOf(wrap, tag) : [];
}

/** A `<state key="...">` child's own `title`, or null; a button's caption lives here, never on the button itself. */
export function stateTitle(el, key) {
  const state = childrenOf(el, "state").find((s) => attrOf(s, "key") === key);
  return state ? attrText(state, "title") : null;
}

/** The inline `<segments><segment title="...">` children a segmentedControl declares, in order. */
export function segmentsOf(el) {
  const wrap = childrenOf(el, "segments")[0];
  return wrap ? childrenOf(wrap, "segment") : [];
}

/** Every `<segue>` anywhere under an element, found recursively: a segue can sit inside a control's own
 * `<connections>` (an action segue a button triggers) or directly among a scene's objects (a relationship
 * segue naming the initial view controller). Real navigation information, named in the report rather than wired. */
export function seguesOf(el, out = []) {
  for (const c of allChildren(el)) {
    if (c.tag === "segue") out.push(c);
    seguesOf(c, out);
  }
  return out;
}
