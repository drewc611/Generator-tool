import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { attrOf } from "../dsp-ir/markup.js";
import {
  allChildObjects, childObjectsOfClass, childrenOf, childWidgets, hasInternalChild, inlineItems,
  readRequires, rootObject, signalOf, valueOf,
} from "./parse.js";

/**
 * What a GTK Builder widget tree means, once parse.js has handed it over as
 * plain elements. An `<object class="...">` is a real component boundary
 * somebody drew with Glade, so this reader produces a screen the way
 * input-qt already does from a Qt Designer form: laid out in the document
 * order the file's own `<child>` wrappers recorded. GtkBuilder wires a
 * widget's own event straight onto it, a `<signal name="clicked"
 * handler="...">` child of the button itself, which is simpler than Qt's
 * separate `<connections>` section to match against. What has no honest
 * equivalent, a property this reader does not interpret, a widget class
 * outside GTK's own set, a combo box filled from a model this reader does
 * not chase, is named through the caller's `note` rather than approximated.
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
const declarable = (id) => (RESERVED.has(id) ? `${id}Field` : id);

const BOX = new Set(["GtkWindow", "GtkDialog", "GtkBox", "GtkGrid", "GtkFrame", "GtkScrolledWindow"]);
const CHECKABLE = new Set(["GtkCheckButton", "GtkToggleButton"]);
const COMBO = new Set(["GtkComboBoxText", "GtkComboBox"]);
const FIELD_LIKE = new Set(["GtkEntry", "GtkTextView", "GtkCheckButton", "GtkToggleButton", "GtkComboBoxText", "GtkComboBox"]);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), usesNgFor: false,
    byName: new Map(),
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
 * A widget's own `<property>` children whose value this reader does not
 * interpret (anything GtkBuilder wrote as a nested element rather than
 * plain text), named by property name and value type only, never by what
 * they hold. `consumed` lists the properties this widget's own rendering
 * already read on purpose, so a property read for a reason is not also
 * reported as an unread gap.
 */
function noteOpaqueProps(widget, label, state, consumed = []) {
  const names = childrenOf(widget, "property")
    .map((p) => attrOf(p, "name"))
    .filter((n) => n && !consumed.includes(n));
  const opaque = names.map((n) => valueOf(widget, n)).filter((v) => v && v.value === null);
  if (opaque.length) {
    state.note(`\`${label}\` declares propert${opaque.length === 1 ? "y" : "ies"} this reader does not interpret beyond their names: ${opaque.map((p) => `${p.name} (${p.type})`).join(", ")}.`);
  }
}

/**
 * Ids, field names and radio groups are settled before anything renders, in
 * one walk over the whole tree (tab labels and internal children included,
 * since a mnemonic or a group reference may point at any of them), so a
 * label or a radio met before the widget it refers to resolves the same
 * either way.
 */
function prepare(widget, state, radios) {
  for (const child of allChildObjects(widget)) {
    const klass = attrOf(child, "class") || "";
    const id = attrOf(child, "id");
    if (id) state.byName.set(id, child);
    if (klass === "GtkRadioButton") {
      const group = valueOf(child, "group");
      radios.push({ id: id || `radio${state.seq++}`, el: child, groupRef: group?.type === "text" && group.value ? group.value : null });
    } else if (FIELD_LIKE.has(klass)) {
      const fallback = COMBO.has(klass) ? `select${state.seq++}` : CHECKABLE.has(klass) ? `check${state.seq++}` : `field${state.seq++}`;
      child.field = state.unique(declarable(id || fallback));
      state.fields.push(child.field);
    }
    prepare(child, state, radios);
  }
}

/**
 * GTK groups radio buttons by one naming another's id in its own `group`
 * property, unlike Qt's buttonGroup-by-name; a chain of references (A groups
 * with B groups with C) is one group, resolved here by union find so
 * document order never matters. A radio with no `group` and none pointing
 * back at it is a group of one, exactly the singleton GtkBuilder itself
 * would leave it as with no code wiring it to any other.
 */
function resolveRadioGroups(radios, state) {
  const parent = new Map(radios.map((r) => [r.id, r.id]));
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(x) !== root) { const next = parent.get(x); parent.set(x, root); x = next; }
    return root;
  };
  for (const r of radios) if (r.groupRef && parent.has(r.groupRef)) {
    const a = find(r.id); const b = find(r.groupRef);
    if (a !== b) parent.set(a, b);
  }
  const groupField = new Map();
  for (const r of radios) {
    const root = find(r.id);
    if (!groupField.has(root)) {
      const key = state.unique(camel(root) || "choice");
      groupField.set(root, key);
      state.fields.push(key);
    }
    r.el.field = groupField.get(root);
  }
}

function renderBox(widget, klass, id, state, depth) {
  const pad = "  ".repeat(depth);
  const lines = [`${pad}<div>`];
  const consumed = [];
  if (klass === "GtkFrame") {
    consumed.push("label");
    const label = valueOf(widget, "label");
    if (label?.type === "text" && label.value) lines.push(`${pad}  <h2>${esc(label.value)}</h2>`);
  }
  for (const child of childWidgets(widget, state.note, id || klass)) lines.push(...render(child, state, depth + 1));
  noteOpaqueProps(widget, id || klass, state, consumed);
  lines.push(`${pad}</div>`);
  return lines;
}

function renderNotebook(widget, id, state, depth) {
  const pad = "  ".repeat(depth);
  const pages = childWidgets(widget, state.note, id || "the notebook");
  state.note(`\`${id || "the notebook"}\` switches between ${pages.length} page(s); every page is in the template and which one shows is a state the port drives.`);
  noteOpaqueProps(widget, id || "GtkNotebook", state, []);
  const lines = [`${pad}<div class="tabs">`];
  for (const page of pages) lines.push(...render(page, state, depth + 1));
  lines.push(`${pad}</div>`);
  return lines;
}

function renderLabel(widget, id, state, depth) {
  const pad = "  ".repeat(depth);
  const text = valueOf(widget, "label");
  const content = text?.type === "text" ? text.value : "";
  const mnemonic = valueOf(widget, "mnemonic_widget");
  const targetId = mnemonic?.type === "text" ? mnemonic.value : null;
  const target = targetId ? state.byName.get(targetId) : null;
  noteOpaqueProps(widget, id || "a label", state, ["label", "mnemonic_widget"]);
  if (target?.field) return [`${pad}<label for="f-${target.field}">${esc(content)}</label>`];
  if (targetId) state.note(`\`${id || "a label"}\`'s mnemonic_widget \`${targetId}\` is not a field this reader lowered; the label stands alone.`);
  return content ? [`${pad}<p>${esc(content)}</p>`] : [];
}

function renderEntry(widget, id, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const visibility = valueOf(widget, "visibility");
  const type = visibility?.type === "text" && visibility.value === "False" ? "password" : "text";
  noteOpaqueProps(widget, id || field, state, ["visibility"]);
  return [`${pad}<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderTextarea(widget, id, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  noteOpaqueProps(widget, id || field, state, []);
  return [`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`];
}

function renderCheckbox(widget, id, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const text = valueOf(widget, "label");
  noteOpaqueProps(widget, id || field, state, ["label", "active"]);
  return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(text?.value ?? "")}</label>`];
}

function renderRadio(widget, id, state, depth) {
  const pad = "  ".repeat(depth);
  const group = widget.field;
  const text = valueOf(widget, "label");
  const label = text?.value ?? "";
  noteOpaqueProps(widget, id || group, state, ["label", "active", "group"]);
  const value = attrSafe(kebab(label) || id || "choice");
  return [`${pad}<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`];
}

function renderSelect(widget, klass, id, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const items = klass === "GtkComboBoxText" ? inlineItems(widget) : [];
  noteOpaqueProps(widget, id || field, state, []);
  const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
  if (items.length) {
    for (const it of items) lines.push(`${pad}  <option>${esc(it)}</option>`);
  } else {
    state.usesNgFor = true;
    state.note(`\`${id || field}\` declares no inline items; ${klass === "GtkComboBox" ? "its rows come from a GtkTreeModel this reader does not chase" : "they are populated from code at runtime"}, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
  }
  lines.push(`${pad}</select>`);
  return lines;
}

function renderButton(widget, id, state, depth) {
  const pad = "  ".repeat(depth);
  const text = valueOf(widget, "label");
  const label = text?.value ?? id ?? "";
  noteOpaqueProps(widget, id || label || "a button", state, ["label"]);
  const signal = signalOf(widget, "clicked");
  if (!signal) {
    state.note(`\`${id || label}\` has no \`<signal name="clicked">\` child wired; it is emitted with no wiring found.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  const handler = attrOf(signal, "handler") || "";
  const event = camel(handler.replace(/^on_?/i, "")) || "click";
  state.outputs.add(event);
  return [`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

function renderTreeView(widget, id, state, depth) {
  const pad = "  ".repeat(depth);
  const cols = childObjectsOfClass(widget, "GtkTreeViewColumn");
  noteOpaqueProps(widget, id || "a tree view", state, []);
  if (!hasInternalChild(widget, "selection")) {
    state.note(`\`${id || "a tree view"}\` declares no internal selection child; it is read as a GtkTreeView all the same.`);
  }
  if (!cols.length) {
    state.note(`\`${id || "a tree view"}\` declares no GtkTreeViewColumn definitions; the port has a table with no header and rows the code supplies.`);
    return [`${pad}<table></table>`];
  }
  const heads = cols.map((c) => esc(valueOf(c, "title")?.value ?? ""));
  state.note(`\`${id || "a tree view"}\`'s rows come from the code at runtime; none are invented here.`);
  return [`${pad}<table>`, `${pad}  <thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`, `${pad}  <tbody></tbody>`, `${pad}</table>`];
}

function render(widget, state, depth) {
  const klass = attrOf(widget, "class") || "";
  const id = attrOf(widget, "id") || "";
  const pad = "  ".repeat(depth);
  if (BOX.has(klass)) return renderBox(widget, klass, id, state, depth);
  if (klass === "GtkNotebook") return renderNotebook(widget, id, state, depth);
  if (klass === "GtkLabel") return renderLabel(widget, id, state, depth);
  if (klass === "GtkEntry") return renderEntry(widget, id, state, depth);
  if (klass === "GtkTextView") return renderTextarea(widget, id, state, depth);
  if (CHECKABLE.has(klass)) return renderCheckbox(widget, id, state, depth);
  if (klass === "GtkRadioButton") return renderRadio(widget, id, state, depth);
  if (COMBO.has(klass)) return renderSelect(widget, klass, id, state, depth);
  if (klass === "GtkButton") return renderButton(widget, id, state, depth);
  if (klass === "GtkTreeView") return renderTreeView(widget, id, state, depth);
  const kids = childWidgets(widget, () => {});
  state.note(`the widget class \`${klass}\`${id ? ` (${id})` : ""} is not lowered${kids.length ? `; ${kids.length} child widget(s) inside it were not read either` : ""}; it is named here rather than approximated.`);
  return [];
}

/**
 * One `.glade` file lowered onto the shared dialect. `rel` is only used in
 * notes that need to say where a structural problem was found; `note` is
 * called for those, kept separate from the notes the widget tree itself
 * gathers so a caller can prefix or route each kind differently.
 */
export function lowerGlade(interfaceEl, rel, note = () => {}) {
  const root = rootObject(interfaceEl);
  if (!root) { note(`${rel}: no widget <object> in the <interface> element; nothing was read.`); return null; }

  const state = makeState();
  for (const req of readRequires(interfaceEl)) {
    if (req.lib && req.lib !== "gtk+") state.note(`the file requires \`${req.lib}\` (version ${req.version ?? "unstated"}); its widgets are outside GTK's own set and are not lowered here.`);
  }

  const radios = [];
  prepare(root, state, radios);
  resolveRadioGroups(radios, state);

  const klass = attrOf(root, "class") || "";
  const rootId = attrOf(root, "id") || "";
  const title = valueOf(root, "title");
  const lines = [];
  for (const child of childWidgets(root, state.note, rootId || klass)) lines.push(...render(child, state, 1));
  noteOpaqueProps(root, rootId || klass, state, ["title"]);
  const heading = title?.type === "text" && title.value ? [`  <h2>${esc(title.value)}</h2>`] : [];
  const template = ["<div>", ...heading, ...lines, "</div>"].join("\n");
  const stem = kebab(rootId) || kebab(klass) || "screen";
  const className = pascal(stem) || "Screen";
  return {
    template,
    stem,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
    title: (title?.type === "text" && title.value) || className,
    className,
  };
}
