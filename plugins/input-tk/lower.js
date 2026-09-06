import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";

/**
 * What one Tk widget-creation command means, once parse.js has handed the
 * whole file over as a plain ordered list of them. There is no container
 * tree to walk (parse.js explains why a flat list is honest here), so
 * widgets render in declaration order, top to bottom.
 *
 * `-variable` is Tk's own real, load-bearing grouping mechanism for a
 * `radiobutton`: every one sharing the same variable name is one group,
 * however far apart in the file, an explicit reference rather than a
 * fallback heuristic, the strongest kind of grouping signal this tool's
 * readers ever get (stronger even than input-fxml's own `toggleGroup`
 * reference, since here it is the field binding itself). Groups are
 * resolved through a `Map` keyed by that variable name, the same pattern
 * input-fxml's own `prepare()` keeps for its `toggleGroup` reference.
 *
 * An `entry` or `checkbutton` with no bound variable, a `radiobutton` with
 * no `-variable` at all, and a `button` whose `-command` is not a clean
 * bare proc name are each named through `note(...)` rather than invented; a
 * widget path is never printed into a note, only its own last dotted
 * segment (Tk's closest thing to a field's own name), so nothing in a note
 * ever reads like the raw source.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A name the emitted JavaScript can declare: a variable that spells a reserved word gets a suffix. Not shared with
 * the other readers' own copies of this table: each keeps its own, since the naming choices differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/** A Tcl variable name reduced to what the emitted JavaScript can hold as an identifier; Tk variable names are
 * ordinarily already clean, so this only guards the rare one that is not. */
const identSafe = (name) => {
  const cleaned = String(name ?? "").replace(/[^A-Za-z0-9_]/g, "");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : cleaned ? `_${cleaned}` : "field";
};

/** A widget path's own last dotted segment, Tk's closest thing to a field name, or a plain fallback for the root
 * window itself (`.` alone, no segment to read). Used only for a note's own identity, never for a value this reader
 * invents a binding from. */
const lastSegment = (path) => {
  const segs = String(path ?? "").split(".").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : "the window";
};

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), toggleGroups: new Map(),
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

function renderLabel(widget) {
  const text = widget.options.get("text");
  return text ? [`<p>${esc(text.raw)}</p>`] : [];
}

function renderEntry(widget, state) {
  const textvariable = widget.options.get("textvariable");
  const show = widget.options.get("show");
  const isPassword = Boolean(show && show.raw !== "");
  const type = isPassword ? "password" : "text";

  if (!textvariable) {
    state.note(`the entry named \`${lastSegment(widget.path)}\` binds no variable; it is rendered with no field bound.`);
    return [`<input type="${type}">`];
  }
  const field = state.unique(declarable(identSafe(textvariable.raw)));
  state.fields.push(field);
  return [`<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderCheckbutton(widget, state) {
  const text = widget.options.get("text");
  const variable = widget.options.get("variable");
  const label = text ? esc(text.raw) : "";

  if (!variable) {
    state.note(`the checkbutton named \`${lastSegment(widget.path)}\` binds no variable; it is rendered with no field bound.`);
    return [`<label><input type="checkbox"> ${label}</label>`];
  }
  const field = state.unique(declarable(identSafe(variable.raw)));
  state.fields.push(field);
  return [`<label><input type="checkbox" ng-model="${field}"> ${label}</label>`];
}

/** The field name a group of radiobuttons shares, registered once per distinct `-variable` value the first time it is
 * met and reused after that: an explicit reference resolved through a `Map`, never a consecutive-siblings fallback,
 * since Tk gives a real one here. */
function groupField(variableName, state) {
  if (!state.toggleGroups.has(variableName)) {
    const field = state.unique(declarable(identSafe(variableName)));
    state.toggleGroups.set(variableName, field);
    state.fields.push(field);
  }
  return state.toggleGroups.get(variableName);
}

function renderRadiobutton(widget, state) {
  const text = widget.options.get("text");
  const variable = widget.options.get("variable");
  const value = widget.options.get("value");
  const label = text ? esc(text.raw) : "";

  let group;
  if (variable) {
    group = groupField(variable.raw, state);
  } else {
    state.note(`the radiobutton named \`${lastSegment(widget.path)}\` carries no -variable; it belongs to no group this reader can resolve, so it is rendered on its own.`);
    group = state.unique(declarable(identSafe(lastSegment(widget.path))));
    state.fields.push(group);
  }
  const optionValue = attrSafe(value ? value.raw : kebab(text ? text.raw : "") || "choice");
  return [`<label><input type="radio" ng-model="${group}" value="${optionValue}"> ${label}</label>`];
}

/** A bare word that is a clean Tcl proc name, the one `-command` shape this reader trusts as a real handler
 * reference: `-command {destroy .}`'s brace-quoted script, and a bare word carrying anything other than plain
 * identifier characters, are both named as an inline script and never evaluated, the same restraint input-fxml keeps
 * over a `-command`/`onAction` value that is a binding expression rather than a plain method reference. */
const isCleanProcName = (word) => word.kind === "bare" && /^[A-Za-z_]\w*$/.test(word.raw);

function renderButton(widget, state) {
  const text = widget.options.get("text");
  const command = widget.options.get("command");
  const label = text ? esc(text.raw) : "";
  const name = (text && text.raw) || lastSegment(widget.path);

  if (!command) {
    state.note(`\`${name}\` has no -command; it is emitted with no wiring found.`);
    return [`<button type="button">${label}</button>`];
  }
  if (!isCleanProcName(command)) {
    state.note(`\`${name}\`'s -command is an inline script rather than a clean bare proc name; it is not evaluated, and the button is emitted with no wiring found.`);
    return [`<button type="button">${label}</button>`];
  }
  const method = command.raw;
  const event = method.charAt(0).toLowerCase() + method.slice(1);
  state.outputs.add(event);
  return [`<button type="button" ng-click="on${pascal(event)}()">${label}</button>`];
}

function renderLabelframe(widget) {
  const text = widget.options.get("text");
  return text ? [`<h3>${esc(text.raw)}</h3>`] : [];
}

function renderPresenceOnly(widget, state) {
  state.note(`the \`${widget.command}\` at \`${lastSegment(widget.path)}\` exists; its content is not declared inline, so nothing was invented for it here.`);
  return [];
}

function renderUnrecognized(widget, state) {
  state.note(`the \`${widget.command}\` widget command at \`${lastSegment(widget.path)}\` is not lowered; it is named here rather than approximated.`);
  return [];
}

function render(widget, state) {
  switch (widget.command) {
    case "label": return renderLabel(widget);
    case "entry": return renderEntry(widget, state);
    case "checkbutton": return renderCheckbutton(widget, state);
    case "radiobutton": return renderRadiobutton(widget, state);
    case "button": return renderButton(widget, state);
    case "labelframe": return renderLabelframe(widget);
    case "frame": return []; // a layout container with nothing of its own to show
    case "text": case "listbox": return renderPresenceOnly(widget, state);
    default: return renderUnrecognized(widget, state); // menu, menubutton, scale, scrollbar, canvas
  }
}

/**
 * A whole `.tcl` file's own ordered widget list lowered onto the shared
 * dialect: no conditional, no loop, no interpolation but a field's own
 * `ng-model`, since a Tk script builds a flat form the same way an xBase
 * `@ SAY/GET` screen or a CICS `DFHMDI` map does. `stem` and `title` are
 * derived from the file's own name, since a whole file is one screen and
 * Tk gives it no name of its own.
 */
export function lowerTk(widgets, stem) {
  const state = makeState();
  const lines = [];
  for (const widget of widgets) {
    for (const line of render(widget, state)) lines.push(`  ${line}`);
  }

  const className = pascal(stem);
  return {
    template: ["<div>", ...lines, "</div>"].join("\n"),
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    stem,
    title: className,
    className,
  };
}
