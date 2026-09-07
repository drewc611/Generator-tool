import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * JasperReports' `.jrxml` report definitions, read into a plain element tree.
 * It is XML with no namespaces to worry about, so the shared markup reader
 * already fits: a band, a report element and a value expression are each an
 * element, self closing tags and all. Only the XML declaration, comments and
 * CDATA sections are this file's own business, stripped or unwrapped before
 * the shared reader ever sees them. What a band means, and what its elements
 * lower onto, is lower.js's job; this file only hands over the tree.
 */

/** The XML declaration, any doctype, comments and CDATA taken out before the shared tag scanner runs. A CDATA body is
 * plain text a translator never treats as markup (a report's own text, or a Java expression that may hold `<` and
 * `>`); escaping its own angle brackets and ampersands lets the scanner read it as ordinary text, and decodeEntities
 * recovers exactly what was written. */
function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return text;
}

/** The `<jasperReport>` root element of a `.jrxml` file, or null when the file has none. */
export function parseJrxml(source) {
  const root = parseMarkup(stripNoise(source));
  return elements(root.children).find((e) => e.tag === "jasperreport") ?? null;
}

/** An element's own child elements with a given tag, direct children only. */
export function childrenOf(el, tag) {
  return elements(el?.children ?? []).filter((c) => c.tag === tag);
}

/** The decoded text an element holds directly, its own text nodes joined. */
export function textOf(el) {
  return decodeEntities((el?.children ?? []).filter((c) => c.type === "text").map((c) => c.text).join(""));
}

/** A `<parameter>` or `<field>` element's own declared name and class, never a runtime value: a .jrxml is a template,
 * so no runtime value exists in it to begin with. */
export function readDeclared(el) {
  return { name: attrOf(el, "name"), class: attrOf(el, "class") };
}

/** Every top level `<parameter>` the report declares. */
export function readParameters(reportEl) {
  return childrenOf(reportEl, "parameter").map(readDeclared);
}

/** Every top level `<field>` the detail band binds to. */
export function readFields(reportEl) {
  return childrenOf(reportEl, "field").map(readDeclared);
}

// The bands JasperReports lays the page out with, top to bottom, each one a
// `<band>` element wrapped in its own section tag. `background`, `noData`
// and `lastPageFooter` are read from the file too, but named present rather
// than laid out: none of the three is the plain top to bottom flow the rest
// already are (a background sits behind everything, noData replaces the
// whole body when a data set is empty, and lastPageFooter replaces
// pageFooter on the final page only), so reproducing a layout for them would
// be a guess about which one wins.
const LAID_OUT = ["title", "pageHeader", "columnHeader", "detail", "columnFooter", "pageFooter", "summary"];
const NAMED_ONLY = ["background", "noData", "lastPageFooter"];

/** The report's bands: `laidOut` in page order, each `{ tag, band }` for a section the file actually has, and
 * `namedOnly` as the tags among background/noData/lastPageFooter the file declares but this reader does not lay out. */
export function readBands(reportEl) {
  const laidOut = [];
  for (const tag of LAID_OUT) {
    const section = childrenOf(reportEl, tag.toLowerCase())[0];
    const band = section ? childrenOf(section, "band")[0] : null;
    if (band) laidOut.push({ tag, band });
  }
  const namedOnly = NAMED_ONLY.filter((tag) => {
    const section = childrenOf(reportEl, tag.toLowerCase())[0];
    return section && childrenOf(section, "band")[0];
  });
  return { laidOut, namedOnly };
}

/** Every `<group>` the report declares, by its own name attribute: a group's headers and footers are bands too, and
 * named present the same way background/noData/lastPageFooter are, never laid out, since which rows belong to which
 * group is a data grouping this reader does not compute. */
export function readGroups(reportEl) {
  return childrenOf(reportEl, "group").map((g) => attrOf(g, "name")).filter(Boolean);
}

/** A band's own report elements, in document order: staticText, textField, line, break, rectangle, image, subreport,
 * and anything this reader has no vocabulary entry for. */
export function bandElements(band) {
  return elements(band?.children ?? []);
}
