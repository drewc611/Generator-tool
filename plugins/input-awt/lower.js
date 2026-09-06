import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { literalString } from "./parse.js";

/**
 * What a Java AWT/Swing file's `new ClassName(...)` constructions mean, once
 * parse.js has handed them over as a plain, file-ordered list. There is no
 * container tree to walk, since a hand written form draws every control
 * flat against whichever panel or frame `add(...)` reaches, so each control
 * renders in the order its own construction statement appears, the same
 * flat shape input-autoit and input-xbase already read a legacy screen's
 * own fields in.
 *
 * `Label`/`JLabel` becomes a caption, read only where its constructor
 * argument is a plain string literal. `TextField`/`JTextField` and
 * `TextArea`/`JTextArea` become a real input; unlike AutoIt's own
 * GUICtrlCreate calls, which return a value the caller must assign to bind
 * a field to it, a Swing/AWT constructor call is itself the value, so the
 * field's name is read from whichever variable that value is assigned to
 * (`custNoField = new JTextField(10)` names the field `custNoField`), and a
 * construction never assigned to anything at all, a bare statement or an
 * argument passed straight into `add(...)`, is a real gap named through a
 * note rather than invented. `Checkbox`/`JCheckBox` is the same field rule
 * with its own literal caption paired directly.
 *
 * `Choice`/`JComboBox` is read as existing only: its options are filled by
 * `.add("...")`/`.addItem("...")` calls, which are easy to conflate with a
 * container's own `.add(...)`, so this reader names it present and reads no
 * option out of it, the way input-fxml names a combo box filled from code.
 *
 * `Button`/`JButton` becomes a real button with its own literal caption, or
 * one read off a `.setText(...)` call on the same variable when the
 * constructor itself carries none. Its wiring comes from a
 * `.addActionListener(...)` call referencing the same variable: a clean
 * lambda whose whole body is one bare, zero-argument method call resolves
 * to a real output named after that method; an anonymous inner class, a
 * multi-statement lambda body, or any other shape found there is named as
 * wired to something not read for what it does, and a button never
 * referenced in any `.addActionListener(...)` call at all is named unwired.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

/** A construction's own first-argument literal, or null when it has no argument or the argument is not a plain
 * string literal (a variable, a method call, a concatenation) this reader can read as text. */
const textArg = (ctrl) => (ctrl.args.length ? literalString(ctrl.args[0]) : null);

function renderLabel(ctrl, state) {
  const text = textArg(ctrl);
  if (text !== null) return [`<p>${esc(text)}</p>`];
  state.note(`a ${ctrl.className} call's text argument is not a plain string literal; it is not a caption this reader can read, so nothing was rendered for it.`);
  return [];
}

function renderTextField(ctrl, state) {
  if (!ctrl.variable) {
    state.note(`a ${ctrl.className} construction is never assigned to a variable; it has no name this reader can bind a field to, so nothing was rendered for it.`);
    return [];
  }
  const field = state.unique(declarable(ctrl.variable));
  state.fields.push(field);
  return [`<input id="f-${field}" type="text" ng-model="${field}">`];
}

function renderCheckbox(ctrl, state) {
  if (!ctrl.variable) {
    state.note(`a ${ctrl.className} construction is never assigned to a variable; it has no name this reader can bind a field to, so nothing was rendered for it.`);
    return [];
  }
  const field = state.unique(declarable(ctrl.variable));
  state.fields.push(field);
  const label = textArg(ctrl) ?? "";
  return [`<label><input type="checkbox" ng-model="${field}"> ${esc(label)}</label>`];
}

function renderCombo(ctrl, state) {
  state.note(`a ${ctrl.className} is constructed; its inline options are filled by code this reader does not read, so it is named present rather than filled.`);
  return [];
}

/** A button's own caption: its constructor literal first, a same-variable `.setText(...)` literal otherwise. */
function buttonCaption(ctrl) {
  const own = textArg(ctrl);
  if (own !== null) return own;
  if (ctrl.setTextArg != null) return literalString(ctrl.setTextArg) ?? "";
  return "";
}

function renderButton(ctrl, state) {
  const label = buttonCaption(ctrl);
  const shown = label || ctrl.variable || "(unnamed)";
  if (ctrl.wiring === undefined) {
    state.note(`the button \`${shown}\` has no addActionListener call referencing its own variable; it is emitted with no wiring found.`);
    return [`<button type="button">${esc(label)}</button>`];
  }
  const method = ctrl.lambdaCall ? ctrl.lambdaCall(ctrl.wiring) : null;
  if (!method) {
    state.note(`the button \`${shown}\`'s addActionListener argument is not a single bare method call lambda (an anonymous listener, a multi-statement body, or a call with arguments); it is wired to something not read for what it does.`);
    return [`<button type="button">${esc(label)}</button>`];
  }
  const event = camel(method) || "click";
  state.outputs.add(event);
  return [`<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

/**
 * A whole `.java` file's constructions lowered onto the shared dialect: no
 * conditional, no loop, no interpolation, but each field's own `ng-model`,
 * since the form is a flat, construction-ordered list of captions and
 * controls. `read` is parse.js's own structural read of the file; `lambdaCall`
 * is passed on the constructions themselves so this function never needs to
 * import parse.js beyond the literal decoder it already shares with it.
 */
export function lowerAwt(read, rawClassName) {
  const state = makeState();
  const lines = [];

  for (const p of read.problems) state.note(p);

  for (const ctrl of read.constructions) {
    ctrl.lambdaCall = read.lambdaCall;
    let rendered;
    if (!ctrl.kind) {
      state.note(`\`${ctrl.className}\` is not a recognised control construction; it is named here rather than approximated.`);
      rendered = [];
    } else if (ctrl.kind === "label") rendered = renderLabel(ctrl, state);
    else if (ctrl.kind === "text") rendered = renderTextField(ctrl, state);
    else if (ctrl.kind === "checkbox") rendered = renderCheckbox(ctrl, state);
    else if (ctrl.kind === "combo") rendered = renderCombo(ctrl, state);
    else rendered = renderButton(ctrl, state);
    for (const line of rendered) lines.push(`  ${line}`);
  }

  const className = pascal(kebab(rawClassName || "awt-screen")) || "AwtScreen";

  return {
    template: ["<div>", ...lines, "</div>"].join("\n"),
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: false,
    usesTwoWay: state.fields.length > 0,
    className,
  };
}
