import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";

/**
 * What a PowerBuilder window means, once parse.js has handed over its real
 * control blocks, the window's own declaration order and every event block
 * the file carries. `statictext` becomes a `<p>`; `singlelineedit` an
 * `<input>`, a `password` property making it `type="password"`;
 * `multilineedit` a `<textarea>`; `checkbox` and `radiobutton` a checkbox
 * and a radio, radios grouped by this reader's own heuristic below;
 * `dropdownlistbox`/`listbox` a `<select>`, its inline `string item[]`
 * array becoming real options; `commandbutton` a button wired from an
 * `event <name>::clicked` block found elsewhere in the file; `groupbox` a
 * `<div>` with its own `text` as a heading, its children never reparented
 * beneath it (a PowerBuilder `.srw` places every control flat within the
 * window, so there is no nesting to reproduce); `datawindow` a named
 * placeholder, since a DataWindow's rows live in a separate `.srd`/`.pbl`
 * artifact this reader does not have access to.
 *
 * Grouping heuristic, named honestly: a `.srw` file carries no explicit
 * "these radio buttons form one group" reference of its own, unlike a GTK
 * Builder radio's `group` property or Qt's `buttonGroup`. A run of
 * consecutive `radiobutton` controls in the window's own declaration order,
 * with no other control type between them, is read as one group. That is
 * this reader's own structural convenience, not a rule PowerBuilder's format
 * states, the same restraint input-uno already keeps over its own radios.
 *
 * A control class with no vocabulary entry, an opaque property (its type
 * keyword is not `integer`, `string` or `boolean`), an empty item array and
 * a button with no `clicked` event are each named through the caller's
 * `note` rather than approximated; a non-`clicked` event, or a second event
 * on the same button, is named as behaviour the port must reimplement,
 * never invented wiring.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => {
  const p = pascal(kebab(text));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** Not shared with the other readers' own copies of this table: each keeps its own, since the naming choices
 * (a suffix, a prefix) differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/** PowerBuilder's own Hungarian-ish convention prefixes a control's name with a short class abbreviation before
 * an underscore (`sle_`, `cbx_`, `ddlb_`, `cb_`...); stripped for a readable field or output name, this reader's
 * own structural convenience, not a rule the format states. */
const stripPrefix = (name) => {
  const m = /^[a-z]{1,6}_(.+)$/.exec(String(name ?? ""));
  return m ? m[1] : String(name ?? "");
};

const strProp = (ctrl, name) => {
  const p = ctrl.properties[name];
  return p && !p.array && /^string$/i.test(p.type) ? (p.value ?? "") : "";
};
const boolProp = (ctrl, name) => {
  const p = ctrl.properties[name];
  return Boolean(p && !p.array && /^boolean$/i.test(p.type) && p.value);
};
const arrayProp = (ctrl, name) => {
  const p = ctrl.properties[name];
  return p && p.array ? p.items : null;
};

/** The opaque (not `integer`/`string`/`boolean`) properties a control declares, named by key only, the value never
 * read: the same restraint input-qt's and input-glade's own `noteOpaqueProps` keep. */
function noteOpaqueProps(ctrl, label, state) {
  const names = Object.entries(ctrl.properties).filter(([, v]) => v.opaque).map(([k]) => k);
  if (names.length) state.note(`\`${label}\` declares propert${names.length === 1 ? "y" : "ies"} this reader does not interpret: ${names.join(", ")}.`);
}

function makeState(emit = () => {}) {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), usesNgFor: false, wiredClicked: new Set(), groupboxNoted: false,
    note(text) { if (!notes.includes(text)) { notes.push(text); emit(text); } },
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

const FIELD_CLASSES = new Set(["singlelineedit", "multilineedit", "checkbox", "dropdownlistbox", "listbox"]);

/**
 * Field names and radio groups settled in one pass over the rendering order
 * before anything renders, so a run of consecutive radio buttons resolves
 * the same regardless of where in the walk it is met.
 */
function prepare(order, controlsByName, state) {
  let runGroup = null;
  for (const name of order) {
    const ctrl = controlsByName.get(name);
    if (!ctrl) continue;
    const klass = ctrl.class.toLowerCase();
    if (klass === "radiobutton") {
      if (!runGroup) { runGroup = state.unique(declarable(camel(stripPrefix(name))) || "choice"); state.fields.push(runGroup); }
      ctrl.field = runGroup;
      continue;
    }
    runGroup = null;
    if (FIELD_CLASSES.has(klass)) {
      ctrl.field = state.unique(declarable(camel(stripPrefix(name)) || "field"));
      state.fields.push(ctrl.field);
    }
  }
}

function renderStatic(ctrl, state) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  const text = strProp(ctrl, "text");
  return text ? [`  <p>${esc(text)}</p>`] : [];
}

function renderInput(ctrl, state) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  const field = ctrl.field;
  const type = boolProp(ctrl, "password") ? "password" : "text";
  return [`  <input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderTextarea(ctrl, state) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  return [`  <textarea id="f-${ctrl.field}" ng-model="${ctrl.field}"></textarea>`];
}

function renderCheckbox(ctrl, state) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  const label = strProp(ctrl, "text");
  return [`  <label><input type="checkbox" ng-model="${ctrl.field}"> ${esc(label)}</label>`];
}

function renderRadio(ctrl, state) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  const label = strProp(ctrl, "text");
  const value = attrSafe(kebab(label) || kebab(stripPrefix(ctrl.name)) || "choice");
  return [`  <label><input type="radio" ng-model="${ctrl.field}" value="${value}"> ${esc(label)}</label>`];
}

function renderSelect(ctrl, state) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  const field = ctrl.field;
  const items = arrayProp(ctrl, "item");
  const lines = [`  <select id="f-${field}" ng-model="${field}">`];
  if (items && items.length) {
    for (const it of items) lines.push(`    <option>${esc(it)}</option>`);
  } else {
    state.usesNgFor = true;
    state.note(`\`${ctrl.name}\` declares no \`string item[]\` array (or an empty one); its items are populated from code at runtime, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`    <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
  }
  lines.push("  </select>");
  return lines;
}

function renderButton(ctrl, state, events) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  const label = strProp(ctrl, "text") || stripPrefix(ctrl.name);
  const clicked = events.find((e) => e.control === ctrl.name && e.event.toLowerCase() === "clicked");
  if (!clicked) {
    state.note(`\`${ctrl.name}\` has no \`clicked\` event block found elsewhere in the file; it is emitted with no wiring found.`);
    return [`  <button type="button">${esc(label)}</button>`];
  }
  state.wiredClicked.add(ctrl.name);
  const event = camel(stripPrefix(ctrl.name)) || "click";
  state.outputs.add(event);
  return [`  <button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

function renderGroup(ctrl, state) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  if (!state.groupboxNoted) {
    state.groupboxNoted = true;
    state.note("a groupbox's own children are not nested beneath it: a `.srw` places every control flat within the window with no tree to reflect, so each is rendered as its own sibling control here rather than reparented.");
  }
  const label = strProp(ctrl, "text");
  const lines = ["  <div>"];
  if (label) lines.push(`    <h2>${esc(label)}</h2>`);
  lines.push("  </div>");
  return lines;
}

function renderDataWindow(ctrl, state) {
  noteOpaqueProps(ctrl, ctrl.name, state);
  state.note(`\`${ctrl.name}\` is a DataWindow, PowerBuilder's own data bound grid or report object defined in a separate \`.srd\`/\`.pbl\` artifact this reader does not have access to; the port has an empty structural table and the rows the code must supply.`);
  return ["  <table></table>"];
}

function render(ctrl, state, events) {
  switch (ctrl.class.toLowerCase()) {
    case "statictext": return renderStatic(ctrl, state);
    case "singlelineedit": return renderInput(ctrl, state);
    case "multilineedit": return renderTextarea(ctrl, state);
    case "checkbox": return renderCheckbox(ctrl, state);
    case "radiobutton": return renderRadio(ctrl, state);
    case "dropdownlistbox": case "listbox": return renderSelect(ctrl, state);
    case "commandbutton": return renderButton(ctrl, state, events);
    case "groupbox": return renderGroup(ctrl, state);
    case "datawindow": return renderDataWindow(ctrl, state);
    default:
      noteOpaqueProps(ctrl, ctrl.name, state);
      state.note(`the control class \`${ctrl.class}\` (\`${ctrl.name}\`) is not lowered; it is named here rather than approximated.`);
      return [];
  }
}

/**
 * One `.srw` file's window lowered onto the shared dialect. `read` is
 * parse.js's own structural read; `note` is called for a control the file
 * forward-declared but never really defined, kept separate from the notes
 * the control tree itself gathers so a caller can prefix or route each kind
 * differently.
 */
export function lowerSrw(read, note = () => {}) {
  const state = makeState(note);
  const window = read.window;
  const controlsByName = read.controls;

  const declared = window.order.length ? window.order : [];
  const extra = [...controlsByName.keys()].filter((n) => !declared.includes(n));
  const order = [...declared, ...extra];

  prepare(order, controlsByName, state);
  noteOpaqueProps(window, window.name, state);

  const lines = [];
  for (const name of order) {
    const ctrl = controlsByName.get(name);
    if (!ctrl) {
      const fwd = read.forward.find((f) => f.name === name);
      state.note(`\`${name}\` (${fwd ? fwd.class : "unknown class"}) was forward-declared but no real, non-forward \`type\` block for it was found later in the file; nothing was read for it.`);
      continue;
    }
    lines.push(...render(ctrl, state, read.events));
  }
  for (const fwd of read.forward) {
    if (fwd.class === "window" || order.includes(fwd.name)) continue;
    state.note(`\`${fwd.name}\` (${fwd.class}) was forward-declared but never appears in the window's own declaration order or its real control blocks; nothing was read for it.`);
  }

  // Every event this file carries that was not the one clicked wire a button already took: behaviour the port
  // must reimplement, kept only as existing and how many lines it runs, never what it does.
  for (const e of read.events) {
    if (state.wiredClicked.has(e.control) && e.event.toLowerCase() === "clicked") continue;
    state.note(`\`${e.control}::${e.event}\` is ${e.lines} line(s) of PowerScript kept only as existing; the port must reimplement this behaviour.`);
  }

  const stem = kebab(stripPrefix(window.name)) || "window";
  const className = pascal(stem) || "Window";
  const title = strProp(window, "title") || window.name;
  const template = ["<div>", `  <h2>${esc(title)}</h2>`, ...lines, "</div>"].join("\n");

  return {
    template, stem, className, title,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
  };
}
