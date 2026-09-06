import { pascal } from "../dsp-ir/emit.js";
import { attrOf } from "../dsp-ir/markup.js";
import { bandElements, childrenOf, readBands, readFields, readGroups, readParameters, textOf } from "./parse.js";

/**
 * What a JasperReports band means, once parse.js has handed it over as plain
 * elements. A `.jrxml` lays out a report the way a PDF data sheet lays out a
 * page: somebody's words and values, positioned once, that a port carries
 * without inventing any. There is no interactivity to wire, no input, no
 * button, no event, so the report becomes a read only screen the way
 * input-pdf's documents do, one `<section>` per band in the order the page
 * prints them.
 *
 * `$F{name}`, `$P{name}` and `$V{name}` are the one shape this reader
 * evaluates: a bare reference to a field, a parameter or a report variable,
 * lowered onto the dialect's own interpolation. Anything a textField
 * expression does beyond that bare reference (string concatenation, a
 * `SimpleDateFormat` call, a conditional, arithmetic) is a computed value
 * this reader does not evaluate, named through `note` and rendered as an
 * empty placeholder rather than guessed at or partly reproduced.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A report name's humps as hyphens before kebab-casing, so `InvoiceReport` survives the round trip through pascal()
 * as `InvoiceReport` rather than collapsing into one word: the same spelling qt and gwt already keep, kept separate
 * here since the naming choices differ reader to reader. */
const humpKebab = (text) => kebab(String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

/** A bare `$F{name}`, `$P{name}` or `$V{name}` reference and nothing else, whitespace aside. Anything more (a second
 * reference, a method call, an operator, a string literal, a `new` expression) fails the match on purpose: a report
 * expression this reader does not evaluate is named, never partially read. */
const BARE_REF = /^\s*\$[FPV]\{([^{}]*)\}\s*$/;

const BAND_LABEL = {
  title: "title", pageHeader: "page header", columnHeader: "column header",
  detail: "detail", columnFooter: "column footer", pageFooter: "page footer", summary: "summary",
};

function renderStaticText(el) {
  const text = textOf(childrenOf(el, "text")[0]);
  return text ? `  <p>${esc(text)}</p>` : "";
}

function renderTextField(el, bandLabel, note) {
  const raw = textOf(childrenOf(el, "textfieldexpression")[0]);
  const m = BARE_REF.exec(raw ?? "");
  if (m) return `  <p>{{ ${m[1].trim()} }}</p>`;
  note(`the ${bandLabel} band's textField expression is more than a bare field, parameter or variable reference (string concatenation, a formatting call, a conditional or arithmetic, say); this reader does not evaluate report expressions, so it renders an empty placeholder rather than any part of it.`);
  return `  <p></p>`;
}

function renderImage(bandLabel, note) {
  note(`an image in the ${bandLabel} band names a source expression this reader does not evaluate; nothing is rendered in its place.`);
  return "";
}

function renderSubreport(bandLabel, note) {
  note(`a subreport in the ${bandLabel} band is a nested report this reader does not follow; nothing from it is inlined here.`);
  return "";
}

function renderElement(el, bandLabel, note) {
  switch (el.tag) {
    case "statictext": return renderStaticText(el);
    case "textfield": return renderTextField(el, bandLabel, note);
    case "line": case "break": return "  <hr>";
    case "rectangle": return '  <div class="box"></div>';
    case "image": return renderImage(bandLabel, note);
    case "subreport": return renderSubreport(bandLabel, note);
    // reportElement only carries position and size, which this reader does not reproduce; a graphicElement's
    // shared attributes (pen, forecolor) live inside line/rectangle/image and are read there or not at all.
    case "reportelement": return "";
    default:
      note(`the \`${el.tag}\` element in the ${bandLabel} band has no vocabulary entry in this reader; it is named rather than approximated.`);
      return "";
  }
}

/**
 * One `.jrxml` file lowered onto the shared dialect. `note` is called for
 * every gap this reader finds: a computed expression it does not evaluate,
 * a subreport it does not follow, an image whose source it does not
 * evaluate, an unrecognised element, and a band this reader read as present
 * but did not lay out.
 */
export function lowerJrxml(reportEl, note = () => {}) {
  const name = attrOf(reportEl, "name") || "Report";
  const parameters = readParameters(reportEl);
  const fields = readFields(reportEl);
  const { laidOut, namedOnly } = readBands(reportEl);
  const groups = readGroups(reportEl);

  if (!laidOut.length) {
    note("no title, pageHeader, columnHeader, detail, columnFooter, pageFooter or summary band was found; nothing was laid out.");
  }

  const sections = [];
  for (const { tag, band } of laidOut) {
    const bandLabel = BAND_LABEL[tag];
    const lines = bandElements(band).map((el) => renderElement(el, bandLabel, note)).filter(Boolean);
    sections.push([`<section aria-label="${esc(bandLabel)}">`, ...lines, "</section>"].join("\n"));
  }

  for (const tag of namedOnly) {
    note(`the ${tag} band is present; its layout is not reproduced here, since it is not the plain top to bottom flow the rest of the page is.`);
  }
  for (const g of groups) {
    note(`the group \`${g}\` declares its own header and footer bands; which rows belong to it is a data grouping this reader does not compute, so its bands are named rather than laid out.`);
  }

  const className = pascal(humpKebab(name));
  return {
    template: sections.join("\n"),
    parameters,
    fields,
    bandsRendered: laidOut.map((b) => b.tag),
    namedOnly,
    groups,
    className: className || "Report",
    title: name,
  };
}
