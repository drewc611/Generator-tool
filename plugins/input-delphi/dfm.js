import { matchBracket } from "../dsp-ir/text.js";

/**
 * Reads a Delphi or Lazarus text form file (.dfm, .fmx, .lfm) as the nested
 * `object name: TClass ... end` blocks it is. Each block is a list of
 * `Property = value` lines; a value is a string with its quotes doubled and
 * control characters spelled `#13#10`, a number, an identifier, a set in
 * brackets, a string list in parentheses spanning lines, a collection in
 * angle brackets holding `item ... end` blocks, or binary data in braces.
 * The scanner walks lines with a block stack and joins the lines a value
 * spans by matching its bracket; it never runs a regular expression over the
 * whole file.
 *
 * `inherited` and `inline` open blocks exactly as `object` does. FireMonkey
 * spells a position as Position.X and a size as Size.Width and a caption as
 * Text; the model reads both spellings. Binary data, SQL text and a memo's
 * lines are noted to exist and never printed.
 */

/** A Delphi string: quoted runs with '' doubling and #nn character codes, concatenated, from the start of `s`. */
export function parseString(s) {
  let i = 0;
  let out = "";
  let any = false;
  while (i < s.length) {
    // Two runs are one string across an explicit + or with nothing between them ('a'#13'b'); across bare whitespace
    // they are two items of a list, so the run ends there.
    if (any) {
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j += 1;
      if (s[j] === "+") { i = j + 1; while (i < s.length && /\s/.test(s[i])) i += 1; }
      else if (j !== i) break;
    }
    if (s[i] === "'") {
      let j = i + 1;
      for (;;) {
        const q = s.indexOf("'", j);
        if (q < 0) { out += s.slice(j); j = s.length; break; }
        out += s.slice(j, q);
        if (s[q + 1] === "'") { out += "'"; j = q + 2; continue; }
        j = q + 1; break;
      }
      i = j; any = true;
    } else if (s[i] === "#") {
      const m = /^#(\$[0-9A-Fa-f]+|\d+)/.exec(s.slice(i));
      if (!m) break;
      out += String.fromCharCode(m[1].startsWith("$") ? parseInt(m[1].slice(1), 16) : Number(m[1]));
      i += m[0].length; any = true;
    } else break;
  }
  return any ? { string: out, end: i } : null;
}

/** One property value, typed by its first character. */
export function parseValue(raw) {
  const s = String(raw).trim();
  if (s[0] === "'" || s[0] === "#") return { string: parseString(s)?.string ?? "" };
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^(True|False)$/i.test(s)) return s.toLowerCase() === "true";
  if (s[0] === "(") {
    const list = [];
    const close = matchBracket(s, 0, { ticks: false });
    let rest = s.slice(1, close > 0 ? close - 1 : undefined).trim();
    while (rest) {
      const str = parseString(rest);
      if (str) { list.push(str.string); rest = rest.slice(str.end).trim(); continue; }
      const tok = /^\S+/.exec(rest);
      list.push(tok[0]); rest = rest.slice(tok[0].length).trim();
    }
    return { list };
  }
  if (s[0] === "[") return { set: s };
  if (s[0] === "{") return { binary: true };
  if (s[0] === "<") return { collection: true };
  return { ident: s };
}

const OPEN = /^(object|inherited|inline)\s+(\w+)(?:\s*:\s*([\w.]+))?(?:\s*\[\d+\])?$/i;

export function readDfm(source) {
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  const forms = [];
  const problems = [];
  const stack = [];
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n].trim();
    if (!line) continue;
    const open = OPEN.exec(line);
    if (open) {
      const node = { name: open[2], className: open[3] ?? open[2], props: {}, children: [], line: n + 1 };
      if (stack.length) stack[stack.length - 1].children.push(node); else forms.push(node);
      stack.push(node);
      continue;
    }
    if (/^end$/i.test(line)) { if (stack.length) stack.pop(); else problems.push(`an end at line ${n + 1} closes nothing`); continue; }
    if (!stack.length) continue;
    const prop = /^([\w.]+)\s*=\s*(.*)$/.exec(line);
    if (!prop) { problems.push(`line ${n + 1} inside ${stack[stack.length - 1].name} is neither a property nor a block and was skipped`); continue; }
    let raw = prop[2];
    // A list or binary block runs until its bracket closes; a collection until its last `end>`; a string until no line ends in +.
    if (raw[0] === "(" || raw[0] === "{") while (matchBracket(raw, 0, { strings: raw[0] === "(", ticks: false }) < 0 && n + 1 < lines.length) raw += "\n" + lines[++n].trim();
    else if (raw[0] === "<" && !/>$/.test(raw)) {
      let depth = 1;
      while (depth > 0 && n + 1 < lines.length) {
        const t = lines[++n].trim();
        raw += "\n" + t;
        if (/=\s*<$/.test(t) || t === "<") depth += 1;
        else if (/^end>$/.test(t) || t === ">") depth -= 1;
      }
    }
    while (/\+$/.test(raw) && n + 1 < lines.length) raw += " " + lines[++n].trim();
    stack[stack.length - 1].props[prop[1]] = parseValue(raw);
  }
  if (stack.length) problems.push(`the block ${stack[stack.length - 1].name}: ${stack[stack.length - 1].className} opened at line ${stack[stack.length - 1].line} is never closed`);
  if (!forms.length) return { error: "no object block: not a Delphi form file" };
  return { forms, problems };
}

const num = (v) => (typeof v === "number" ? v : null);
const str = (v) => (v && typeof v === "object" && "string" in v ? v.string : null);
const ident = (v) => (v && typeof v === "object" && "ident" in v ? v.ident : null);
const list = (v) => (v && typeof v === "object" && "list" in v ? v.list : null);

const KINDS = {
  TLabel: "label", TStaticText: "label", TLinkLabel: "label",
  TEdit: "input", TMaskEdit: "input", TLabeledEdit: "input", TButtonedEdit: "input",
  TMemo: "textarea", TRichEdit: "textarea",
  TCheckBox: "checkbox", TRadioButton: "radio", TRadioGroup: "radiogroup", TGroupBox: "group",
  TPanel: "section", TScrollBox: "section", TFlowPanel: "section", TGridPanel: "section", TFrame: "section", TCategoryPanel: "section",
  TPageControl: "tabs", TTabControl: "tabs", TTabSheet: "tab",
  TComboBox: "select", TListBox: "select", TCheckListBox: "select", TComboBoxEx: "select", TLookupComboBox: "select",
  TButton: "button", TBitBtn: "button", TSpeedButton: "button",
  TSpinEdit: "number", TTrackBar: "range", TDateTimePicker: "date", TMonthCalendar: "date", TCalendar: "date",
  TProgressBar: "progress", TImage: "image", TBevel: "rule", TShape: "decoration",
  TStringGrid: "table", TDrawGrid: "table", TDBGrid: "table", TValueListEditor: "table",
  TListView: "listview", TTreeView: "tree",
  TMainMenu: "menu", TPopupMenu: "menu", TMenuBar: "menu", TMenuItem: "menuitem",
};

const hasRect = (p) => (num(p.Width) != null && num(p.Height) != null) || (num(p["Size.Width"]) != null && num(p["Size.Height"]) != null);

/** What a component is, from its class; a data aware TDBEdit is the TEdit it wraps, and a class with no rectangle draws nothing. */
export function kindOf(node) {
  const base = node.className.replace(/^TDB(?=[A-Z])/, "T");
  const known = KINDS[base] ?? KINDS[node.className];
  if (known === "date" && ident(node.props.Kind) === "dtkTime") return "time";
  if (known) return known;
  return hasRect(node.props) ? "unknown" : "nonvisual";
}

const KEYS = { 8: "Backspace", 9: "Tab", 13: "Enter", 27: "Esc", 32: "Space", 33: "PgUp", 34: "PgDn", 35: "End", 36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 45: "Ins", 46: "Del" };
/** A TShortCut word spelled out: the high bits are Shift, Ctrl and Alt, the low byte a virtual key. */
export function decodeShortcut(value) {
  if (typeof value === "string") return value || null;
  if (typeof value !== "number" || !value) return null;
  const mods = [];
  if (value & 0x2000) mods.push("Shift");
  if (value & 0x4000) mods.push("Ctrl");
  if (value & 0x8000) mods.push("Alt");
  const code = value & 0xff;
  const key = KEYS[code] ?? (code >= 0x30 && code <= 0x5a ? String.fromCharCode(code) : code >= 0x70 && code <= 0x7b ? `F${code - 0x6f}` : `key ${code}`);
  return [...mods, key].join("+");
}

const nonvisualNote = (className) => {
  if (/DataSource$/.test(className)) return "a data source the port must supply";
  if (/(Query|StoredProc|Command)$/.test(className)) return "a query the port must supply; its SQL is not printed";
  if (/(Table|DataSet)$/.test(className)) return "a data set the port must supply";
  if (/(Connection|Database|Session)$/.test(className)) return "a database connection the port must supply";
  if (/Timer$/.test(className)) return "a timer; its interval and OnTimer handler are behaviour the port must reimplement";
  if (/Dialog$/.test(className)) return "a system dialog the port must supply";
  if (/ImageList$/.test(className)) return "images not carried into the port";
  if (/ActionList$/.test(className)) return "actions, each behaviour the port wires to the control that fires it";
  return "a component with no window";
};

const CAPTION_FROM_TEXT = new Set(["label", "button", "checkbox", "radio", "tab", "group", "menuitem"]);

/** One parsed `object` block as the control model the shared lowering reads. Pixels stay pixels; the report says so. */
export function modelForm(node) {
  const nonvisual = [];
  const menus = [];
  const eventsOf = (p) => Object.keys(p).filter((k) => /^On[A-Z]/.test(k)).map((k) => k.slice(2));
  const rectOf = (p) => {
    if (num(p.Width) != null && num(p.Height) != null) return { left: num(p.Left) ?? 0, top: num(p.Top) ?? 0, width: p.Width, height: p.Height };
    if (num(p["Size.Width"]) != null && num(p["Size.Height"]) != null) return { left: Math.round(num(p["Position.X"]) ?? 0), top: Math.round(num(p["Position.Y"]) ?? 0), width: Math.round(p["Size.Width"]), height: Math.round(p["Size.Height"]) };
    return null;
  };
  const toItem = (n) => {
    const p = n.props;
    const cap = str(p.Caption) ?? str(p.Text) ?? "";
    return {
      name: n.name, caption: cap, separator: cap === "-", disabled: p.Enabled === false, checked: p.Checked === true, hidden: p.Visible === false,
      shortcut: decodeShortcut(num(p.ShortCut) ?? str(p.ShortCut)), events: eventsOf(p), children: n.children.map(toItem),
    };
  };
  const toControl = (n) => {
    const p = n.props;
    const kind = kindOf(n);
    const cap = str(p.Caption) ?? (CAPTION_FROM_TEXT.has(kind) ? str(p.Text) : null) ?? "";
    const items = list(p["Items.Strings"]);
    // A tab sheet has no rectangle of its own; the page control sizes it. It sits at its parent's origin and pages keep file order.
    const rect = rectOf(p) ?? (kind === "tab" ? { left: 0, top: 0, width: 0, height: 0 } : null);
    const c = {
      name: n.name, className: n.className, kind, caption: cap, rect, checkedIndex: kind === "radiogroup" ? num(p.ItemIndex) : null,
      tab: num(p.TabOrder), hidden: p.Visible === false, disabled: p.Enabled === false, readonly: p.ReadOnly === true,
      password: (str(p.PasswordChar) ?? "") !== "" && str(p.PasswordChar) !== "\0",
      checked: p.Checked === true || p.IsChecked === true, multiple: p.MultiSelect === true || /CheckListBox$/.test(n.className),
      index: null, options: kind === "select" || kind === "radiogroup" ? items : null, optionsFrom: kind === "select" && !items ? "runtime" : null,
      submit: num(p.ModalResult) === 1 || ident(p.Kind) === "bkOK" || p.Default === true,
      cancel: num(p.ModalResult) === 2 || ident(p.Kind) === "bkCancel" || p.Cancel === true,
      isDefault: p.Default === true, labelFor: ident(p.FocusControl),
      initialText: kind === "textarea" ? Boolean(p["Lines.Strings"]) : kind === "input" && (str(p.Text) ?? "") !== "",
      dataAware: /^TDB[A-Z]/.test(n.className), events: eventsOf(p), children: [],
    };
    // A labelled edit carries its own label; the caption is the field's name and no separate label control exists.
    if (str(p["EditLabel.Caption"])) c.labelText = str(p["EditLabel.Caption"]).replace(/&(?!&)/g, "").replace(/:\s*$/, "");
    for (const child of n.children) {
      const k = kindOf(child);
      if (k === "menu") { menus.push({ label: child.className === "TPopupMenu" ? `${child.name} (context menu)` : "menu", items: child.children.map(toItem) }); continue; }
      if (k === "nonvisual") { nonvisual.push({ name: child.name, className: child.className, note: nonvisualNote(child.className), events: eventsOf(child.props) }); continue; }
      c.children.push(toControl(child));
    }
    return c;
  };
  const root = toControl(node);
  const p = node.props;
  return {
    name: node.name, className: node.className, caption: str(p.Caption) ?? "",
    size: { width: num(p.ClientWidth) ?? num(p.Width) ?? 0, height: num(p.ClientHeight) ?? num(p.Height) ?? 0 },
    units: { row: 8, above: 32, col: 8 },
    controls: root.children, menus, nonvisual, events: eventsOf(p), messages: [],
  };
}
