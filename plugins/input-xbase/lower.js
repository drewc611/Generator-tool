import { pascal } from "../dsp-ir/emit.js";

/**
 * What one xBase `@ row, col SAY/GET` screen means, once parse.js has handed
 * it over as a plain ordered list of statements. There is no container tree
 * to walk, the same flat shape input-cics reads a `DFHMDI` map's fields in,
 * so each statement's own `row, col` decides its place: statements are
 * ordered top to bottom, left to right, the same `byPosition` rule
 * input-cics keeps over `POS=(row,col)`, rather than by the order they
 * happened to appear in source (xBase source order usually already matches
 * screen order, but nothing in the language requires it).
 *
 * A screen's own `@ SAY/GET` statements never say what a `READ` returning
 * means: which key ended it (`LASTKEY()`/`READKEY()`) and what to do next
 * live in the calling code around the statements, never inside them, so this
 * reader produces zero outputs, ever, the same honest zero input-cics,
 * input-informix, input-cobolscreen and input-ispf already give a
 * character-cell format with nothing to wire.
 *
 * `PICTURE` is a display/edit mask this reader does not translate. That
 * restraint is named once, here, rather than as a note on every field that
 * carries one, the same restraint input-cics keeps over an ATTRB value
 * beyond PROT/UNPROT/NUM: a field's own PICTURE is common enough that
 * repeating the same sentence per field would be noise, not information.
 * `VALID`, `WHEN` and `RANGE` are named present on the field that carries
 * one, never evaluated: a condition is a decision about the product, and
 * inventing an HTML constraint from source this reader cannot execute would
 * be exactly the guess CLAUDE.md forbids. `DEFAULT` is treated the same way,
 * named present and never read, a deliberate choice over the alternative of
 * parsing its literal: the shared screen shape this reader emits into
 * (fields bound by name alone, the same shape input-cics's own fields use)
 * has nowhere to carry a per-field initial value even if one were read, so
 * reading it would buy no fidelity a person could see in the port.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A name the emitted JavaScript can declare: an xBase variable that spells a reserved word gets a suffix. Not
 * shared with the other readers' own copies of this table: each keeps its own, since the naming choices differ
 * reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/** Top to bottom, left to right: a statement whose row or column was not a plain integer literal sorts after every
 * cleanly positioned one, since it cannot be placed by a position this reader does not trust. */
function byPosition(a, b) {
  const ar = a.positionClean ? a.row : Infinity;
  const br = b.positionClean ? b.row : Infinity;
  if (ar !== br) return ar - br;
  const ac = a.positionClean ? a.col : Infinity;
  const bc = b.positionClean ? b.col : Infinity;
  return ac - bc;
}

/** The identifying text a note names a statement by: its own field once reserved-word-safe, its caption when it has
 * neither a field nor a label, or a plain fallback when it has neither. */
function label(stmt, field) {
  if (field) return `\`${field}\``;
  if (stmt.say !== null) return `"${stmt.say}"`;
  return "an unlabeled statement";
}

/**
 * One `@` statement rendered into zero, one or two template lines (a caption
 * line, a field line, or both), plus every note it earns. `note` is called
 * for a `SAY` argument that is not a plain quoted literal, a `GET` argument
 * that is not a plain identifier, and for a present `VALID`, `WHEN`, `RANGE`
 * or `DEFAULT` clause on a real field.
 */
function renderStatement(stmt, state) {
  const lines = [];
  let field = null;

  if (stmt.get !== null) {
    field = state.unique(declarable(stmt.get));
  } else if (stmt.getRaw !== null) {
    state.note(`an @ statement's GET clause (\`${stmt.getRaw}\`) does not name a plain field; it cannot be bound to a name this reader can trust, so nothing was rendered for it.`);
  }

  if (stmt.say !== null) {
    lines.push(`<p>${esc(stmt.say)}</p>`);
  } else if (stmt.sayRaw !== null) {
    state.note(`${label(stmt, field)}'s SAY expression is not a plain quoted literal; it is not a caption this reader can read, so nothing was rendered for it.`);
  }

  if (field) {
    lines.push(`<input id="f-${field}" type="text" ng-model="${field}">`);
    state.fields.push(field);
  }

  if (stmt.valid) state.note(`${label(stmt, field)} carries a VALID clause; its condition exists and is not evaluated here, so the port must decide what to enforce.`);
  if (stmt.when) state.note(`${label(stmt, field)} carries a WHEN clause; it is only enterable when that condition holds, which this reader does not evaluate.`);
  if (stmt.range) state.note(`${label(stmt, field)} carries a RANGE clause; its bounds exist and are not evaluated here, so the port must enforce them itself.`);
  if (stmt.hasDefault) state.note(`${label(stmt, field)} carries a DEFAULT clause; its initial value is named as existing and not read, so the port must supply one deliberately.`);

  return lines;
}

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

/**
 * One xBase screen (the run of `@ SAY/GET` statements one `READ` closes, or
 * the whole file's own run when it closes none) lowered onto the shared
 * dialect: no conditional, no loop, no interpolation but the field's own
 * `ng-model`, since a full-screen xBase form is a flat grid of positioned
 * captions and inputs with nothing computed. `index` names a screen with no
 * name of its own: `Screen1`, `Screen2`, ... in closing order.
 */
export function lowerXbase(statements, index) {
  const state = makeState();
  const ordered = [...statements].sort(byPosition);
  const lines = [];
  for (const stmt of ordered) {
    for (const line of renderStatement(stmt, state)) lines.push(`  ${line}`);
  }

  const stem = kebab(`screen-${index}`);
  const title = `Screen${index}`;
  const className = pascal(stem);

  return {
    template: ["<div>", ...lines, "</div>"].join("\n"),
    fields: state.fields,
    outputs: [],
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    stem,
    title,
    className,
  };
}
