import { splitCommas } from "../dsp-ir/text.js";

/**
 * Reads a Visual Basic 6 .frm as the nested blocks it is. The file opens with
 * a VERSION line and the OCX references, then one `Begin VB.Form name` block
 * whose children are `Begin <class> <name>` blocks, each a list of
 * `Property = value` lines with `BeginProperty ... EndProperty` groups (fonts,
 * data bindings) that are skipped whole. After the form's `End` come the
 * `Attribute` lines and the code. The scanner walks lines and a block stack;
 * it never runs a regular expression over the whole file, because a caption
 * can spell anything the grammar spells.
 *
 * The code is not ported. Two things are read from it: which `Sub name_Event`
 * handlers exist, so the report can say what was wired and the notes what the
 * port must write again, and the string literals `MsgBox` shows, which are
 * the messages a user saw. No other literal is read.
 */

/** A line without its comment: an apostrophe or Rem outside every string ends it. */
function uncomment(line) {
  let inString = false;
  for (let k = 0; k < line.length; k += 1) {
    const c = line[k];
    if (c === '"') inString = !inString;
    else if (!inString && (c === "'" || /^rem\b/i.test(line.slice(k)) && /^\s*$/.test(line.slice(0, k)))) return line.slice(0, k);
  }
  return line;
}

/**
 * One property value: a string with its doubled quotes undone, a number with
 * its `'True` comment dropped, a .frx pointer as the file and offset it names
 * (a `$` before it marks a string stored there), or the raw token.
 */
export function parseValue(raw) {
  const s = String(raw).trim();
  const frx = /^(\$?)"([^"]*\.frx)":([0-9A-Fa-f]+)/i.exec(s);
  if (frx) return { frx: true, file: frx[2], offset: parseInt(frx[3], 16), dollar: frx[1] === "$" };
  const str = /^"((?:[^"]|"")*)"/.exec(s);
  if (str) return { string: str[1].replace(/""/g, '"') };
  const num = /^-?\d+(?:\.\d+)?(?![\w&])/.exec(s);
  if (num) return Number(num[0]);
  return { raw: s };
}

const HANDLER = /^\s*(?:(?:Private|Public|Friend)\s+)?(?:Static\s+)?Sub\s+(\w+)_(\w+)\s*\(/i;
const PROCEDURE = /^\s*(?:(?:Private|Public|Friend)\s+)?(?:Static\s+)?(?:Sub|Function|Property\s+(?:Get|Let|Set))\s+(\w+)/i;

export function readFrm(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const objects = [];
  const problems = [];
  const stack = [];
  let form = null;
  let propDepth = 0;
  let codeStart = lines.length;
  let n = 0;
  for (; n < lines.length; n += 1) {
    const line = lines[n].trim();
    if (!line) continue;
    if (propDepth) {
      if (/^BeginProperty\b/.test(line)) propDepth += 1;
      else if (/^EndProperty\b/.test(line)) propDepth -= 1;
      continue;
    }
    if (/^BeginProperty\b/.test(line)) { propDepth = 1; continue; }
    const begin = /^Begin\s+(\S+)\s+(\S+)/.exec(line);
    if (begin) {
      const node = { className: begin[1], name: begin[2], props: {}, children: [], line: n + 1 };
      if (!stack.length) form = node;
      else stack[stack.length - 1].children.push(node);
      stack.push(node);
      continue;
    }
    if (/^End\b/.test(line) && stack.length) {
      stack.pop();
      if (!stack.length) { codeStart = n + 1; break; }
      continue;
    }
    if (stack.length) {
      const prop = /^(\w+)\s*=\s*(.*)$/.exec(line);
      if (prop) stack[stack.length - 1].props[prop[1]] = parseValue(prop[2]);
      else problems.push(`line ${n + 1} inside ${stack[stack.length - 1].name} is neither a property nor a block and was skipped`);
      continue;
    }
    const ref = /^Object\s*=\s*"[^"]*";\s*"([^"]+)"/.exec(line);
    if (ref) objects.push(ref[1]);
  }
  if (!form) return { error: "no Begin block: not a VB6 form file" };
  if (stack.length) problems.push(`the block ${stack[stack.length - 1].className} ${stack[stack.length - 1].name} opened at line ${stack[stack.length - 1].line} is never closed`);

  const handlers = [];
  const messages = [];
  let name = null;
  let current = null;
  for (let i = codeStart; i < lines.length; i += 1) {
    const line = lines[i];
    const attr = /^Attribute\s+VB_Name\s*=\s*"([^"]*)"/.exec(line.trim());
    if (attr) { name = attr[1]; continue; }
    // A trailing comment is dropped outside strings, and a statement continued with _ is read as one line.
    let stripped = uncomment(line);
    while (/\s_$/.test(stripped) && i + 1 < lines.length) stripped = stripped.replace(/\s_$/, " ") + uncomment(lines[++i]).trim();
    if (!stripped.trim()) continue;
    // A form file holds one form; a second Begin block after the first closed is in the code's place and is not read.
    const second = /^\s*Begin\s+(\S+)\s+(\S+)/.exec(stripped);
    if (second) { problems.push(`a second top level block (${second[1]} ${second[2]}) at line ${i + 1} is not read; a form file holds one form`); continue; }
    const h = HANDLER.exec(stripped);
    if (h) handlers.push({ control: h[1], event: h[2], line: i + 1 });
    const proc = PROCEDURE.exec(stripped);
    if (proc) current = proc[1];
    if (/^\s*End\s+(Sub|Function|Property)\b/i.test(stripped)) { current = null; continue; }
    // MsgBox as a call (a statement, after Call, or as a function's value), never the word inside a string.
    const blank = stripped.replace(/"(?:[^"]|"")*"/g, (m) => " ".repeat(m.length));
    const at = /(?:^|[=:(,]|\bCall\b|\bThen\b|\bElse\b)\s*MsgBox\b/i.exec(blank);
    const msg = at ? /^\s*\(?\s*(.*)$/.exec(stripped.slice(at.index + at[0].length)) : null;
    if (msg) {
      // The first argument is the message; a title in the third is not read, and neither is anything that is not a literal.
      const first = splitCommas(msg[1], { ticks: false })[0] ?? "";
      const literals = [...first.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"').trim());
      // Literals joined by an ellipsis mark where a variable sat between them; the variable's value is not read.
      messages.push({ in: current ?? `line ${i + 1}`, text: literals.length ? literals.join(" … ") : "(a message built at runtime; not read)", line: i + 1 });
    }
  }
  return { form, name, objects, handlers, messages, problems };
}

const NONVISUAL = new Set(["VB.Timer", "VB.Data", "VB.OLE", "MSComDlg.CommonDialog", "MSWinsockLib.Winsock", "MSComctlLib.ImageList", "MSAdodcLib.Adodc", "RDO.RDOConnection"]);
const num = (v) => (typeof v === "number" ? v : null);
const str = (v) => (v && typeof v === "object" && "string" in v ? v.string : null);
const on = (v) => typeof v === "number" && v !== 0;

/** What a control is, from its class and the properties that class reads. */
export function kindOf(node) {
  const p = node.props;
  switch (node.className) {
    case "VB.Label": return "label";
    case "VB.TextBox": return on(p.MultiLine) ? "textarea" : "input";
    case "VB.CommandButton": return "button";
    case "VB.CheckBox": return "checkbox";
    case "VB.OptionButton": return "radio";
    case "VB.Frame": return "group";
    case "VB.ComboBox": case "VB.ListBox": case "VB.DriveListBox": case "VB.DirListBox": case "VB.FileListBox": return "select";
    case "VB.PictureBox": return node.children.length ? "section" : "image";
    case "VB.Image": return "image";
    case "VB.HScrollBar": case "VB.VScrollBar": return "range";
    case "VB.Line": return "rule";
    case "VB.Shape": return "decoration";
    case "VB.Menu": return "menuitem";
    default:
      if (NONVISUAL.has(node.className)) return "nonvisual";
      return num(p.Width) == null && num(p.Height) == null ? "nonvisual" : "unknown";
  }
}

/** `^O` spelled as Ctrl+O: the caret is Ctrl, the plus Shift, the percent Alt, braces name a key. */
export function decodeShortcut(raw) {
  if (!raw) return null;
  const mods = [];
  let s = String(raw);
  for (;;) {
    if (s.startsWith("^")) mods.push("Ctrl");
    else if (s.startsWith("+")) mods.push("Shift");
    else if (s.startsWith("%")) mods.push("Alt");
    else break;
    s = s.slice(1);
  }
  const key = /^\{(\w+)\}$/.exec(s)?.[1] ?? s;
  const spelled = key.length > 1 ? key.charAt(0).toUpperCase() + key.slice(1).toLowerCase() : key.toUpperCase();
  return [...mods, spelled].join("+");
}

const nonvisualNote = (className) => {
  if (className === "VB.Timer") return "a timer; its interval and Timer handler are behaviour the port must reimplement";
  if (/^VB\.Data$|Adodc$|RDOConnection$/.test(className)) return "data access the port must supply";
  if (/CommonDialog$/.test(className)) return "a system dialog the port must supply";
  if (/Winsock$/.test(className)) return "a network connection the port must supply";
  if (/ImageList$/.test(className)) return "images not carried into the port";
  return "a component with no window";
};

/** The parsed form as the control model the shared lowering reads. Twips stay twips; the report says so. */
export function modelForm(read) {
  const { form, handlers } = read;
  const eventsOf = (name) => [...new Set(handlers.filter((h) => h.control === name).map((h) => h.event))];
  const nonvisual = [];
  const menus = [];
  const toControl = (node) => {
    const p = node.props;
    const kind = kindOf(node);
    let rect = null;
    if ([p.Left, p.Top, p.Width, p.Height].every((v) => num(v) != null)) rect = { left: p.Left, top: p.Top, width: p.Width, height: p.Height };
    else if ([p.X1, p.Y1, p.X2, p.Y2].every((v) => num(v) != null)) rect = { left: Math.min(p.X1, p.X2), top: Math.min(p.Y1, p.Y2), width: Math.abs(p.X2 - p.X1), height: Math.abs(p.Y2 - p.Y1) };
    const c = {
      name: node.name, className: node.className, kind, caption: str(p.Caption) ?? "", rect,
      tab: num(p.TabIndex), hidden: p.Visible !== undefined && !on(p.Visible), disabled: p.Enabled !== undefined && !on(p.Enabled),
      readonly: on(p.Locked), password: (str(p.PasswordChar) ?? "") !== "",
      checked: kind === "checkbox" ? num(p.Value) === 1 : kind === "radio" ? on(p.Value) : false,
      multiple: (num(p.MultiSelect) ?? 0) > 0, index: num(p.Index), options: null,
      optionsFrom: kind === "select" ? (p.List?.frx ? "frx" : "runtime") : null,
      submit: on(p.Default), cancel: on(p.Cancel), isDefault: on(p.Default), labelFor: null,
      initialText: (kind === "input" || kind === "textarea") && ((str(p.Text) ?? "") !== "" || Boolean(p.Text?.frx)),
      events: eventsOf(node.name), children: [], frx: pointersOf(node),
    };
    for (const child of node.children) {
      if (child.className === "VB.Menu") continue;
      const k = kindOf(child);
      if (k === "nonvisual") { nonvisual.push({ name: child.name, className: child.className, note: nonvisualNote(child.className), events: eventsOf(child.name), frx: pointersOf(child) }); continue; }
      c.children.push(toControl(child));
    }
    return c;
  };
  const toItem = (node) => {
    const p = node.props;
    const cap = str(p.Caption) ?? "";
    return {
      name: node.name, caption: cap, separator: cap === "-", disabled: p.Enabled !== undefined && !on(p.Enabled), checked: on(p.Checked),
      hidden: p.Visible !== undefined && !on(p.Visible), shortcut: decodeShortcut(p.Shortcut?.raw), events: eventsOf(node.name),
      children: node.children.filter((ch) => ch.className === "VB.Menu").map(toItem),
    };
  };
  const root = toControl(form);
  const items = form.children.filter((ch) => ch.className === "VB.Menu").map(toItem);
  if (items.length) menus.push({ label: "menu", items });
  const p = form.props;
  const formEvents = [...new Set(handlers.filter((h) => h.control === "Form" || h.control === "MDIForm" || h.control === form.name).map((h) => h.event))];
  const known = new Set();
  const collect = (list) => { for (const c of list) { known.add(c.name); collect(c.children); } };
  collect(root.children);
  for (const m of menus) { const w = (list) => { for (const it of list) { known.add(it.name); w(it.children); } }; w(m.items); }
  for (const nv of nonvisual) known.add(nv.name);
  const orphans = [...new Set(handlers.filter((h) => !known.has(h.control) && !["Form", "MDIForm", form.name].includes(h.control)).map((h) => `${h.control}_${h.event}`))];
  return {
    name: form.name, className: form.className, caption: str(p.Caption) ?? "",
    size: { width: num(p.ClientWidth) ?? num(p.Width) ?? 0, height: num(p.ClientHeight) ?? num(p.Height) ?? 0 },
    units: { row: 180, above: 480, col: 120 },
    controls: root.children, menus, nonvisual, events: formEvents, messages: read.messages, orphans,
    frx: root.frx, frxRefs: countFrx(form),
  };
}

/** The properties of one block that point into a .frx, as pointers the companion reader resolves. */
const pointersOf = (node) => Object.entries(node.props).filter(([, v]) => v && typeof v === "object" && v.frx).map(([property, v]) => ({ property, file: v.file, offset: v.offset, dollar: v.dollar }));

function countFrx(node) {
  let n = pointersOf(node).length;
  for (const c of node.children) n += countFrx(c);
  return n;
}
