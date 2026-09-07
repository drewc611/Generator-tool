import { pascal, unique } from "../dsp-ir/emit.js";

/**
 * What one OpenEdge `FORM ... WITH FRAME` block means, once parse.js has
 * handed over the file's declarations and buttons' `ON CHOOSE OF` wiring
 * alongside it. A frame's own name list is the one real, load-bearing order
 * this format gives (FORM declares which previously-DEFINEd fields and
 * buttons appear on this screen, and in what order), the same "the source's
 * own list is the truth" rule input-cobolscreen keeps over declaration order
 * and input-xbase keeps over `LINE`/`COLUMN` position: nothing here is
 * re-sorted.
 *
 * `FORMAT "..."` is a display/edit mask this reader does not translate; that
 * restraint is named once, here, rather than as a note on every field that
 * carries one, the same restraint input-xbase keeps over xBase's own
 * `PICTURE` clause.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * An ABL identifier as a JS binding name. Unlike COBOL's own conventionally
 * all-caps, hyphenated data-names, an ABL variable, button or procedure name
 * is ordinarily already written in the case its author chose (`custNo`,
 * `activeFlag`), and this reader's own instruction is to keep that choice
 * rather than re-case it, so a name with no hyphen or underscore is returned
 * exactly as written. Only a hyphenated or underscored name, the one shape
 * JS cannot spell directly, is rewritten to camelCase, the same treatment
 * input-cobolscreen's own camel()/kebab() gives a hyphenated COBOL
 * data-name, kept here as its own copy rather than shared, since the two
 * readers camelCase for different reasons.
 */
const camelize = (name) => {
  const text = String(name ?? "");
  if (!/[-_]/.test(text)) return text;
  const [first, ...rest] = text.split(/[-_]+/).filter(Boolean);
  return (first ?? "").toLowerCase() + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("");
};

/** A name the emitted JavaScript can declare: an ABL name that spells a reserved word gets a suffix. Not shared with
 * the other readers' own copies of this table: each keeps its own, since the naming choices differ reader to
 * reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [],
    outputs: [],
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

/** A DEFINE VARIABLE entry rendered: a real checkbox for AS LOGICAL, a real text input for anything else. A field
 * with no LABEL clause at all is still a real field, rendered with no caption paired to it rather than an invented
 * one. */
function renderVariable(decl, state) {
  const field = state.unique(camelize(decl.name));
  state.fields.push(field);
  const type = decl.type.toUpperCase() === "LOGICAL" ? "checkbox" : "text";
  const lines = [];
  if (decl.label) lines.push(`<label for="f-${field}">${esc(decl.label)}</label>`);
  else state.note(`\`${decl.name}\` declares no LABEL; it is rendered with no caption paired to it.`);
  lines.push(`<input id="f-${field}" type="${type}" ng-model="${field}">`);
  return lines;
}

/**
 * A DEFINE BUTTON entry rendered, its caption its own LABEL when it declared
 * one (a button with none is named through a note rather than given an
 * invented caption), its click resolved from `onChoose`: a clean `RUN
 * name.` body becomes a real output named after the procedure; a "complex"
 * body (more than one statement, or one that is not a bare RUN) is named
 * through a note as wired to something not read for what it does, the same
 * restraint input-autoit keeps over a Case/If block with more than one
 * statement; a button with no ON CHOOSE OF block at all is named unwired.
 */
function renderButton(decl, onChoose, state) {
  const caption = decl.label ? esc(decl.label) : "";
  if (!decl.label) state.note(`\`${decl.name}\` declares no LABEL; it is rendered with no caption invented for it.`);

  const wiring = onChoose[decl.name];
  if (!wiring) {
    state.note(`\`${decl.name}\` has no ON CHOOSE wiring anywhere in the file; it is emitted unwired.`);
    return `<button type="button">${caption}</button>`;
  }
  if (!wiring.clean) {
    state.note(`\`${decl.name}\`'s ON CHOOSE handler is wired to something not read for what it does (its body is not one clean bare RUN statement), so nothing was assumed from it.`);
    return `<button type="button">${caption}</button>`;
  }

  const event = camelize(wiring.runName);
  state.outputs.push(event);
  return `<button type="button" ng-click="on${pascal(event)}()">${caption}</button>`;
}

/**
 * One frame lowered onto the shared dialect: no conditional, no loop, no
 * interpolation, since a FORM block is a flat, declared-order list of
 * captions, fields and buttons with nothing computed. `frame` is
 * `{ frame: name, names: [...] }` from parse.js; `declarations` and
 * `onChoose` are the whole file's own, shared across every frame it holds.
 * A name in the FORM list with no matching DEFINE anywhere is named through
 * a note rather than invented a field for.
 */
export function lowerOpenEdge(frame, declarations, onChoose) {
  const state = makeState();
  const lines = [];

  for (const name of frame.names) {
    const decl = declarations[name];
    if (!decl) {
      state.note(`\`${name}\` appears in the FORM naming frame ${frame.frame} but was never DEFINEd anywhere in the file; nothing was rendered for it.`);
      continue;
    }
    if (decl.kind === "button") lines.push(renderButton(decl, onChoose, state));
    else lines.push(...renderVariable(decl, state));
  }

  const stem = kebab(frame.frame);
  const title = frame.frame;
  const className = pascal(stem || "openedge-screen");

  return {
    template: ["<div>", ...lines.map((l) => `  ${l}`), "</div>"].join("\n"),
    fields: state.fields,
    outputs: unique(state.outputs),
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    stem,
    title,
    className,
  };
}
