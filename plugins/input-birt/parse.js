import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * Eclipse BIRT's `.rptdesign` report definitions, read into a plain element
 * tree. It is XML with one default namespace and no prefixes to worry about,
 * so the shared markup reader already fits: a section, a table row and a
 * property are each an element, self closing tags and all. Only the XML
 * declaration, comments and CDATA sections (a BIRT expression may hold its
 * own `<` and `>`, quoted column subscripts included) are this file's own
 * business, stripped or unwrapped before the shared reader ever sees them.
 * What a section or a table means, and what its elements lower onto, is
 * lower.js's job; this file only hands over the tree.
 */

function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return text;
}

/** The `<report>` root element of a `.rptdesign` file, or null when the file has none. */
export function parseRptdesign(source) {
  const root = parseMarkup(stripNoise(source));
  return elements(root.children).find((e) => e.tag === "report") ?? null;
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
 * A named `<property name="X">value</property>` or `<text-property
 * name="X">value</property>` child's own text, whichever shape the file
 * uses: BIRT spells a plain value one way and a longer or localizable one
 * the other, and both carry a name attribute and a text body the same way.
 * Returns null when no such child exists.
 */
export function textProp(el, name) {
  const child = elements(el?.children ?? []).find((c) => (c.tag === "property" || c.tag === "text-property") && attrOf(c, "name") === name);
  return child ? textOf(child) : null;
}

/** A `<list-property name="X">` child holding its own plain text directly, a table or list's `dataSet` name, say, rather than `<structure>` children. */
export function listPropText(el, name) {
  const child = elements(el?.children ?? []).find((c) => c.tag === "list-property" && attrOf(c, "name") === name);
  const text = child ? textOf(child).trim() : "";
  return text || null;
}

/** A `<list-property name="X">` child's own `<structure>` elements, a dataset's `resultSetColumn` entries, say. */
export function listPropStructures(el, name) {
  const child = elements(el?.children ?? []).find((c) => c.tag === "list-property" && attrOf(c, "name") === name);
  return child ? childrenOf(child, "structure") : [];
}

/** Every `<scalar-parameter>` the report declares, by its own name and declared dataType. The `id` attribute every
 * BIRT element carries is an internal object identifier, not meaningful data, and is never read. */
export function readParameters(reportEl) {
  const container = childrenOf(reportEl, "parameters")[0];
  if (!container) return [];
  return childrenOf(container, "scalar-parameter").map((p) => ({
    name: attrOf(p, "name"),
    dataType: textProp(p, "dataType") || "unspecified",
  }));
}

/** Every `<oda-data-set>` or `<script-data-set>` the report declares, by its own name, with its resultSetColumn structures read as fields. */
export function readDataSets(reportEl) {
  const container = childrenOf(reportEl, "data-sets")[0];
  if (!container) return [];
  const sets = [...childrenOf(container, "oda-data-set"), ...childrenOf(container, "script-data-set")];
  return sets.map((ds) => ({
    name: attrOf(ds, "name"),
    columns: listPropStructures(ds, "resultSetColumn").map((s) => ({
      name: textProp(s, "name"),
      dataType: textProp(s, "dataType") || "unspecified",
    })),
  }));
}
