import { parseAttributes, tokenizeRow } from "./parse.js";

/**
 * What an Informix `.per` screen form means, once parse.js has handed over
 * its SCREEN rows and its ATTRIBUTES map. There is no container tree here
 * the way a Qt or GTK Builder form gives one: the screen block's row and
 * column position already is the layout, so this reader keeps only reading
 * order (top to bottom, left to right) and drops exact column alignment,
 * which the task this format was built for never needed a browser to keep.
 *
 * A field's real meaning, its table and column and whether it takes typed
 * input, lives in ATTRIBUTES, keyed by the same tag the SCREEN block wrote
 * in brackets. Two honest choices this reader makes and states once rather
 * than per occurrence:
 *
 *   - NOENTRY means the operator cannot type into the field, so it is never
 *     rendered as an ng-model input. With no recording or sample data to draw
 *     a real value from, its column name is carried across as a bare dialect
 *     interpolation, `{{ name }}`, the same honest treatment input-jasperreports
 *     and input-birt already give a bare report field reference: a value the
 *     component is handed, never one this reader invents.
 *   - REVERSE, BOLD and HIGH are terminal display attributes with nothing to
 *     translate them onto in a browser; they are read and intentionally never
 *     acted on, the same restraint every other reader keeps over an opaque
 *     visual property (Qt's, GTK Builder's, PowerBuilder's). One comment here
 *     says so; nothing is emitted per occurrence for it.
 *
 * A `.per` file names no button, no submit and no event anywhere: the 4GL
 * program's own INPUT/CONSTRUCT statements drive the form, and this format
 * never writes them down. This reader produces zero outputs, the same
 * honest zero input-jasperreports and input-birt already establish for a
 * document with nothing to wire.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A name the emitted JavaScript can declare: a column or tag that spells a reserved word gets a suffix. Not shared
 * with the other readers' copies of this table: each keeps its own, since the naming choices differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [],
    note(text) { if (!notes.includes(text)) notes.push(text); },
    notes,
    unique(base) {
      const stem = declarable(base || "field");
      let name = stem; let n = 2;
      while (names.has(name)) name = `${stem}${n++}`;
      names.add(name);
      return name;
    },
  };
}

/** A field met for the first time: its ATTRIBUTES entry decides how it renders. A tag with no ATTRIBUTES statement at
 * all is named as a mismatch and rendered as a plain enterable field, since there is no evidence either way that the
 * operator cannot type into it; guessing NOENTRY for a field the file never says is NOENTRY would be the wrong kind
 * of guess. */
function renderField(tag, attrs, state) {
  const entry = attrs.get(tag);
  if (!entry) {
    state.note(`\`${tag}\` appears on screen with no declared table or column binding; rendered as a plain enterable field with nothing bound to it.`);
    const name = state.unique(declarable(tag));
    state.fields.push(name);
    return `<input id="f-${name}" type="text" ng-model="${name}">`;
  }

  const name = state.unique(declarable(entry.column || tag));
  const title = entry.comments ? ` title="${esc(entry.comments)}"` : "";

  if (entry.modifiers.has("REQUIRED")) {
    state.note(`\`${tag}\` (${name}) is marked required; the port must enforce this itself, since no validation behaviour was observed to carry across as a real HTML \`required\` attribute.`);
  }

  if (entry.modifiers.has("NOENTRY")) return `<span${title}>{{ ${name} }}</span>`;

  state.fields.push(name);
  return `<input id="f-${name}" type="text" ng-model="${name}"${title}>`;
}

/**
 * One `.per` file's SCREEN rows and ATTRIBUTES map, lowered onto the shared
 * dialect. `note` receives every gap: a SCREEN placeholder with no
 * ATTRIBUTES statement, an ATTRIBUTES statement whose tag never appears on
 * screen, an empty `[]` placeholder, and an ATTRIBUTES modifier this reader
 * does not recognise.
 */
export function lowerInformix(parsed, rel, note = () => {}) {
  if (!parsed.screen.present) { note(`${rel}: no SCREEN section; nothing was read.`); return null; }
  if (parsed.screen.unreadable) { note(`${rel}: the SCREEN section's { ... } block has no matching closing brace; nothing was read.`); return null; }

  const state = makeState();
  const attrs = parseAttributes(parsed.attributesLines, (n) => state.note(n));
  return buildTemplate(parsed.screen.rows, rel, attrs, state);
}

function buildTemplate(rows, rel, attrs, state) {
  const seen = new Set();
  const lines = [];
  let heading = null;
  let firstContentRow = true; // the screen block's own first row of real content, blank lines aside, reads as its heading

  rows.forEach((row, rowIndex) => {
    const tokens = tokenizeRow(row);
    if (!tokens.length) return;

    const parts = [];
    for (const tok of tokens) {
      if (tok.kind === "text") { parts.push(esc(tok.value)); continue; }
      if (!tok.tag) { state.note(`row ${rowIndex + 1}: an empty [] placeholder with no tag was found; skipped.`); continue; }
      if (seen.has(tok.tag)) continue; // the same tag reappearing is the same field wrapped onto another row, not a second one
      seen.add(tok.tag);
      parts.push(renderField(tok.tag, attrs, state));
    }
    if (!parts.length) return;

    if (firstContentRow && tokens.every((t) => t.kind === "text")) heading = parts.join(" ");
    else lines.push(`  <p>${parts.join(" ")}</p>`);
    firstContentRow = false;
  });

  for (const [tag, entry] of attrs) {
    if (!seen.has(tag)) state.note(`\`${tag}\` (${entry.column}) has a declared table or column binding but never appears anywhere on screen; nothing was rendered for it.`);
  }

  const template = ["<div>", ...(heading ? [`  <h2>${heading}</h2>`] : []), ...lines, "</div>"].join("\n");
  const stem = kebab(rel.replace(/\.per$/i, "").split("/").pop()) || "screen";
  return {
    template,
    fields: state.fields,
    outputs: [],
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    className: stem,
    title: heading || stem,
  };
}
