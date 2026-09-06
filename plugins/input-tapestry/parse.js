import { attrOf, cloneNode, elements, parseMarkup } from "../dsp-ir/markup.js";

/**
 * Apache Tapestry's `.tml` templates are valid HTML with a `t:` namespace
 * declared once (`xmlns:t="http://tapestry.apache.org/schema/component.xsd"`)
 * and, sometimes, a `p:` namespace for named parameter blocks. Nothing about
 * that shape needs a reader of its own: it is the same tag and attribute
 * syntax the shared markup parser already reads for Thymeleaf's `th:`
 * attributes, so this file only re-exports it plus the two small readers
 * Tapestry's own vocabulary needs.
 */

export { attrOf, cloneNode, elements, parseMarkup };

/** True when an element's own tag name carries the `t:` namespace, the
 * spelling Tapestry's built in components use when they stand as an element
 * rather than an attribute on a plain one (`<t:if>`, `<t:loop>`,
 * `<t:checkbox>`, `<t:parameter>`). */
export const isTapestryTag = (tag) => /^t:/.test(String(tag ?? ""));

/**
 * A parameter Tapestry's own control components (`t:if`, `t:loop`,
 * `t:parameter`) take as a bare attribute, because the element itself
 * already carries the namespace: `<t:if test="...">`, not `<t:if t:test="...">`.
 */
export const bareAttr = attrOf;

/**
 * A parameter that drives Tapestry behaviour on an element that is not
 * itself in the namespace, always spelled with the `t:` prefix: `t:type`,
 * `t:id`, `t:value`, `t:model` on a plain `<input>` or `<select>`, and the
 * same prefix on the element form of a built in component (`<t:checkbox
 * t:id="..." t:value="...">`, as Tapestry markup is written in practice).
 */
export const tAttr = (el, name) => attrOf(el, `t:${name}`);

/** An element's attributes with every `t:` namespaced one removed, in order, name/value pairs as the shared parser
 * gives them. The `xmlns:t`/`xmlns:p` namespace declarations go the same way: real Tapestry housekeeping, not real
 * HTML, so leaving one standing would be exactly the raw syntax leak translating everything else is meant to avoid. */
export const plainAttrs = (el) => (el.attrs ?? []).filter((a) => !/^(?:t:|xmlns:t$|xmlns:p$)/i.test(a.name));
