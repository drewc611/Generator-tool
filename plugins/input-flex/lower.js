import { pascal } from "../dsp-ir/emit.js";
import { attr, bindingOf, parseMxml } from "./parse.js";
import { handlerName, readScript } from "./script.js";

/**
 * An MXML file lowered onto the shared dialect. MXML is a declarative tree
 * exactly like XAML's, so the widget choices mirror input-xaml's: a Panel's
 * title becomes a heading, a text field's id names its model, a button's
 * click is matched to a real function rather than read for what it does.
 * What sets Flex apart is the script sitting inside the same file, the way a
 * Vue single file component holds its script beside its template, and the
 * curly brace {expression} binding syntax, which is never printed as if it
 * were the literal text a user would have seen.
 */

// Anchored to the whole namespace, so a URI that merely contains these words is not read as Flex's.
const MX_NS = /^library:\/\/ns\.adobe\.com\/flex\/mx\/?$/;
const SPARK_NS = /^library:\/\/ns\.adobe\.com\/flex\/spark\/?$/;
const FX_NS = /^https?:\/\/ns\.adobe\.com\/mxml\/\d+\/?$/;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => { const p = pascal(kebab(text)); return p ? p.charAt(0).toLowerCase() + p.slice(1) : ""; };

const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

const CONTAINER = new Set(["application", "windowedapplication", "panel", "group", "vgroup", "hgroup", "vbox", "hbox", "canvas", "form"]);
const TEXT = new Set(["label", "text", "richtext"]);
const INPUT = new Set(["textinput"]);
const TEXTAREA = new Set(["textarea"]);
const CHECKBOX = new Set(["checkbox"]);
const COMBOBOX = new Set(["combobox"]);
const RADIOGROUP = new Set(["radiobuttongroup"]);
const BUTTON = new Set(["button"]);
const FORMITEM = new Set(["formitem"]);
const STYLE = new Set(["style"]);

function kindOf(tag) {
  if (CONTAINER.has(tag)) return "container";
  if (TEXT.has(tag)) return "text";
  if (INPUT.has(tag)) return "input";
  if (TEXTAREA.has(tag)) return "textarea";
  if (CHECKBOX.has(tag)) return "checkbox";
  if (COMBOBOX.has(tag)) return "select";
  if (RADIOGROUP.has(tag)) return "radiogroup";
  if (BUTTON.has(tag)) return "button";
  if (FORMITEM.has(tag)) return "formitem";
  if (STYLE.has(tag)) return "style";
  return null;
}

/** What a value shows: a literal, a binding (named, never printed as text), or nothing. */
function caption(node, attrName, state) {
  const v = attr(node, attrName);
  const raw = v === null ? node.text : v;
  if (!raw) return { text: "", expr: null };
  const bound = bindingOf(raw);
  if (bound !== null) {
    state.note(`${node.name}'s \`${attrName ?? "text"}\` is the binding \`{${bound}}\`; the port is handed \`${camel(bound.split(/[.\s]/)[0])}\`, which it must supply.`);
    return { text: "", expr: camel(bound.split(/[.\s]/)[0]) || "value" };
  }
  return { text: raw, expr: null };
}
const captionText = (c) => (c.expr ? `{{ ${c.expr} }}` : esc(c.text));

/** The options an inline ArrayCollection or Array declares: mx:Object rows or plain mx:String rows, never a store this reader cannot see. */
function inlineOptions(holder) {
  const collection = holder.children.find((c) => c.tag === "arraycollection" || c.tag === "array");
  if (!collection) return null;
  const source = collection.children.find((c) => c.tag === "source") ?? collection;
  const items = source.children.map((item) => {
    if (item.tag === "object") { const label = attr(item, "label"); const data = attr(item, "data"); return { label: label ?? data ?? "", value: data ?? label ?? "" }; }
    if (item.tag === "string") return { label: item.text, value: item.text };
    return null;
  }).filter(Boolean);
  return items;
}

/** A ComboBox or RadioButtonGroup's data, from its dataProvider attribute or its own nested dataProvider element. Bound to a variable is a gap, never a guess at what the variable holds. */
function dataProviderOf(node, state, field) {
  const boundAttr = attr(node, "dataProvider");
  if (boundAttr !== null) {
    const bound = bindingOf(boundAttr);
    state.note(`${node.name}'s \`dataProvider\` is ${bound !== null ? `the binding \`{${bound}}\`` : `\`${boundAttr}\``}, defined elsewhere; the port takes it as \`${field}Options\`, which it must be handed.`);
    return null;
  }
  const holder = node.children.find((c) => c.tag === "dataprovider");
  if (!holder) return null;
  const options = inlineOptions(holder);
  if (!options) { state.note(`${node.name}'s dataProvider element declares neither an ArrayCollection nor an Array this reader reads; the port takes it as \`${field}Options\`, which it must be handed.`); return null; }
  return options;
}

function makeState(ns) {
  const names = new Set();
  const notes = [];
  const widgetNS = (prefix) => { const uri = ns[prefix ?? ""] ?? ""; return MX_NS.test(uri) || SPARK_NS.test(uri); };
  return {
    fields: [],
    outputs: new Set(),
    usesNgFor: false,
    widgetNS,
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

/** The event a button raises, from the function its click attribute names, "on" stripped the way a handler is usually spelled. */
function eventOf(node, state, functions) {
  const handler = attr(node, "click");
  if (handler === null) return { event: null };
  if (bindingOf(handler) !== null) { state.note(`${node.name}'s \`click\` is the binding \`${handler}\`, not a plain function reference; the port is not wired to it.`); return { event: null }; }
  const name = handlerName(handler);
  if (!name || !functions.has(name)) { state.note(`${node.name}'s \`click\` names \`${handler}\`, which is not a function this reader found in the script block; the port is handed a plain button.`); return { event: null }; }
  state.note(`${node.name}'s \`click\` calls \`${name}\`, ${functions.get(name).lines} line(s) of code; it exists, and is not read further.`);
  const event = camel(name.replace(/^on(?=[A-Z])/, "").replace(/_?click$/i, "")) || camel(name);
  return { event };
}

function render(node, state, functions, depth) {
  const pad = "  ".repeat(depth);
  const kind = state.widgetNS(node.prefix) ? kindOf(node.tag) : null;
  if (kind === null) {
    state.note(state.widgetNS(node.prefix) ? `${node.name} is not a recognised MX or Spark tag; it is named here, not approximated.` : `${node.name} is a custom component this reader does not read; it is named here, not approximated.`);
    return [];
  }
  switch (kind) {
    case "style":
      state.note(`${node.name} declares a style block; Flex styling is not parsed and none of it reaches the port.`);
      return [];
    case "container": {
      const lines = [`${pad}<div>`];
      if (node.tag === "panel") {
        const title = caption(node, "title", state);
        if (title.text || title.expr) lines.push(`${pad}  <h2>${captionText(title)}</h2>`);
      }
      for (const child of node.children) lines.push(...render(child, state, functions, depth + 1));
      lines.push(`${pad}</div>`);
      return lines;
    }
    case "text": {
      const text = caption(node, "text", state);
      return (text.text || text.expr) ? [`${pad}<p>${captionText(text)}</p>`] : [];
    }
    case "input": case "textarea": {
      const id = attr(node, "id");
      const field = state.unique(id ? camel(id) : `field`);
      state.fields.push(field);
      const password = /^true$/i.test(attr(node, "displayAsPassword") ?? "");
      if (kind === "textarea") return [`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`];
      return [`${pad}<input id="f-${field}" type="${password ? "password" : "text"}" ng-model="${field}">`];
    }
    case "checkbox": {
      const id = attr(node, "id");
      const field = state.unique(id ? camel(id) : "check");
      state.fields.push(field);
      const label = caption(node, "label", state);
      return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${captionText(label)}</label>`];
    }
    case "select": {
      const id = attr(node, "id");
      const field = state.unique(id ? camel(id) : "select");
      state.fields.push(field);
      const options = dataProviderOf(node, state, field);
      const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
      if (options) for (const o of options) lines.push(`${pad}  <option value="${esc(o.value)}">${esc(o.label)}</option>`);
      else { state.usesNgFor = true; lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`); }
      lines.push(`${pad}</select>`);
      return lines;
    }
    case "radiogroup": {
      const id = attr(node, "id");
      const field = state.unique(id ? camel(id) : "choice");
      state.fields.push(field);
      const options = node.children.filter((c) => c.tag === "radiobutton").map((r) => {
        const label = caption(r, "label", state);
        const value = attr(r, "value");
        return { value: value ?? (label.text || label.expr || ""), label };
      });
      const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
      for (const o of options) lines.push(`${pad}  <option value="${esc(o.value)}">${captionText(o.label)}</option>`);
      lines.push(`${pad}</select>`);
      return lines;
    }
    case "button": {
      const label = caption(node, "label", state);
      const { event } = eventOf(node, state, functions);
      if (event) { state.outputs.add(event); return [`${pad}<button type="button" ng-click="on${pascal(event)}()">${captionText(label)}</button>`]; }
      return [`${pad}<button type="button">${captionText(label)}</button>`];
    }
    case "formitem": {
      const label = caption(node, "label", state);
      const inner = node.children.flatMap((c) => render(c, state, functions, depth + 1));
      if (!label.text && !label.expr) return inner;
      return [`${pad}<label>`, `${pad}  ${captionText(label)}`, ...inner, `${pad}</label>`];
    }
    default: return [];
  }
}

export function lowerMxml(source, rel, note = () => {}) {
  const { root, ns } = parseMxml(source);
  if (!root) { note(`${rel}: no root element; nothing was read.`); return { screen: null }; }
  if (!/^(application|windowedapplication)$/.test(root.tag)) {
    note(`${rel}: the root <${root.name}> is not an Application or a WindowedApplication, so it is not a screen this reader ports.`);
    return { screen: null };
  }

  const state = makeState(ns);
  const scriptNode = (function find(n) { if (n.tag === "script") return n; for (const c of n.children) { const f = find(c); if (f) return f; } return null; })(root);
  const script = scriptNode ? readScript(scriptNode.cdata ?? "") : { functions: new Map(), bindable: new Set() };
  if (script.bindable.size) state.note(`${[...script.bindable].length} [Bindable] propert${script.bindable.size === 1 ? "y" : "ies"} declared (${[...script.bindable].join(", ")}); each is data bound, nothing more is read.`);

  const title = caption(root, "title", state);
  const body = root.children.filter((c) => c.tag !== "script").flatMap((c) => render(c, state, script.functions, 1));
  const template = ["<div>", ...(title.text || title.expr ? [`  <h2>${captionText(title)}</h2>`] : []), ...body, "</div>"].join("\n");

  const selector = kebab(rel.split("/").pop().replace(/\.mxml$/i, "")) || "screen";
  const usedNamespaces = Object.values(ns).some((uri) => MX_NS.test(uri) || SPARK_NS.test(uri) || FX_NS.test(uri));
  if (!usedNamespaces) note(`${rel}: no library://ns.adobe.com/flex/mx, .../spark or mxml/2009 namespace was declared on the root; every tag was read as an unrecognised component.`);
  for (const n of state.notes) note(`${rel}: ${n}`);

  return {
    screen: {
      selector, className: pascal(selector), file: rel,
      fields: state.fields,
      outputs: [...state.outputs].sort(), template,
      templateOrigin: `an MXML ${root.name}, read structurally from ${rel}`,
      usesNgIf: false, usesNgFor: state.usesNgFor, usesTwoWay: state.fields.length > 0, rxjs: [], readBy: "flex",
      title: title.text || selector.replace(/-/g, " "),
    },
  };
}
