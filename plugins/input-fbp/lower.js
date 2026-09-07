import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { attrOf } from "../dsp-ir/markup.js";
import { childWidgets, childrenOf, eventOf, propertyNames, propertyOf, readChoices, readProject } from "./parse.js";

/**
 * What a wxFormBuilder widget tree means, once parse.js has handed it over as
 * plain elements. An `<object class="...">` is a real component boundary
 * somebody placed with the designer, so this reader produces a screen the
 * way input-qt does from a Qt Designer form, laid out in the document order
 * the sizers already recorded. What has no honest equivalent, a property
 * this reader does not interpret, a widget class with no vocabulary entry, a
 * button with no `OnButtonClick` event wired, is named through the caller's
 * `note` rather than approximated.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// A handler name is a C++/Python identifier (OnLoginButtonClick), not a caption, so the humps need splitting before
// kebab-casing them, the same way input-gwt's kebab splits GWT's Java field and method names.
const kebab = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => {
  const p = pascal(kebab(text));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** A name the emitted JavaScript can declare: a caption that spells a reserved word gets a suffix. Not shared with the
 * other readers' copies of this table: each keeps its own, since the naming choices differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

const BOX = new Set(["Dialog", "Frame", "Panel", "wxPanel", "wxScrolledWindow"]);
const FIELD_LIKE = new Set(["wxTextCtrl", "wxComboBox", "wxChoice", "wxCheckBox", "wxRadioBox"]);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), byName: new Map(), radioGroup: null, usesNgFor: false,
    seq: 1,
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
 * A widget's own `<property>` children this reader does not interpret,
 * named by property name only, its value never read let alone printed.
 * `consumed` lists the properties this widget's own rendering already read
 * on purpose (a label, a style flag, its choices), so a property read for a
 * reason is not also reported as an unread gap.
 */
function noteOpaqueProps(objectEl, label, state, consumed = []) {
  const names = propertyNames(objectEl).filter((n) => !consumed.includes(n));
  if (names.length) {
    state.note(`\`${label}\` declares propert${names.length === 1 ? "y" : "ies"} this reader does not interpret: ${names.join(", ")}.`);
  }
}

/**
 * Field ids and radio groups are settled before anything renders, in one walk
 * over the whole tree in document order, so a radio button's group is always
 * the same whether it is met before or after another member of it.
 *
 * wxWidgets groups radio buttons by a rule of its own, not by proximity: a
 * `wxRadioButton` whose `style` names `wxRB_GROUP` starts a new group, and
 * every radio button after it, across sizers, belongs to that same group
 * until the next `wxRB_GROUP` one starts another. The very first radio
 * button in the form starts the first group even with no `wxRB_GROUP` of its
 * own, since wxWidgets has no earlier group for it to continue.
 */
function prepare(containerEl, state) {
  for (const child of childWidgets(containerEl)) {
    const klass = attrOf(child, "class") || "";
    const name = attrOf(child, "name");
    if (name) state.byName.set(name, child);
    if (klass === "wxRadioButton") {
      const style = propertyOf(child, "style") || "";
      const startsGroup = /\bwxRB_GROUP\b/.test(style);
      if (startsGroup || !state.radioGroup) {
        state.radioGroup = state.unique(camel(name) || `radioGroup${state.seq++}`);
        state.fields.push(state.radioGroup);
      }
      child.field = state.radioGroup;
    } else if (FIELD_LIKE.has(klass)) {
      const fallback = klass === "wxComboBox" || klass === "wxChoice" ? `select${state.seq++}`
        : klass === "wxCheckBox" ? `check${state.seq++}`
        : klass === "wxRadioBox" ? `radioGroup${state.seq++}`
        : `field${state.seq++}`;
      child.field = state.unique(declarable(name || fallback));
      state.fields.push(child.field);
    }
    prepare(child, state);
  }
}

function renderBox(el, klass, name, state, depth) {
  const pad = "  ".repeat(depth);
  const lines = [`${pad}<div>`];
  const consumed = [];
  if (klass === "Dialog" || klass === "Frame") {
    consumed.push("title");
    const title = propertyOf(el, "title");
    if (title) lines.push(`${pad}  <h2>${esc(title)}</h2>`);
  }
  for (const child of childWidgets(el)) lines.push(...render(child, state, depth + 1));
  noteOpaqueProps(el, name || klass, state, consumed);
  lines.push(`${pad}</div>`);
  return lines;
}

function renderStaticBox(el, name, state, depth) {
  const pad = "  ".repeat(depth);
  const label = propertyOf(el, "label");
  const lines = [`${pad}<div>`];
  if (label) lines.push(`${pad}  <h2>${esc(label)}</h2>`);
  for (const child of childWidgets(el)) lines.push(...render(child, state, depth + 1));
  noteOpaqueProps(el, name || "wxStaticBoxSizer", state, ["label", "orient"]);
  lines.push(`${pad}</div>`);
  return lines;
}

function renderLabel(el, name, state, depth) {
  const pad = "  ".repeat(depth);
  const label = propertyOf(el, "label") ?? "";
  noteOpaqueProps(el, name || "a label", state, ["label"]);
  return label ? [`${pad}<p>${esc(label)}</p>`] : [];
}

function renderInput(el, name, state, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  const style = propertyOf(el, "style") || "";
  noteOpaqueProps(el, name || field, state, ["style"]);
  if (/\bwxTE_MULTILINE\b/.test(style)) return [`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`];
  const type = /\bwxTE_PASSWORD\b/.test(style) ? "password" : "text";
  return [`${pad}<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderCheckbox(el, name, state, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  const label = propertyOf(el, "label") ?? "";
  noteOpaqueProps(el, name || field, state, ["label", "checked"]);
  return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(label)}</label>`];
}

function renderRadio(el, name, state, depth) {
  const pad = "  ".repeat(depth);
  const group = el.field;
  const label = propertyOf(el, "label") ?? "";
  noteOpaqueProps(el, name || group, state, ["label", "checked", "style"]);
  const value = attrSafe(kebab(label) || name || "choice");
  return [`${pad}<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`];
}

function renderSelect(el, name, state, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  const items = readChoices(el);
  noteOpaqueProps(el, name || field, state, ["choices", "selection"]);
  const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
  if (items.length) {
    for (const it of items) lines.push(`${pad}  <option>${esc(it)}</option>`);
  } else {
    state.usesNgFor = true;
    state.note(`\`${name || field}\` declares no choices; they are populated from code at runtime, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
  }
  lines.push(`${pad}</select>`);
  return lines;
}

function renderRadioBox(el, name, state, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  const items = readChoices(el);
  const label = propertyOf(el, "label") ?? "";
  noteOpaqueProps(el, name || field, state, ["choices", "label", "selection", "dimension"]);
  const lines = [`${pad}<fieldset>`];
  if (label) lines.push(`${pad}  <legend>${esc(label)}</legend>`);
  if (items.length) {
    for (const it of items) lines.push(`${pad}  <label><input type="radio" ng-model="${field}" value="${attrSafe(kebab(it) || "choice")}"> ${esc(it)}</label>`);
  } else {
    state.note(`\`${name || field}\` declares no choices; they are populated from code at runtime, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`${pad}  <label ng-repeat="option in ${field}Options"><input type="radio" ng-model="${field}" value="{{ option }}"> {{ option }}</label>`);
  }
  lines.push(`${pad}</fieldset>`);
  return lines;
}

function renderButton(el, name, state, depth) {
  const pad = "  ".repeat(depth);
  const label = propertyOf(el, "label") ?? name ?? "";
  noteOpaqueProps(el, name || label || "a button", state, ["label"]);
  const handler = eventOf(el, "OnButtonClick");
  if (!handler) {
    state.note(`\`${name || label}\` has no \`OnButtonClick\` event wired in the .fbp file; it is emitted with no wiring found.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  // wxFormBuilder's own naming convention prefixes a handler with "On" (OnLoginButtonClick); stripping it before
  // camel casing keeps the emitted ng-click from doubling up as onOnLoginButtonClick.
  const bareHandler = handler.replace(/^On(?=[A-Z0-9])/, "");
  const eventName = camel(bareHandler) || camel(handler) || "click";
  state.outputs.add(eventName);
  return [`${pad}<button type="button" ng-click="on${pascal(eventName)}()">${esc(label)}</button>`];
}

function render(el, state, depth) {
  const klass = attrOf(el, "class") ?? "";
  const name = attrOf(el, "name") ?? "";
  if (klass === "wxStaticBoxSizer") return renderStaticBox(el, name, state, depth);
  if (BOX.has(klass)) return renderBox(el, klass, name, state, depth);
  if (klass === "wxStaticText") return renderLabel(el, name, state, depth);
  if (klass === "wxTextCtrl") return renderInput(el, name, state, depth);
  if (klass === "wxCheckBox") return renderCheckbox(el, name, state, depth);
  if (klass === "wxRadioButton") return renderRadio(el, name, state, depth);
  if (klass === "wxChoice" || klass === "wxComboBox") return renderSelect(el, name, state, depth);
  if (klass === "wxRadioBox") return renderRadioBox(el, name, state, depth);
  if (klass === "wxButton") return renderButton(el, name, state, depth);
  const kids = childWidgets(el);
  state.note(`the widget class \`${klass}\`${name ? ` (${name})` : ""} is not lowered${kids.length ? `; ${kids.length} child widget(s) inside it were not read either` : ""}; it is named here rather than approximated.`);
  return [];
}

/**
 * One `.fbp` file's project element lowered onto the shared dialect. `rel` is
 * only used in notes that need to say where a structural problem was found;
 * `note` is called for those, kept separate from the notes the widget tree
 * itself gathers so a caller can prefix or route each kind differently.
 */
export function lowerFbp(projectRootEl, rel, note = () => {}) {
  const project = readProject(projectRootEl);
  const root = project ? childrenOf(project, "object")[0] : null;
  if (!root) { note(`${rel}: no form under <object class="Project">; nothing was read.`); return null; }
  const state = makeState();
  prepare(root, state);
  const klass = attrOf(root, "class") ?? "";
  const rootName = attrOf(root, "name") ?? "";
  const title = propertyOf(root, "title");
  const lines = [];
  for (const child of childWidgets(root)) lines.push(...render(child, state, 1));
  noteOpaqueProps(root, rootName || klass, state, ["title"]);
  const heading = title ? [`  <h2>${esc(title)}</h2>`] : [];
  const template = ["<div>", ...heading, ...lines, "</div>"].join("\n");
  const className = rootName || "Screen";
  return {
    template,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
    title: title || className,
    className,
  };
}
