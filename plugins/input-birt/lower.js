import { pascal } from "../dsp-ir/emit.js";
import { attrOf, elements } from "../dsp-ir/markup.js";
import { childrenOf, listPropText, readDataSets, readParameters, textProp } from "./parse.js";

/**
 * What a BIRT `.rptdesign` section means, once parse.js has handed it over
 * as plain elements. A report is a document layout, not an interactive
 * form: no input, no button, no event, so it becomes a read only screen the
 * way input-jasperreports's reports do, one `<section>` per top level part
 * of the page (page header, body, page footer) in the order the page
 * prints them. Unlike JasperReports, BIRT's own equivalent of a band lives
 * inside a `<table>`'s own header/detail/footer sub-sections, each holding
 * rows of cells, so a table lowers onto a real HTML `<table>` with a
 * `<thead>`/`<tbody>`/`<tfoot>` per band rather than a flat flow of markup.
 *
 * A bare `<data>` element naming a `resultSetColumn` is the one shape this
 * reader evaluates, lowered onto the dialect's own interpolation. A `<data>`
 * element carrying an `<expression>` child instead (or as well as, since a
 * real file can carry both) is a computed BIRT expression this reader does
 * not evaluate, named through `note` and rendered as an empty placeholder
 * rather than guessed at or partly reproduced. A `<list>`, BIRT's own
 * repeating container, is a real scope boundary named present and never
 * inlined, the way input-jasperreports treats a subreport.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A report title's humps as hyphens before kebab-casing, so a title spelled `CustomerInvoiceReport` survives the
 * round trip through pascal() as one name rather than collapsing, the same separation input-jasperreports keeps. */
const humpKebab = (text) => kebab(String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

const SECTIONS = [
  { tag: "page-header", label: "page header" },
  { tag: "body", label: "body" },
  { tag: "page-footer", label: "page footer" },
];
const BAND_TAGS = ["header", "detail", "footer"];
const BAND_HTML = { header: "thead", detail: "tbody", footer: "tfoot" };

/** A `<label>` (literal text), `<text-item>` (literal text) `<data>` (a resultSetColumn reference or a computed
 * expression) or `<image>` element, rendered as a `<p>` (or nothing, for an image or an unrendered gap). `ctxLabel`
 * names where the element was found, for a note that reads like a sentence. */
function renderLeaf(el, ctxLabel, note) {
  switch (el.tag) {
    case "label": {
      const text = textProp(el, "text");
      return text ? `<p>${esc(text)}</p>` : "";
    }
    case "text-item": {
      const text = textProp(el, "content");
      return text ? `<p>${esc(text)}</p>` : "";
    }
    case "data": {
      const exprEl = childrenOf(el, "expression")[0];
      if (exprEl) {
        note(`${ctxLabel} a data element's value is a computed BIRT expression (an aggregate function, or any other formula) this reader does not evaluate; it renders an empty placeholder rather than any part of it.`);
        return "<p></p>";
      }
      const col = textProp(el, "resultSetColumn");
      if (col) return `<p>{{ ${col.trim()} }}</p>`;
      note(`${ctxLabel} a data element declares neither a resultSetColumn nor an expression; nothing is rendered.`);
      return "";
    }
    case "image":
      note(`${ctxLabel} an image names a source this reader does not evaluate; nothing is rendered in its place.`);
      return "";
    default:
      note(`the \`${el.tag}\` element ${ctxLabel} has no vocabulary entry in this reader; it is named rather than approximated.`);
      return "";
  }
}

/** A table or grid cell, which holds exactly one of `<label>` or `<data>`; anything else the cell holds is named,
 * never approximated, since the vocabulary above is deliberately narrow. */
function renderCell(cellEl, ctxLabel, note) {
  const child = elements(cellEl?.children ?? [])[0];
  if (!child) return "";
  if (child.tag === "label" || child.tag === "data") return renderLeaf(child, ctxLabel, note);
  note(`${ctxLabel} a cell holds a \`${child.tag}\` element rather than a label or data element; it is named rather than approximated.`);
  return "";
}

function renderRow(rowEl, ctxLabel, note) {
  const cells = childrenOf(rowEl, "cell").map((c) => `<td>${renderCell(c, ctxLabel, note)}</td>`);
  return `<tr>${cells.join("")}</tr>`;
}

/** A `<table>`: named which dataset feeds it, then its header/detail/footer bands each as a real `<thead>`,
 * `<tbody>` or `<tfoot>`, so the band this reader does not fabricate a flow for stays the grid BIRT drew it as. */
function renderTable(tableEl, note) {
  const name = attrOf(tableEl, "name") || "table";
  const dataset = listPropText(tableEl, "dataSet");
  if (!dataset) note(`the table \`${name}\` declares no dataSet; nothing feeds it.`);
  const parts = [];
  for (const band of BAND_TAGS) {
    const section = childrenOf(tableEl, band)[0];
    if (!section) continue;
    const ctxLabel = `the table \`${name}\`'s ${band} band's`;
    const rows = childrenOf(section, "row").map((r) => renderRow(r, ctxLabel, note));
    if (rows.length) parts.push(`<${BAND_HTML[band]}>${rows.join("")}</${BAND_HTML[band]}>`);
  }
  return `<table>${parts.join("")}</table>`;
}

/** A `<grid>`: a layout only table with no dataset, named as such, its rows read the same way a table's are,
 * whether they sit in header/detail/footer bands or, as a plain layout grid usually does, directly. */
function renderGrid(gridEl, note) {
  const name = attrOf(gridEl, "name") || "grid";
  note(`the grid \`${name}\` is a layout only table with no dataset; its rows are read structurally the same way a table's are.`);
  const wrapped = BAND_TAGS.some((b) => childrenOf(gridEl, b).length);
  const rows = wrapped
    ? BAND_TAGS.flatMap((b) => childrenOf(childrenOf(gridEl, b)[0], "row"))
    : childrenOf(gridEl, "row");
  const ctxLabel = `the grid \`${name}\`'s`;
  const trs = rows.map((r) => renderRow(r, ctxLabel, note));
  return trs.length ? `<table>${trs.join("")}</table>` : "";
}

/** A `<list>`, BIRT's own repeating container: named as present with the dataset it binds to, and never inlined,
 * since its own header-content/detail-content shape is a nested scope this reader does not reproduce. This is a
 * deliberate scope boundary, not a bug, the way input-jasperreports leaves a subreport named rather than inlined. */
function renderList(listEl, note) {
  const name = attrOf(listEl, "name") || "list";
  const dataset = listPropText(listEl, "dataSet");
  note(`the list \`${name}\` is a repeating list container${dataset ? ` bound to the dataset \`${dataset}\`` : ", bound to no dataset,"} named as present; its own header and detail content is a nested shape this reader does not reproduce.`);
  return "";
}

function renderContentEl(el, sectionLabel, note) {
  switch (el.tag) {
    case "text-item": case "label": case "data": case "image":
      return renderLeaf(el, `the ${sectionLabel} section's`, note);
    case "table": return renderTable(el, note);
    case "grid": return renderGrid(el, note);
    case "list": return renderList(el, note);
    default:
      note(`the \`${el.tag}\` element in the ${sectionLabel} section has no vocabulary entry in this reader; it is named rather than approximated.`);
      return "";
  }
}

/**
 * One `.rptdesign` file lowered onto the shared dialect. `note` is called
 * for every gap this reader finds: a computed expression it does not
 * evaluate, a list it does not inline, an image whose source it does not
 * evaluate, an unrecognised element, and a cell or a table with a shape
 * this reader has no vocabulary for.
 */
export function lowerRptdesign(reportEl, note = () => {}) {
  const title = textProp(reportEl, "title") || "Report";
  const parameters = readParameters(reportEl);
  const dataSets = readDataSets(reportEl);

  const sections = [];
  const sectionsRendered = [];
  for (const { tag, label } of SECTIONS) {
    const sectionEl = childrenOf(reportEl, tag)[0];
    if (!sectionEl) continue;
    const lines = elements(sectionEl.children ?? []).map((el) => renderContentEl(el, label, note)).filter(Boolean);
    sections.push([`<section aria-label="${esc(label)}">`, ...lines, "</section>"].join("\n"));
    sectionsRendered.push(tag);
  }
  if (!sections.length) note("no page-header, body or page-footer section was found; nothing was laid out.");

  const className = pascal(humpKebab(title)) || "Report";
  return {
    template: sections.join("\n"),
    parameters,
    dataSets,
    sectionsRendered,
    className,
    title,
  };
}
