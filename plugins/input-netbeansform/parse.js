import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * NetBeans' own Matisse GUI Builder `.form` file, read into a plain element
 * tree. It is XML with no namespaces to worry about, so the shared markup
 * reader already fits: a component, a property and its value are each an
 * element, self closing tags and all. Only the XML declaration and comments
 * are this file's own business, stripped before the shared reader ever sees
 * them, the same restraint input-qt already keeps for Qt Designer's own
 * `.ui` XML.
 *
 * Unlike Qt's `<string>value</string>` text nodes, NetBeans spells almost
 * every value as an attribute on the element itself (`<String
 * value="Username"/>`), and a real `.form` file mixes a second shape for a
 * simple primitive: `<Property name="x" type="boolean" value="true"/>` with
 * no nested value element at all, the bare attribute sitting directly on the
 * `<Property>` tag. `readProperty` reads both shapes rather than assuming
 * either is the only one a given NetBeans version wrote.
 */

/** The XML declaration, any doctype and comments taken out before the shared tag scanner runs. */
function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  return text;
}

/** The `<Form>` root element of a `.form` file, or null when the file has none. */
export function parseForm(source) {
  const root = parseMarkup(stripNoise(source));
  return elements(root.children).find((e) => e.tag === "form") ?? null;
}

/** An element's own child elements with a given tag, direct children only. */
export function childrenOf(el, tag) {
  return elements(el?.children ?? []).filter((c) => c.tag === tag);
}

/**
 * A `<Component>`'s own `<SubComponents>` (wrapped in a `<Container>` element
 * or not; both shapes appear across NetBeans versions), unwrapped into a flat
 * list of `<Component>` elements in document order. Recurses through
 * arbitrarily deep `<Container>`/`<SubComponents>` nesting the same way
 * input-uno and input-glade already unwrap their own nested wrapper
 * elements, so a panel inside a panel costs the caller nothing extra.
 */
function directSubComponents(el) {
  const out = [];
  for (const sub of childrenOf(el, "subcomponents")) out.push(...childrenOf(sub, "component"));
  for (const container of childrenOf(el, "container")) out.push(...directSubComponents(container));
  return out;
}

/** The `<Form>` element's own top level components. */
export function rootComponents(formEl) {
  return directSubComponents(formEl);
}

/** A `<Component>`'s own child components, however NetBeans nested them. */
export function componentChildren(componentEl) {
  return directSubComponents(componentEl);
}

/** A component's own `<Properties><Property>` children, direct only. */
export function propertiesOf(componentEl) {
  const section = childrenOf(componentEl, "properties")[0];
  return section ? childrenOf(section, "property") : [];
}

/**
 * A `<Property>` element read into its value, whichever of the two shapes a
 * real `.form` file wrote it in:
 *
 * - a bare `value` attribute on the `<Property>` tag itself, with no nested
 *   element (`type="boolean"` reads as a real boolean; anything else is kept
 *   as the primitive text NetBeans wrote, not interpreted further);
 * - a nested `<String value="...">` (a literal string, entities decoded);
 * - a nested `<StringArray>` of `<StringItem index="N" value="...">`, a
 *   JComboBox's own inline model, read in `index` order;
 * - a nested `<ComponentRef name="...">`, NetBeans' own explicit reference
 *   from one component's property to another (a radio's `buttonGroup`, a
 *   label's `labelFor`);
 * - anything else (`<Color>`, `<Font>`, `<Dimension>`, `<Border>`, and every
 *   other value type Matisse writes) is kept opaque: named by its own child
 *   tag, never read for what it holds.
 */
export function readProperty(propEl) {
  const name = attrOf(propEl, "name");
  const type = attrOf(propEl, "type");
  const child = elements(propEl?.children ?? [])[0];
  const bareValue = attrOf(propEl, "value");

  if (!child) {
    if (bareValue === null) return { name, kind: "empty", type };
    if (type === "boolean") return { name, kind: "boolean", value: bareValue.trim() === "true" };
    return { name, kind: "primitive", type, value: decodeEntities(bareValue) };
  }
  if (child.tag === "string") return { name, kind: "string", value: decodeEntities(attrOf(child, "value") ?? "") };
  if (child.tag === "stringarray") {
    const items = childrenOf(child, "stringitem")
      .map((it) => ({ index: Number(attrOf(it, "index") ?? 0), value: decodeEntities(attrOf(it, "value") ?? "") }))
      .sort((a, b) => a.index - b.index)
      .map((it) => it.value);
    return { name, kind: "stringarray", items };
  }
  if (child.tag === "componentref") return { name, kind: "componentref", ref: attrOf(child, "name") };
  return { name, kind: "opaque", type: child.tag };
}

/** The first `<Property name="X">` child of a component, read, or null. */
export function valueOf(componentEl, name) {
  const found = propertiesOf(componentEl).find((p) => attrOf(p, "name") === name);
  return found ? readProperty(found) : null;
}

/**
 * A component's own `<Events><EventHandler>` children: the real Java method
 * NetBeans wired to each named event, kept only as existing, its own body
 * never this reader's to read. Reading this straight from the `.form` file
 * is exactly why it is the more reliable source: input-swing has to find the
 * same wiring by matching a generated `addActionListener` shape in the
 * `.java` file, while here it is a plain attribute.
 */
export function eventHandlers(componentEl) {
  const section = childrenOf(componentEl, "events")[0];
  if (!section) return [];
  return childrenOf(section, "eventhandler").map((e) => ({
    event: attrOf(e, "event"),
    handler: attrOf(e, "handler"),
    listener: attrOf(e, "listener"),
  }));
}

/**
 * Every `<NonVisualComponents><Component>` the `<Form>` declares: a
 * `ButtonGroup` lives here, never among the visible `<SubComponents>`, and a
 * radio's own `buttonGroup` property references one by its `name`.
 */
export function nonVisualComponents(formEl) {
  const section = childrenOf(formEl, "nonvisualcomponents")[0];
  if (!section) return [];
  return childrenOf(section, "component").map((c) => ({ class: attrOf(c, "class"), name: attrOf(c, "name") }));
}
