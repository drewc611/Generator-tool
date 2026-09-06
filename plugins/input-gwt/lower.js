import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { hasBinding, namespaceOf, parseUiXml } from "./parse.js";

/**
 * A UiBinder view lowered onto the shared AngularJS attribute dialect. The
 * widget tree is a real component boundary somebody drew (a `<g:TextBox
 * ui:field="usernameBox"/>` is the same kind of evidence a WinForms designer
 * control or a VB6 field is), so this reader produces a screen the way
 * input-winforms and input-vb6 do, on the choices they already settled: a
 * field's name comes from `ui:field` where the file gives one, a button
 * wires `ng-click` to an event named for it, and the paired .java file is
 * read only far enough to say which button has a `@UiHandler` and how long
 * it runs, never what it does.
 *
 * What has no honest equivalent is named through `note` rather than
 * invented: a `{...}` template expression anywhere in text lives in
 * PORT_NOTES.md, not in the port; a `<ui:with>` resource injection is named
 * with its field and type and never resolved; a widget with no vocabulary
 * entry, native or from another import namespace, is named and kept as an
 * empty placeholder.
 */

const UI_BINDER_NS = "urn:ui:com.google.gwt.uibinder";
const WIDGET_NS = "urn:import:com.google.gwt.user.client.ui";

const CONTAINER = new Set(["HTMLPanel", "FlowPanel", "VerticalPanel", "HorizontalPanel", "DockLayoutPanel", "SimplePanel"]);
const TEXT_TAG = { Label: "p", InlineLabel: "span", HTML: "p" };
const FIELD_INPUT = new Set(["TextBox", "PasswordTextBox", "TextArea", "IntegerBox", "DoubleBox"]);
const BUTTON = new Set(["Button", "PushButton"]);

const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);
const kebab = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => {
  const p = pascal(kebab(text));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** State one file's lowering carries as it walks the widget tree: named the way input-extjs's own `makeState` is, kept local for the same reason. */
function makeState({ widgetPrefix, uiPrefix, handlers }) {
  const names = new Set();
  const notes = [];
  return {
    widgetPrefix, uiPrefix, handlers,
    fields: [], outputs: new Set(),
    fieldSeq: 1, checkSeq: 1, selectSeq: 1, buttonSeq: 1,
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

/** The `ui:field` a node declares, under whatever prefix this file gave the `ui` namespace. */
const fieldAttr = (node, state) => (state.uiPrefix ? node.attrs[`${state.uiPrefix}:field`] ?? null : null);

/** A node's own literal text, and whether it carries a template expression that must be named rather than shown. */
const caption = (node) => (hasBinding(node.text) ? { text: "", dynamic: true, raw: node.text } : { text: node.text, dynamic: false, raw: node.text });

function fieldName(node, fallback, state) {
  const declared = fieldAttr(node, state);
  return state.unique(declared || fallback);
}

function renderText(node, state, depth) {
  const pad = "  ".repeat(depth);
  const tag = TEXT_TAG[node.name];
  const cap = caption(node);
  if (cap.dynamic) {
    state.note(`the <${node.name}> holds the template expression \`${cap.raw}\`; it is named here, not read as literal text.`);
    return [`${pad}<${tag}></${tag}>`];
  }
  return cap.text ? [`${pad}<${tag}>${esc(cap.text)}</${tag}>`] : [];
}

function renderField(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = fieldName(node, `field${state.fieldSeq++}`, state);
  state.fields.push(field);
  if (node.name === "TextArea") return [`${pad}<textarea ng-model="${field}"></textarea>`];
  const type = node.name === "PasswordTextBox" ? "password" : node.name === "IntegerBox" || node.name === "DoubleBox" ? "number" : "text";
  return [`${pad}<input type="${type}" ng-model="${field}">`];
}

function renderCheckbox(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = fieldName(node, `check${state.checkSeq++}`, state);
  state.fields.push(field);
  const cap = caption(node);
  if (cap.dynamic) state.note(`the checkbox \`${field}\`'s label holds the template expression \`${cap.raw}\`; it is named here, not read as literal text.`);
  return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(cap.dynamic ? "" : cap.text)}</label>`];
}

/** A ListBox's `<g:item value="...">Label</g:item>` children: inline literal data, unlike a runtime store, so it is always read when present. */
function renderListBox(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = fieldName(node, `select${state.selectSeq++}`, state);
  state.fields.push(field);
  const items = node.children.filter((c) => c.prefix === state.widgetPrefix && c.name.toLowerCase() === "item");
  const lines = [`${pad}<select ng-model="${field}">`];
  for (const it of items) {
    const value = it.attrs.value ?? it.text;
    lines.push(`${pad}  <option value="${attrSafe(value ?? "")}">${esc(it.text)}</option>`);
  }
  if (!items.length) state.note(`the list box \`${field}\` declares no <g:item> children; the port has a select with no options.`);
  lines.push(`${pad}</select>`);
  return lines;
}

function renderButton(node, state, depth) {
  const pad = "  ".repeat(depth);
  const declared = fieldAttr(node, state);
  const cap = caption(node);
  if (cap.dynamic) state.note(`the button's caption holds the template expression \`${cap.raw}\`; it is named here, not read as literal text.`);
  const text = cap.dynamic ? "" : cap.text;
  const base = declared ? camel(declared.replace(/Button$/, "")) : camel(text);
  const event = state.unique(base || `button${state.buttonSeq++}`);
  state.outputs.add(event);
  const handler = declared ? state.handlers.get(declared) : null;
  if (declared && handler) state.note(`\`${declared}\`'s @UiHandler is wired to a method of ${handler.lines} line(s) starting at line ${handler.line}; it exists and is not read further.`);
  else if (declared) state.note(`no @UiHandler("${declared}") was found in the paired .java file; the port raises on${pascal(event)}() with nothing behind it in the source.`);
  else state.note(`the button "${text || node.name}" declares no ui:field, so no @UiHandler can be matched to it; the port raises on${pascal(event)}() with nothing behind it in the source.`);
  return [`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(text)}</button>`];
}

function renderContainer(node, state, depth) {
  const pad = "  ".repeat(depth);
  return [`${pad}<div>`, ...node.children.flatMap((c) => renderNode(c, state, depth + 1)), `${pad}</div>`];
}

function renderNode(node, state, depth) {
  const pad = "  ".repeat(depth);
  if (node.prefix !== state.widgetPrefix) {
    if (state.uiPrefix && node.prefix === state.uiPrefix) {
      state.note(uiNamespaceNote(node));
      return [];
    }
    const name = `${node.prefix ? `${node.prefix}:` : ""}${node.name}`;
    state.note(`<${name}> is a custom widget or from an import namespace this reader has not been told the vocabulary for; it is named here, not approximated.`);
    return [`${pad}<div class="unresolved-widget"></div>`];
  }
  if (CONTAINER.has(node.name)) return renderContainer(node, state, depth);
  if (TEXT_TAG[node.name]) return renderText(node, state, depth);
  if (FIELD_INPUT.has(node.name)) return renderField(node, state, depth);
  if (node.name === "CheckBox") return renderCheckbox(node, state, depth);
  if (node.name === "ListBox") return renderListBox(node, state, depth);
  if (BUTTON.has(node.name)) return renderButton(node, state, depth);
  state.note(`the widget <${node.prefix}:${node.name}> is not lowered; it is named here rather than approximated.`);
  return [`${pad}<div class="unresolved-widget"></div>`];
}

/** What a `<ui:with>`, `<ui:style>` or other UiBinder namespaced element means: named, never resolved for what it provides. */
function uiNamespaceNote(node) {
  if (/^with$/i.test(node.name)) return `<ui:with field="${node.attrs.field ?? ""}" type="${node.attrs.type ?? ""}"/> injects a resource; the field and type are named, never resolved for what they provide.`;
  return `<${node.prefix}:${node.name}> is UiBinder's own declaration, not a widget; it is named and not read.`;
}

/**
 * One `.ui.xml` file lowered. `handlers` is the map `scanJava` produced from
 * the paired `.java` file, by field name; an empty map (no paired file, or
 * one found but with none of its own) means every button's handler is
 * unresolved, and each says so on its own rather than once for the file,
 * since a person reading one button wants to know about that button.
 */
export function lowerUiBinder(source, rel, handlers, note) {
  const { root } = parseUiXml(source);
  if (!root) { note(`${rel}: no root element; nothing was read.`); return { screen: null }; }

  const uiPrefix = namespaceOf(root, UI_BINDER_NS);
  if (!(uiPrefix && root.prefix === uiPrefix && /^uibinder$/i.test(root.name))) {
    note(`${rel}: the root <${root.prefix ? `${root.prefix}:` : ""}${root.name}> is not <ui:UiBinder>; nothing was read.`);
    return { screen: null };
  }
  const widgetPrefix = namespaceOf(root, WIDGET_NS);
  if (!widgetPrefix) note(`${rel}: no xmlns import for com.google.gwt.user.client.ui is declared on the root; no widget in this file can be matched to the vocabulary.`);

  const state = makeState({ widgetPrefix, uiPrefix, handlers: handlers ?? new Map() });
  let widgetRoot = null;
  let extra = 0;
  for (const child of root.children) {
    if (child.prefix === uiPrefix) { state.note(uiNamespaceNote(child)); continue; }
    if (widgetRoot) { extra += 1; continue; }
    widgetRoot = child;
  }
  if (extra) state.note(`${extra} additional top level element(s) beside the widget root were not read.`);
  if (!widgetRoot) { note(`${rel}: <ui:UiBinder> declares no widget root; nothing was read.`); return { screen: null }; }

  const body = renderNode(widgetRoot, state, 1);
  const template = ["<div>", ...body, "</div>"].join("\n");
  for (const n of state.notes) note(n);

  return { screen: { fields: state.fields, outputs: [...state.outputs].sort(), template } };
}
