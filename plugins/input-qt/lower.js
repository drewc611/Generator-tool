import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { attrOf } from "../dsp-ir/markup.js";
import { childrenOf, childWidgets, readClassName, readConnections, readCustomWidgets, rootWidget, valueOf } from "./parse.js";

/**
 * What a Qt Designer widget tree means, once parse.js has handed it over as
 * plain elements. A `<widget class="...">` is a real component boundary
 * somebody placed with the Designer, so this reader produces a screen the
 * way input-winforms and input-delphi do from a form, laid out in the
 * document order the layouts already recorded. What has no honest
 * equivalent, a property this reader does not interpret, a promoted widget's
 * real behaviour, a signal with no connection wired, is named through the
 * caller's `note` rather than approximated.
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

const BOX = new Set(["QDialog", "QWidget", "QMainWindow", "QGroupBox", "QFrame"]);
const TEXT_INPUT = new Set(["QLineEdit", "QSpinBox", "QDoubleSpinBox"]);
const TEXTAREA = new Set(["QTextEdit", "QPlainTextEdit"]);
const TABLE = new Set(["QTableWidget", "QTableView"]);
const FIELD_LIKE = new Set(["QLineEdit", "QSpinBox", "QDoubleSpinBox", "QTextEdit", "QPlainTextEdit", "QCheckBox", "QComboBox"]);

function makeState(connections, customWidgets) {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), usesNgFor: false,
    byName: new Map(), buttonGroups: new Map(), connections, customWidgets,
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
 * interpret (every type but string, bool, number and double), named by
 * property name and value type only, never by what they hold. `consumed`
 * lists the properties this widget's own rendering already read on purpose
 * (a caption, a buddy, an echo mode), so a property read for a reason is not
 * also reported as an unread gap.
 */
function noteOpaqueProps(widget, label, state, consumed = []) {
  const names = childrenOf(widget, "property")
    .map((p) => attrOf(p, "name"))
    .filter((n) => n && !consumed.includes(n));
  const opaque = names.map((n) => valueOf(widget, n)).filter((v) => v && v.value === null && v.type);
  if (opaque.length) {
    state.note(`\`${label}\` declares propert${opaque.length === 1 ? "y" : "ies"} this reader does not interpret beyond their names: ${opaque.map((p) => `${p.name} (${p.type})`).join(", ")}.`);
  }
}

/**
 * Field ids and radio groups are settled before anything renders, in one walk
 * over the whole tree, so a label met before its buddy (or after it) resolves
 * the same either way: `byName` and every field's `.field` are complete
 * before render ever looks at them.
 */
function prepare(widget, state) {
  const parentName = attrOf(widget, "name") ?? "";
  let localRadioGroup = null;
  for (const child of childWidgets(widget)) {
    const klass = attrOf(child, "class");
    const name = attrOf(child, "name");
    if (name) state.byName.set(name, child);
    if (klass === "QRadioButton") {
      const bg = valueOf(child, "buttonGroup", "attribute");
      const bgName = bg?.type === "string" ? bg.value : null;
      if (bgName) {
        if (!state.buttonGroups.has(bgName)) {
          const key = state.unique(camel(bgName) || "choice");
          state.buttonGroups.set(bgName, key);
          state.fields.push(key);
        }
        child.field = state.buttonGroups.get(bgName);
      } else {
        // Radios sharing one immediate container, with no QButtonGroup naming a
        // wider group, are the one group Designer's own tree already says they are.
        if (!localRadioGroup) {
          localRadioGroup = state.unique(camel(parentName) || "choice");
          state.fields.push(localRadioGroup);
        }
        child.field = localRadioGroup;
      }
    } else if (FIELD_LIKE.has(klass)) {
      const fallback = klass === "QComboBox" ? `select${state.seq++}` : klass === "QCheckBox" ? `check${state.seq++}` : `field${state.seq++}`;
      child.field = state.unique(declarable(name || fallback));
      state.fields.push(child.field);
    }
    prepare(child, state);
  }
}

function renderBox(widget, klass, name, state, depth) {
  const pad = "  ".repeat(depth);
  const lines = [`${pad}<div>`];
  const consumed = [];
  if (klass === "QGroupBox") {
    consumed.push("title");
    const title = valueOf(widget, "title");
    if (title?.type === "string" && title.value) lines.push(`${pad}  <h2>${esc(title.value)}</h2>`);
  }
  for (const child of childWidgets(widget, state.note)) lines.push(...render(child, state, depth + 1));
  noteOpaqueProps(widget, name || klass, state, consumed);
  lines.push(`${pad}</div>`);
  return lines;
}

function renderLabel(widget, name, state, depth) {
  const pad = "  ".repeat(depth);
  const text = valueOf(widget, "text");
  const content = text?.type === "string" ? text.value : "";
  const buddy = valueOf(widget, "buddy");
  const buddyName = buddy?.type === "cstring" ? buddy.raw : null;
  const target = buddyName ? state.byName.get(buddyName) : null;
  noteOpaqueProps(widget, name || "a label", state, ["text", "buddy"]);
  if (target?.field) return [`${pad}<label for="f-${target.field}">${esc(content)}</label>`];
  if (buddyName) state.note(`\`${name || "a label"}\`'s buddy \`${buddyName}\` is not a field this reader lowered; the label stands alone.`);
  return content ? [`${pad}<p>${esc(content)}</p>`] : [];
}

function renderInput(widget, klass, name, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const consumed = [];
  let type = "number";
  if (klass === "QLineEdit") {
    consumed.push("echoMode");
    type = "text";
    const echo = valueOf(widget, "echoMode");
    if (echo?.type === "enum" && /Password$/.test(echo.raw ?? "")) type = "password";
  }
  noteOpaqueProps(widget, name || field, state, consumed);
  return [`${pad}<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderTextarea(widget, name, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  noteOpaqueProps(widget, name || field, state, []);
  return [`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`];
}

function renderCheckbox(widget, name, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const text = valueOf(widget, "text");
  noteOpaqueProps(widget, name || field, state, ["text", "checked"]);
  return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(text?.value ?? "")}</label>`];
}

function renderRadio(widget, name, state, depth) {
  const pad = "  ".repeat(depth);
  const group = widget.field;
  const text = valueOf(widget, "text");
  const label = text?.value ?? "";
  noteOpaqueProps(widget, name || group, state, ["text", "checked"]);
  const value = attrSafe(kebab(label) || name || "choice");
  return [`${pad}<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`];
}

function renderSelect(widget, name, state, depth) {
  const pad = "  ".repeat(depth);
  const field = widget.field;
  const items = childrenOf(widget, "item");
  noteOpaqueProps(widget, name || field, state, []);
  const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
  if (items.length) {
    for (const it of items) lines.push(`${pad}  <option>${esc(valueOf(it, "text")?.value ?? "")}</option>`);
  } else {
    state.usesNgFor = true;
    state.note(`\`${name || field}\` declares no inline items; they are populated from code at runtime, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
  }
  lines.push(`${pad}</select>`);
  return lines;
}

function renderButton(widget, name, state, depth) {
  const pad = "  ".repeat(depth);
  const text = valueOf(widget, "text");
  const label = text?.value ?? name ?? "";
  noteOpaqueProps(widget, name || label || "a button", state, ["text"]);
  const conn = state.connections.find((c) => c.sender === name && c.signal === "clicked()");
  if (!conn) {
    state.note(`\`${name || label}\` has no \`clicked()\` connection wired in the .ui file; it is emitted with no wiring found.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  const event = camel(conn.slot.replace(/\(\)\s*$/, "")) || "click";
  state.outputs.add(event);
  return [`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

function renderTable(widget, name, state, depth) {
  const pad = "  ".repeat(depth);
  const cols = childrenOf(widget, "column");
  noteOpaqueProps(widget, name || "a table", state, []);
  if (!cols.length) {
    state.note(`\`${name || "a table"}\` declares no columns; the port has a table with no header and rows the code supplies.`);
    return [`${pad}<table></table>`];
  }
  const heads = cols.map((c) => esc(valueOf(c, "text")?.value ?? ""));
  state.note(`\`${name || "a table"}\`'s rows come from the code at runtime; none are invented here.`);
  return [`${pad}<table>`, `${pad}  <thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`, `${pad}  <tbody></tbody>`, `${pad}</table>`];
}

function renderTabs(widget, name, state, depth) {
  const pad = "  ".repeat(depth);
  const pages = childrenOf(widget, "widget");
  state.note(`\`${name || "the tab widget"}\` switches between ${pages.length} page(s); every page is in the template and which one shows is a state the port drives.`);
  const lines = [`${pad}<div class="tabs">`];
  for (const page of pages) {
    const title = valueOf(page, "title", "attribute");
    const label = title?.type === "string" ? title.value : (attrOf(page, "name") ?? "");
    lines.push(`${pad}  <section aria-label="${esc(label)}">`);
    for (const child of childWidgets(page, state.note)) lines.push(...render(child, state, depth + 2));
    lines.push(`${pad}  </section>`);
  }
  lines.push(`${pad}</div>`);
  return lines;
}

function render(widget, state, depth) {
  const klass = attrOf(widget, "class") ?? "";
  const name = attrOf(widget, "name") ?? "";
  const pad = "  ".repeat(depth);
  if (BOX.has(klass)) return renderBox(widget, klass, name, state, depth);
  if (klass === "QLabel") return renderLabel(widget, name, state, depth);
  if (TEXT_INPUT.has(klass)) return renderInput(widget, klass, name, state, depth);
  if (TEXTAREA.has(klass)) return renderTextarea(widget, name, state, depth);
  if (klass === "QCheckBox") return renderCheckbox(widget, name, state, depth);
  if (klass === "QRadioButton") return renderRadio(widget, name, state, depth);
  if (klass === "QComboBox") return renderSelect(widget, name, state, depth);
  if (klass === "QPushButton") return renderButton(widget, name, state, depth);
  if (TABLE.has(klass)) return renderTable(widget, name, state, depth);
  if (klass === "QTabWidget") return renderTabs(widget, name, state, depth);
  const promoted = state.customWidgets.get(klass);
  if (promoted) {
    state.note(`\`${name || klass}\` is promoted to \`${klass}\` (extends \`${promoted.extends ?? "an unrecognised base"}\`); its real behaviour was not read, only that it exists.`);
    return [`${pad}<div class="${kebab(klass)}"></div>`];
  }
  const kids = childWidgets(widget);
  state.note(`the widget class \`${klass}\`${name ? ` (${name})` : ""} is not lowered${kids.length ? `; ${kids.length} child widget(s) inside it were not read either` : ""}; it is named here rather than approximated.`);
  return [];
}

/**
 * One `.ui` file lowered onto the shared dialect. `rel` is only used in
 * notes that need to say where a structural problem was found; `note` is
 * called for those, kept separate from the notes the widget tree itself
 * gathers so a caller can prefix or route each kind differently.
 */
export function lowerUi(uiEl, rel, note = () => {}) {
  const root = rootWidget(uiEl);
  if (!root) { note(`${rel}: no <widget> in the <ui> element; nothing was read.`); return null; }
  const state = makeState(readConnections(uiEl), readCustomWidgets(uiEl));
  prepare(root, state);
  const klass = attrOf(root, "class") ?? "";
  const rootName = attrOf(root, "name") ?? "";
  const title = valueOf(root, "windowTitle");
  const lines = [];
  for (const child of childWidgets(root, state.note)) lines.push(...render(child, state, 1));
  noteOpaqueProps(root, rootName || klass, state, ["windowTitle"]);
  const heading = title?.type === "string" && title.value ? [`  <h2>${esc(title.value)}</h2>`] : [];
  const template = ["<div>", ...heading, ...lines, "</div>"].join("\n");
  const className = readClassName(uiEl) || rootName || "Screen";
  return {
    template,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
    title: (title?.type === "string" && title.value) || className,
    className,
  };
}
