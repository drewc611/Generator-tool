import { pascal } from "../dsp-ir/emit.js";

/**
 * What a raw UIKit view construction file means, once parse.js has handed it
 * over as a plain, construction-ordered control list. There is no container
 * tree to walk, since `addSubview:` draws every control flat against `self.
 * view` the same way AutoIt draws every control flat against the one window
 * `GUICreate` opens, so each control renders in the order its own
 * construction statement appears, never the order it was added to the view.
 *
 * `UILabel` becomes a caption, read from a separate following `.text`/
 * `setText:` statement; `UITextField` and `UISwitch` a real input and
 * checkbox, each needing the variable its own construction was assigned to
 * for a name to bind `ng-model` to, the same "identity from assignment" rule
 * input-autoit already keeps over its own `GUICtrlCreate*` return values.
 * `UIButton`'s caption comes from `setTitle:forState:` and its wiring from
 * `addTarget:action:forControlEvents:`, whose `@selector(methodName)`
 * resolves directly to an output name, the cleanest wiring signal this tool
 * reads anywhere. `UITextView` is read as existing only, its content never
 * invented. What has no honest equivalent, a non-literal caption, a control
 * never assigned to a variable, a button with no wiring found, is named
 * through the caller's `note` rather than approximated.
 *
 * A class outside this five member vocabulary (`UIView`, `UIStackView`, a
 * custom subclass, `UIImageView`) never reaches this file at all: parse.js's
 * own `detectConstruction` already passes it over silently, the same
 * "ordinary source, not this reader's vocabulary" restraint input-autoit
 * keeps over AutoIt calls its own `GUICtrlCreate*` set does not name.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** camelCase's own word boundaries made explicit before kebab lowercases them away: an Objective-C selector like
 * `handleOkTapped` carries no separator of its own, only its capital letters do, the same convenience
 * input-storyboard and input-autoit already keep over their own method and function names. */
const splitCamel = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2");
const camel = (text) => {
  const p = pascal(kebab(splitCamel(text)));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** Not shared with the other readers' own copies of this table: each keeps its own, since the naming choices
 * (a suffix, a prefix) differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

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

function renderLabel(ctrl, state) {
  const text = ctrl.config?.text;
  if (typeof text === "string") return [`<p>${esc(text)}</p>`];
  state.note("a UILabel's own caption (.text or setText:) is not a plain string literal; it is not a caption this reader can read, so nothing was rendered for it.");
  return [];
}

/** The one place `UITextField` and `UISwitch` both read their field name from: the variable their own
 * construction was assigned to. A control never assigned to one has no name this reader can bind a field to,
 * since nothing anywhere refers to it, so it is a real gap named through `note` rather than invented. */
function fieldOf(ctrl, state, kind) {
  if (!ctrl.variable) {
    state.note(`a ${ctrl.className} construction is never assigned to a variable; it has no name this reader can bind a ${kind} to, so nothing was rendered for it.`);
    return null;
  }
  return state.unique(declarable(ctrl.variable));
}

function renderTextField(ctrl, state) {
  const field = fieldOf(ctrl, state, "field");
  if (!field) return [];
  state.fields.push(field);
  const type = ctrl.config?.secure === true ? "password" : "text";
  return [`<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderSwitch(ctrl, state) {
  const field = fieldOf(ctrl, state, "field");
  if (!field) return [];
  state.fields.push(field);
  return [`<input id="f-${field}" type="checkbox" ng-model="${field}">`];
}

function renderTextView(ctrl, state) {
  const id = ctrl.variable || "a UITextView";
  state.note(`\`${id}\` is a UITextView; its content was named as existing and not rendered.`);
  return [];
}

function renderButton(ctrl, state) {
  if (!ctrl.variable) {
    state.note("a UIButton construction is never assigned to a variable; its title and wiring cannot be resolved, so it is emitted with no caption and no wiring found.");
    return [`<button type="button"></button>`];
  }
  const cfg = ctrl.config;
  let label = "";
  if (cfg && typeof cfg.title === "string") label = cfg.title;
  else if (cfg && cfg.title === null) state.note(`the button \`${ctrl.variable}\`'s setTitle:forState: argument is not a plain string literal; it is emitted with no caption.`);
  else state.note(`the button \`${ctrl.variable}\` has no setTitle:forState: call found; it is emitted with no caption.`);

  if (cfg && cfg.wiredMethod) {
    const event = camel(cfg.wiredMethod) || "click";
    state.outputs.add(event);
    return [`<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
  }
  state.note(`the button \`${ctrl.variable}\` has no addTarget:action:forControlEvents: call referencing its own variable; it is emitted with no wiring found.`);
  return [`<button type="button">${esc(label)}</button>`];
}

/**
 * One `.m` file's controls lowered onto the shared dialect: no conditional,
 * no loop, no interpolation but each field's own `ng-model`, since a
 * construction-ordered control list is a flat, ordered list of captions and
 * controls, the same shape input-autoit already produces from its own flat
 * `GUICtrlCreate*` sequence. `read` is parse.js's own structural read of the
 * file; `fallbackStem` names the screen when the file declares no
 * `@implementation` of its own to read a class name from.
 */
export function lowerUikit(read, fallbackStem) {
  const state = makeState();

  if (read.implementations > 1) {
    state.note(`${read.implementations} @implementation blocks found in this file; only one screen is read, since splitting it would be a guess about where one screen ends and the next begins.`);
  }
  if (read.viewDidLoads > 1) {
    state.note(`${read.viewDidLoads} - (void)viewDidLoad methods found in this file; a whole .m file is read as one screen regardless.`);
  }

  const lines = [];
  for (const ctrl of read.controls) {
    let rendered;
    if (ctrl.className === "UILabel") rendered = renderLabel(ctrl, state);
    else if (ctrl.className === "UITextField") rendered = renderTextField(ctrl, state);
    else if (ctrl.className === "UISwitch") rendered = renderSwitch(ctrl, state);
    else if (ctrl.className === "UITextView") rendered = renderTextView(ctrl, state);
    else rendered = renderButton(ctrl, state);
    for (const line of rendered) lines.push(`  ${line}`);
  }

  // splitCamel first: read.className comes straight off `@implementation ClassName`, and kebab alone would glue
  // its humps into one lowercase word the way it would any other PascalCase name with no hyphen of its own.
  const stem = kebab(splitCamel(read.className || fallbackStem || "uikit-screen")) || "uikit-screen";
  const className = pascal(stem) || "UikitScreen";

  return {
    template: ["<div>", ...lines, "</div>"].join("\n"),
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    stem,
    title: read.className || className,
    className,
  };
}
