import { pascal } from "../dsp-ir/emit.js";

/**
 * One lowering for the two text form formats of the 1990s desktop. A Visual
 * Basic .frm and a Delphi .dfm spell their controls differently and describe
 * the same thing: a window of absolutely placed controls, each with a class,
 * a name, a caption, a rectangle and a tab stop; a menu bar of nested items;
 * and components that draw nothing. input-vb6 and input-delphi each parse
 * their own format into the control model this file reads and share this one
 * lowering onto the AngularJS attribute dialect, so the two readers cannot
 * disagree about what a label beside a field means, which button is the
 * submit, or how a hidden control is shown. The absolute layout goes to the
 * report; the template flows in reading order, top then left, within each
 * container the file declared.
 *
 * A control is { name, className, kind, caption, rect, tab, hidden, disabled,
 * readonly, password, checked, multiple, index, options, optionsFrom, submit,
 * cancel, isDefault, labelFor, events, children }. Kinds: label, input,
 * textarea, number, date, time, range, checkbox, radio, radiogroup, select,
 * button, group, section, tabs, tab, image, rule, progress, table, listview,
 * tree, decoration, nonvisual, unknown. A form is { name, caption, size,
 * units, controls, menus, nonvisual, events, messages }.
 */

/**
 * A caption without its mnemonic ampersand and trailing punctuation, with the access key it named. A doubled
 * ampersand is a literal one and is set aside before the mnemonic is looked for, so it never names the key.
 */
const LITERAL_AMP = String.fromCharCode(1);
export function caption(text) {
  const raw = String(text ?? "").replace(/&&/g, LITERAL_AMP);
  const m = /&([^&])/.exec(raw);
  const clean = raw.replace(/&/g, "").split(LITERAL_AMP).join("&").replace(/(\.\.\.|…|:)\s*$/, "").trim();
  return { text: clean, accesskey: m ? m[1].toLowerCase() : null };
}

/** A name the emitted JavaScript can declare: a caption that spells a reserved word gets a suffix. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
export const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/** camelCase from a caption or a control name; a name's own humps are words too, so txtUserName becomes userName. */
export const camel = (text) => {
  const spaced = String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const p = pascal(spaced.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
export const kebab = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The prefixes both dialects' naming conventions put before a control's name.
 * Stripped only when a capital letter or underscore follows, so `frame` keeps
 * its f and `txtUser` loses its txt.
 */
const PREFIXES = ["txt", "lbl", "cmd", "btn", "chk", "opt", "rb", "cbo", "cmb", "cb", "lst", "fra", "grp", "pnl", "edt", "ed", "led", "mem", "mnu", "mm", "pm", "mi", "pic", "img", "frm", "hsb", "vsb", "spn", "trk", "dtp", "prg", "rg", "pg", "ts", "grd", "dbg", "tmr"];
const PREFIX = new RegExp(`^(?:${PREFIXES.join("|")})(?=[A-Z_])`);
export const stripPrefix = (name) => String(name ?? "").replace(PREFIX, "").replace(/^_+/, "") || String(name ?? "");

const FIELD = new Set(["input", "textarea", "number", "date", "time", "range", "select"]);
const NO_ATTRS = new Set(["label", "group", "section", "tabs", "tab", "decoration", "nonvisual"]);
const walk = (list, fn) => { for (const c of list) { fn(c); walk(c.children ?? [], fn); } };

/**
 * A form lowered onto the shared dialect: the menu bar first, then the
 * controls in reading order within each container, a label beside or above
 * a field naming it, radios sharing their container's name, the default
 * button the submit that hands every field back by name, the cancel button
 * its own event. Everything the file cannot say is named through `note`.
 */
export function lowerForm(form, note) {
  const { row, above, col } = form.units;
  const names = new Set();
  const unique = (base) => {
    const stem = declarable(base || "field");
    let name = stem;
    let n = 2;
    while (names.has(name)) name = `${stem}${n++}`;
    names.add(name);
    return name;
  };
  const outputs = new Set();
  const fields = [];
  const notes = { hidden: [], disabled: [], lists: [], unknown: [], images: 0, skipped: [], behaviours: [], dataAware: [] };
  let hasSubmit = false;
  let hasModel = false;
  let hasRepeat = false;

  const all = [];
  walk(form.controls, (c) => all.push(c));
  // An explicit label (Delphi's FocusControl) names its field wherever the two sit; it is settled before any geometry.
  for (const l of all) {
    if (l.kind !== "label" || !l.labelFor) continue;
    const t = all.find((c) => c.name === l.labelFor && c !== l);
    if (t && FIELD.has(t.kind)) { t.labelText = caption(l.caption).text; t.htmlId = `f-${kebab(t.labelText) || kebab(t.name)}`; l.target = t; }
    else notes.skipped.push(`the label ${l.name} names ${l.labelFor} as its control, which is not a field this reader lowered; the label stays text`);
  }
  const display = (c) => caption(c.caption).text || c.name;
  const baseName = (c) => (c.labelText != null ? camel(c.labelText) : camel(stripPrefix(c.name))) || "field";
  const fieldName = (c) => unique(`${baseName(c)}${c.index ?? ""}`);
  const eventName = (c) => camel(caption(c.caption).text) || camel(stripPrefix(c.name)) || "button";
  const reading = (a, b) => (Math.abs(a.rect.top - b.rect.top) > row ? a.rect.top - b.rect.top : a.rect.left - b.rect.left);

  const render = (list, depth, parent) => {
    const own = list.filter((c) => c.rect && c.kind !== "nonvisual").sort(reading);
    const lines = [];
    const pad = "  ".repeat(depth);
    let radioGroup = null;
    for (let i = 0; i < own.length; i += 1) {
      const c = own[i];
      const cap = caption(c.caption);
      const attrs = [];
      if (cap.accesskey && !NO_ATTRS.has(c.kind)) attrs.push(`accesskey="${cap.accesskey}"`);
      if (c.disabled && !NO_ATTRS.has(c.kind)) { attrs.push("disabled"); notes.disabled.push(display(c)); }
      // A control that starts hidden is shown by a state the file cannot see; the port drives it by name.
      if (c.hidden) { const shown = unique(`${camel(cap.text) || camel(stripPrefix(c.name)) || "control"}Shown`); attrs.push(`ng-show="shown.${shown}"`); notes.hidden.push(display(c)); }
      if (c.readonly) attrs.push("readonly");
      if (c.dataAware) notes.dataAware.push(c.name);
      const a = attrs.length ? " " + attrs.join(" ") : "";
      const push = (s) => lines.push(`${pad}${s}`);
      switch (c.kind) {
        case "label": {
          if (c.target) { push(`<label for="${c.target.htmlId}"${c.hidden ? a : ""}>${esc(cap.text)}</label>`); break; }
          // A label sits on the row of the field it names, to its left, or on the row above it. One that named its
          // control explicitly is never matched by geometry: the file said what it labels.
          const next = own.slice(i + 1).find((d) => d.kind !== "label");
          const r = c.rect;
          const labels = !c.hidden && !c.labelFor && next && FIELD.has(next.kind) && next.labelText == null
            && ((Math.abs(next.rect.top - r.top) <= row && next.rect.left >= r.left) || (next.rect.top > r.top && next.rect.top - r.top <= above && Math.abs(next.rect.left - r.left) <= col));
          if (labels) { next.labelText = cap.text; next.htmlId = `f-${kebab(cap.text) || kebab(next.name)}`; push(`<label for="${next.htmlId}">${esc(cap.text)}</label>`); }
          else if (cap.text) push(`<p${a}>${esc(cap.text)}</p>`);
          break;
        }
        case "input": case "textarea": case "number": case "date": case "time": case "range": {
          const field = fieldName(c);
          const id = c.htmlId ?? `f-${kebab(field)}`;
          hasModel = true;
          fields.push(field);
          if (c.kind === "textarea") push(`<textarea id="${id}" ng-model="${field}"${a}></textarea>`);
          else push(`<input id="${id}" type="${c.kind === "input" ? (c.password ? "password" : "text") : c.kind}" ng-model="${field}"${a}>`);
          if (c.initialText) notes.skipped.push(`${field} starts with text the file holds; the port starts it empty, because a design time value is not the value a user sees`);
          break;
        }
        case "checkbox": {
          const field = unique(camel(cap.text) || camel(stripPrefix(c.name)) || "check");
          hasModel = true;
          fields.push(field);
          push(`<label><input type="checkbox" ng-model="${field}"${a}> ${esc(cap.text)}</label>`);
          if (c.checked) notes.skipped.push(`${field} starts checked in the original; the port starts every field empty and is handed the state`);
          break;
        }
        case "radio": {
          // Radios share the name of the container they sit in; the first one in a container opens its group.
          if (!radioGroup) { radioGroup = unique(parent ? camel(caption(parent.caption).text) || camel(stripPrefix(parent.name)) || "choice" : "choice"); fields.push(radioGroup); }
          hasModel = true;
          push(`<label><input type="radio" ng-model="${radioGroup}" value="${kebab(cap.text) || kebab(c.name)}"${a}> ${esc(cap.text)}</label>`);
          if (c.checked) notes.skipped.push(`${radioGroup} starts on ${kebab(cap.text) || kebab(c.name)} in the original; the port starts every field empty and is handed the state`);
          break;
        }
        case "radiogroup": {
          const field = unique(camel(cap.text) || camel(stripPrefix(c.name)) || "choice");
          hasModel = true;
          fields.push(field);
          push(`<fieldset${a}>`);
          if (cap.text) push(`  <legend>${esc(cap.text)}</legend>`);
          for (const o of c.options ?? []) { const oc = caption(o); push(`  <label><input type="radio" ng-model="${field}" value="${kebab(oc.text) || "option"}"> ${esc(oc.text)}</label>`); }
          if (!(c.options ?? []).length) notes.skipped.push(`the radio group ${c.name} declares no items; its buttons are what the code adds at runtime`);
          else if (c.checkedIndex != null && c.checkedIndex >= 0 && c.options[c.checkedIndex] != null) notes.skipped.push(`${field} starts on ${kebab(caption(c.options[c.checkedIndex]).text)} in the original; the port starts every field empty and is handed the state`);
          push(`</fieldset>`);
          break;
        }
        case "select": {
          const field = fieldName(c);
          const id = c.htmlId ?? `f-${kebab(field)}`;
          hasModel = true;
          fields.push(field);
          push(`<select id="${id}" ng-model="${field}"${c.multiple ? " multiple" : ""}${a}>`);
          if (c.options) for (const o of c.options) push(`  <option>${esc(o)}</option>`);
          else { hasRepeat = true; notes.lists.push({ field, from: c.optionsFrom }); push(`  <option ng-repeat="option in ${field}Options">{{ option }}</option>`); }
          push(`</select>`);
          break;
        }
        case "button": {
          // The default button is what Enter fired: the form's submit, handing every field back by name. A second
          // default is its own event and says so; a cancel button is the cancel event whatever it is captioned.
          if (c.submit && !hasSubmit) { hasSubmit = true; outputs.add("ok"); push(`<button type="submit"${a}>${esc(cap.text)}</button>`); break; }
          const event = c.cancel ? "cancel" : eventName(c);
          outputs.add(event);
          if (c.submit) notes.skipped.push(`${c.name} is also marked as the default button; only the first default is the submit, so the port raises on${pascal(event)} from a click only`);
          push(`<button type="button" ng-click="on${pascal(event)}()"${a}>${esc(cap.text)}</button>`);
          break;
        }
        case "group": {
          push(`<fieldset${a}>`);
          if (cap.text) push(`  <legend>${esc(cap.text)}</legend>`);
          lines.push(...render(c.children ?? [], depth + 1, c));
          push(`</fieldset>`);
          break;
        }
        case "section": case "tab": {
          const role = c.kind === "tab" ? ' role="tabpanel"' : "";
          push(`<section${role}${cap.text ? ` aria-label="${esc(cap.text)}"` : ""}${a}>`);
          lines.push(...render(c.children ?? [], depth + 1, c));
          push(`</section>`);
          break;
        }
        case "tabs": {
          const pages = (c.children ?? []).filter((d) => d.kind === "tab");
          notes.skipped.push(`the page control ${c.name} shows one of ${pages.length} page(s) at a time (${pages.map(display).join(", ")}); which is shown is state the port drives, and every page is in the template`);
          push(`<div role="tablist"${cap.text ? ` aria-label="${esc(cap.text)}"` : ""}${a}>`);
          lines.push(...render(c.children ?? [], depth + 1, c));
          push(`</div>`);
          break;
        }
        case "image": notes.images += 1; push(`<span class="image" role="img" aria-label="${esc(cap.text || stripPrefix(c.name) || "image")}"${a}></span>`); break;
        case "rule": push(`<hr${a}>`); break;
        case "progress": push(`<progress${a}></progress>`); break;
        case "table": notes.skipped.push(`the grid ${c.name} is a table whose columns and rows the code supplies`); push(`<table class="grid"${a}></table>`); break;
        case "listview": notes.skipped.push(`the list view ${c.name} is a table whose columns and rows the code supplies`); push(`<table class="list-view"${a}></table>`); break;
        case "tree": notes.skipped.push(`the tree view ${c.name} has nodes the code supplies`); push(`<ul role="tree"${a}></ul>`); break;
        case "decoration": notes.skipped.push(`${c.name} (${c.className}) is drawn decoration; nothing carried`); break;
        default: notes.unknown.push(`${c.className} (${c.name})`); push(`<div class="${kebab(c.className.replace(/^VB\.|^T/, "")) || "control"}"${a}></div>`); break;
      }
      if (c.kind !== "radio") radioGroup = null;
    }
    return lines;
  };

  const body = render(form.controls, 1, null);
  const menus = [];
  for (const m of form.menus) { const l = lowerMenu(m, 1); menus.push(...l.lines); for (const e of l.outputs) outputs.add(e); }
  const title = caption(form.caption).text;
  const result = fields.length ? `{ ${fields.map((f) => `${f}: ${f}`).join(", ")} }` : "";
  const open = hasSubmit ? `<form class="window" ng-submit="onOk(${result})">` : `<div class="window">`;
  const template = [open, ...(title ? [`  <h2>${esc(title)}</h2>`] : []), ...menus, ...body, hasSubmit ? "</form>" : "</div>"].join("\n");

  // Every handler the code wires that is not a button's or a menu item's click is behaviour the port must write again.
  const clickable = new Set(["button", "menuitem"]);
  // A set, because every element of a control array shares one handler.
  const behaviours = new Set();
  for (const c of all) for (const e of c.events ?? []) if (!(clickable.has(c.kind) && e === "Click")) behaviours.add(`${c.name} ${e}`);
  for (const e of form.events ?? []) behaviours.add(`${form.name} ${e}`);
  for (const nv of form.nonvisual) for (const e of nv.events ?? []) behaviours.add(`${nv.name} ${e}`);
  for (const o of form.orphans ?? []) behaviours.add(`${o} (no control by that name)`);
  for (const m of form.menus) walk(m.items, (it) => { for (const e of it.events ?? []) if (e !== "Click") behaviours.push(`${it.name} ${e}`); });

  if (notes.lists.length) {
    const frx = notes.lists.filter((l) => l.from === "frx").map((l) => l.field);
    const runtime = notes.lists.filter((l) => l.from !== "frx").map((l) => l.field);
    if (frx.length) note(`the list(s) ${frx.join(", ")} are filled from the binary .frx companion, which is not read; the port takes each as \`<name>Options\`, which it must be handed.`);
    if (runtime.length) note(`the list(s) ${runtime.join(", ")} are filled by the code at runtime; the port takes each as \`<name>Options\`, which it must be handed.`);
  }
  if (notes.hidden.length) note(`${notes.hidden.length} control(s) start hidden (${notes.hidden.join(", ")}); which state shows each is code the port drives through \`shown\`.`);
  if (notes.disabled.length) note(`${notes.disabled.length} control(s) start disabled (${notes.disabled.join(", ")}); the port keeps the initial state and the code that enabled them is not read.`);
  if (notes.images) note(`${notes.images} picture control(s) are placeholders; the images are not carried into the port.`);
  if (notes.unknown.length) note(`control class(es) with no HTML equivalent kept as divs: ${notes.unknown.join(", ")}.`);
  if (notes.dataAware.length) note(`${notes.dataAware.length} control(s) are data aware (${notes.dataAware.join(", ")}), bound to a data source the port must supply; the field each shows is named in the form file and not carried.`);
  if (form.nonvisual.length) note(`${form.nonvisual.length} component(s) draw nothing (${form.nonvisual.map((n) => `${n.name}: ${n.className}`).join(", ")}); each is named in the report as something the port must supply, and none is a control.`);
  for (const m of form.menus) walk(m.items, (it) => { if (it.shortcut) note(`${it.shortcut} fired ${caption(it.caption).text} in the original; the port binds no keyboard shortcut, so the menu item is a button only.`); });
  if (behaviours.size) note(`${behaviours.size} handler(s) wired in code are behaviour the port must reimplement (${[...behaviours].join(", ")}); the code body is not read.`);
  for (const s of notes.skipped) note(s);
  return { template, outputs: [...outputs].sort(), fields, usesTwoWay: hasModel, usesNgFor: hasRepeat, usesNgIf: notes.hidden.length > 0, title };
}

/**
 * A menu lowered to a navigation component: popups as nested lists, commands
 * as buttons, mnemonics as access keys. Items are { name, caption, separator,
 * disabled, checked, hidden, shortcut, events, children }.
 */
export function lowerMenu(menu, depth = 0) {
  const outputs = new Set();
  const items = (list, d) => list.flatMap((it) => {
    const pad = "  ".repeat(d);
    if (it.separator) return [`${pad}<li role="separator"></li>`];
    const cap = caption(it.caption);
    const key = cap.accesskey ? ` accesskey="${cap.accesskey}"` : "";
    const dis = it.disabled ? " disabled" : "";
    if (it.children?.length) return [`${pad}<li>`, `${pad}  <button type="button"${key}${dis} aria-haspopup="menu">${esc(cap.text)}</button>`, `${pad}  <ul role="menu">`, ...items(it.children, d + 2), `${pad}  </ul>`, `${pad}</li>`];
    const event = camel(cap.text) || camel(stripPrefix(it.name)) || "command";
    outputs.add(event);
    const checked = it.checked ? ' aria-checked="true"' : "";
    return [`${pad}<li role="none"><button type="button" role="menuitem" ng-click="on${pascal(event)}()"${key}${dis}${checked}>${esc(cap.text)}</button></li>`];
  });
  const pad = "  ".repeat(depth);
  const label = menu.label ?? "menu";
  const lines = [`${pad}<nav class="menu-bar" aria-label="${esc(label)}">`, `${pad}  <ul role="menubar">`, ...items(menu.items, depth + 2), `${pad}  </ul>`, `${pad}</nav>`];
  return { lines, template: lines.join("\n"), outputs: [...outputs].sort() };
}

/** Text inside a markdown table cell: the backslash first, then the pipe, and a line break as a space. */
const cell = (text) => String(text ?? "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/**
 * One report for every form a reader took apart: a table per form with each
 * control's class, caption, rectangle in the file's own units, tab stop and
 * the handlers wired to it, then the menu tree, the components that draw
 * nothing, and the messages the code shows. Values other than captions and
 * messages are never printed.
 */
export function formsReport(files, { heading, intro, units }) {
  const out = [`# ${heading}`, "", intro, ""];
  const walkMenu = (items, depth) => items.flatMap((it) => it.separator ? [`${"  ".repeat(depth)}- ———`] : [`${"  ".repeat(depth)}- ${caption(it.caption).text}${it.shortcut ? ` (${it.shortcut})` : ""}${it.disabled ? " disabled" : ""}${it.checked ? " checked" : ""}${it.hidden ? " hidden" : ""}`, ...(it.children?.length ? walkMenu(it.children, depth + 1) : [])]);
  const rows = (list, prefix) => list.flatMap((c) => [
    `| ${cell(prefix + c.name + (c.index != null ? `(${c.index})` : ""))} | ${cell(c.className)} | ${c.kind} | ${cell(caption(c.caption).text)} | ${c.rect ? `${c.rect.left}, ${c.rect.top}` : ""} | ${c.rect ? `${c.rect.width} × ${c.rect.height}` : ""} | ${c.tab ?? ""} | ${(c.events ?? []).join(", ")} |`,
    ...rows(c.children ?? [], `${prefix}${c.name}.`),
  ]);
  for (const f of files) {
    out.push(`## ${f.rel}`, "");
    for (const p of f.problems ?? []) out.push(`${p}.`, "");
    for (const form of f.forms) {
      const count = [];
      walk(form.controls, (c) => count.push(c));
      out.push(`### ${form.name} (${form.className})${form.caption ? `: ${cell(caption(form.caption).text)}` : ""}`, "",
        `${form.size ? `${form.size.width} × ${form.size.height} ${units}, ` : ""}${count.length} control(s)${form.events?.length ? `, form handlers: ${form.events.join(", ")}` : ""}.`, "",
        `| control | class | kind | caption | left, top (${units}) | width × height | tab | handlers |`, "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...rows(form.controls, ""), "");
      for (const m of form.menus) out.push(`#### ${m.label ?? "menu"}`, "", ...walkMenu(m.items, 0), "");
      if (form.nonvisual.length) out.push("#### Components that draw nothing", "", ...form.nonvisual.map((n) => `- ${cell(n.name)} (${cell(n.className)})${n.note ? `: ${n.note}` : ""}`), "");
      if (form.messages?.length) out.push("#### Messages the code shows", "", "| in | message |", "| --- | --- |", ...form.messages.map((m) => `| ${cell(m.in)} | ${cell(m.text)} |`), "");
    }
  }
  return out.join("\n") + "\n";
}
