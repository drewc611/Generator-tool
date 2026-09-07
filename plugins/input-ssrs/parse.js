import { attrOf, elements, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { decodeEntities } from "../input-xaml/extension.js";

/**
 * Microsoft SQL Server Reporting Services' `.rdl` report definitions, read
 * into a plain element tree. RDL has shipped under half a dozen slightly
 * different `reportdefinition` namespace URIs across SQL Server versions, so
 * this reader never inspects the namespace at all: it asks only for the
 * `<Report>` root element by tag name, the same restraint every other reader
 * here keeps for a namespace it does not otherwise interpret. `rd:TypeName`
 * and any other `rd:`-prefixed tag are read as ordinary tag names the shared
 * markup reader already lowercases and hands over. Only the XML declaration,
 * comments and CDATA sections are this file's own business, stripped or
 * unwrapped before the shared reader ever sees them. What a section or a
 * Tablix means, and what its elements lower onto, is lower.js's job; this
 * file only hands over the tree, including the one shape lower.js cannot
 * reach on its own: a Tablix's deeply nested row/cell layout, flattened here
 * into a plain array of rows of cells.
 */

function stripNoise(source) {
  let text = String(source ?? "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  text = stripDelimited(text, "<!--", "-->");
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, body) => body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return text;
}

/** The `<Report>` root element of an `.rdl` file, or null when the file has none. Its own xmlns is never inspected: RDL has shipped under several namespace URIs since SQL Server 2000 and this reader answers to the tag alone. */
export function parseRdl(source) {
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

/** Every `<ReportParameter>` the report declares, by its own Name attribute and its declared `<DataType>`. */
export function readParameters(reportEl) {
  const container = childrenOf(reportEl, "reportparameters")[0];
  if (!container) return [];
  return childrenOf(container, "reportparameter").map((p) => ({
    name: attrOf(p, "name"),
    dataType: textOf(childrenOf(p, "datatype")[0]) || "unspecified",
  }));
}

/** A `<DataSet>` element's own `<Fields><Field>` children, each by its Name attribute and its `rd:TypeName`, the .NET type name Report Builder wrote for it. */
function readFields(datasetEl) {
  const container = childrenOf(datasetEl, "fields")[0];
  if (!container) return [];
  return childrenOf(container, "field").map((f) => ({
    name: attrOf(f, "name"),
    typeName: textOf(childrenOf(f, "rd:typename")[0]) || "unspecified",
  }));
}

/** Every `<DataSet>` the report declares, by its own Name attribute, with its fields. */
export function readDataSets(reportEl) {
  const container = childrenOf(reportEl, "datasets")[0];
  if (!container) return [];
  return childrenOf(container, "dataset").map((ds) => ({
    name: attrOf(ds, "name"),
    fields: readFields(ds),
  }));
}

/** A top level section's own `<ReportItems>` wrapper, PageHeader, Body or PageFooter alike, as plain elements in document order. */
export function sectionItems(sectionEl) {
  const wrap = childrenOf(sectionEl, "reportitems")[0];
  return wrap ? elements(wrap.children ?? []) : [];
}

/**
 * A `<Tablix>`'s deeply nested TablixBody/TablixRows/TablixRow/TablixCells/
 * TablixCell/CellContents layout, flattened into a plain array of rows, each
 * row a plain array of cells, each cell the one content element its
 * CellContents holds (or null for an empty cell). RDL's own schema draws no
 * header/detail/footer distinction inside a Tablix the way BIRT's table
 * does: every TablixRow is just a row in document order, so this is as far
 * as the structure goes; lower.js renders every row into one body.
 */
export function tablixRows(tablixEl) {
  const body = childrenOf(tablixEl, "tablixbody")[0];
  const rowsWrap = body ? childrenOf(body, "tablixrows")[0] : null;
  const rowEls = rowsWrap ? childrenOf(rowsWrap, "tablixrow") : [];
  return rowEls.map((rowEl) => {
    const cellsWrap = childrenOf(rowEl, "tablixcells")[0];
    const cellEls = cellsWrap ? childrenOf(cellsWrap, "tablixcell") : [];
    return cellEls.map((cellEl) => {
      const contents = childrenOf(cellEl, "cellcontents")[0];
      return contents ? (elements(contents.children ?? [])[0] ?? null) : null;
    });
  });
}
