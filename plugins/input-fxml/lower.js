import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { attr, childWidgets, comboItems, tagName, toggleGroupKey } from "./parse.js";

/**
 * What a JavaFX widget tree means, once parse.js has handed it over as plain
 * elements. A container or control element is a real component boundary
 * somebody placed with Scene Builder or by hand, so this reader produces a
 * screen the way input-qt and input-glade already do from a desktop form,
 * laid out in the document order the file's own nesting already recorded.
 * FXML wires a control's own event straight onto it, an `onAction="#method"`
 * attribute, which is simpler than Qt's separate `<connections>` section to
 * match against. What has no honest equivalent, layout positioning this
 * reader does not reproduce, a combo box filled from code, a button whose
 * handler is a binding expression rather than a controller method, is named
 * through the caller's `note` rather than approximated.
 *
 * Every tag comparison below is against a lowercase string: the shared
 * scanner lowercases every tag name it reads (parse.js explains why), so
 * `GridPane` is compared as `gridpane` and `ComboBox` as `combobox`
 * throughout. A note that names an unrecognised, undotted element prints
 * that same lowercase spelling, a small honest cost of reusing the one
 * shared scanner rather than a second one that kept case for this dialect
 * alone; a fully qualified custom control's dots survive through `tagName`
 * (parse.js), so its package path still reads exactly as it was spelled.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => {
  const p = pascal(kebab(text));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** A name the emitted JavaScript can declare: a caption that spells a reserved word gets a suffix. Not shared with the
 * other readers' copies of this table: each keeps its own, since the naming choices differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

const BOX = new Set(["gridpane", "vbox", "hbox", "borderpane", "anchorpane", "stackpane", "flowpane", "pane", "group", "scrollpane"]);
const TEXT_INPUT = new Set(["textfield", "passwordfield"]);
const TABLE_LIKE = new Set(["tableview", "listview", "treeview"]);
const FIELD_LIKE = new Set(["textfield", "passwordfield", "textarea", "checkbox", "combobox"]);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), usesNgFor: false,
    toggleGroups: new Map(),
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
 * Field names and radio groups are settled before anything renders, in one
 * walk over the whole tree, so a reference resolves the same regardless of
 * where in the walk it is met. `openRun` is the field name of the run of
 * consecutive, unreferenced RadioButton siblings currently open in this
 * container; a control of any other kind between two radio buttons closes
 * it, this reader's own structural convenience for a group FXML itself left
 * no explicit reference for, the same restraint input-uno and
 * input-powerbuilder already keep for their own radio grouping fallbacks. A
 * RadioButton that does carry an explicit reference does not close the run:
 * it is still a RadioButton sibling, its own grouping just settled a
 * different way.
 */
function prepare(widget, state) {
  let openRun = null;
  for (const child of childWidgets(widget)) {
    const tag = child.tag;
    const id = attr(child, "fx:id");
    if (tag === "radiobutton") {
      const ref = toggleGroupKey(child);
      if (ref) {
        if (!state.toggleGroups.has(ref)) {
          const key = state.unique(camel(ref) || "choice");
          state.toggleGroups.set(ref, key);
          state.fields.push(key);
        }
        child.field = state.toggleGroups.get(ref);
      } else {
        if (!openRun) {
          openRun = state.unique(camel(id) || "choice");
          state.fields.push(openRun);
        }
        child.field = openRun;
      }
    } else {
      openRun = null;
      if (FIELD_LIKE.has(tag)) {
        const fallback = tag === "combobox" ? `select${state.seq++}` : tag === "checkbox" ? `check${state.seq++}` : `field${state.seq++}`;
        child.field = state.unique(declarable(id || fallback));
        state.fields.push(child.field);
      }
    }
    prepare(child, state);
  }
}

function renderBox(widget, state, depth) {
  const pad = "  ".repeat(depth);
  const lines = [`${pad}<div>`];
  for (const child of childWidgets(widget)) lines.push(...render(child, state, depth + 1));
  lines.push(`${pad}</div>`);
  return lines;
}

function renderLabel(widget, depth) {
  const pad = "  ".repeat(depth);
  const content = attr(widget, "text") ?? "";
  return content ? [`${pad}<p>${esc(content)}</p>`] : [];
}

function renderInput(widget, tag, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const type = tag === "passwordfield" ? "password" : "text";
  return [`${pad}<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderTextarea(widget, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  return [`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`];
}

function renderCheckbox(widget, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const text = attr(widget, "text") ?? "";
  return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(text)}</label>`];
}

function renderRadio(widget, depth) {
  const pad = "  ".repeat(depth);
  const group = widget.field;
  const label = attr(widget, "text") ?? "";
  const value = attrSafe(kebab(label) || attr(widget, "fx:id") || "choice");
  return [`${pad}<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`];
}

function renderSelect(widget, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const items = comboItems(widget);
  const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
  if (items) {
    for (const it of items) lines.push(`${pad}  <option>${esc(it)}</option>`);
  } else {
    state.usesNgFor = true;
    state.note(`\`${attr(widget, "fx:id") || field}\` declares no \`<items>\` this reader can read as a plain list (no <items> element, no FXCollections observableArrayList factory, or entries that are not all <String fx:value>); its options come from code at runtime, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
  }
  lines.push(`${pad}</select>`);
  return lines;
}

function renderButton(widget, state, depth) {
  const pad = "  ".repeat(depth);
  const label = attr(widget, "text") ?? "";
  const name = attr(widget, "fx:id") || label || "a button";
  const action = attr(widget, "onAction");
  if (!action) {
    state.note(`\`${name}\` has no \`onAction\` attribute; it is emitted with no wiring found.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  if (!action.startsWith("#")) {
    state.note(`\`${name}\`'s onAction is a binding expression, not FXML's own \`#method\` convention; it is not evaluated, and the button is emitted with no wiring found.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  const method = action.slice(1).replace(/[^A-Za-z0-9_$]/g, "");
  const event = method ? method.charAt(0).toLowerCase() + method.slice(1) : "click";
  state.outputs.add(event);
  return [`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

function renderTableLike(widget, tag, state, depth) {
  const pad = "  ".repeat(depth);
  const name = attr(widget, "fx:id") || `the ${tag}`;
  state.note(`\`${name}\`'s rows come from the code at runtime; none are invented here.`);
  return [`${pad}<table></table>`];
}

function renderImage(widget, state) {
  const name = attr(widget, "fx:id") || "an image view";
  state.note(`\`${name}\` is an image view; its image source was named as existing and not rendered.`);
  return [];
}

function render(widget, state, depth) {
  const tag = widget.tag;
  if (BOX.has(tag)) return renderBox(widget, state, depth);
  if (tag === "label") return renderLabel(widget, depth);
  if (TEXT_INPUT.has(tag)) return renderInput(widget, tag, depth);
  if (tag === "textarea") return renderTextarea(widget, depth);
  if (tag === "checkbox") return renderCheckbox(widget, depth);
  if (tag === "radiobutton") return renderRadio(widget, depth);
  if (tag === "combobox") return renderSelect(widget, state, depth);
  if (tag === "button") return renderButton(widget, state, depth);
  if (TABLE_LIKE.has(tag)) return renderTableLike(widget, tag, state, depth);
  if (tag === "imageview") return renderImage(widget, state);
  const kids = childWidgets(widget);
  state.note(`the element \`${tagName(widget)}\` is not lowered${kids.length ? `; ${kids.length} child widget(s) inside it were not read either` : ""}; it is named here rather than approximated.`);
  return [];
}

/** A fully qualified Java class name's simple name, the package prefix dropped, or null for an empty or absent value. */
export function simpleClassName(fqcn) {
  const parts = String(fqcn ?? "").split(".").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * One `.fxml` file lowered onto the shared dialect. `rel` is only used in
 * notes that need to say where a structural problem was found; `note` is
 * called for those, kept separate from the notes the widget tree itself
 * gathers so a caller can prefix or route each kind differently.
 */
export function lowerFxml(root, rel, note = () => {}) {
  if (!root) { note(`${rel}: no root container or control element; nothing was read.`); return null; }

  const state = makeState();
  prepare(root, state);

  const lines = [];
  for (const child of childWidgets(root)) lines.push(...render(child, state, 1));
  const template = ["<div>", ...lines, "</div>"].join("\n");
  const className = simpleClassName(attr(root, "fx:controller"));
  return {
    template,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
    className,
  };
}
