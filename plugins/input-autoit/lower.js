import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { parseAutoitString } from "./parse.js";

/**
 * What an AutoIt window's own `GUICtrlCreate*` calls mean, once parse.js has
 * handed them over as a plain, declaration-ordered list. There is no
 * container tree to walk (AutoIt draws every control flat against the one
 * window `GUICreate` opened), so each control renders in the order its call
 * appears, the same flat shape input-xbase and input-cics already read a
 * legacy screen's own fields in.
 *
 * `GUICtrlCreateLabel` becomes a caption; `GUICtrlCreateInput` and
 * `GUICtrlCreatePassword` a real input, the password variant genuinely its
 * own AutoIt function rather than a style flag; `GUICtrlCreateCheckbox` and
 * `GUICtrlCreateRadio` a real checkbox and radio. Every one of those four
 * needs a field name to bind `ng-model` to, and AutoIt gives none of them a
 * "bind to this name" argument the way Tcl's `-textvariable` does, so the
 * field name is read from the variable the control's own return value was
 * assigned to; a control whose return value is never assigned to anything at
 * all is a real gap named through a note rather than invented, since nothing
 * anywhere refers to it.
 *
 * Grouping heuristic, named honestly: AutoIt gives radio buttons no explicit
 * "these belong together" reference at all, unlike Tk's shared
 * `-variable`. A run of consecutive `GUICtrlCreateRadio` calls, with no
 * other control between them, is read as one group sharing the first
 * radio's own field name. That is this reader's own structural convenience,
 * not a rule AutoIt states, the same restraint input-uno, input-powerbuilder
 * and input-fxml already keep over their own radios.
 *
 * `GUICtrlCreateButton` wires nothing on its own creation call at all: its
 * action lives entirely in the event loop parse.js already scanned, a `Case`
 * or `If` block matching the button's own variable. A clean, single function
 * call there becomes the button's output; anything else found there, and a
 * variable never referenced there at all, are each named through a note
 * rather than guessed at.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** camelCase's or PascalCase's own word boundaries made explicit before kebab lowercases them away: AutoIt's own
 * user function names (`HandleOk`, `btnSaveClick`) carry their boundaries this way, the same convenience
 * input-storyboard already keeps over Swift/Objective-C's own method names. */
const splitCamel = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2");
const camel = (text) => {
  const p = pascal(kebab(splitCamel(text)));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** Not shared with the other readers' own copies of this table: each keeps its own, since the naming choices
 * (a suffix, a prefix) differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

const KNOWN = new Set(["guictrlcreatelabel", "guictrlcreateinput", "guictrlcreatepassword", "guictrlcreatecheckbox", "guictrlcreateradio", "guictrlcreatebutton"]);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(),
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

/** The text argument of a control's own call, as a plain literal, or null when it is a variable or an expression
 * this reader does not evaluate. */
const textArg = (ctrl) => (ctrl.args.length ? parseAutoitString(ctrl.args[0]) : null);

/** A control's own field name from the variable its return value was assigned to, or null when there is none; the
 * one place every field-like control reads its name from, since AutoIt gives none of them a binding argument. */
function fieldOf(ctrl, state) {
  if (!ctrl.variable) return null;
  return state.unique(declarable(ctrl.variable));
}

function renderLabel(ctrl, state) {
  const text = textArg(ctrl);
  if (text !== null) return [`<p>${esc(text)}</p>`];
  state.note("a GUICtrlCreateLabel call's text argument is not a plain string literal; it is not a caption this reader can read, so nothing was rendered for it.");
  return [];
}

function renderTextInput(ctrl, state, type) {
  const field = fieldOf(ctrl, state);
  if (!field) {
    state.note(`a ${ctrl.name} call's return value is never assigned to a variable; it has no name this reader can bind a field to, since nothing anywhere refers to it, so nothing was rendered for it.`);
    return [];
  }
  state.fields.push(field);
  return [`<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderCheckbox(ctrl, state) {
  const field = fieldOf(ctrl, state);
  if (!field) {
    state.note("a GUICtrlCreateCheckbox call's return value is never assigned to a variable; it has no name this reader can bind a field to, so nothing was rendered for it.");
    return [];
  }
  state.fields.push(field);
  const label = textArg(ctrl) ?? "";
  return [`<label><input type="checkbox" ng-model="${field}"> ${esc(label)}</label>`];
}

/**
 * One radio's own template line. `group` is the shared field this run of
 * consecutive radios already agreed on in the pass below; a run whose first
 * radio had no assigned variable has no group at all, so every radio in it
 * is named and skipped, the same restraint every other field-like control
 * keeps over a control nothing refers to.
 */
function renderRadio(ctrl, group, state) {
  if (!group) {
    state.note("a run of GUICtrlCreateRadio calls starts with one whose return value is never assigned to a variable; the group has no name this reader can bind a field to, so nothing was rendered for it.");
    return [];
  }
  const label = textArg(ctrl) ?? "";
  const value = attrSafe(kebab(label) || kebab(ctrl.variable) || "choice");
  return [`<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`];
}

function renderButton(ctrl, state, wiring) {
  const label = textArg(ctrl) ?? "";
  const variable = ctrl.variable;
  if (!variable || !wiring.has(variable)) {
    state.note(`the button \`${label || variable || "(unnamed)"}\` is never referenced in any Case or If block against \`$msg\`; it is emitted with no wiring found.`);
    return [`<button type="button">${esc(label)}</button>`];
  }
  const call = wiring.get(variable);
  if (call === null) {
    state.note(`the button \`${label || variable}\`'s own Case/If block is not one clean function call (more than one statement, a bare keyword, or nothing recognizable); it is wired to something not read for what it does.`);
    return [`<button type="button">${esc(label)}</button>`];
  }
  const event = camel(call) || "click";
  state.outputs.add(event);
  return [`<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

/**
 * Every radio's own shared group field settled in one pass over declaration
 * order, before anything renders, so a run of consecutive radios resolves
 * the same regardless of where in the walk it is met: a `GUICtrlCreateGroup`
 * call or any other non-radio control between two radios starts a new run,
 * since AutoIt gives grouping no reference of its own to follow instead.
 */
function prepareRadioGroups(controls, state) {
  const groups = new Map();
  let run = null;
  for (const ctrl of controls) {
    if (ctrl.name.toLowerCase() !== "guictrlcreateradio") { run = null; continue; }
    if (run === null) {
      const field = ctrl.variable ? state.unique(declarable(ctrl.variable)) : null;
      if (field) state.fields.push(field);
      run = field;
    }
    groups.set(ctrl, run);
  }
  return groups;
}

/**
 * One AutoIt `.au3` file's window lowered onto the shared dialect: no
 * conditional, no loop, no interpolation but each field's own `ng-model`,
 * since the window is a flat, ordered list of captions and controls. `read`
 * is parse.js's own structural read of the file.
 */
export function lowerAutoit(read) {
  const state = makeState();
  const radioGroups = prepareRadioGroups(read.controls, state);

  if (read.titleRaw !== null && read.title === null) {
    state.note("GUICreate's own title argument is not a plain string literal; the window is named from the file instead.");
  }
  if (read.extraWindows > 0) {
    state.note(`${read.extraWindows} additional GUICreate call(s) exist beyond the first; a second window is not read, only the file's first.`);
  }

  const lines = [];
  for (const ctrl of read.controls) {
    const kind = ctrl.name.toLowerCase();
    let rendered;
    if (!KNOWN.has(kind)) {
      state.note(`\`${ctrl.name}\` is not a recognised control creation call; it is named here rather than approximated.`);
      rendered = [];
    } else if (kind === "guictrlcreatelabel") rendered = renderLabel(ctrl, state);
    else if (kind === "guictrlcreateinput") rendered = renderTextInput(ctrl, state, "text");
    else if (kind === "guictrlcreatepassword") rendered = renderTextInput(ctrl, state, "password");
    else if (kind === "guictrlcreatecheckbox") rendered = renderCheckbox(ctrl, state);
    else if (kind === "guictrlcreateradio") rendered = renderRadio(ctrl, radioGroups.get(ctrl), state);
    else rendered = renderButton(ctrl, state, read.wiring);
    for (const line of rendered) lines.push(`  ${line}`);
  }

  const stem = kebab(read.title || "autoit-screen") || "autoit-screen";
  const className = pascal(stem) || "AutoitScreen";

  return {
    template: ["<div>", ...lines, "</div>"].join("\n"),
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    stem,
    title: read.title || className,
    className,
  };
}
