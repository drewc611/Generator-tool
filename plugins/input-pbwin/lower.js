import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";

/**
 * What one PB/Win dialog's own `CONTROL ADD` calls mean, once parse.js has
 * handed them over as a plain, declaration-ordered list. There is no
 * container tree to walk (PowerBASIC draws every DDT control flat against
 * the one dialog `DIALOG NEW` opened), so each control renders in the order
 * its own statement appears, the same flat shape input-autoit already reads
 * its own window in.
 *
 * PowerBASIC identifies a DDT control by a plain numeric id, a genuinely
 * different identity mechanism from every other statement-built reader's
 * own variable-assignment convention (input-autoit's return value, Tk's
 * `-textvariable`). Nothing else in the file gives a control a friendlier
 * name, so this reader's own naming convention, spelled out here rather than
 * left implicit, is the id itself under a `control` prefix (`control101`),
 * stable for as long as the source keeps that id.
 *
 * Grouping heuristic, named honestly: PB/Win's own DDT gives a radio option
 * no explicit "these belong together" reference at all, the real runtime
 * rule Windows radio buttons generally follow. A run of consecutive `OPTION`
 * controls, with no other control between them, is read as one group
 * sharing the first option's own id-derived field name. That is this
 * reader's own structural convenience, not a rule PowerBASIC states, the
 * same restraint input-uno, input-powerbuilder and input-autoit already
 * document for their own ungrouped formats.
 *
 * `BUTTON` wires its action through the optional, trailing `CALL procname`
 * clause parse.js already resolved off its own `CONTROL ADD` statement: a
 * clean, explicit reference, the strongest kind, needing no event-loop
 * matching the way input-autoit has to do for its own buttons. Absent that
 * clause, the button is named as unwired rather than left to guess at.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/** Recognised control types, PowerBASIC's own keyword spelling, matched case-insensitively like every other keyword
 * this reader reads. `LISTBOX` and `COMBOBOX` are real DDT controls but outside this reader's short list, named
 * through a note as unrecognised rather than approximated, the same restraint kept over anything else PowerBASIC
 * might add a control for. */
const KNOWN = new Set(["label", "textbox", "checkbox", "option", "button", "frame"]);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(),
    note(text) { if (!notes.includes(text)) notes.push(text); },
    notes,
    unique(base) {
      const stem = declarable(base || "control");
      let name = stem; let n = 2;
      while (names.has(name)) name = `${stem}${n++}`;
      names.add(name);
      return name;
    },
  };
}

/** A control's own field name, `control` plus its own numeric id, or null when the id is not a plain number (a
 * real gap: nothing else in a DDT statement names the control at all, so an unresolvable id leaves it with no
 * name this reader can bind a field to). */
function fieldOf(ctrl, state) {
  if (!/^\d+$/.test(ctrl.idRaw)) return null;
  return state.unique(declarable(`control${ctrl.idRaw}`));
}

function renderLabel(ctrl, state) {
  if (ctrl.hasText && ctrl.text !== null) return [`<p>${esc(ctrl.text)}</p>`];
  state.note(`a LABEL control (id ${ctrl.idRaw}) has no plain string literal in its own \`"text"\` argument; it is not a caption this reader can read, so nothing was rendered for it.`);
  return [];
}

function renderTextInput(ctrl, state) {
  const field = fieldOf(ctrl, state);
  if (!field) {
    state.note(`a TEXTBOX control's own id \`${ctrl.idRaw}\` is not a plain number; it has no name this reader can bind a field to, so nothing was rendered for it.`);
    return [];
  }
  state.fields.push(field);
  return [`<input id="f-${field}" type="text" ng-model="${field}">`];
}

function renderCheckbox(ctrl, state) {
  const field = fieldOf(ctrl, state);
  if (!field) {
    state.note(`a CHECKBOX control's own id \`${ctrl.idRaw}\` is not a plain number; it has no name this reader can bind a field to, so nothing was rendered for it.`);
    return [];
  }
  state.fields.push(field);
  const label = ctrl.text ?? "";
  return [`<label><input type="checkbox" ng-model="${field}"> ${esc(label)}</label>`];
}

/** One option's own template line. `group` is the shared field this run of consecutive OPTION controls already
 * agreed on in the pass below; a run whose first option had no resolvable id has no group at all, so every option
 * in it is named and skipped, the same restraint every other field-like control keeps over a control this reader
 * cannot name. */
function renderOption(ctrl, group, state) {
  if (!group) {
    state.note(`a run of OPTION controls starts with one whose own id \`${ctrl.idRaw}\` is not a plain number; the group has no name this reader can bind a field to, so nothing was rendered for it.`);
    return [];
  }
  const label = ctrl.text ?? "";
  const value = attrSafe(kebab(label) || `option${ctrl.idRaw}`);
  return [`<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`];
}

function renderButton(ctrl, state) {
  const label = ctrl.text ?? "";
  if (!ctrl.callName) {
    state.note(`the button \`${label || `control${ctrl.idRaw}`}\` (id ${ctrl.idRaw}) carries no \`CALL\` clause on its own CONTROL ADD statement; it is emitted with no wiring found.`);
    return [`<button type="button">${esc(label)}</button>`];
  }
  const event = ctrl.callName.charAt(0).toLowerCase() + ctrl.callName.slice(1);
  state.outputs.add(event);
  return [`<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

function renderFrame(ctrl) {
  const label = ctrl.text ?? "";
  return label ? [`<h2>${esc(label)}</h2>`] : [];
}

/**
 * Every OPTION's own shared group field settled in one pass over declaration
 * order, before anything renders, so a run of consecutive options resolves
 * the same regardless of where in the walk it is met: any other control
 * between two options starts a new run, since PB/Win gives grouping no
 * reference of its own to follow instead.
 */
function prepareOptionGroups(controls, state) {
  const groups = new Map();
  let run = null;
  for (const ctrl of controls) {
    if (ctrl.type.toLowerCase() !== "option") { run = null; continue; }
    if (run === null) {
      const field = fieldOf(ctrl, state);
      if (field) state.fields.push(field);
      run = field;
    }
    groups.set(ctrl, run);
  }
  return groups;
}

/**
 * One PB/Win dialog, already resolved by parse.js to its own handle and
 * ordered control list, lowered onto the shared dialect: no conditional, no
 * loop, no interpolation but each field's own `ng-model`, since the dialog
 * is a flat, ordered list of captions and controls the same way an AutoIt
 * window already is.
 */
export function lowerPbwin(dialog) {
  const state = makeState();
  const groups = prepareOptionGroups(dialog.controls, state);

  if (dialog.titleRaw !== null && dialog.titleRaw.trim() !== "" && dialog.title === null) {
    state.note("`DIALOG NEW`'s own title argument is not a plain string literal; the dialog is named from the file instead.");
  }

  const lines = [];
  for (const ctrl of dialog.controls) {
    const kind = ctrl.type.toLowerCase();
    let rendered;
    if (!KNOWN.has(kind)) {
      state.note(`\`${ctrl.type}\` is not a recognised CONTROL ADD type; it is named here rather than approximated.`);
      rendered = [];
    } else if (kind === "label") rendered = renderLabel(ctrl, state);
    else if (kind === "textbox") rendered = renderTextInput(ctrl, state);
    else if (kind === "checkbox") rendered = renderCheckbox(ctrl, state);
    else if (kind === "option") rendered = renderOption(ctrl, groups.get(ctrl), state);
    else if (kind === "frame") rendered = renderFrame(ctrl);
    else rendered = renderButton(ctrl, state);
    for (const line of rendered) lines.push(`  ${line}`);
  }

  const stem = kebab(dialog.title || "pbwin-screen") || "pbwin-screen";
  const className = pascal(stem) || "PbwinScreen";

  return {
    template: ["<div>", ...lines, "</div>"].join("\n"),
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    stem,
    title: dialog.title || className,
    className,
  };
}
