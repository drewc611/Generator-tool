import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * JavaFX's `.fxml` format, read into a plain element tree. It is XML with one
 * namespace, `fx:`, FXML itself defines and no others this reader has to
 * resolve, so the shared markup reader already fits: a container, a control
 * and a property value are each an element, self closing tags and all. Only
 * the XML declaration, the `<?import ...?>` processing instructions (Java
 * class imports; informational only, they carry no rendering meaning and are
 * never read as elements here) and comments are this file's own business,
 * stripped before the shared reader ever sees them.
 *
 * The shared scanner lowercases every tag name (it was built for dialects
 * where case never carries meaning) and its tag pattern excludes the dot, so
 * a tag spelled with one never matches its element regex at all. FXML spells
 * two different things with a dotted tag: `<GridPane.rowIndex>`, the rarer
 * element form of an attached property, and a custom control named by its
 * whole package path, `<com.example.Sparkline>`, and the two must not be
 * confused, one dropped on purpose and the other named as the class it is,
 * which is exactly the distinction the forced lowercasing erases: both a
 * property's own name and a class's simple name are just letters once case
 * is gone. `mangleDottedTags` stands in front of the shared scanner for
 * both problems at once: it replaces the dot inside a tag's own name (never
 * inside an attribute value, where a dot is nobody's business but the
 * value's own) with a sentinel the scanner's tag pattern does accept, and
 * appends one more character carrying the one bit the lowercasing is about
 * to erase, whether the tag's last segment opened uppercase before it was
 * touched. `tagName` and `isAttachedPropertyTag` both read that bit back;
 * everything else past the mangling is the shared scanner's own work, not a
 * second tokenizer's.
 */

// A hyphen joins the segments: the shared scanner's own tag pattern accepts only word characters, `:` and `-` in a
// tag name, so the join has to be one of those to survive the parse at all, and no real JavaFX class name contains a
// hyphen (Java identifiers do not allow one). A trailing digit carries the one case bit `.toLowerCase()` would
// otherwise erase; a digit is a word character too and is never itself touched by lowercasing.
const DOT = "-";
const WAS_CLASS = "9";
const WAS_PROPERTY = "0";

/** Every tag-opening position, `<` or `</` followed directly by a dotted name, gets its dots swapped for the join and
 * one flag digit appended, read from the name's own last segment before the scanner ever lowercases it. An attribute
 * value's dots are untouched because a value never sits right after `<`. */
function mangleDottedTags(source) {
  return String(source ?? "").replace(/<(\/?)([A-Za-z_][\w:-]*(?:\.[\w:-]+)+)/g, (_, slash, name) => {
    const segs = name.split(".");
    const flag = /^[A-Z]/.test(segs[segs.length - 1]) ? WAS_CLASS : WAS_PROPERTY;
    return `<${slash}${segs.join(DOT)}${flag}`;
  });
}

function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  return text;
}

/** The file's own root container or control element, or null when the file has none. */
export function parseFxml(source) {
  const root = parseMarkup(stripNoise(mangleDottedTags(source)));
  return elements(root.children)[0] ?? null;
}

/** A tag as FXML actually spelled it, dots included: the join and flag digit `mangleDottedTags` added, undone. An
 * undotted tag never carried either and passes through untouched. */
export const tagName = (el) => {
  const tag = String(el?.tag ?? "");
  return tag.includes(DOT) ? tag.slice(0, -1).split(DOT).join(".") : tag;
};

/**
 * True for a mangled tag naming an attached property written as its own
 * element (`<GridPane.rowIndex>`): its own flag digit, read off before the
 * scanner's lowercasing ever touched the name, says its last segment opened
 * lowercase, a property's own name, never a class. A fully qualified custom
 * control's tag carries the sentinel too, once mangled, but its own flag
 * says its last segment, the class itself, opened uppercase, so it is read
 * as the widget it is instead of dropped as layout.
 */
function isAttachedPropertyTag(tag) {
  return tag.includes(DOT) && tag.endsWith(WAS_PROPERTY);
}

/** An element's attribute value, entities decoded, or null. Attribute name lookup is case blind (attrOf's own rule). */
export function attr(el, name) {
  const v = attrOf(el, name);
  return v === null ? null : decodeEntities(v);
}

/** True for an attribute name spelling an attached property, `ClassName.propertyName`: layout positioning a parent
 * container assigns a child. It carries no rendering meaning this reader reproduces (no grid or flex translation), so
 * it is recognised by that one shape, a literal dot, and dropped without individual comment; there would be one per
 * positioned control and it would be noise, not a gap. */
export const isAttachedPropertyName = (name) => String(name ?? "").includes(".");

// The two property-value wrappers this reader reads as their own elements rather than as widgets: a ComboBox's
// inline `<items>` and a RadioButton's inline `<toggleGroup>`. Both are already lowercase in real FXML, so the
// shared scanner's forced lowercasing costs nothing here; every other lowercase-tag property wrapper FXML allows
// (`<graphic>`, `<tooltip>`, and the rest) is outside this reader's vocabulary and, met as a child, falls through to
// the same "not lowered" note an unrecognised control gets, which is honest: nothing here claims to know what it is.
const PROPERTY_ELEMENT_TAGS = new Set(["items", "togglegroup"]);

/** An element's own child elements that are real widgets: the two known property-value wrappers and an
 * attached-property element (dropped as layout, not named) both excluded. */
export function childWidgets(el) {
  return elements(el?.children ?? []).filter((c) => !PROPERTY_ELEMENT_TAGS.has(c.tag) && !isAttachedPropertyTag(c.tag));
}

/** An element's own property-element child by name (already lowercase: `"items"`, `"togglegroup"`), or null. */
export function propertyElement(el, name) {
  return elements(el?.children ?? []).find((c) => c.tag === name) ?? null;
}

/**
 * A ComboBox's inline `<items><FXCollections fx:factory="observableArrayList">
 * <String fx:value="..."/>...</FXCollections></items>` shape, read as the
 * literal option values it declares, or null when the shape is not exactly
 * this: no `<items>` child, no `FXCollections` inside it, a factory other
 * than `observableArrayList`, or a child that is not a bare `<String
 * fx:value="...">`. Anything else FXML can fill a ComboBox with, a
 * `<items>` bound from code, a different factory, a converter, is a gap this
 * reader does not resolve rather than a shape it guesses at.
 */
export function comboItems(el) {
  const items = propertyElement(el, "items");
  if (!items) return null;
  const coll = elements(items.children)[0];
  if (!coll || coll.tag !== "fxcollections" || attr(coll, "fx:factory") !== "observableArrayList") return null;
  const kids = elements(coll.children);
  if (!kids.length || kids.some((k) => k.tag !== "string")) return null;
  return kids.map((k) => attr(k, "fx:value") ?? "");
}

/**
 * A RadioButton's own toggle group reference: the key named after FXML's
 * `$id` syntax in a `toggleGroup="$X"` attribute, or, when the button
 * instead declares the group inline, the `fx:id` of the `<ToggleGroup>`
 * nested inside its own `<toggleGroup>` property element (its own single
 * child, read by position rather than by tag: the shared scanner lowercases
 * both the wrapper's tag and the class it wraps to the same string, so tag
 * identity cannot tell them apart, and does not need to). Null when neither
 * is present, which this reader takes as no reference at all rather than
 * inventing one.
 */
export function toggleGroupKey(el) {
  const ref = attr(el, "toggleGroup");
  if (ref && ref.startsWith("$")) return ref.slice(1) || null;
  const wrapper = propertyElement(el, "togglegroup");
  const tg = wrapper ? elements(wrapper.children)[0] : null;
  return tg ? attr(tg, "fx:id") : null;
}
