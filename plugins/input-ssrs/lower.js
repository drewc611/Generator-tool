import { pascal } from "../dsp-ir/emit.js";
import { attrOf } from "../dsp-ir/markup.js";
import { childrenOf, readDataSets, readParameters, sectionItems, tablixRows, textOf } from "./parse.js";

/**
 * What an RDL section or item means, once parse.js has handed it over as
 * plain elements. A report is a document layout, not an interactive form: no
 * input, no button, no event, so it becomes a read only screen the way
 * input-jasperreports's and input-birt's reports do, one `<section>` per top
 * level part of the page, PageHeader, Body and PageFooter, RDL's own names
 * for the parts the other two readers' equivalents already are, in the
 * order the page prints them.
 *
 * A Tablix is RDL's table/matrix/list construct, the modern replacement for
 * the older Table/List elements some files still carry (an unimplemented
 * legacy `<Table>` is simply named through `note`, the same restraint kept
 * for any other unrecognised element). Its own deeply nested TablixBody
 * layout is flattened by parse.js into rows of cells and rendered here as a
 * real HTML `<table>`. RDL's own schema draws no header/detail/footer
 * distinction inside a Tablix the way BIRT's table does, so every row lands
 * in one `<tbody>` rather than a split this reader would have to invent.
 *
 * A bare `=Fields!name.Value` or `=Parameters!name.Value` reference is the
 * one expression shape this reader evaluates, lowered onto the dialect's own
 * interpolation. Anything else beginning with `=` (a function call, string
 * concatenation, IIf, an operator) is a computed RDL expression this reader
 * does not evaluate, named through `note` and rendered as an empty
 * placeholder rather than guessed at or partly reproduced.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A file stem's humps as hyphens before kebab-casing, so a name spelled `InvoiceReport` survives the round trip through pascal() as one name rather than collapsing, the same separation input-jasperreports and input-birt keep. */
const humpKebab = (text) => kebab(String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2"));

// A bare =Fields!name.Value or =Parameters!name.Value reference and nothing else, whitespace aside. Anything more (a
// function call, an operator, a second reference, a string literal) fails the match on purpose: an RDL expression
// this reader does not evaluate is named, never partially read.
const FIELD_REF = /^=Fields!([A-Za-z_]\w*)\.Value$/;
const PARAM_REF = /^=Parameters!([A-Za-z_]\w*)\.Value$/;

const SECTIONS = [
  { tag: "pageheader", label: "page header", name: "PageHeader" },
  { tag: "body", label: "body", name: "Body" },
  { tag: "pagefooter", label: "page footer", name: "PageFooter" },
];

function renderTextbox(el, where, note) {
  const raw = textOf(childrenOf(el, "value")[0]).trim();
  if (!raw) return "";
  if (!raw.startsWith("=")) return `<p>${esc(raw)}</p>`;
  const mf = FIELD_REF.exec(raw);
  if (mf) return `<p>{{ ${mf[1]} }}</p>`;
  const mp = PARAM_REF.exec(raw);
  if (mp) return `<p>{{ ${mp[1]} }}</p>`;
  note(`a textbox ${where} carries a computed RDL expression (a function call, string concatenation, IIf, or an operator) this reader does not evaluate; it renders an empty placeholder rather than any part of it.`);
  return `<p></p>`;
}

function renderImage(where, note) {
  note(`an image ${where} names a source this reader does not evaluate; nothing is rendered in its place.`);
  return "";
}

function renderSubreport(el, where, note) {
  const name = textOf(childrenOf(el, "reportname")[0]).trim();
  note(`a subreport ${where} names \`${name || "an unnamed report"}\` as a nested report this reader does not follow; nothing from it is inlined here.`);
  return "";
}

/** A Textbox, Image, Line, Rectangle, Subreport or nested Tablix, wherever one turns up: at the top of a section, or
 * inside a Tablix cell. `where` names the context for a note that reads like a sentence. */
function renderItem(el, where, note) {
  switch (el.tag) {
    case "textbox": return renderTextbox(el, where, note);
    case "tablix": return renderTablix(el, note);
    case "image": return renderImage(where, note);
    case "line": return "<hr>";
    case "rectangle": return '<div class="box"></div>';
    case "subreport": return renderSubreport(el, where, note);
    default:
      note(`the \`${el.tag}\` element ${where} has no vocabulary entry in this reader; it is named rather than approximated.`);
      return "";
  }
}

/** A `<Tablix>`, RDL's table/matrix/list construct: named by which dataset feeds it, then every TablixRow parse.js
 * flattened rendered into one `<tbody>`, since RDL's own schema draws no header/detail/footer distinction inside a
 * Tablix the way BIRT's table does. */
function renderTablix(el, note) {
  const name = attrOf(el, "name") || "tablix";
  const dataset = textOf(childrenOf(el, "datasetname")[0]).trim();
  if (dataset) note(`the tablix \`${name}\` is fed by the dataset \`${dataset}\`.`);
  else note(`the tablix \`${name}\` declares no DataSetName; nothing feeds it.`);

  const where = `in the tablix \`${name}\`'s cell`;
  const rows = tablixRows(el).map((cells) => {
    const tds = cells.map((c) => `<td>${c ? renderItem(c, where, note) : ""}</td>`);
    return `<tr>${tds.join("")}</tr>`;
  });
  return rows.length ? `<table><tbody>${rows.join("")}</tbody></table>` : "<table></table>";
}

/**
 * One `.rdl` file lowered onto the shared dialect. `name` is the file's own
 * stem: RDL carries no report level name of its own the way a `.jrxml`'s
 * `name` attribute or a `.rptdesign`'s title property does, so the file's
 * own name is the honest source, the same choice input-pdf makes for a
 * document with no title of its own. `note` is called for every gap this
 * reader finds: a computed expression it does not evaluate, a subreport it
 * does not follow, an image whose source it does not evaluate, a Tablix's
 * dataset, and an unrecognised element.
 */
export function lowerRdl(reportEl, name, note = () => {}) {
  const parameters = readParameters(reportEl);
  const dataSets = readDataSets(reportEl);

  const sections = [];
  const sectionsRendered = [];
  for (const { tag, label, name: sectionName } of SECTIONS) {
    const sectionEl = childrenOf(reportEl, tag)[0];
    if (!sectionEl) continue;
    const where = `in the ${label} section`;
    const lines = sectionItems(sectionEl).map((el) => renderItem(el, where, note)).filter(Boolean);
    sections.push([`<section aria-label="${esc(label)}">`, ...lines, "</section>"].join("\n"));
    sectionsRendered.push(sectionName);
  }
  if (!sections.length) note("no PageHeader, Body or PageFooter section was found; nothing was laid out.");

  const className = pascal(humpKebab(name)) || "Report";
  return {
    template: sections.join("\n"),
    parameters,
    dataSets,
    sectionsRendered,
    className,
    title: name,
  };
}
