import { pascal } from "../dsp-ir/emit.js";

/**
 * What a CICS BMS map means, once parse.js has handed it over as plain
 * mapsets, maps and fields. A `DFHMDI` map is one physical 3270 screen, so
 * each becomes its own screen the way input-storyboard treats each `<scene>`
 * as its own screen. A map's fields are not nested in a container tree at
 * all, the same flat shape input-exe reads a native dialog template's
 * controls in, so they are ordered here by their own `POS=(row,col)`, top to
 * bottom, left to right, rather than by the declaration order the source
 * happened to write them in.
 *
 * BMS states no button, no event and no navigation: a 3270 screen is driven
 * by whichever program processes the AID key (PF-keys, Enter) that
 * terminated the operator's input, and this format never says which, so
 * this reader produces no output at all, ever, the same honest zero
 * input-jasperreports and input-birt already give a format with nothing to
 * wire. An `ATTRB` value beyond `PROT`/`ASKIP`/`UNPROT`/`NUM`/`IC` (`BRT`,
 * `NORM`, `DRK`, `FSET` and the rest) is intensity or formatting this reader
 * does not translate, and it is never named per field: doing so for every
 * field carrying one would be noise, the same restraint input-fxml keeps
 * over an attached layout property.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Top to bottom, left to right: a field with no POS at all sorts after every positioned one, since it cannot be
 * placed by a position it never gave. */
function byPosition(a, b) {
  const ar = a.pos ? a.pos.row : Infinity;
  const br = b.pos ? b.pos.row : Infinity;
  if (ar !== br) return ar - br;
  const ac = a.pos ? a.pos.col : Infinity;
  const bc = b.pos ? b.pos.col : Infinity;
  return ac - bc;
}

/**
 * One field rendered, or null when it is empty screen furniture with
 * nothing to show: a protected field with no `INITIAL` and no label. `note`
 * is called for an unlabeled `UNPROT` field (it cannot be bound to a name
 * this reader never had), a declared `NUM` field (rendered as a plain text
 * input regardless), and an `INITIAL` value that is not a clean quoted
 * literal.
 */
function renderField(field, note) {
  const unprot = field.attrb.includes("UNPROT");
  if (unprot) {
    if (!field.label) {
      const at = field.pos ? `row ${field.pos.row}, column ${field.pos.col}` : "an unknown position";
      note(`a field open for typing at ${at} carries no label; it cannot be bound to a name it never had, so it is named here rather than invented.`);
      return null;
    }
    if (field.attrb.includes("NUM")) {
      note(`\`${field.label}\` is declared numeric only; this reader does not enforce that, so it is rendered as a plain text input.`);
    }
    return { line: `<input id="f-${field.label}" type="text" ng-model="${field.label}">`, field: field.label };
  }
  // Protected, autoskip, or left unstated: the operator cannot type here, so it is a caption when it carries one
  // and nothing at all, silently, when it does not, the same "no affordance, nothing rendered" restraint
  // input-uno's own header-only placeholders keep.
  if (field.initial !== null) return { line: `<p>${esc(field.initial)}</p>`, field: null };
  if (field.initialRaw !== null) {
    note(`${field.label ? `\`${field.label}\`'s` : "an unlabeled field's"} initial value is not a plain quoted literal; nothing was assumed from it.`);
  }
  return null;
}

/**
 * One `DFHMDI` map lowered onto the shared dialect: no conditional, no loop
 * and no interpolation, since a BMS screen is a flat fixed grid of captions
 * and inputs with nothing computed. `mapsetLabel` names the mapset a map
 * with no label of its own belongs to, for its fallback title only.
 */
export function lowerCics(map, mapsetLabel = null) {
  const notes = [];
  const note = (text) => { if (!notes.includes(text)) notes.push(text); };

  const fields = [...map.fields].sort(byPosition);
  const lines = [];
  const fieldNames = [];
  for (const field of fields) {
    const rendered = renderField(field, note);
    if (!rendered) continue;
    lines.push(`  ${rendered.line}`);
    if (rendered.field) fieldNames.push(rendered.field);
  }

  // GRPNAME groups fields for CICS's own purposes (typically light pen or cursor-select processing), unrelated to
  // an HTML radio group; named once per map as existing, never turned into a group this reader has no basis for.
  const grpnames = [...new Set(map.fields.map((f) => f.grpname).filter(Boolean))];
  if (grpnames.length) {
    note(`GRPNAME grouping (${grpnames.join(", ")}) exists on this map for CICS's own purposes; named as existing and never turned into an actual radio group.`);
  }

  const stem = map.label ? kebab(map.label) : null;
  const title = map.label || mapsetLabel || "CICS Map";
  const className = pascal(stem || kebab(title) || "cics-map");

  return {
    template: ["<div>", ...lines, "</div>"].join("\n"),
    fields: fieldNames,
    outputs: [],
    notes,
    usesNgFor: false,
    usesTwoWay: fieldNames.length > 0,
    stem,
    title,
    className,
  };
}
