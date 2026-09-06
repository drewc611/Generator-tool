import { matchBracket, splitCommas } from "../dsp-ir/text.js";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The InitializeComponent body of a Windows Forms designer file, read as the
 * form definition it is. The designer serialises a form as straight line code:
 * every control declared with `new`, configured one property assignment at a
 * time, wired with `+=`, and placed with `Controls.Add`. The C# and the VB
 * spellings differ only at the surface (`this.` against `Me.`, `;` against a
 * line end, `\"` against `""`), so both are cut into statements by a scanner
 * that knows each language's strings and comments, and the statements are
 * classified by shape. No regular expression ever runs over the whole file:
 * one runs over one statement, whose bounds the scanner already proved.
 */

/** Where the C# string, character or comment opening at `i` ends, or `i` when none opens there. */
function skipCs(t, i) {
  const c = t[i];
  if (c === "/" && t[i + 1] === "/") { const nl = t.indexOf("\n", i); return nl < 0 ? t.length : nl; }
  if (c === "/" && t[i + 1] === "*") { const e = t.indexOf("*/", i + 2); return e < 0 ? t.length : e + 2; }
  // A verbatim string: a backslash is a character in it and a doubled quote is one quote.
  const verbatim = (c === "@" && t[i + 1] === '"') || (c === "$" && t[i + 1] === "@" && t[i + 2] === '"') || (c === "@" && t[i + 1] === "$" && t[i + 2] === '"');
  if (verbatim) {
    let j = t.indexOf('"', i) + 1;
    for (;;) { const q = t.indexOf('"', j); if (q < 0) return t.length; if (t[q + 1] === '"') { j = q + 2; continue; } return q + 1; }
  }
  const start = c === "$" && t[i + 1] === '"' ? i + 1 : i;
  const q = t[start];
  if (q !== '"' && q !== "'") return i;
  let j = start + 1;
  while (j < t.length && t[j] !== q) { if (t[j] === "\\") j += 1; j += 1; }
  return j + 1;
}

/** Where the VB string or comment opening at `i` ends, or `i` when none opens there. */
function skipVb(t, i) {
  const c = t[i];
  if (c === "'") { const nl = t.indexOf("\n", i); return nl < 0 ? t.length : nl; }
  if (c !== '"') return i;
  let j = i + 1;
  for (;;) { const q = t.indexOf('"', j); if (q < 0) return t.length; if (t[q + 1] === '"') { j = q + 2; continue; } return q + 1; }
}

const OPEN = "([{";
const CLOSE = ")]}";

/** The C# statements between `from` and the brace that closes the body opened just before it, each with its line, comments dropped. */
function statementsCs(source, from) {
  const out = [];
  let depth = 0;
  let text = "";
  let line = 0;
  let i = from;
  while (i < source.length) {
    const j = skipCs(source, i);
    if (j > i) {
      // A comment between two statements is not part of either; a string is part of its statement whole.
      if (source[i] !== "/") { if (!text.trim()) line = lineAt(source, i); text += source.slice(i, j); }
      i = j;
      continue;
    }
    const c = source[i];
    if (OPEN.includes(c)) depth += 1;
    else if (CLOSE.includes(c)) {
      if (depth === 0) return { statements: out, end: i };
      depth -= 1;
    } else if (c === ";" && depth === 0) {
      if (text.trim()) out.push({ text: text.trim(), line });
      text = "";
      i += 1;
      continue;
    }
    if (!text.trim() && !/\s/.test(c)) line = lineAt(source, i);
    text += c;
    i += 1;
  }
  return { statements: out, end: -1 };
}

/** The VB statements from `from` to the `End Sub` that closes the procedure, comments dropped and continued lines joined. */
function statementsVb(source, from) {
  const out = [];
  let i = from;
  let depth = 0;
  let current = "";
  let currentLine = 0;
  let closed = false;
  while (i < source.length) {
    const nl = source.indexOf("\n", i);
    const lineEnd = nl < 0 ? source.length : nl;
    let text = "";
    for (let k = i; k < lineEnd;) {
      if (source[k] === "'") break;
      const j = skipVb(source, k);
      if (j > k) { text += source.slice(k, j); k = j; continue; }
      if (OPEN.includes(source[k])) depth += 1;
      else if (CLOSE.includes(source[k])) depth -= 1;
      text += source[k];
      k += 1;
    }
    text = text.trim();
    if (!current) currentLine = lineAt(source, i);
    if (/^End\s+Sub\b/i.test(text) && !current) { closed = true; break; }
    const continues = /\s_$/.test(` ${text}`) || depth > 0;
    current += (current ? " " : "") + text.replace(/\s_$/, "").trim();
    if (!continues && current) { out.push({ text: current, line: currentLine }); current = ""; }
    if (nl < 0) break;
    i = nl + 1;
  }
  if (current) out.push({ text: current, line: currentLine });
  return { statements: out, closed };
}

/**
 * The InitializeComponent definition in a file, with its statements, or null
 * when the file defines none: a code behind file calls the method and a
 * helper class never names it, and neither is a form definition.
 */
export function designerBody(source) {
  const cs = /\bvoid\s+InitializeComponent\s*\(\s*\)/.exec(source);
  if (cs) {
    const open = source.indexOf("{", cs.index + cs[0].length);
    if (open < 0 || source.slice(cs.index + cs[0].length, open).trim()) return null;
    const { statements, end } = statementsCs(source, open + 1);
    return { lang: "cs", statements, line: lineAt(source, cs.index), closed: end >= 0 };
  }
  const vb = /\bSub\s+InitializeComponent\s*\(\s*\)[ \t]*\r?\n/i.exec(source);
  if (vb) {
    const { statements, closed } = statementsVb(source, vb.index + vb[0].length);
    return { lang: "vb", statements, line: lineAt(source, vb.index), closed };
  }
  return null;
}

/** A string literal decoded, in either language, or null when the text is not one whole literal. */
export function readString(raw, lang) {
  const t = raw.trim();
  if (lang === "vb") return /^"(?:[^"]|"")*"$/.test(t) ? t.slice(1, -1).replace(/""/g, '"') : null;
  if (/^@"(?:[^"]|"")*"$/.test(t)) return t.slice(2, -1).replace(/""/g, '"');
  if (!/^"(?:[^"\\]|\\.)*"$/.test(t)) return null;
  return t.slice(1, -1).replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{1,4}|.)/g, (_, e) => {
    if (e[0] === "u" || e[0] === "x") return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r", 0: "\0", a: "\x07", b: "\b", f: "\f", v: "\v" }[e] ?? e;
  });
}

/** The numbers inside `new Point(x, y)` or `new Size(w, h)`, in either language. */
function pair(raw, what) {
  const m = new RegExp(`\\b(?:new|New)\\s+[\\w.]*\\b${what}\\s*\\(`).exec(raw);
  if (!m) return null;
  const open = raw.indexOf("(", m.index);
  const close = matchBracket(raw, open, { ticks: false });
  if (close < 0) return null;
  const nums = splitCommas(raw.slice(open + 1, close - 1), { ticks: false }).map((n) => Number(n.replace(/[FfDdMm!]$/, "")));
  return nums.length === 2 && nums.every(Number.isFinite) ? nums : null;
}

/** A number in either language, `new decimal(new int[] { lo, mid, hi, flags })` included; null when it cannot be read exactly. */
export function readNumber(raw) {
  const t = raw.trim();
  if (/^-?\d+(\.\d+)?[FfDdMmRr!]?$/.test(t)) return Number(t.replace(/[FfDdMmRr!]$/, ""));
  if (/\b(?:new|New)\s+[\w.]*[Dd]ecimal\s*\(/.test(t)) {
    const open = t.indexOf("{");
    const close = open < 0 ? -1 : matchBracket(t, open, { ticks: false });
    if (close < 0) return null;
    const parts = splitCommas(t.slice(open + 1, close - 1), { ticks: false }).map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
    const [lo, mid, hi, flags] = parts;
    // The high words carry a value past 2^32; the scale is in bits 16 to 23 and the sign in bit 31.
    if (mid !== 0 || hi !== 0) return null;
    const scale = (flags >>> 16) & 0xff;
    const negative = (flags >>> 31) === 1;
    return (negative ? -1 : 1) * lo / 10 ** scale;
  }
  return null;
}

const VALUE_TYPES = new Set(["Point", "Size", "SizeF", "Font", "Padding", "Color", "Margin", "decimal", "Decimal", "Rectangle", "DateTime"]);

const ENUM_LAST = (raw, family) => [...raw.matchAll(new RegExp(`\\b${family}\\.(\\w+)`, "g"))].map((m) => m[1]);

function newControl(name, line) {
  return {
    name, type: null, fullType: null, line, text: null, textResource: false, localized: false, initialText: false,
    location: null, size: null, tabIndex: null, enabled: true, visible: true, readOnly: false, multiline: false, password: false,
    checked: false, items: [], itemsResource: false, dropDownStyle: null, selectionMode: null, min: null, max: null, format: null, customFormat: false,
    maxLength: null, anchor: [], dock: null, headerText: null, useMnemonic: true, hasImage: false, contextMenu: null,
    events: [], children: [], columns: [], parent: null, unreadProps: [], inline: [],
  };
}

/**
 * The designer file as a form: its class, its own properties and events, and
 * every control with what the code set on it, who holds it, and what is wired.
 */
export function readDesigner(source, rel = "") {
  const body = designerBody(source);
  if (!body) return null;
  const { lang, statements } = body;
  const classMatch = lang === "cs" ? /\bclass\s+(\w+)/.exec(source) : /\bClass\s+(\w+)/.exec(source);
  const controls = new Map();
  const form = { name: null, text: null, textResource: false, localized: false, clientSize: null, acceptButton: null, cancelButton: null, mainMenuStrip: null, events: [], children: [], inline: [] };
  const problems = [];
  const control = (name) => { if (!controls.has(name)) controls.set(name, newControl(name, null)); return controls.get(name); };
  const str = (raw) => readString(raw, lang);
  const isResource = (raw) => /\bresources\.(GetString|GetObject)\s*\(/.test(raw) || /\bresources\.ApplyResources\b/.test(raw);
  const bool = (raw) => (/^(true|True)$/.test(raw.trim()) ? true : /^(false|False)$/.test(raw.trim()) ? false : null);

  const assign = (target, prop, raw) => {
    const s = str(raw);
    // What the code set inline is remembered, so a .resx entry for the same property never overrides it.
    if (!isResource(raw)) target.inline.push(prop);
    switch (prop) {
      case "Text": if (isResource(raw)) target.textResource = true; else if (s !== null) target.text = s; else target.unreadProps.push(prop); return;
      case "Name": if (s !== null) target.designerName = s; return;
      case "Location": target.location = pair(raw, "Point") ?? target.location; if (!target.location) target.unreadProps.push(prop); return;
      case "Size": target.size = pair(raw, "Size") ?? target.size; return;
      case "ClientSize": target.clientSize = pair(raw, "Size"); return;
      case "TabIndex": target.tabIndex = readNumber(raw); return;
      case "Enabled": target.enabled = bool(raw) ?? true; return;
      case "Visible": target.visible = bool(raw) ?? true; return;
      case "ReadOnly": target.readOnly = bool(raw) ?? false; return;
      case "Multiline": target.multiline = bool(raw) ?? false; return;
      case "UseSystemPasswordChar": target.password = bool(raw) ?? target.password; return;
      case "PasswordChar": target.password = true; return;
      case "Checked": target.checked = bool(raw) ?? false; return;
      case "CheckState": return;
      case "UseMnemonic": target.useMnemonic = bool(raw) ?? true; return;
      case "DropDownStyle": target.dropDownStyle = ENUM_LAST(raw, "ComboBoxStyle")[0] ?? null; return;
      case "SelectionMode": target.selectionMode = ENUM_LAST(raw, "SelectionMode")[0] ?? null; return;
      case "Minimum": target.min = readNumber(raw); if (target.min === null) target.unreadProps.push(prop); return;
      case "Maximum": target.max = readNumber(raw); if (target.max === null) target.unreadProps.push(prop); return;
      case "MaxLength": target.maxLength = readNumber(raw); return;
      case "Format": target.format = ENUM_LAST(raw, "DateTimePickerFormat")[0] ?? null; return;
      case "CustomFormat": target.customFormat = true; return;
      case "Anchor": target.anchor = ENUM_LAST(raw, "AnchorStyles"); return;
      case "Dock": target.dock = ENUM_LAST(raw, "DockStyle")[0] ?? null; return;
      case "HeaderText": if (isResource(raw)) target.textResource = true; else if (s !== null) target.headerText = s; return;
      case "Image": case "BackgroundImage": case "Icon": target.hasImage = true; return;
      case "ContextMenuStrip": case "ContextMenu": target.contextMenu = /^(?:this|Me)\.(\w+)$/.exec(raw.trim())?.[1] ?? null; return;
      case "AcceptButton": target.acceptButton = /^(?:this|Me)\.(\w+)$/.exec(raw.trim())?.[1] ?? null; return;
      case "CancelButton": target.cancelButton = /^(?:this|Me)\.(\w+)$/.exec(raw.trim())?.[1] ?? null; return;
      case "MainMenuStrip": case "Menu": target.mainMenuStrip = /^(?:this|Me)\.(\w+)$/.exec(raw.trim())?.[1] ?? null; return;
      default: return;
    }
  };

  /** The `this.a, this.b` references inside a call's collection initializer, or its plain argument. */
  const refs = (args) => {
    const open = args.indexOf("{");
    const inner = open >= 0 ? args.slice(open + 1, matchBracket(args, open, { ticks: false }) - 1) : args;
    return splitCommas(inner, { ticks: false }).map((a) => /^(?:this|Me)\.(\w+)$/.exec(a.trim())?.[1] ?? null);
  };
  const literals = (args) => {
    const open = args.indexOf("{");
    const inner = open >= 0 ? args.slice(open + 1, matchBracket(args, open, { ticks: false }) - 1) : args;
    return splitCommas(inner, { ticks: false }).map((a) => str(a));
  };

  for (const st of statements) {
    const text = st.text.replace(/\s+/g, " ");
    // A declaration: the control's type is the last segment of what is constructed.
    const declared = /^(?:this\.|Me\.)?(\w+) = (?:new|New) ([\w.]+)\s*\(/.exec(text);
    // `this.ClientSize = new Size(...)` constructs a value, not a control; the form's own properties are set, never declared.
    if (declared && !/^System\.Drawing\./.test(declared[2]) && !VALUE_TYPES.has(declared[2].split(".").pop())) {
      const c = control(declared[1]);
      c.line = st.line; c.fullType = declared[2]; c.type = declared[2].split(".").pop();
      continue;
    }
    // An event wired, in the C# spelling or the VB one; the handler is the last name in the right hand side.
    const wired = lang === "cs"
      ? /^(?:this\.)?(?:([\w.]+)\.)?(\w+) \+= (.+)$/.exec(text)
      : /^AddHandler (?:Me\.)?(?:([\w.]+)\.)?(\w+), AddressOf (?:Me\.)?([\w.]+)$/i.exec(text);
    if (wired) {
      const handler = /(\w+)\s*\)*\s*;?$/.exec(wired[3])?.[1] ?? wired[3];
      const target = wired[1] ? control(wired[1].split(".")[0]) : form;
      target.events.push({ event: wired[2], handler, line: st.line });
      continue;
    }
    // A call: containment, items, columns, menu items, localisation; the layout calls are noise.
    const call = /^(?:this\.|Me\.)?([\w.]+)\s*\(([\s\S]*)\)$/.exec(text);
    if (call) {
      const segments = call[1].split(".");
      const method = segments.pop();
      const collection = segments.pop();
      const owner = segments.join(".");
      if ((method === "Add" || method === "AddRange") && collection) {
        const names = refs(call[2]);
        if (collection === "Controls") {
          const holder = owner === "" ? form : control(owner.split(".")[0]);
          for (const n of names) if (n) { control(n).parent = owner === "" ? "" : owner; holder.children.push(n); }
        } else if (collection === "Items" || collection === "DropDownItems") {
          const target = control(owner);
          if (names.every((n) => n === null)) {
            const values = literals(call[2]);
            // A localizable form fills its list with resources.GetString("x.Items"): the items live in the .resx, not unread.
            const parts = splitCommas(call[2].includes("{") ? call[2].slice(call[2].indexOf("{") + 1, matchBracket(call[2], call[2].indexOf("{"), { ticks: false }) - 1) : call[2], { ticks: false });
            values.forEach((v, i) => { if (v !== null) target.items.push(v); else if (isResource(parts[i] ?? "")) target.itemsResource = true; else target.unreadProps.push("Items"); });
          } else for (const n of names) if (n) { control(n).parent = owner; target.children.push(n); }
        } else if (collection === "Columns") {
          for (const n of names) if (n) control(owner).columns.push(n);
        }
        continue;
      }
      if (call[1] === "resources.ApplyResources") {
        const first = splitCommas(call[2], { ticks: false })[0]?.trim();
        if (first === "this" || first === "Me") form.localized = true;
        else { const n = /^(?:this|Me)\.(\w+)$/.exec(first ?? "")?.[1]; if (n) control(n).localized = true; }
      }
      continue;
    }
    // A property set, on a control or on the form itself.
    const set = /^(?:this\.|Me\.)?(?:([\w.]+)\.)?(\w+) = ([\s\S]+)$/.exec(text);
    if (set) {
      const owner = set[1];
      if (!owner) { assign(form, set[2], set[3]); continue; }
      // `this.Foo.Bar = x` reaches a control the file declared or will declare; a local like `resources` is not one.
      if (/^(?:this|Me)\./.test(text) || controls.has(owner.split(".")[0])) assign(control(owner.split(".")[0]), set[2], set[3]);
      continue;
    }
  }
  if (!body.closed) problems.push("InitializeComponent never closes; what was read before the end of the file is kept");
  const className = classMatch?.[1] ?? form.designerName ?? rel.replace(/^.*\//, "").replace(/\.Designer\.(cs|vb)$/i, "").replace(/\.(cs|vb)$/i, "") ?? "Form";
  form.name = form.designerName ?? className;
  return { lang, className, form, controls, problems, line: body.line, statements: statements.length };
}
