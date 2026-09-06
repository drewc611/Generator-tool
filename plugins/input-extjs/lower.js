import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { entryValue } from "./parse.js";

/**
 * What an ExtJS config tree means, once parse.js has handed it over as plain
 * key and value pairs. An `xtype` is a real component boundary, drawn by
 * whoever wrote the app, so this reader produces screens the way input-vb6
 * and input-exe do from a form, not an inventory the way input-jquery does
 * for a library with no boundaries at all.
 *
 * A config this reader cannot lower is named through the caller's `note`
 * rather than approximated: a store or model referenced by name, a layout
 * other than the default, a handler's body, a `vtype`, an unknown xtype, an
 * `extend` onto a base class nothing here recognises.
 */

// The trailing dot segment before an ExtJS class name is the family the SDK
// itself organises by (Ext.panel.Panel, Ext.form.Panel, Ext.grid.Panel), so
// an `extend` with no `xtype` beside it still names a family this table can
// answer for; a family the table has never heard of is named, not guessed.
const familyOf = (extendPath) => {
  const segments = String(extendPath).split(".");
  return segments.length >= 2 ? segments[segments.length - 2].toLowerCase() : null;
};

export const xtypeOf = (node) => {
  const literal = entryValue(node, "xtype");
  if (literal?.kind === "string") return literal.value;
  const extend = entryValue(node, "extend");
  // The family segment only means something for the framework's own classes;
  // an app's own base class is not Ext's to have organised, and reading its
  // path the same way would invent a family that was never claimed.
  return extend?.kind === "string" && /^Ext\./.test(extend.value) ? familyOf(extend.value) : null;
};

/** Why a config lowered to nothing: an xtype nobody's asked for yet, a custom base class, or neither name at all. */
function unknownNote(node, xtype) {
  if (xtype) return `the xtype \`${xtype}\` is not lowered; it is named here rather than approximated.`;
  const extend = entryValue(node, "extend");
  if (extend?.kind === "string") return `extends \`${extend.value}\`, a base class this reader does not recognise; its shape was not read.`;
  return "carries neither an xtype nor an extend this reader can classify; nothing was lowered.";
}

/** A class this reader keeps out of the screen tree because it is data, not UI: a store, a model, a proxy, the state it reads. */
export const isDataClass = (name) => typeof name === "string" && /^Ext\.(data|util|state)\./.test(name);

const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/** kebab or PascalCase text to camelCase, the spelling a field name or an event needs. Not shared: each reader that turns
 * captions into identifiers keeps its own copy, since none of them agree closely enough to be one function. */
const camel = (text) => {
  const p = pascal(String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A config value only when it is a plain string; a dynamic caption is never guessed at, so a variable or a call is left out rather than shown as if it were the text itself. */
const literalText = (node) => (node?.kind === "string" ? node.value : node?.kind === "number" ? String(node.value) : null);

/** The array of object children under `items`; ExtJS also allows a single bare object, and either an array or nothing at all. */
function itemsOf(node) {
  const items = entryValue(node, "items");
  if (items?.kind === "array") return items.items.filter((i) => i.kind === "object");
  if (items?.kind === "object") return [items];
  return [];
}

/** The field label an author wrote for a control: a leading fieldLabel, or a checkbox's own boxLabel. */
const labelOf = (node) => literalText(entryValue(node, "fieldLabel")) ?? literalText(entryValue(node, "boxLabel"));

/**
 * The state one class's lowering carries as it walks its item tree: the
 * names already given out, the fields the screen owns, the events it raises,
 * and the notes gathered along the way. `unique` is what input-exe and
 * input-winforms already do to keep two controls from colliding on one name;
 * kept local here for the same reason `camel` is: the naming conventions
 * differ just enough between readers that sharing the function would mean
 * threading a framework's own quirks through code the other readers do not
 * carry.
 */
function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [],
    outputs: new Set(),
    usesNgFor: false,
    submitButton: null,
    fieldSeq: 1,
    buttonSeq: 1,
    note(text) { if (!notes.includes(text)) notes.push(text); },
    notes,
    unique(base) {
      const stem = declarable(base || "field");
      let name = stem;
      let n = 2;
      while (names.has(name)) name = `${stem}${n++}`;
      names.add(name);
      return name;
    },
  };
}

function fieldName(node, fallback, state) {
  const declared = entryValue(node, "name");
  const base = declared?.kind === "string" ? declared.value : camel(labelOf(node)) || fallback;
  return state.unique(base);
}

/** A function or an identifier bound to a behaviour key: named as opaque, never read past what it is. */
function noteHandler(state, subject, key, value) {
  if (!value) return;
  if (value.kind === "function") state.note(`${subject}'s \`${key}\` is ${value.lines} line(s) of code; it exists, and is not read further.`);
  else if (value.kind === "expr") state.note(`${subject}'s \`${key}\` is wired to \`${value.text}\`, a reference this reader does not follow.`);
}

/** The click behaviour a button (or a listeners block) declares, `handler` and `listeners.click` both read the same way. */
const clickHandler = (node) => entryValue(node, "handler") ?? entryValue(entryValue(node, "listeners"), "click");

/** The button deepest in reading order under `node`, the one Enter would have reached last and so the one a form submits with. */
function lastButton(node) {
  let found = null;
  const walk = (n) => {
    if (n?.kind !== "object") return;
    if (xtypeOf(n) === "button") found = n;
    for (const child of itemsOf(n)) walk(child);
  };
  walk(node);
  return found;
}

/**
 * A combobox or selectfield's options, read only where the store is
 * something this file can already see: an inline array, or an inline store
 * config with a `data` array. A store named elsewhere, or shaped some other
 * way, is not resolved; the caller is told so and hands the port a name to
 * fill in by hand rather than a guess at what it holds.
 */
function storeOptions(storeNode) {
  if (!storeNode) return { options: [] };
  const rowValue = (row) => (row?.kind === "array" ? row.items.map(literalText) : [literalText(row)]);
  if (storeNode.kind === "array") {
    const options = storeNode.items.map((item) => {
      const [value, label] = rowValue(item);
      return { value: value ?? "", label: label ?? value ?? "" };
    });
    return { options };
  }
  if (storeNode.kind === "object") {
    const data = entryValue(storeNode, "data");
    if (data?.kind === "array") {
      const options = data.items.map((row) => {
        const [value, label] = rowValue(row);
        return { value: value ?? "", label: label ?? value ?? "" };
      });
      return { options };
    }
  }
  const name = storeNode.kind === "string" ? storeNode.value : storeNode.kind === "expr" ? storeNode.text : null;
  return { options: [], unresolved: name };
}

function renderBox(node, xtype, state, depth) {
  const pad = "  ".repeat(depth);
  const title = literalText(entryValue(node, "title"));
  const heading = xtype === "panel" && title;
  const tag = heading ? "section" : "div";
  const lines = [`${pad}<${tag}>`];
  if (heading) lines.push(`${pad}  <h2>${esc(title)}</h2>`);
  for (const child of itemsOf(node)) lines.push(...renderNode(child, state, depth + 1));
  lines.push(`${pad}</${tag}>`);
  return lines;
}

function renderForm(node, state, depth) {
  const pad = "  ".repeat(depth);
  state.submitButton = lastButton(node);
  const children = itemsOf(node).flatMap((c) => renderNode(c, state, depth + 1));
  state.outputs.add("submit");
  return [`${pad}<form ng-submit="onSubmit()">`, ...children, `${pad}</form>`];
}

function renderTextInput(node, xtype, state, depth) {
  const pad = "  ".repeat(depth);
  const field = fieldName(node, `field${state.fieldSeq++}`, state);
  state.fields.push(field);
  const label = labelOf(node);
  const type = xtype === "numberfield" ? "number" : xtype === "datefield" ? "date" : "text";
  const vtype = entryValue(node, "vtype");
  if (vtype?.kind === "string") state.note(`\`${label ?? field}\` declares the vtype \`${vtype.value}\`; its validation is named here, not reproduced.`);
  const required = entryValue(node, "allowBlank");
  if (required?.kind === "boolean" && required.value === false) state.note(`\`${label ?? field}\` sets allowBlank to false; the port keeps the field, not the constraint.`);
  const lines = [];
  if (label) lines.push(`${pad}<label for="f-${field}">${esc(label)}</label>`);
  lines.push(`${pad}<input id="f-${field}" type="${type}" ng-model="${field}">`);
  return lines;
}

function renderTextarea(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = fieldName(node, `field${state.fieldSeq++}`, state);
  state.fields.push(field);
  const label = labelOf(node);
  const lines = [];
  if (label) lines.push(`${pad}<label for="f-${field}">${esc(label)}</label>`);
  lines.push(`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`);
  return lines;
}

function renderCheckbox(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = fieldName(node, `check${state.fieldSeq++}`, state);
  state.fields.push(field);
  const label = labelOf(node) ?? "";
  return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(label)}</label>`];
}

function renderSelect(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = fieldName(node, `select${state.fieldSeq++}`, state);
  state.fields.push(field);
  const label = labelOf(node);
  const { options, unresolved } = storeOptions(entryValue(node, "store"));
  const lines = [];
  if (label) lines.push(`${pad}<label for="f-${field}">${esc(label)}</label>`);
  if (options.length) {
    lines.push(`${pad}<select id="f-${field}" ng-model="${field}">`);
    for (const o of options) lines.push(`${pad}  <option value="${attrSafe(o.value)}">${esc(o.label)}</option>`);
    lines.push(`${pad}</select>`);
  } else {
    state.usesNgFor = true;
    lines.push(`${pad}<select id="f-${field}" ng-model="${field}">`, `${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`, `${pad}</select>`);
    state.note(
      unresolved
        ? `\`${label ?? field}\`'s store, \`${unresolved}\`, is defined elsewhere and was not read; the port takes it as \`${field}Options\`, which it must be handed.`
        : `\`${label ?? field}\`'s store could not be read as inline data; the port takes it as \`${field}Options\`, which it must be handed.`
    );
  }
  return lines;
}

function renderButton(node, state, depth) {
  const pad = "  ".repeat(depth);
  const text = literalText(entryValue(node, "text")) ?? "";
  const itemId = entryValue(node, "itemId");
  const base = camel(text) || (itemId?.kind === "string" ? camel(itemId.value) : "") || `button${state.buttonSeq++}`;
  const subject = `the ${text || base} button`;
  noteHandler(state, subject, "handler", entryValue(node, "handler"));
  const listenerClick = entryValue(entryValue(node, "listeners"), "click");
  if (listenerClick) noteHandler(state, subject, "listeners.click", listenerClick);
  if (node === state.submitButton) return [`${pad}<button type="submit">${esc(text)}</button>`];
  const event = state.unique(base);
  state.outputs.add(event);
  return [`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(text)}</button>`];
}

function renderTabs(node, state, depth) {
  const pad = "  ".repeat(depth);
  const tabs = itemsOf(node);
  const lines = [`${pad}<div class="tabs">`, `${pad}  <nav>`];
  for (const tab of tabs) lines.push(`${pad}    <span>${esc(literalText(entryValue(tab, "title")) ?? "")}</span>`);
  lines.push(`${pad}  </nav>`);
  for (const tab of tabs) lines.push(...renderNode(tab, state, depth + 1));
  lines.push(`${pad}</div>`);
  return lines;
}

function renderGrid(node, state, depth) {
  const pad = "  ".repeat(depth);
  const columns = entryValue(node, "columns");
  const cols = columns?.kind === "array" ? columns.items.filter((c) => c.kind === "object") : [];
  if (!cols.length) state.note("the grid's columns could not be read structurally; an empty table stands in.");
  const lines = [`${pad}<table>`, `${pad}  <thead><tr>`];
  for (const c of cols) lines.push(`${pad}    <th>${esc(literalText(entryValue(c, "text")) ?? literalText(entryValue(c, "dataIndex")) ?? "")}</th>`);
  lines.push(`${pad}  </tr></thead>`, `${pad}  <tbody></tbody>`, `${pad}</table>`);
  state.note("the grid's rows come from its store at runtime; none are invented here.");
  return lines;
}

const BOX = new Set(["panel", "container", "viewport", "window"]);
const TEXT_INPUT = new Set(["textfield", "numberfield", "datefield"]);
const CHECK = new Set(["checkboxfield", "checkbox"]);
const SELECT = new Set(["combobox", "selectfield"]);
const GRID = new Set(["grid", "gridpanel"]);
const FORM = new Set(["form", "formpanel"]);

function renderNode(node, state, depth) {
  if (node?.kind !== "object") { state.note("an entry in items is not a plain config object; it was skipped."); return []; }
  const xtype = xtypeOf(node);
  const layout = entryValue(node, "layout");
  if (layout?.kind === "string" && layout.value !== "auto") {
    state.note(`the layout \`${layout.value}\` is named here, not reproduced; its items render in document order.`);
  }
  if (BOX.has(xtype)) return renderBox(node, xtype, state, depth);
  if (FORM.has(xtype)) return renderForm(node, state, depth);
  if (TEXT_INPUT.has(xtype)) return renderTextInput(node, xtype, state, depth);
  if (xtype === "textarea") return renderTextarea(node, state, depth);
  if (CHECK.has(xtype)) return renderCheckbox(node, state, depth);
  if (SELECT.has(xtype)) return renderSelect(node, state, depth);
  if (xtype === "button") return renderButton(node, state, depth);
  if (xtype === "tabpanel") return renderTabs(node, state, depth);
  if (GRID.has(xtype)) return renderGrid(node, state, depth);
  const extend = entryValue(node, "extend");
  if (extend?.kind === "string" && isDataClass(extend.value)) return [];
  state.note(unknownNote(node, xtype));
  return [];
}

/**
 * One `Ext.define` or `Ext.create` config tree, lowered onto the AngularJS
 * attribute dialect the rest of the tool already reads. `className` names the
 * screen when the tree itself carries none; a tree with neither an `xtype`
 * nor an `extend` this file recognises lowers to nothing, and says so.
 */
export function lowerClass(config, className) {
  const state = makeState();
  const xtype = xtypeOf(config);
  if (!xtype) {
    state.note(unknownNote(config, xtype));
    return { template: null, fields: [], outputs: [], notes: state.notes, usesNgFor: false, usesTwoWay: false, title: className };
  }
  const title = literalText(entryValue(config, "title")) ?? className;
  const lines = renderNode(config, state, 0);
  return {
    template: lines.length ? lines.join("\n") : null,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
    title,
  };
}
