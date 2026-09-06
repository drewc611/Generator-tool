import { attrOf, parseMarkup, stripDelimited } from "../dsp-ir/markup.js";
import { pascal } from "../dsp-ir/emit.js";
import { decodeEntities, parseExtension, readBinding, resourceKey, staticMember } from "./extension.js";

/**
 * A XAML file lowered onto the shared dialect. XAML is XML: a Window, Page,
 * UserControl or ContentPage holds a tree of panels and controls, each control
 * naming its bindings in its attributes and the code behind holding nothing
 * the layout needs. The tree is parsed structurally, property elements
 * (`<Grid.RowDefinitions>`, `<Button.Content>`) set aside from children, and
 * every control becomes the HTML element nearest it, in the order a reader
 * meets them: a Grid's children by row then column, a Canvas's by top then
 * left, every other panel's as written. The choices mirror input-exe's so a
 * dialog compiled into an .exe and the same dialog written in XAML come out
 * as the same port: a text before a field labels it, radios group by name or
 * panel, the default button is the form's submit handing every field back by
 * name, Cancel is an event, a hidden control is shown by a named state, and
 * what has no honest equivalent is named rather than approximated.
 */

// Anchored to the whole namespace, so a URI that merely contains these words is not read as MAUI's.
const MAUI_NS = /^https?:\/\/(?:schemas\.microsoft\.com\/dotnet\/\d+\/maui|xamarin\.com\/schemas\/\d+\/forms)\/?$/;
const XAML_NS = /schemas\.microsoft\.com\/winfx\/\d+\/xaml$/;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => {
  const p = pascal(kebab(text));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** A name the emitted JavaScript can declare: a caption that spells a reserved word gets a suffix. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/** A binding path as the JavaScript the port reads: each segment's first letter lowered, an all caps segment lowered whole, casts and the current item slash dropped. */
const segment = (s) => (/^[A-Z0-9_]+$/.test(s) ? s.toLowerCase() : s.charAt(0).toLowerCase() + s.slice(1));
export const pathJs = (path) => String(path ?? "").replace(/[()]/g, "").replace(/\//g, ".").split(".").filter(Boolean).map((seg) => seg.replace(/^[A-Za-z_]\w*/, segment)).join(".");

/**
 * A caption without its mnemonic underscore and trailing punctuation, with the
 * access key it named. A doubled underscore is a literal one and is set aside
 * before the mnemonic is looked for, so it never names the key.
 */
const LITERAL_US = String.fromCharCode(1);
export function mnemonic(text) {
  const raw = String(text ?? "").replace(/__/g, LITERAL_US);
  const m = /_([^_\s])/.exec(raw);
  const clean = raw.replace(/_/g, "").split(LITERAL_US).join("_").replace(/(\.\.\.|…|:)\s*$/, "").trim();
  return { text: clean, accesskey: m ? m[1].toLowerCase() : null };
}
const plain = (text) => ({ text: String(text ?? "").replace(/(\.\.\.|…|:)\s*$/, "").trim(), accesskey: null });

/** What a control is, by its element name, the namespace prefix set aside. */
export function kindOf(tag) {
  switch (tag) {
    case "textblock": case "label": return "text";
    case "textbox": case "entry": case "passwordbox": case "searchbar": case "autosuggestbox": case "numberbox": return "input";
    case "richtextbox": case "editor": return "textarea";
    case "checkbox": case "togglebutton": case "toggleswitch": case "switch": return "checkbox";
    case "radiobutton": return "radio";
    case "groupbox": return "group";
    case "combobox": case "listbox": case "picker": return "select";
    case "button": case "appbarbutton": case "repeatbutton": case "imagebutton": return "button";
    case "hyperlinkbutton": case "hyperlink": return "link";
    case "slider": return "range";
    case "stepper": return "number";
    case "datepicker": case "calendardatepicker": return "date";
    case "timepicker": return "time";
    case "progressbar": case "progressring": case "activityindicator": return "progress";
    case "image": return "image";
    case "listview": case "gridview": case "collectionview": case "itemscontrol": return "list";
    case "datagrid": return "table";
    case "treeview": return "tree";
    case "tabcontrol": case "pivot": case "tabbedpage": return "tabs";
    case "menu": case "menubar": case "contextmenu": case "menuflyout": return "menu";
    case "expander": return "expander";
    case "separator": case "menuflyoutseparator": return "separator";
    case "rectangle": case "line": case "ellipse": case "path": case "polygon": case "polyline": return "shape";
    case "stackpanel": case "grid": case "dockpanel": case "wrappanel": case "canvas": case "border": case "scrollviewer": case "viewbox":
    case "stacklayout": case "verticalstacklayout": case "horizontalstacklayout": case "frame": case "contentview": case "scrollview":
    case "uniformgrid": case "relativepanel": case "flexlayout": case "absolutelayout": case "contentcontrol": case "panel": case "contentpresenter":
    case "window": case "page": case "usercontrol": case "contentpage": case "navigationpage": case "flyoutpage": case "shell": case "shellcontent":
    case "tabitem": case "pivotitem": case "splitview": case "refreshview": case "adorner":
      return "container";
    default: return "unknown";
  }
}

const FIELD = new Set(["input", "textarea", "select", "range", "number", "date", "time"]);
const TEXT_ATTRS = ["Content", "Text", "Header", "Title"];
/** Events the code behind handled that the dialect has no event for: each is named, none invented. */
const BEHAVIOURS = new Set(["SelectionChanged", "TextChanged", "Checked", "Unchecked", "Indeterminate", "Toggled", "ValueChanged", "LostFocus", "GotFocus", "KeyDown", "KeyUp", "PreviewKeyDown", "PreviewKeyUp", "PreviewTextInput", "MouseDoubleClick", "MouseDown", "MouseUp", "MouseEnter", "MouseLeave", "Loaded", "Unloaded", "Closing", "Closed", "Tapped", "DoubleTapped", "Completed", "DateSelected", "TimeSelected", "Scrolled", "ItemTapped", "ItemSelected", "Refreshing", "SizeChanged", "Drop", "DragOver", "DragEnter", "QuerySubmitted", "TextChanging", "SuggestionChosen", "Appearing", "Disappearing", "Focused", "Unfocused", "SelectedDateChanged", "SelectedIndexChanged", "CellEditEnding", "RowEditEnding", "Sorting", "Navigated", "ContextMenuOpening", "Opened", "Expanded", "Collapsed", "SelectionChangeCommitted", "TextInput"]);
const KEYBOARDS = { email: "email", emailsmtpaddress: "email", numeric: "number", number: "number", telephone: "tel", telephonenumber: "tel", url: "url", chat: "text", text: "text", plain: "text", default: "text" };

/** The tree, comments and the XML declaration set aside, property elements split from children, text collected. */
export function parseXaml(source) {
  const text = stripDelimited(String(source ?? "").replace(/<\?[\s\S]*?\?>/g, ""), "<!--", "-->");
  // The shared tree reader knows no dot in a tag name, so a property element's dot is spelled `__` on the way in and read back on the way out.
  const marked = text.replace(/<(\/?)([A-Za-z_][\w:]*(?:\.\w+)+)/g, (m, slash, name) => `<${slash}${name.replace(/\./g, "__")}`);
  const rootEl = parseMarkup(marked).children.find((c) => c.type === "el") ?? null;
  if (!rootEl) return { root: null };
  const ns = {};
  for (const a of rootEl.attrs) if (/^xmlns(:|$)/.test(a.name)) ns[a.name === "xmlns" ? "" : a.name.slice(6)] = a.value ?? "";
  const x = Object.keys(ns).find((p) => p && XAML_NS.test(ns[p])) ?? "x";
  const flavor = MAUI_NS.test(ns[""] ?? "") ? "maui" : "wpf";
  // The tree lowercases every tag; the notes and the layout report spell each as the file did.
  const spelling = new Map();
  for (const m of text.matchAll(/<([A-Za-z_][\w:.-]*)/g)) if (!spelling.has(m[1].toLowerCase())) spelling.set(m[1].toLowerCase(), m[1]);
  const normalize = (el, parent) => {
    const colon = el.tag.indexOf(":");
    const node = { tag: colon >= 0 ? el.tag.slice(colon + 1) : el.tag, prefix: colon >= 0 ? el.tag.slice(0, colon) : null, name: spelling.get(el.tag) ?? el.tag, el, parent, children: [], props: {}, text: "" };
    for (const c of el.children) {
      if (c.type === "text") { node.text += c.text; continue; }
      const dot = c.tag.lastIndexOf("__");
      if (dot > 0) { const key = c.tag.slice(dot + 2); node.props[key] = c.children.filter((k) => k.type === "el").map((k) => normalize(k, node)); node.props[key].text = c.children.filter((k) => k.type === "text").map((k) => k.text).join(""); continue; }
      node.children.push(normalize(c, node));
    }
    node.text = decodeEntities(node.text.replace(/\s+/g, " ").trim());
    return node;
  };
  return { root: normalize(rootEl, null), ns, x, flavor };
}

const attr = (node, name) => { const v = attrOf(node.el, name); return v === null ? null : decodeEntities(v); };
const ext = (node, name) => parseExtension(attr(node, name));
const isTrue = (v) => /^true$/i.test(String(v ?? ""));
const isFalse = (v) => /^false$/i.test(String(v ?? ""));

/** A panel's children in the order a reader meets them: a Grid by row then column, a Canvas by top then left, the rest as written. */
export function ordered(node) {
  const num = (n, name) => Number(attr(n, name) ?? 0) || 0;
  const by = (a, b) => (list) => list.map((n, i) => ({ n, i })).sort((p, q) => num(p.n, a) - num(q.n, a) || num(p.n, b) - num(q.n, b) || p.i - q.i).map((p) => p.n);
  if (node.tag === "grid") return by("Grid.Row", "Grid.Column")(node.children);
  if (node.tag === "canvas") return by("Canvas.Top", "Canvas.Left")(node.children);
  return node.children;
}

/** How many rows and columns a Grid declares, from the property element or MAUI's attribute spelling. */
export function gridShape(node) {
  const count = (key, attrName) => {
    const prop = node.props[key];
    if (prop?.length) return prop.length;
    const a = attr(node, attrName);
    return a ? a.split(",").filter((s) => s.trim()).length : 0;
  };
  return { rows: count("rowdefinitions", "RowDefinitions"), columns: count("columndefinitions", "ColumnDefinitions") };
}

export function lowerXaml(source, rel, note = () => {}) {
  const { root, x, flavor } = parseXaml(source);
  if (!root) { note(`${rel}: no root element; nothing was read.`); return { screen: null, layout: [`## ${rel}`, "", "No root element.", ""] }; }
  const xattr = (node, name) => attr(node, `${x}:${name}`);
  const klass = xattr(root, "Class");
  const resources = root.props.resources ?? [];
  const resourceLine = (list) => list.map((r) => `${xattr(r, "Key") ?? attr(r, "TargetType") ?? "(implicit)"} (${r.name})`).join(", ");

  if (root.tag === "resourcedictionary" || root.tag === "application") {
    const declared = root.tag === "resourcedictionary" ? root.children : resources;
    note(`${rel} is ${root.tag === "application" ? "the application definition" : "a resource dictionary"}, not a screen: ${declared.length} resource(s) declared (${resourceLine(declared) || "none"}); styles and templates are not read and every screen that used them is named where it did.`);
    return { screen: null, layout: [`## ${rel}`, "", `${root.tag === "application" ? "Application" : "ResourceDictionary"}${klass ? ` \`${klass}\`` : ""}, ${declared.length} resource(s): ${resourceLine(declared) || "none"}.`, ""] };
  }
  const rootKind = /window$/.test(root.tag) ? "window" : /page$/.test(root.tag) ? "page" : root.tag === "usercontrol" || /control$/.test(root.tag) || /view$/.test(root.tag) ? "control" : klass ? "window" : null;
  if (!rootKind) {
    note(`${rel}: the root <${root.name}> is not a window, page or control and declares no x:Class, so it is not a screen this reader ports.`);
    return { screen: null, layout: [`## ${rel}`, "", `Root <${root.name}>, not read as a screen.`, ""] };
  }

  const notes = { hidden: [], disabled: [], images: 0, lists: [], unknown: [], skipped: [], converters: [], resources: new Set(), behaviours: [], initial: [], strings: [], oneWay: [], reach: [], tabs: 0, props: new Set() };
  const names = new Set();
  const unique = (base) => {
    const stem = declarable(base || "field");
    let name = stem; let n = 2;
    while (names.has(name)) name = `${stem}${n++}`;
    names.add(name);
    return name;
  };
  const byName = new Map();
  const walkAll = (n) => { const nm = xattr(n, "Name") ?? attr(n, "Name"); if (nm) byName.set(nm, n); n.children.forEach(walkAll); Object.values(n.props).forEach((p) => p.forEach(walkAll)); };
  walkAll(root);
  const outputs = new Set();
  const fields = [];
  const keys = new Set();
  let hasSubmit = false; let hasModel = false; let hasRepeat = false; let hasShow = false;
  const layout = [];

  /**
   * A bound path as the JavaScript the port reads, inside a row's scope when
   * there is one. An ElementName binding reads another control, a
   * RelativeSource or Source one reaches outside the data context; each is
   * lowered to the nearest name and said.
   */
  const bound = (b, scope, where) => {
    if (b.elementName) {
      const target = byName.get(b.elementName);
      const base = target?.field ?? camel(b.elementName);
      const path = b.path ? `${base}.${pathJs(b.path)}` : base;
      notes.reach.push(`${where} reads ${b.elementName}${b.path ? `.${b.path}` : ""} (ElementName), lowered to \`${path}\``);
      return path;
    }
    if (b.relative || b.source || b.template) {
      const path = pathJs(b.path) || "dataContext";
      notes.reach.push(`${where} binds ${b.relative ? "through RelativeSource" : b.template ? "through TemplateBinding" : "to a Source"}, outside the data context; lowered to \`${path}\``);
      return path;
    }
    if (b.format) notes.skipped.push(`${where} formats its value with StringFormat, which the port does not apply; the raw value is shown`);
    if (b.converter) notes.converters.push(`${where} (${resourceKey(b.converter) ?? "a converter"})`);
    const path = pathJs(b.path);
    if (!path) return scope ? scope.item : "dataContext";
    return scope ? `${scope.item}.${path}` : path;
  };
  const resource = (key) => { notes.resources.add(key); return camel(key); };

  /** What a control shows: a literal caption, a bound expression, or text from resources, from the first attribute the control carries. */
  const caption = (node, scope, mnemonics = flavor !== "maui") => {
    const read = mnemonics ? mnemonic : plain;
    const uid = xattr(node, "Uid");
    for (const name of TEXT_ATTRS) {
      const v = attr(node, name);
      if (v === null) continue;
      const e = parseExtension(v);
      if (!e) { const lit = v.replace(/^\{\}/, ""); return { ...read(lit), literal: lit }; }
      const b = readBinding(e);
      if (b) return { text: "", accesskey: null, expr: bound(b, scope, `${node.name} ${name}`) };
      const member = staticMember(e);
      if (member) { notes.strings.push(`${node.name} ${name} is x:Static ${member}`); return { text: "", accesskey: null, expr: `strings.${camel(member.split(".").pop())}` }; }
      const key = resourceKey(e);
      if (key) return { text: "", accesskey: null, expr: resource(key) };
    }
    if (node.text) return { ...read(node.text), literal: node.text };
    const content = node.props.content;
    if (content?.text?.trim()) return { ...read(content.text.trim()), literal: content.text.trim() };
    if (uid) { notes.strings.push(`${node.name} x:Uid ${uid} takes its text from a resource file`); return { text: "", accesskey: null, expr: `strings.${camel(uid)}` }; }
    return { text: "", accesskey: null };
  };
  const captionText = (node) => { const c = caption(node, null, false); return c.expr ? `{{ ${c.expr} }}` : esc(c.text); };
  const hidden = (node) => /^(collapsed|hidden)$/i.test(attr(node, "Visibility") ?? "") || isFalse(attr(node, "IsVisible"));
  const label = (node) => node.labelText ?? attr(node, "Header") ?? attr(node, "Title") ?? attr(node, "Placeholder") ?? attr(node, "PlaceholderText") ?? null;
  const name = (node, ...paths) => {
    const own = xattr(node, "Name") ?? attr(node, "Name");
    for (const p of paths) { const b = readBinding(ext(node, p)); if (b && !b.elementName && !b.relative && !b.source) return unique(pathJs(b.path)); }
    const lbl = node.labelText ?? attr(node, "Header");
    return unique((own && camel(own)) || (lbl && !parseExtension(lbl) && camel(plain(lbl).text)) || "");
  };
  const field = (node, expr) => {
    node.field = expr;
    node.id = `f-${kebab(expr)}`;
    let key = expr.split(".").pop(); let n = 2;
    while (keys.has(key)) key = `${expr.split(".").pop()}${n++}`;
    keys.add(key);
    fields.push({ key, expr });
    hasModel = true;
  };

  /** Names and labels are settled before anything is rendered, in the render's own order, so a label can name a field met later. */
  const prepare = (node, scope) => {
    const kids = ordered(node);
    const radioGroups = new Map();
    for (let i = 0; i < kids.length; i += 1) {
      const k = kids[i];
      const kind = kindOf(k.tag);
      if (kind === "text") {
        const target = readBinding(ext(k, "Target"));
        const explicit = target?.elementName ? byName.get(target.elementName) : null;
        const next = kids[i + 1];
        const cap = caption(k, scope);
        const labels = explicit ?? (!hidden(k) && cap.literal && next && FIELD.has(kindOf(next.tag)) && !next.labelledBy ? next : null);
        if (labels && !labels.labelledBy) { labels.labelledBy = k; labels.labelText = cap.text; k.labels = labels; }
        // A Switch or ToggleSwitch has no caption of its own; the text beside it is what a person reads as its name.
        else if (!explicit && !hidden(k) && cap.literal && next && kindOf(next.tag) === "checkbox" && !caption(next, scope).text && !attr(next, "Header") && !next.labelText) { next.labelText = cap.text; k.captions = next; }
      } else if (kind === "input" || kind === "textarea") field(k, name(k, "Text", "Value", "Password"));
      else if (kind === "select") field(k, name(k, "SelectedItem", "SelectedValue", "Text", "SelectedIndex"));
      else if (kind === "range" || kind === "number") field(k, name(k, "Value"));
      else if (kind === "date") field(k, name(k, "SelectedDate", "Date"));
      else if (kind === "time") field(k, name(k, "Time", "SelectedTime"));
      else if (kind === "checkbox") field(k, name(k, "IsChecked", "IsOn", "IsToggled"));
      else if (kind === "radio") {
        // A named group shares its model across the panel; unnamed radios in one panel are one group, as WPF groups them.
        const group = attr(k, "GroupName") ?? "";
        if (!radioGroups.has(group)) {
          const header = node.tag === "groupbox" || node.parent?.tag === "groupbox" ? caption(node.tag === "groupbox" ? node : node.parent, scope).text : "";
          const model = unique(camel(group) || camel(header) || "choice");
          radioGroups.set(group, model);
          fields.push({ key: model, expr: model }); keys.add(model); hasModel = true;
        }
        k.field = radioGroups.get(group);
        if (readBinding(ext(k, "IsChecked"))) notes.skipped.push(`radio ${caption(k, scope).text || k.name} binds IsChecked on its own; the group's selection is the one field \`${k.field}\``);
      }
      if (kind === "group" || kind === "container" || kind === "tabs" || kind === "expander" || kind === "button") prepare(k, scope);
    }
  };

  const common = (node, kind) => {
    const attrs = [];
    // A field's Text is a value, never a caption: notes and state names use the control's name for it.
    const what = FIELD.has(kind) ? xattr(node, "Name") || node.name : caption(node, null).text || xattr(node, "Name") || node.name;
    const enabled = attr(node, "IsEnabled");
    const eb = readBinding(parseExtension(enabled));
    if (eb && kind !== "text") attrs.push(`ng-disabled="!${bound(eb, null, `${node.name} IsEnabled`)}"`);
    else if (isFalse(enabled) && kind !== "text" && kind !== "container") { attrs.push("disabled"); notes.disabled.push(what); }
    const vis = attr(node, "Visibility") ?? attr(node, "IsVisible");
    const vb = readBinding(parseExtension(vis));
    if (vb) { hasShow = true; attrs.push(`ng-show="${bound(vb, null, `${node.name} Visibility`)}"`); }
    else if (hidden(node)) { hasShow = true; const shown = unique(`${camel(what) || "control"}Shown`); attrs.push(`ng-show="shown.${shown}"`); notes.hidden.push(what); }
    const tip = attr(node, "ToolTip") ?? attr(node, "ToolTipService.ToolTip");
    if (tip && !parseExtension(tip)) attrs.push(`title="${esc(tip)}"`);
    const aria = attr(node, "AutomationProperties.Name") ?? attr(node, "SemanticProperties.Description");
    if (aria && !parseExtension(aria)) attrs.push(`aria-label="${esc(aria)}"`);
    for (const a of node.el.attrs) {
      if (BEHAVIOURS.has(a.name) && a.value && /^\w+$/.test(a.value)) notes.behaviours.push(`${a.name}="${a.value}" on ${node.name}${xattr(node, "Name") ? ` ${xattr(node, "Name")}` : ""}`);
      const e = parseExtension(a.value);
      const key = resourceKey(e);
      if (key) notes.resources.add(key);
      else if (e && !readBinding(e) && !staticMember(e) && !/^(Null|Type|Reference|Bind|Binding)$/.test(e.type)) notes.skipped.push(`${node.name} ${a.name} is a {${e.type}} extension this reader does not read`);
    }
    for (const p of Object.keys(node.props)) if (!/^(content|header|items|itemtemplate|columns|view|resources|rowdefinitions|columndefinitions|contextmenu|text|inlines|children|flyout)$/.test(p)) notes.props.add(`${node.name}.${p}`);
    if (node.props.contextmenu?.length) node.contextMenu = node.props.contextmenu[0];
    return attrs.length ? " " + attrs.join(" ") : "";
  };

  /** The event a button raises, from its handler, its command, its caption or its name, in that order of evidence. */
  const eventOf = (node, cap) => {
    const handler = attr(node, "Click") ?? attr(node, "Clicked") ?? attr(node, "Tapped");
    if (handler && !parseExtension(handler)) return camel(handler.replace(/^On(?=[A-Z])/, "").replace(/_?(Click|Clicked|Tapped)$/, "")) || camel(handler);
    const cmd = readBinding(ext(node, "Command"));
    if (cmd && cmd.path) return camel(pathJs(cmd.path).split(".").pop().replace(/Command$/, "")) || "command";
    const s = staticMember(ext(node, "Command"));
    if (s) return camel(s.split(".").pop());
    return camel(cap.text) || camel(xattr(node, "Name") ?? "") || "";
  };

  /** Text with its inline children: Runs, line breaks, bold, italic, underline, spans and hyperlinks. */
  const inline = (node, scope) => {
    const cap = caption(node, scope, node.tag === "label" && flavor !== "maui");
    if (cap.expr) return `{{ ${cap.expr} }}`;
    if (attr(node, "Text") !== null || attr(node, "Content") !== null) return esc(cap.text);
    const inlines = [...(node.props.inlines ?? []), ...node.children];
    if (!inlines.length) return esc(node.text);
    let out = "";
    for (const c of node.el.children) {
      if (c.type === "text") { out += esc(decodeEntities(c.text).replace(/\s+/g, " ")); continue; }
      const k = node.children.find((n) => n.el === c);
      if (!k) continue;
      switch (k.tag) {
        case "run": out += inline(k, scope); break;
        case "linebreak": out += "<br>"; break;
        case "bold": out += `<b>${inline(k, scope)}</b>`; break;
        case "italic": out += `<i>${inline(k, scope)}</i>`; break;
        case "underline": out += `<u>${inline(k, scope)}</u>`; break;
        case "hyperlink": { const c2 = caption(k, scope, false); const text = c2.expr ? `{{ ${c2.expr} }}` : esc(c2.text || k.text); const event = eventOf(k, { text: c2.text || k.text }); outputs.add(event); const nav = attr(k, "NavigateUri"); if (nav && !parseExtension(nav)) notes.skipped.push(`the link ${c2.text || k.text || event} navigated to ${nav}; the port raises on${pascal(event)} instead`); out += `<button type="button" class="link" ng-click="on${pascal(event)}()">${text}</button>`; break; }
        default: out += inline(k, scope);
      }
    }
    return out.replace(/\s+/g, " ").trim();
  };

  const initial = (node, what, ...attrsToCheck) => { for (const a of attrsToCheck) { const v = attr(node, a); if (v !== null && !parseExtension(v)) { notes.initial.push(what); return; } } };

  /** A row template's body is carried only when it is text, images and panels; a control inside a row is a decision about the row, so the row is named instead. */
  const simpleRow = (node) => { const k = kindOf(node.tag); return k === "text" || (["image", "container", "separator", "shape"].includes(k) && node.children.every(simpleRow)); };

  const listBody = (node, depth, scope) => {
    const pad = "  ".repeat(depth);
    const template = (node.props.itemtemplate ?? []).find((t) => t.tag === "datatemplate") ?? (node.props.itemtemplate ?? [])[0];
    const rowNode = template?.children[0] ?? null;
    const member = attr(node, "DisplayMemberPath") ?? attr(node, "ItemDisplayBinding") ?? null;
    if (rowNode && simpleRow(rowNode)) return render(rowNode, depth, { item: "item" }, { inRow: true });
    if (rowNode) notes.skipped.push(`the row template of ${node.name}${xattr(node, "Name") ? ` ${xattr(node, "Name")}` : ""} carries controls (${rowNode.name}); the port shows each row as its text and the template is named in LAYOUT.md`);
    if (member) { const b = readBinding(parseExtension(member)); return [`${pad}{{ item.${pathJs(b ? b.path : member)} }}`]; }
    return [`${pad}{{ item }}`];
  };

  /** A table from the columns a DataGrid or a ListView's GridView declares; no columns means the data names them at runtime. */
  const table = (node, listExpr, depth, a) => {
    const pad = "  ".repeat(depth);
    const view = (node.props.view ?? []).find((v) => v.tag === "gridview");
    const columns = node.props.columns ?? view?.props.columns ?? [];
    const cells = columns.map((c) => {
      const header = caption(c, null, false);
      const b = readBinding(ext(c, "Binding") ?? ext(c, "DisplayMemberBinding"));
      const cell = b ? `{{ ${bound(b, { item: "row" }, `${c.name} Binding`)} }}` : c.tag === "datagridtemplatecolumn" ? "" : "{{ row }}";
      if (c.tag === "datagridtemplatecolumn") notes.skipped.push(`the template column ${header.text || c.name} of ${node.name} has a cell template this reader does not carry`);
      return { header: header.expr ? `{{ ${header.expr} }}` : esc(header.text), cell };
    });
    if (!columns.length) { notes.skipped.push(`the ${node.name}${xattr(node, "Name") ? ` ${xattr(node, "Name")}` : ""} generates its columns from the data at runtime, so the port has a table with no columns`); return [`${pad}<table class="${kebab(node.name)}"${a}></table>`]; }
    hasRepeat = true;
    return [`${pad}<table class="${kebab(node.name)}"${a}>`, `${pad}  <thead><tr>${cells.map((c) => `<th>${c.header}</th>`).join("")}</tr></thead>`, `${pad}  <tbody>`, `${pad}    <tr ng-repeat="row in ${listExpr}">${cells.map((c) => `<td>${c.cell}</td>`).join("")}</tr>`, `${pad}  </tbody>`, `${pad}</table>`];
  };

  const menu = (node, depth, kind) => {
    const pad = "  ".repeat(depth);
    const items = (list, d) => list.flatMap((it) => {
      const p = "  ".repeat(d);
      if (kindOf(it.tag) === "separator") return [`${p}<li role="separator"></li>`];
      const cap = caption(it, null);
      const text = cap.expr ? `{{ ${cap.expr} }}` : esc(cap.text);
      const key = cap.accesskey ? ` accesskey="${cap.accesskey}"` : "";
      const dis = isFalse(attr(it, "IsEnabled")) ? " disabled" : "";
      const children = it.children.filter((c) => /menuitem|menuflyoutitem|menuflyoutsubitem|separator|menubaritem/.test(c.tag));
      if (children.length) return [`${p}<li>`, `${p}  <button type="button"${key}${dis} aria-haspopup="menu">${text}</button>`, `${p}  <ul role="menu">`, ...items(children, d + 2), `${p}  </ul>`, `${p}</li>`];
      const event = eventOf(it, cap) || `item${outputs.size + 1}`;
      outputs.add(event);
      const checked = isTrue(attr(it, "IsChecked")) ? ' aria-checked="true"' : "";
      return [`${p}<li role="none"><button type="button" role="menuitem" ng-click="on${pascal(event)}()"${key}${dis}${checked}>${text}</button></li>`];
    });
    const label = kind === "context" ? "context menu" : "menu";
    return [`${pad}<nav class="${kind === "context" ? "context-menu" : "menu-bar"}" aria-label="${label}">`, `${pad}  <ul role="menubar">`, ...items(node.children, depth + 2), `${pad}  </ul>`, `${pad}</nav>`];
  };

  const renderChildren = (node, depth, scope, opts) => ordered(node).flatMap((k) => render(k, depth, scope, opts));

  const render = (node, depth, scope, opts = {}) => {
    const kind = kindOf(node.tag);
    const pad = "  ".repeat(depth);
    const a = common(node, kind);
    const lines = [];
    const nm = xattr(node, "Name") ?? attr(node, "Name") ?? "";
    switch (kind) {
      case "text": {
        const cap = caption(node, scope, node.tag === "label" && flavor !== "maui");
        const text = inline(node, scope);
        const key = cap.accesskey ? ` accesskey="${cap.accesskey}"` : "";
        if (node.captions) break;
        if (node.labels) lines.push(`${pad}<label for="${node.labels.id}"${key}${a}>${text}</label>`);
        else if (text) { const horizontal = opts.inRow && /^horizontal$/i.test(attr(node.parent, "Orientation") ?? "") || node.parent?.tag === "horizontalstacklayout"; lines.push(`${pad}<${horizontal ? "span" : "p"}${a}>${text}</${horizontal ? "span" : "p"}>`); }
        break;
      }
      case "input": case "textarea": case "range": case "number": case "date": case "time": {
        const multiline = kind === "textarea" || isTrue(attr(node, "AcceptsReturn")) || Number(attr(node, "MinLines") ?? 1) > 1;
        const password = node.tag === "passwordbox" || isTrue(attr(node, "IsPassword"));
        const keyboard = (attr(node, "Keyboard") ?? attr(node, "InputScope") ?? "").toLowerCase();
        const type = kind === "input" ? (password ? "password" : node.tag === "searchbar" ? "search" : node.tag === "numberbox" ? "number" : KEYBOARDS[keyboard] ?? "text") : kind;
        const attrs = [];
        const ro = attr(node, "IsReadOnly");
        const rb = readBinding(parseExtension(ro));
        if (rb) attrs.push(`ng-readonly="${bound(rb, scope, `${node.name} IsReadOnly`)}"`); else if (isTrue(ro)) attrs.push("readonly");
        if (kind === "range" || kind === "number") { for (const [n, h] of [["Minimum", "min"], ["Maximum", "max"], ["Increment", "step"], ["SmallChange", "step"], ["TickFrequency", "step"]]) { const v = attr(node, n); if (v !== null && !parseExtension(v) && !attrs.some((s) => s.startsWith(`${h}=`))) attrs.push(`${h}="${esc(v)}"`); } }
        const max = attr(node, "MaxLength"); if (max && !parseExtension(max)) attrs.push(`maxlength="${esc(max)}"`);
        const ph = attr(node, "Placeholder") ?? attr(node, "PlaceholderText"); if (ph && !parseExtension(ph)) attrs.push(`placeholder="${esc(ph)}"`);
        if (!node.labelledBy) { const h = attr(node, "Header") ?? attr(node, "Title"); if (h && !parseExtension(h)) lines.push(`${pad}<label for="${node.id}">${esc(plain(h).text)}</label>`); }
        const textBinding = readBinding(ext(node, "Text") ?? ext(node, "Value") ?? ext(node, "SelectedDate") ?? ext(node, "Date") ?? ext(node, "Time"));
        if (textBinding && /^(OneWay|OneTime)$/i.test(textBinding.mode ?? "")) notes.oneWay.push(node.field);
        else if (textBinding?.compiled && !textBinding.mode) notes.oneWay.push(node.field);
        if (node.tag === "richtextbox") notes.skipped.push(`the rich text box ${node.field} is a textarea in the port; its formatting is not carried`);
        initial(node, node.field, "Text", "Value", "SelectedDate", "Date", "Password");
        const extra = attrs.length ? " " + attrs.join(" ") : "";
        if (multiline) lines.push(`${pad}<textarea id="${node.id}" ng-model="${node.field}"${extra}${a}></textarea>`);
        else lines.push(`${pad}<input id="${node.id}" type="${type}" ng-model="${node.field}"${extra}${a}>`);
        break;
      }
      case "checkbox": {
        const cap = caption(node, scope);
        const text = cap.expr ? `{{ ${cap.expr} }}` : esc(cap.text);
        const key = cap.accesskey ? ` accesskey="${cap.accesskey}"` : "";
        const header = attr(node, "Header");
        initial(node, node.field, "IsChecked", "IsOn", "IsToggled");
        lines.push(`${pad}<label><input type="checkbox" ng-model="${node.field}"${key}${a}> ${text || (header && !parseExtension(header) ? esc(plain(header).text) : node.labelText ? esc(node.labelText) : "")}</label>`);
        break;
      }
      case "radio": {
        const cap = caption(node, scope);
        const text = cap.expr ? `{{ ${cap.expr} }}` : esc(cap.text);
        const key = cap.accesskey ? ` accesskey="${cap.accesskey}"` : "";
        if (isTrue(attr(node, "IsChecked"))) notes.initial.push(node.field);
        lines.push(`${pad}<label><input type="radio" ng-model="${node.field}" value="${kebab(cap.text) || `choice-${node.parent.children.indexOf(node) + 1}`}"${key}${a}> ${text}</label>`);
        break;
      }
      case "select": {
        const items = [...node.children, ...(node.props.items ?? [])].filter((c) => /item$|^string$/.test(c.tag));
        const source = ext(node, "ItemsSource");
        const sb = readBinding(source);
        const multiple = /^(multiple|extended)$/i.test(attr(node, "SelectionMode") ?? "") ? " multiple" : "";
        const header = attr(node, "Header") ?? attr(node, "Title");
        if (!node.labelledBy && header && !parseExtension(header)) lines.push(`${pad}<label for="${node.id}">${esc(plain(header).text)}</label>`);
        initial(node, node.field, "SelectedIndex", "SelectedItem", "Text");
        lines.push(`${pad}<select id="${node.id}" ng-model="${node.field}"${multiple}${a}>`);
        if (items.length) for (const it of items) lines.push(`${pad}  <option>${captionText(it)}</option>`);
        else {
          hasRepeat = true;
          const member = attr(node, "DisplayMemberPath") ?? attr(node, "ItemDisplayBinding");
          const mb = member ? readBinding(parseExtension(member)) : null;
          const shown = member ? `{{ item.${pathJs(mb ? mb.path : member)} }}` : "{{ item }}";
          const valuePath = attr(node, "SelectedValuePath");
          const value = valuePath ? ` ng-value="item.${pathJs(valuePath)}"` : "";
          let list;
          if (sb) list = bound(sb, scope, `${node.name} ItemsSource`);
          else if (resourceKey(source)) { list = resource(resourceKey(source)); notes.skipped.push(`the list ${node.field} is the resource ${resourceKey(source)}; the port takes it as \`${list}\`, which it must be handed`); }
          else { list = `${node.field}Options`; notes.lists.push(node.field); }
          lines.push(`${pad}  <option ng-repeat="item in ${list}"${value}>${shown}</option>`);
        }
        lines.push(`${pad}</select>`);
        break;
      }
      case "button": case "link": {
        const cap = caption(node, scope);
        const inner = node.children.length && !cap.literal && !cap.expr ? renderChildren(node, depth + 1, scope, opts) : null;
        const text = cap.expr ? `{{ ${cap.expr} }}` : esc(cap.text);
        const innerText = inner ? node.children.map((c) => caption(c, scope, false).text).concat(node.children.flatMap((c) => c.children.map((g) => caption(g, scope, false).text))).filter(Boolean).join(" ") : "";
        const event = eventOf(node, { text: cap.text || innerText }) || `button${outputs.size + 1}`;
        const key = cap.accesskey ? ` accesskey="${cap.accesskey}"` : "";
        const isDefault = isTrue(attr(node, "IsDefault"));
        const isCancel = isTrue(attr(node, "IsCancel"));
        const cls = kind === "link" ? ' class="link"' : "";
        const nav = attr(node, "NavigateUri");
        if (nav && !parseExtension(nav)) notes.skipped.push(`the link ${cap.text || nm || event} navigated to ${nav}; the port raises on${pascal(event)} instead`);
        const body = (open) => (inner ? [`${pad}${open}`, ...inner, `${pad}</button>`] : [`${pad}${open}${text}</button>`]);
        if (isDefault && !hasSubmit) {
          hasSubmit = true; outputs.add("ok");
          if (event !== "ok") notes.skipped.push(`the default button ${cap.text || innerText || nm} is the form's submit; the port raises onOk with every field, not on${pascal(event)}`);
          lines.push(...body(`<button type="submit"${cls}${key}${a}>`));
        } else if (isCancel) { outputs.add("cancel"); lines.push(...body(`<button type="button"${cls} ng-click="onCancel()"${key}${a}>`)); }
        else {
          outputs.add(event);
          if (isDefault) notes.skipped.push(`a second default button ${cap.text || nm} cannot be the submit too; the port raises on${pascal(event)} from a click only`);
          lines.push(...body(`<button type="button"${cls} ng-click="on${pascal(event)}()"${key}${a}>`));
        }
        break;
      }
      case "group": {
        const cap = caption(node, scope, false);
        lines.push(`${pad}<fieldset${a}>`);
        if (cap.text || cap.expr) lines.push(`${pad}  <legend>${cap.expr ? `{{ ${cap.expr} }}` : esc(cap.text)}</legend>`);
        lines.push(...renderChildren(node, depth + 1, scope, opts));
        lines.push(`${pad}</fieldset>`);
        break;
      }
      case "expander": {
        const cap = caption(node, scope, false);
        lines.push(`${pad}<details${a}>`, `${pad}  <summary>${cap.expr ? `{{ ${cap.expr} }}` : esc(cap.text)}</summary>`, ...renderChildren(node, depth + 1, scope, opts), `${pad}</details>`);
        break;
      }
      case "tabs": {
        notes.tabs += 1;
        for (const tab of node.children) {
          const cap = caption(tab, scope, false);
          const aria = cap.expr ? `{{ ${cap.expr} }}` : esc(cap.text || `tab ${node.children.indexOf(tab) + 1}`);
          lines.push(`${pad}<section aria-label="${aria}"${common(tab, "container")}>`, ...renderChildren(tab, depth + 1, scope, opts), `${pad}</section>`);
        }
        break;
      }
      case "menu": lines.push(...menu(node, depth, node.tag === "contextmenu" || node.tag === "menuflyout" ? "context" : "bar")); break;
      case "separator": lines.push(`${pad}<hr${a}>`); break;
      case "shape": break;
      case "image": {
        notes.images += 1;
        const src = attr(node, "Source");
        lines.push(`${pad}<span class="image" role="img" aria-label="${esc(attr(node, "AutomationProperties.Name") ?? nm ?? "image") || "image"}"${a.replace(/ aria-label="[^"]*"/, "")}></span>`);
        if (src && parseExtension(src) && readBinding(parseExtension(src))) notes.skipped.push(`the image ${nm || "(unnamed)"} binds its Source; the port shows a placeholder until the image is supplied`);
        break;
      }
      case "progress": {
        const vb = readBinding(ext(node, "Value") ?? ext(node, "Progress"));
        const active = readBinding(ext(node, "IsActive") ?? ext(node, "IsRunning") ?? ext(node, "IsIndeterminate"));
        const max = attr(node, "Maximum");
        const value = vb ? ` ng-value="${bound(vb, scope, `${node.name} Value`)}"` : "";
        const show = active && !/ng-show=/.test(a) ? ` ng-show="${bound(active, scope, `${node.name} IsActive`)}"` : "";
        if (show) hasShow = true;
        lines.push(`${pad}<progress${value}${max && !parseExtension(max) && vb ? ` max="${esc(max)}"` : ""}${show}${a}></progress>`);
        break;
      }
      case "list": {
        const sb = readBinding(ext(node, "ItemsSource"));
        const literal = node.children.filter((c) => /item$/.test(c.tag));
        const view = (node.props.view ?? []).find((v) => v.tag === "gridview") || node.props.columns;
        if (sb && view) { lines.push(...table(node, bound(sb, scope, `${node.name} ItemsSource`), depth, a)); break; }
        for (const sel of ["SelectedItem", "SelectedItems", "SelectedValue"]) { const s = readBinding(ext(node, sel)); if (s) notes.skipped.push(`the ${node.name}${nm ? ` ${nm}` : ""} binds ${sel} to ${s.path}; a selection is state the port keeps and this list does not model it`); }
        if (sb) { hasRepeat = true; const list = bound(sb, scope, `${node.name} ItemsSource`); lines.push(`${pad}<ul class="${kebab(node.name)}"${a}>`, `${pad}  <li ng-repeat="item in ${list}">`, ...listBody(node, depth + 2, scope), `${pad}  </li>`, `${pad}</ul>`); }
        else if (literal.length) lines.push(`${pad}<ul class="${kebab(node.name)}"${a}>`, ...literal.map((it) => `${pad}  <li>${captionText(it)}</li>`), `${pad}</ul>`);
        else { notes.skipped.push(`the ${node.name}${nm ? ` ${nm}` : ""} has items the code supplies`); lines.push(`${pad}<ul class="${kebab(node.name)}"${a}></ul>`); }
        break;
      }
      case "table": {
        const sb = readBinding(ext(node, "ItemsSource"));
        if (sb) lines.push(...table(node, bound(sb, scope, `${node.name} ItemsSource`), depth, a));
        else { notes.skipped.push(`the ${node.name}${nm ? ` ${nm}` : ""} has rows the code supplies`); lines.push(`${pad}<table class="${kebab(node.name)}"${a}></table>`); }
        break;
      }
      case "tree": notes.skipped.push(`the tree view ${nm || "(unnamed)"} has nodes the code supplies${node.props.itemtemplate ? " through a hierarchical template this reader does not carry" : ""}`); lines.push(`${pad}<ul role="tree"${a}></ul>`); break;
      case "container": lines.push(...renderChildren(node, depth, scope, opts)); break;
      default: {
        if (node.prefix && node.prefix !== x) {
          // A tag from another namespace is a component of the app's own; the run resolves it to that screen if it read one.
          const tag = kebab(node.name.replace(/^\w+:/, ""));
          const attrs = [];
          for (const at of node.el.attrs) {
            if (/^xmlns|:|\./.test(at.name) || /^(Margin|Padding|Width|Height|MinWidth|MinHeight|MaxWidth|MaxHeight|HorizontalAlignment|VerticalAlignment|HorizontalOptions|VerticalOptions|Style|Visibility|IsEnabled|IsVisible|ToolTip)$/.test(at.name)) continue;
            const b = readBinding(parseExtension(at.value));
            if (b) attrs.push(`ng-attr-${kebab(at.name)}="${bound(b, scope, `${node.name} ${at.name}`).replace(/"/g, "'")}"`);
            else if (!parseExtension(at.value)) attrs.push(`${kebab(at.name)}="${esc(decodeEntities(at.value ?? ""))}"`);
          }
          lines.push(`${pad}<${tag}${attrs.length ? " " + attrs.join(" ") : ""}${a}></${tag}>`);
        } else { notes.unknown.push(`${node.name}${nm ? ` ${nm}` : ""}`); lines.push(`${pad}<div class="${kebab(node.name) || "control"}"${a}></div>`); }
      }
    }
    if (node.contextMenu) { notes.skipped.push(`the context menu on ${node.name}${nm ? ` ${nm}` : ""} opened on right click; the port renders it beside the element`); lines.push(...menu(node.contextMenu, depth, "context")); }
    return lines;
  };

  /** The panel tree for LAYOUT.md: each panel with its shape, each control with its name, cell and every binding it carries as written. */
  const layoutLines = (node, depth) => {
    const pad = "  ".repeat(depth);
    const nm = xattr(node, "Name") ?? attr(node, "Name");
    const shape = node.tag === "grid" ? (() => { const g = gridShape(node); return ` (${g.rows} row(s) × ${g.columns} column(s))`; })() : "";
    const cell = ["Grid.Row", "Grid.Column", "Grid.RowSpan", "Grid.ColumnSpan", "Canvas.Left", "Canvas.Top", "DockPanel.Dock"].map((k) => [k.split(".")[1].toLowerCase(), attr(node, k)]).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}`);
    const bindings = node.el.attrs.filter((at) => parseExtension(at.value) && !/^xmlns/.test(at.name)).map((at) => `${at.name}=${decodeEntities(at.value)}`);
    const cap = caption(node, null, false);
    // A field's Text is a value the report withholds; a caption is what a person saw and is printed.
    const literal = ["input", "textarea"].includes(kindOf(node.tag)) ? (cap.literal ? " (initial value withheld)" : "") : cap.literal ? ` "${cap.text.replace(/"/g, "'")}"` : "";
    const line = `${pad}- ${node.name}${shape}${nm ? ` \`${nm}\`` : ""}${literal}${cell.length ? ` [${cell.join(", ")}]` : ""}${bindings.length ? ` ${bindings.join(" ")}` : ""}`;
    const kids = [...ordered(node), ...Object.entries(node.props).filter(([k]) => /^(itemtemplate|columns|view|contextmenu|content|header|items)$/.test(k)).flatMap(([, v]) => v)];
    return [line, ...kids.flatMap((k) => layoutLines(k, depth + 1))];
  };

  prepare(root, null);
  const titleCap = caption(root, null, false);
  const title = titleCap.expr ? `{{ ${titleCap.expr} }}` : titleCap.literal ? esc(titleCap.text) : "";
  for (const a of root.el.attrs) if (BEHAVIOURS.has(a.name) && a.value && /^\w+$/.test(a.value)) notes.behaviours.push(`${a.name}="${a.value}" on the ${rootKind}`);
  const dc = readBinding(ext(root, "DataContext")) ?? ext(root, "DataContext");
  if (dc) notes.skipped.push(`the ${rootKind}'s DataContext is set in the markup${resourceKey(dc) ? ` from the resource ${resourceKey(dc)}` : dc.source ? " from a Source" : ""}; the port is handed its view model`);
  for (const p of Object.keys(root.props)) if (!/^(resources|datacontext|contextmenu|content|inputbindings|commandbindings|triggers|taskbariteminfo|menubaritems|toolbaritems|behaviors)$/.test(p)) notes.props.add(`${root.name}.${p}`);
  if (root.props.commandbindings?.length) notes.behaviours.push(`${root.props.commandbindings.length} CommandBinding(s) route commands to code (${root.props.commandbindings.map((c) => attr(c, "Executed") ?? attr(c, "Command") ?? c.name).join(", ")})`);
  if (root.props.inputbindings?.length) notes.behaviours.push(`${root.props.inputbindings.length} InputBinding(s) map keys to commands`);
  const body = kindOf(root.tag) === "tabs" ? render(root, 1, null) : renderChildren(root, 1, null);
  const result = fields.length ? `{ ${fields.map((f) => `${f.key}: ${f.expr}`).join(", ")} }` : "";
  const open = hasSubmit ? `<form class="${rootKind}" ng-submit="onOk(${result})">` : `<div class="${rootKind}">`;
  const template = [open, ...(title ? [`  <h2>${title}</h2>`] : []), ...body, hasSubmit ? "</form>" : "</div>"].join("\n");

  const where = `${rel}`;
  const uniq = (list) => [...new Set(list)];
  for (const k of ["converters", "oneWay", "behaviours", "initial", "strings", "reach", "hidden", "disabled", "lists"]) notes[k] = uniq(notes[k]);
  if (notes.lists.length) note(`${where}: the list(s) ${notes.lists.join(", ")} declare no items and bind no source; the port takes each as \`<name>Options\`, which it must be handed.`);
  if (notes.hidden.length) note(`${where}: ${notes.hidden.length} control(s) start collapsed (${notes.hidden.join(", ")}); which state shows each is code the port drives through \`shown\`.`);
  if (notes.disabled.length) note(`${where}: ${notes.disabled.length} control(s) start disabled (${notes.disabled.join(", ")}); the port keeps the initial state and the code that enabled them is not read.`);
  if (notes.converters.length) note(`${where}: ${notes.converters.length} binding(s) pass through a converter that is not read (${[...new Set(notes.converters)].join("; ")}); the port shows or hides on the bound value itself.`);
  if (notes.oneWay.length) note(`${where}: the field(s) ${[...new Set(notes.oneWay)].join(", ")} were bound one way (OneWay, OneTime or a default x:Bind); the port binds each two way, so wire the write back out by hand where the original did not.`);
  if (notes.images) note(`${where}: ${notes.images} image(s) are placeholders; the image resources are not carried into the port.`);
  if (notes.resources.size) note(`${where}: ${notes.resources.size} resource(s) referenced (${[...notes.resources].sort().join(", ")}) are styles, templates or values the port must supply; none is read.`);
  if (resources.length) note(`${where}: ${resources.length} resource(s) declared in the ${rootKind} (${resourceLine(resources)}); styles and templates are not read.`);
  if (notes.behaviours.length) note(`${where}: ${notes.behaviours.length} handler(s) are wired in code behind that is not read (${notes.behaviours.join("; ")}); each is a behaviour the port must supply.`);
  if (notes.initial.length) note(`${where}: ${notes.initial.length} field(s) (${[...new Set(notes.initial)].join(", ")}) declare an initial value in the markup; the port starts them empty and the values are not reprinted.`);
  if (notes.strings.length) note(`${where}: ${notes.strings.length} caption(s) come from resources (${notes.strings.join("; ")}); the port reads each as \`strings.<key>\`, which it must be handed.`);
  if (notes.reach.length) note(`${where}: ${notes.reach.length} binding(s) reach outside the data context (${notes.reach.join("; ")}).`);
  if (notes.tabs) note(`${where}: ${notes.tabs} tab control(s) render every tab as a section; which is shown is state the port drives.`);
  if (notes.props.size) note(`${where}: property element(s) not read: ${[...notes.props].sort().join(", ")}; they carry styling, triggers or behaviour the port does not carry.`);
  if (notes.unknown.length) note(`${where}: control(s) with no HTML equivalent kept as divs: ${notes.unknown.join(", ")}.`);
  for (const s of [...new Set(notes.skipped)]) note(`${where}: ${s}.`);

  const selector = kebab(klass ? klass.split(".").pop() : rel.split("/").pop().replace(/\.xaml$/i, "")) || "screen";
  layout.push(`## ${rel}`, "", `${pascal(rootKind)}${klass ? ` \`${klass}\`` : ""}${titleCap.literal ? `, title "${titleCap.text}"` : ""}, ${flavor === "maui" ? "MAUI or Xamarin.Forms" : "WPF or UWP"} namespace, ${fields.length} field(s), ${outputs.size} event(s).`, "");
  if (resources.length) layout.push(`Resources: ${resourceLine(resources)}.`, "");
  layout.push(...ordered(root).flatMap((k) => layoutLines(k, 0)), "");
  return {
    screen: {
      selector, className: pascal(selector), file: rel,
      fields: fields.filter((f) => !f.expr.includes(".")).map((f) => f.expr),
      outputs: [...outputs].sort(), template,
      templateOrigin: `a XAML ${rootKind}, read structurally from ${rel}`,
      usesNgIf: hasShow, usesNgFor: hasRepeat, usesTwoWay: hasModel, rxjs: [], readBy: "xaml",
      title: titleCap.literal ? titleCap.text : selector.replace(/-/g, " "),
    },
    layout,
  };
}
