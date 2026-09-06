import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readInputs } from "../dsp-ir/text.js";
import { readDesigner } from "./designer.js";

/**
 * Reads Windows Forms designer code as the legacy front end it is. A .NET
 * desktop application keeps its forms in code the designer wrote: the
 * InitializeComponent body of every `*.Designer.cs` and `*.Designer.vb`
 * declares each control, sets its properties, wires its events and places it
 * in a container, which is exactly the form definition input-exe cannot read
 * from a .NET assembly. Each form becomes a screen on the shared dialect, laid
 * out in reading order by the pixel positions the designer recorded, with the
 * same choices input-exe makes for a native dialog so the two readers agree.
 *
 * What the designer code cannot say is named rather than guessed: a handler's
 * body lives in the code behind file and is not read, a combo box with no
 * items is filled at runtime, a control that starts hidden is shown by a state
 * the port drives, a caption that lives in the .resx is taken from there, and
 * a third party control type is kept as a div with its type named.
 */

/**
 * A caption without its mnemonic ampersand and trailing punctuation, with the access key it named. A doubled
 * ampersand is a literal one and is set aside before the mnemonic is looked for, so it never names the key.
 * The same reading input-exe gives a dialog caption, so a form and a dialog with one caption agree.
 */
const LITERAL_AMP = String.fromCharCode(1);
export function caption(text, mnemonic = true) {
  const raw = String(text ?? "").replace(/&&/g, LITERAL_AMP);
  if (!mnemonic) return { text: raw.split(LITERAL_AMP).join("&").replace(/(\.\.\.|…|:)\s*$/, "").trim(), accesskey: null };
  const m = /&([^&])/.exec(raw);
  const clean = raw.replace(/&/g, "").split(LITERAL_AMP).join("&").replace(/(\.\.\.|…|:)\s*$/, "").trim();
  return { text: clean, accesskey: m ? m[1].toLowerCase() : null };
}

/** A name the emitted JavaScript can declare: a caption that spells a reserved word gets a suffix. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

const camel = (text) => {
  const p = pascal(String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
const kebab = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A class name's humps as hyphens: LoginForm is form-login-form, the selector spelling every other reader uses. */
const kebabClass = (name) => kebab(String(name).replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The Hungarian prefix a designer name commonly carries, dropped when a capital follows it. */
const PREFIX = /^(txt|lbl|btn|chk|rb|rdo|rad|cbo|cmb|lst|num|nud|dtp|pb|pic|grp|gb|pnl|trk|prg|lnk|dgv|lv|tv|tab|tc|tp|mnu|tsmi|ts|ss|cms)(?=[A-Z])/;
export const stem = (name) => { const s = String(name).replace(PREFIX, ""); return s.charAt(0).toLowerCase() + s.slice(1); };

const KINDS = {
  Label: "text", LinkLabel: "link", TextBox: "input", MaskedTextBox: "input", RichTextBox: "textarea", ToolStripTextBox: "input",
  CheckBox: "checkbox", RadioButton: "radio", GroupBox: "group", Panel: "panel", FlowLayoutPanel: "panel", TableLayoutPanel: "panel",
  TabControl: "tabs", TabPage: "tabpage", SplitContainer: "split", ComboBox: "combobox", ToolStripComboBox: "combobox", ListBox: "listbox",
  CheckedListBox: "listbox", Button: "button", NumericUpDown: "spinner", DomainUpDown: "combobox", TrackBar: "range", DateTimePicker: "date",
  MonthCalendar: "date", PictureBox: "image", DataGridView: "grid", DataGrid: "grid", ListView: "listview", TreeView: "treeview",
  ProgressBar: "progress", ToolStripProgressBar: "progress", MenuStrip: "menu", MainMenu: "menu", ToolStrip: "toolbar", StatusStrip: "status",
  ContextMenuStrip: "contextmenu", ContextMenu: "contextmenu", ToolStripMenuItem: "menuitem", MenuItem: "menuitem", ToolStripButton: "menuitem",
  ToolStripDropDownButton: "menuitem", ToolStripSplitButton: "menuitem", ToolStripSeparator: "separator", ToolStripLabel: "striplabel",
  ToolStripStatusLabel: "striplabel", WebBrowser: "frame", HScrollBar: "scrollbar", VScrollBar: "scrollbar",
};
const COMPONENTS = new Set(["Timer", "ToolTip", "ErrorProvider", "BindingSource", "ImageList", "Container", "HelpProvider", "NotifyIcon", "OpenFileDialog", "SaveFileDialog", "FolderBrowserDialog", "ColorDialog", "FontDialog", "PrintDocument", "PrintDialog", "PrintPreviewDialog", "BackgroundWorker", "DataSet", "DataTable", "ComponentResourceManager", "EventLog", "FileSystemWatcher", "Process", "PerformanceCounter", "SerialPort", "ServiceController", "MessageQueue", "DirectoryEntry", "DirectorySearcher"]);

/** What a control is, from the type the designer constructed. */
export function kindOf(type) {
  const t = String(type ?? "");
  if (KINDS[t]) return KINDS[t];
  if (/^DataGridView\w*Column$|^ColumnHeader$|^DataGridTextBoxColumn$/.test(t)) return "column";
  if (COMPONENTS.has(t) || /Adapter$|TableAdapter$|BindingNavigator$/.test(t)) return t === "BindingNavigator" ? "toolbar" : "component";
  return "unknown";
}

const FIELD = new Set(["input", "textarea", "listbox", "combobox", "range", "date", "spinner"]);

/**
 * A form lowered onto the shared dialect. Controls are laid out in reading
 * order by the location the designer recorded, a label beside or above a
 * field is that field's label, radios inside one container form one group,
 * the AcceptButton is the submit and hands every field back by name. The
 * pixel layout, anchors and docking go to the report.
 */
export function lowerForm(read, note) {
  const { form, controls } = read;
  const all = [...controls.values()].map((c) => ({ ...c, kind: kindOf(c.type) }));
  const byName = new Map(all.map((c) => [c.name, c]));
  const captionOf = (c) => (c.localized || c.textResource ? { text: c.name, accesskey: null } : caption(c.text ?? "", c.useMnemonic));
  const names = new Set();
  const unique = (base) => {
    const st = declarable(base || "field");
    let name = st;
    let n = 2;
    while (names.has(name)) name = `${st}${n++}`;
    names.add(name);
    return name;
  };
  const outputs = new Set();
  const notes = { hidden: [], disabled: [], images: 0, lists: [], unknown: [], skipped: [], events: [], unwired: [], localized: [], initial: [], checked: [], editable: [], components: [] };
  let hasSubmit = false;
  let hasModel = false;
  let hasRepeat = false;
  const fields = [];
  const reading = (a, b) => {
    if (!a.location || !b.location) return a.location ? -1 : b.location ? 1 : 0;
    return Math.abs(a.location[1] - b.location[1]) > 8 ? a.location[1] - b.location[1] : a.location[0] - b.location[0];
  };
  // A caption from the .resx is unknown here, so the designer name, prefix dropped, names the event and the field.
  const nameOf = (c) => (c.localized || c.textResource ? stem(c.name) : camel(captionOf(c).text) || stem(c.name));
  const eventName = nameOf;
  const fieldName = (c) => unique(camel(c.labelText ?? "") || stem(c.name));
  const wiredClick = (c) => c.events.some((e) => e.event === "Click" || e.event === "LinkClicked" || e.event === "ItemClicked");

  for (const c of all) {
    if (c.kind === "component") { notes.components.push(`${c.name} (${c.type}${c.events.length ? `, ${c.events.map((e) => e.event).join("/")} wired` : ""})`); continue; }
    if (c.localized || c.textResource) notes.localized.push(c.name);
    if (c.kind === "input" || c.kind === "textarea") { if (c.text !== null) notes.initial.push(c.name); }
    for (const e of c.events) {
      const clickish = e.event === "Click" || e.event === "LinkClicked";
      if (clickish && (c.kind === "button" || c.kind === "link" || c.kind === "menuitem")) continue;
      notes.events.push(`${c.name}.${e.event} → ${e.handler}`);
    }
  }
  for (const e of form.events) notes.events.push(`${form.name}.${e.event} → ${e.handler}`);

  /** Menu items as a list: nested popups, separators, commands as events, mnemonics as access keys. */
  const menuItems = (children, depth) => children.flatMap((n) => {
    const it = byName.get(n);
    const pad = "  ".repeat(depth);
    if (!it) return [];
    if (it.kind === "separator") return [`${pad}<li role="separator"></li>`];
    const cap = captionOf(it);
    const key = cap.accesskey ? ` accesskey="${cap.accesskey}"` : "";
    const dis = it.enabled ? "" : " disabled";
    if (!it.enabled) notes.disabled.push(cap.text || it.name);
    if (it.children.length) return [`${pad}<li>`, `${pad}  <button type="button"${key}${dis} aria-haspopup="menu">${esc(cap.text)}</button>`, `${pad}  <ul role="menu">`, ...menuItems(it.children, depth + 2), `${pad}  </ul>`, `${pad}</li>`];
    const event = eventName(it);
    outputs.add(event);
    if (!wiredClick(it) && read.lang === "cs") notes.unwired.push(it.name);
    const checked = it.checked ? ' aria-checked="true"' : "";
    return [`${pad}<li role="none"><button type="button" role="menuitem" ng-click="on${pascal(event)}()"${key}${dis}${checked}>${esc(cap.text)}</button></li>`];
  });

  const render = (parentKey, depth) => {
    const own = all.filter((c) => c.parent === parentKey && c.kind !== "component" && c.kind !== "column").sort(reading);
    const lines = [];
    const pad = "  ".repeat(depth);
    let radioGroup = null;
    for (let i = 0; i < own.length; i += 1) {
      const c = own[i];
      if (c.rendered) continue;
      const cap = captionOf(c);
      const hidden = !c.visible;
      const attrs = [];
      if (c.kind !== "radio") radioGroup = null;
      if (cap.accesskey && !["text", "group", "tabpage", "panel"].includes(c.kind)) attrs.push(`accesskey="${cap.accesskey}"`);
      // A field's Text is a value, never a caption: the notes and the state name use the control's name for it.
      const said = FIELD.has(c.kind) ? stem(c.name) : cap.text || c.name;
      if (!c.enabled && !["text", "group", "tabpage", "panel", "menu"].includes(c.kind)) { attrs.push("disabled"); notes.disabled.push(said); }
      // A control that starts hidden is shown by a state the designer cannot see; the port drives it by name.
      const shown = hidden ? unique(`${FIELD.has(c.kind) ? stem(c.name) : nameOf(c)}Shown`) : null;
      if (shown) { attrs.push(`ng-show="shown.${shown}"`); notes.hidden.push(said); }
      const a = attrs.length ? " " + attrs.join(" ") : "";
      switch (c.kind) {
        case "text": {
          // A label sits on the row of the field it names, to its left, or on the row above it.
          const next = own.slice(i + 1).find((d) => !d.rendered && d.kind !== "text");
          const near = next && c.location && next.location && ((Math.abs(next.location[1] - c.location[1]) <= 8 && next.location[0] >= c.location[0]) || (next.location[1] > c.location[1] && next.location[1] - c.location[1] <= 30 && Math.abs(next.location[0] - c.location[0]) <= 12));
          if (!hidden && next && FIELD.has(next.kind) && near && next.labelText == null) { next.labelText = cap.text; lines.push(`${pad}<label for="${(next.htmlId = `f-${kebab(cap.text) || kebab(next.name)}`)}"${a}>${esc(cap.text)}</label>`); }
          else if (cap.text) lines.push(`${pad}<p${a}>${esc(cap.text)}</p>`);
          break;
        }
        case "image": notes.images += 1; lines.push(`${pad}<span class="image" role="img" aria-label="${esc(stem(c.name))}"${a}></span>`); break;
        case "input": case "textarea": case "date": case "range": case "spinner": {
          const field = fieldName(c);
          const id = c.htmlId ?? `f-${kebab(field)}`;
          hasModel = true;
          fields.push(field);
          const multiline = c.kind === "textarea" || c.multiline;
          const ro = c.readOnly ? " readonly" : "";
          const maxlength = c.maxLength ? ` maxlength="${c.maxLength}"` : "";
          const range = `${c.min !== null ? ` min="${c.min}"` : ""}${c.max !== null ? ` max="${c.max}"` : ""}`;
          let type = "text";
          if (c.kind === "date") {
            type = c.format === "Time" || c.format === "Custom" ? "datetime-local" : "date";
            if (type === "datetime-local") notes.skipped.push(`the date picker ${field} shows its ${c.format === "Time" ? "time" : "custom format"} in the original; the port takes a datetime-local because the control still held a date`);
          } else if (c.kind === "range") type = "range";
          else if (c.kind === "spinner") type = "number";
          else if (c.password) type = "password";
          if (multiline) lines.push(`${pad}<textarea id="${id}" ng-model="${field}"${ro}${maxlength}${a}></textarea>`);
          else lines.push(`${pad}<input id="${id}" type="${type}" ng-model="${field}"${range}${ro}${maxlength}${a}>`);
          break;
        }
        case "checkbox": {
          const field = unique(nameOf(c));
          hasModel = true;
          fields.push(field);
          if (c.checked) notes.checked.push(field);
          lines.push(`${pad}<label><input type="checkbox" ng-model="${field}"${a}> ${esc(cap.text)}</label>`);
          break;
        }
        case "radio": {
          // Radios in one container are one group, named after the group box that holds them or the panel's own name.
          if (!radioGroup) {
            const holder = byName.get(String(parentKey).split(".")[0]);
            radioGroup = unique(holder ? camel(captionOf(holder).text) || stem(holder.name) : "choice");
            fields.push(radioGroup);
          }
          hasModel = true;
          const value = kebab(nameOf(c));
          if (c.checked) notes.checked.push(`${radioGroup} = ${value}`);
          lines.push(`${pad}<label><input type="radio" ng-model="${radioGroup}" value="${value}"${a}> ${esc(cap.text)}</label>`);
          break;
        }
        case "combobox": case "listbox": {
          const field = fieldName(c);
          const id = c.htmlId ?? `f-${kebab(field)}`;
          const multiple = c.kind === "listbox" && /^Multi/.test(c.selectionMode ?? "") ? " multiple" : "";
          hasModel = true;
          fields.push(field);
          if (c.kind === "combobox" && c.dropDownStyle !== "DropDownList") notes.editable.push(field);
          lines.push(`${pad}<select id="${id}" ng-model="${field}"${multiple}${a}>`);
          // Items the designer declared are the real options; a list with none is filled by the code at runtime.
          if (c.items.length) for (const item of c.items) lines.push(`${pad}  <option>${esc(item)}</option>`);
          else { hasRepeat = true; notes.lists.push(field); lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`); }
          lines.push(`${pad}</select>`);
          break;
        }
        case "button": {
          const isOk = form.acceptButton === c.name;
          const isCancel = form.cancelButton === c.name;
          if (!wiredClick(c) && read.lang === "cs" && !isCancel) notes.unwired.push(c.name);
          if (isOk && !hasSubmit) { hasSubmit = true; outputs.add("ok"); lines.push(`${pad}<button type="submit"${a}>${esc(cap.text)}</button>`); }
          else {
            const event = isCancel ? "cancel" : eventName(c);
            outputs.add(event);
            lines.push(`${pad}<button type="button" ng-click="on${pascal(event)}()"${a}>${esc(cap.text)}</button>`);
          }
          break;
        }
        case "link": { const event = eventName(c); outputs.add(event); if (!wiredClick(c) && read.lang === "cs") notes.unwired.push(c.name); lines.push(`${pad}<button type="button" class="link" ng-click="on${pascal(event)}()"${a}>${esc(cap.text)}</button>`); break; }
        case "group": {
          lines.push(`${pad}<fieldset${a}>`);
          if (cap.text) lines.push(`${pad}  <legend>${esc(cap.text)}</legend>`);
          lines.push(...render(c.name, depth + 1));
          lines.push(`${pad}</fieldset>`);
          break;
        }
        case "panel": lines.push(`${pad}<div class="panel"${a}>`, ...render(c.name, depth + 1), `${pad}</div>`); break;
        case "tabs": {
          const pages = all.filter((p) => p.parent === c.name && p.kind === "tabpage");
          notes.skipped.push(`the tab control ${c.name} switches between ${pages.length} page(s) (${pages.map((p) => captionOf(p).text || p.name).join(", ")}); every page is in the template and which one shows is a state the port drives`);
          lines.push(`${pad}<div class="tab-control"${a}>`);
          for (const p of pages) { p.rendered = true; lines.push(`${pad}  <section aria-label="${esc(captionOf(p).text || p.name)}">`, ...render(p.name, depth + 2), `${pad}  </section>`); }
          lines.push(`${pad}</div>`);
          break;
        }
        case "tabpage": lines.push(`${pad}<section aria-label="${esc(cap.text || c.name)}"${a}>`, ...render(c.name, depth + 1), `${pad}</section>`); break;
        case "split": lines.push(`${pad}<div class="split-container"${a}>`, `${pad}  <div class="panel">`, ...render(`${c.name}.Panel1`, depth + 2), `${pad}  </div>`, `${pad}  <div class="panel">`, ...render(`${c.name}.Panel2`, depth + 2), `${pad}  </div>`, `${pad}</div>`); break;
        case "grid": case "listview": {
          const heads = c.columns.map((n) => byName.get(n)).filter(Boolean).map((col) => (col.localized || col.textResource ? col.name : col.headerText ?? col.text ?? col.name));
          const klass = c.kind === "grid" ? "data-grid-view" : "list-view";
          notes.skipped.push(`the ${c.kind === "grid" ? "grid" : "list view"} ${c.name} ${heads.length ? `has ${heads.length} column(s) the designer declared (${heads.join(", ")}) and` : "is a table whose columns and"} rows the code supplies`);
          if (heads.length) lines.push(`${pad}<table class="${klass}"${a}>`, `${pad}  <thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`, `${pad}</table>`);
          else lines.push(`${pad}<table class="${klass}"${a}></table>`);
          break;
        }
        case "treeview": notes.skipped.push(`the tree view ${c.name} has nodes the code supplies`); lines.push(`${pad}<ul role="tree"${a}></ul>`); break;
        case "progress": lines.push(`${pad}<progress${c.max !== null ? ` max="${c.max}"` : ""}${a}></progress>`); break;
        case "menu": lines.push(`${pad}<nav class="menu-bar" aria-label="menu"${a}>`, `${pad}  <ul role="menubar">`, ...menuItems(c.children, depth + 2), `${pad}  </ul>`, `${pad}</nav>`); break;
        case "toolbar": {
          lines.push(`${pad}<div role="toolbar" aria-label="${esc(stem(c.name))}"${a}>`);
          for (const it of c.children.map((n) => byName.get(n)).filter(Boolean)) {
            const ic = captionOf(it);
            if (it.kind === "separator") lines.push(`${pad}  <span role="separator"></span>`);
            else if (it.kind === "striplabel") lines.push(`${pad}  <span>${esc(ic.text)}</span>`);
            else if (it.kind === "menuitem") { const event = eventName(it); outputs.add(event); if (!wiredClick(it) && read.lang === "cs") notes.unwired.push(it.name); lines.push(`${pad}  <button type="button" ng-click="on${pascal(event)}()"${ic.accesskey ? ` accesskey="${ic.accesskey}"` : ""}${it.enabled ? "" : " disabled"}>${esc(ic.text)}</button>`); }
            else continue;
            it.rendered = true;
          }
          // A text box or combo box on the strip is a field like any other, in the strip's own order.
          lines.push(...render(c.name, depth + 1));
          lines.push(`${pad}</div>`);
          break;
        }
        case "status": lines.push(`${pad}<footer class="status-bar"${a}>`, ...c.children.map((n) => byName.get(n)).filter(Boolean).map((it) => `${pad}  <span>${esc(captionOf(it).text)}</span>`), `${pad}</footer>`); break;
        case "contextmenu": case "menuitem": case "separator": case "striplabel": break;
        case "frame": notes.skipped.push(`the web browser ${c.name} shows a page the code navigates to; nothing carried`); lines.push(`${pad}<iframe title="${esc(stem(c.name))}"${a}></iframe>`); break;
        case "scrollbar": notes.skipped.push(`a scroll bar (${c.name}) scrolls what the port lays out; nothing carried`); break;
        default: {
          // A container this reader does not know (a ToolStripContainer's panels, a third party group) still holds
          // its children, placed on it or on one of its named panels; they render inside it rather than vanish.
          notes.unknown.push(`${c.fullType ?? c.type} (${c.name})`);
          const holders = [...new Set(all.filter((k) => k.parent === c.name || String(k.parent ?? "").startsWith(`${c.name}.`)).map((k) => k.parent))];
          const inside = holders.flatMap((h) => render(h, depth + 1));
          if (inside.length) lines.push(`${pad}<div class="${kebab(c.type) || "control"}"${a}>`, ...inside, `${pad}</div>`);
          else lines.push(`${pad}<div class="${kebab(c.type) || "control"}"${a}></div>`);
          break;
        }
      }
      c.rendered = true;
    }
    return lines;
  };

  const body = render("", 1);
  // A property the scanner could not read exactly is named, never guessed at; a concatenated Text is the common one.
  for (const c of all) if (c.unreadProps?.length) notes.skipped.push(`${c.name}: ${[...new Set(c.unreadProps)].join(", ")} could not be read exactly and left out`);
  // A context menu is not in any container; it opens on the control that names it, which the port must wire.
  for (const c of all.filter((c) => c.kind === "contextmenu")) {
    const owners = all.filter((o) => o.contextMenu === c.name).map((o) => o.name);
    notes.skipped.push(`the context menu ${c.name} opens on right click of ${owners.length ? owners.join(", ") : "a control the code chooses"}; the port must wire the trigger`);
    body.push(`  <nav class="context-menu" aria-label="${esc(stem(c.name))}">`, `    <ul role="menu">`, ...menuItems(c.children, 3), `    </ul>`, `  </nav>`);
  }
  const title = form.localized || form.textResource ? "" : caption(form.text ?? "", false).text;
  const result = fields.length ? `{ ${fields.map((f) => `${f}: ${f}`).join(", ")} }` : "";
  const open = hasSubmit ? `<form class="winform" ng-submit="onOk(${result})">` : `<div class="winform">`;
  const template = [open, ...(title ? [`  <h2>${esc(title)}</h2>`] : []), ...body, hasSubmit ? "</form>" : "</div>"].join("\n");

  if (form.acceptButton && !hasSubmit) note(`the AcceptButton ${form.acceptButton} is not a button the designer placed, so the form has no submit.`);
  if (notes.lists.length) note(`the list(s) ${notes.lists.join(", ")} declare no items in the designer and are filled by the code at runtime; the port takes each as \`<name>Options\`, which it must be handed.`);
  if (notes.editable.length) note(`the combo box(es) ${notes.editable.join(", ")} accepted typed text as well as a pick (DropDownStyle is not DropDownList); a select does not, and whether free text must survive is a product decision.`);
  if (notes.hidden.length) note(`${notes.hidden.length} control(s) start hidden (${notes.hidden.join(", ")}); which state shows each is code the port drives through \`shown\`.`);
  if (notes.disabled.length) note(`${notes.disabled.length} control(s) start disabled (${notes.disabled.join(", ")}); the port keeps the initial state and the code that enabled them is not read.`);
  if (notes.checked.length) note(`initial state set in the designer: ${notes.checked.join(", ")}; the port's initial state must set the same.`);
  if (notes.initial.length) note(`${notes.initial.length} text box(es) start with a text the designer set (${notes.initial.join(", ")}); the value is not reprinted and the port's initial state must set it.`);
  if (notes.images) note(`${notes.images} picture box(es) are placeholders; the image resources are not carried into the port.`);
  if (notes.localized.length) note(`the text of ${notes.localized.length} control(s) (${notes.localized.join(", ")}) lives in the .resx (resources.ApplyResources or GetString); the control names stand in and the port must take each caption from the resource file.`);
  if (form.localized || form.textResource) note(`the form's own title lives in the .resx; the port must take it from there.`);
  if (notes.unknown.length) note(`control type(s) with no HTML equivalent kept as divs: ${notes.unknown.join(", ")}.`);
  if (notes.components.length) note(`component(s) with no visual: ${notes.components.join(", ")}; each is behaviour the port must reimplement where the code used it.`);
  if (notes.events.length) note(`event(s) wired beyond Click: ${notes.events.join("; ")}; each handler is in the code behind, which is not read, and is behaviour the port must reimplement rather than invent.`);
  if (notes.unwired.length) note(`${notes.unwired.length} button(s) or item(s) have no Click wired in the designer (${notes.unwired.join(", ")}); each raises its event and what it did, if anything, is in code this reader does not read.`);
  if (read.lang === "vb" && all.some((c) => c.kind === "button" || c.kind === "link" || c.kind === "menuitem")) note(`a VB designer file wires no handlers; they are bound by Handles clauses in the code file, which is not read, so every button raises its event and the port decides what it does.`);
  for (const s of notes.skipped) note(s);
  return { template, outputs: [...outputs].sort(), fields, usesTwoWay: hasModel, usesNgFor: hasRepeat, usesNgIf: notes.hidden.length > 0, title };
}

/** Text inside a markdown table cell: the backslash first, then the pipe, and a line break as a space. */
const cell = (text) => String(text).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const px = (p) => (p ? `${p[0]}, ${p[1]}` : "");
const wh = (s) => (s ? `${s[0]} × ${s[1]}` : "");
const CAPTIONED = new Set(["text", "link", "checkbox", "radio", "group", "tabpage", "button", "menuitem", "striplabel"]);

export function formsReport(files) {
  const out = ["# Windows Forms", "", "Every form the designer files declared, with each control's type, caption, location and size in pixels, tab index, anchor or dock, and the events the designer wired. The port lays the controls out in reading order; this is the layout the original drew. A text box's initial text is a value and is not reprinted.", ""];
  for (const f of files) {
    const { form, controls } = f.read;
    out.push(`## ${f.read.className} (${f.rel})`, "");
    const facts = [form.text !== null && !form.localized ? `title "${form.text}"` : form.localized ? "title in the .resx" : "no title set", form.clientSize ? `client size ${wh(form.clientSize)}` : null, form.acceptButton ? `accepts on ${form.acceptButton}` : null, form.cancelButton ? `cancels on ${form.cancelButton}` : null, form.mainMenuStrip ? `menu ${form.mainMenuStrip}` : null].filter(Boolean);
    out.push(`${facts.join(", ")}. ${controls.size} control(s), ${f.read.statements} statement(s) read${f.read.lang === "vb" ? ", VB" : ", C#"}.`, "");
    if (form.events.length) out.push(`Form events wired: ${form.events.map((e) => `${e.event} → ${e.handler}`).join(", ")}.`, "");
    out.push("| name | type | text | location | size | tab | anchor / dock | events |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const c of controls.values()) {
      const kind = kindOf(c.type);
      const text = c.localized || c.textResource ? "(from .resx)" : kind === "column" ? c.headerText ?? c.text ?? "" : CAPTIONED.has(kind) ? caption(c.text ?? "", c.useMnemonic).text : c.text !== null && (kind === "input" || kind === "textarea") ? "(initial value withheld)" : "";
      const layout = [c.dock ? `dock ${c.dock}` : null, c.anchor.length ? `anchor ${c.anchor.join(", ")}` : null].filter(Boolean).join("; ");
      out.push(`| ${c.name} | ${cell(c.type ?? "")} | ${cell(text)} | ${px(c.location)} | ${wh(c.size)} | ${c.tabIndex ?? ""} | ${layout} | ${cell(c.events.map((e) => `${e.event} → ${e.handler}`).join(", "))} |`);
    }
    out.push("");
  }
  return out.join("\n") + "\n";
}

export default {
  name: "input-winforms",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const seen = [];
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(cs|vb)$/i.test(f.rel));
      if (!files.length) return log.debug("no C# or VB files");
      const selectors = new Set(ctx.screens.map((s) => s.selector));
      const unique = (base) => { let s = base; let n = 2; while (selectors.has(s)) s = `${base}-${n++}`; selectors.add(s); return s; };
      let skipped = 0;
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        const rel = file.rel.replace(/^\.\//, "");
        const read = text ? readDesigner(text, rel) : null;
        // A code behind file calls InitializeComponent and a helper class never names it; neither defines a form.
        if (!read) { skipped += 1; continue; }
        for (const p of read.problems) ctx.unverified(`${rel}: ${p}.`);
        const lowered = lowerForm(read, (n) => ctx.unverified(`${rel}, form ${read.className}: ${n}`));
        const selector = unique(`form-${kebabClass(read.className)}`);
        ctx.screens.push({
          selector, className: pascal(selector), file: rel,
          // A field is the form's own state, not something it is handed.
          inputs: readInputs(lowered.template, { skip: lowered.fields }), outputs: lowered.outputs, template: lowered.template,
          templateOrigin: `InitializeComponent in ${rel} (line ${read.line}), read from the designer code`,
          usesNgIf: lowered.usesNgIf, usesNgFor: lowered.usesNgFor, usesTwoWay: lowered.usesTwoWay, rxjs: [],
          readBy: "winforms", title: lowered.title || read.className,
        });
        seen.push({ rel, read });
      }
      if (!seen.length) return log.debug(`${skipped} C# or VB file(s), none a designer file`);
      log.info(`${seen.length} form(s) read from designer code as screens, ${skipped} other C# or VB file(s) left to the code`);
    });

    on("emit", async (ctx) => {
      if (!seen.length) return;
      // dsp-forms writes FORMS.md from the rules the templates enforce; the designer's tables are their own report.
      await ctx.write("WINFORMS.md", formsReport(seen));
      log.info("WINFORMS.md written");
    });
  },
};
