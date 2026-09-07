import { pascal } from "../dsp-ir/emit.js";
import { literalString, stringArray, splitTop } from "./parse.js";

/**
 * What a NetBeans initComponents body means, once parse.js has cut it into
 * statements. A GUI builder writes the same handful of shapes every time: a
 * field instantiated, a property set with a literal, an event wired through
 * an anonymous listener, a container's children added. Each is lowered onto
 * the AngularJS attribute dialect the rest of the tool already reads, the
 * same target input-winforms and input-exe lower a designer file and a
 * native dialog onto, so a Swing form reaches React the way either does.
 *
 * What the generated code cannot say honestly is named through the caller's
 * `note` rather than approximated: a caption built at runtime, a combo box
 * filled by a loop, a table whose model is not a literal column array, and
 * every property this reader's shapes do not cover.
 */

const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);
const camel = (text) => {
  const p = pascal(String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A common hand written prefix, dropped when a capital follows it; a NetBeans
// default name like jTextField1 carries none of these and is kept as is.
const PREFIX = /^(txt|lbl|btn|chk|rdo|rb|cbo|cmb|combo|spn|pwd|ta|lst)(?=[A-Z])/;
const stem = (name) => { const s = String(name).replace(PREFIX, ""); return s.charAt(0).toLowerCase() + s.slice(1); };

const KINDS = { JPanel: "panel", JScrollPane: "panel", JSplitPane: "split", JLabel: "label", JTextField: "input", JFormattedTextField: "input", JTextArea: "textarea", JSpinner: "input", JPasswordField: "input", JCheckBox: "checkbox", JRadioButton: "radio", JComboBox: "combobox", JButton: "button", JTabbedPane: "tabs", JTable: "table" };
const FIELD_KIND = new Set(["input", "textarea", "combobox"]);
const LAYOUTS = new Set(["GroupLayout", "GridBagLayout", "GridBagConstraints", "BorderLayout", "CardLayout", "BoxLayout", "FlowLayout"]);

function newWidget(name, type, kind, line) {
  return { name, type, kind, line, text: null, password: type === "JPasswordField", items: [], itemsDynamic: false, columns: null, columnsChecked: false, labelForTarget: null, consumedByLabel: false, radioGroup: null, parent: "", children: [], tabs: [], handler: null, wired: false, order: 0, rendered: false };
}

/**
 * A form's initComponents statements, classified. `fields` are the class
 * level `private javax.swing.J<Type> name;` declarations, read once for the
 * whole file, because an instantiation inside the method carries a type only
 * when the field declaration did not; `handlers` are the file's own
 * `<name>ActionPerformed` methods, each kept as existing and how long it
 * runs, never its body.
 */
export function lowerForm(read, note) {
  const { statements, fieldTypes, handlers } = read;
  const widgets = new Map();
  const buttonGroups = new Map();
  const helperVars = new Map();
  const layoutManagers = new Set();
  let layoutStatements = 0;
  let order = 0;
  let title = null;

  const widget = (name) => widgets.get(name) ?? null;

  for (const st of statements) {
    const text = st.text.replace(/\s+/g, " ").trim();

    // Frame level setup a GUI builder always emits: recognised so it never
    // reads as a gap, reproduced nowhere because it configures the window,
    // not a control on it.
    if (/^(?:this\.)?(?:pack|setResizable|setSize|setLocationRelativeTo|setDefaultCloseOperation)\(/.test(text)) continue;
    const titled = /^(?:this\.)?setTitle\((.+)\)$/.exec(text);
    if (titled) { const s = literalString(titled[1]); if (s !== null) title = s; continue; }

    // A local layout manager or constraint helper: `javax.swing.GroupLayout layout = new javax.swing.GroupLayout(...)`
    // or `java.awt.GridBagConstraints gridBagConstraints = new java.awt.GridBagConstraints();`. Named, never read further.
    const helperDecl = /^(?:javax\.swing\.|java\.awt\.)?(\w+)\s+(\w+)\s*=\s*new\s+/.exec(text);
    if (helperDecl && LAYOUTS.has(helperDecl[1])) { helperVars.set(helperDecl[2], helperDecl[1]); layoutManagers.add(helperDecl[1]); layoutStatements += 1; continue; }

    // A field instantiated: `name = new javax.swing.JLabel();` or a button group: `name = new javax.swing.ButtonGroup();`.
    const declared = /^(\w+)\s*=\s*new\s+(?:javax\.swing\.)?(\w+)\s*\(\s*\)$/.exec(text);
    if (declared) {
      const [, name, ctorType] = declared;
      const known = fieldTypes.get(name) ?? ctorType;
      if (known === "ButtonGroup" || ctorType === "ButtonGroup") { buttonGroups.set(name, []); continue; }
      if (/^J[A-Z]/.test(known)) { order += 1; const w = newWidget(name, known, KINDS[known] ?? "unknown", st.line); w.order = order; widgets.set(name, w); continue; }
      continue;
    }

    // A statement naming a layout local this file already declared: GroupLayout's own builder calls
    // (`layout.setHorizontalGroup(...)`), a GridBagConstraints field set (`gridBagConstraints.gridx = 0`), or a
    // plain `.setLayout(...)` on any container. None of it is read; the note says which manager and how much.
    const receiver = /^(?:(\w+)\.)?(\w+)/.exec(text);
    if (helperVars.has(receiver?.[1]) || /\.setLayout\(|^setLayout\(/.test(text) || /\bGroupLayout\b|\bGridBagLayout\b|\bGridBagConstraints\b|\bBorderLayout\b|\bCardLayout\b|\bBoxLayout\b|\bFlowLayout\b/.test(text)) {
      layoutStatements += 1;
      const m = /(?:new\s+(?:javax\.swing\.|java\.awt\.)?(\w+)\()/.exec(text);
      if (m && LAYOUTS.has(m[1])) layoutManagers.add(m[1]);
      continue;
    }

    // setText("...") only when the argument is a whole string literal; a concatenation or a variable is a gap.
    const setText = /^(\w+)\.setText\((.+)\)$/.exec(text);
    if (setText) {
      const w = widget(setText[1]);
      if (!w) continue;
      const s = literalString(setText[2]);
      if (s !== null) w.text = s;
      else note(`${st.line}: ${setText[1]}.setText(...) is not a plain string literal; its caption is not guessed at.`);
      continue;
    }

    const echo = /^(\w+)\.setEchoChar\(/.exec(text);
    if (echo) { const w = widget(echo[1]); if (w) w.password = true; continue; }

    const labelFor = /^(\w+)\.setLabelFor\((\w+)\)$/.exec(text);
    if (labelFor) { const l = widget(labelFor[1]); if (l) l.labelForTarget = labelFor[2]; continue; }

    // The exact shape a GUI builder writes for a click: an anonymous ActionListener whose actionPerformed calls
    // straight through to the real handler. Only the handler's name is kept; its body is never this reader's.
    const wired = /^(\w+)\.addActionListener\(new\s+(?:java\.awt\.event\.)?ActionListener\(\)\s*\{\s*public\s+void\s+actionPerformed\(\s*(?:java\.awt\.event\.)?ActionEvent\s+\w+\s*\)\s*\{\s*(\w+)\(\s*\w+\s*\);\s*\}\s*\}\)$/.exec(text);
    if (wired) { const w = widget(wired[1]); if (w) { w.wired = true; w.handler = handlers.get(wired[2]) ? { name: wired[2], ...handlers.get(wired[2]) } : { name: wired[2], line: null, lines: null }; } continue; }
    if (/\.addActionListener\(/.test(text)) { note(`${st.line}: an addActionListener call not in the shape a GUI builder generates; the listener is named as existing and not read further.`); continue; }

    const addItem = /^(\w+)\.addItem\((.+)\)$/.exec(text);
    if (addItem) {
      const w = widget(addItem[1]);
      if (!w) continue;
      const s = literalString(addItem[2]);
      if (s !== null) w.items.push(s);
      else { w.itemsDynamic = true; note(`${st.line}: ${addItem[1]}.addItem(...) argument is not a plain string literal; the combo box is taken as filled at runtime.`); }
      continue;
    }

    const addTab = /^(\w+)\.addTab\((.+)\)$/.exec(text);
    if (addTab) {
      const w = widget(addTab[1]);
      if (!w) continue;
      const args = splitTop(addTab[2]);
      const titleLit = args[0] !== undefined ? literalString(args[0]) : null;
      const child = args[1] !== undefined ? /^(\w+)$/.exec(args[1].trim())?.[1] : null;
      if (titleLit !== null && child && widget(child)) { w.tabs.push({ title: titleLit, child }); widget(child).parent = w.name; }
      else note(`${st.line}: ${addTab[1]}.addTab(...) does not name a literal title and a single declared component; its page is not placed.`);
      continue;
    }

    const model = /^(\w+)\.setModel\(new\s+(?:javax\.swing\.table\.)?DefaultTableModel\(([\s\S]+)\)\)$/.exec(text);
    if (model) {
      const w = widget(model[1]);
      if (w) { w.columnsChecked = true; w.columns = stringArray(model[2]); }
      continue;
    }

    // A container's children: `panel1.add(child)`, `panel1.add(child, constraint)`, the implicit `add(child, constraint)`
    // meaning this form itself, or `getContentPane().add(child, constraint)`. A button group's own `.add(radio)` is
    // read as membership, never as containment. `setLeftComponent`/`setRightComponent` place a split pane's panes
    // the same way `.add` places anything else; which side is not kept, both render inside the one split.
    const add = /^(?:getContentPane\(\)\.|(\w+)\.)?add\((\w+)(?:,\s*[\s\S]+)?\)$/.exec(text) ?? /^(\w+)\.(?:setLeftComponent|setRightComponent)\((\w+)\)$/.exec(text);
    if (add) {
      const [, recv, childName] = add;
      const group = recv ? buttonGroups.get(recv) : null;
      if (group) { group.push(childName); const c = widget(childName); if (c) c.radioGroup = recv; continue; }
      const child = widget(childName);
      if (child) child.parent = recv ?? "";
      continue;
    }

    note(`initComponents, line ${st.line}: \`${text.length > 100 ? `${text.slice(0, 100)}…` : text}\` is not a statement shape this reader classifies; nothing was lowered from it.`);
  }

  // A radio button never placed in a ButtonGroup still needs a group of its own, one radio one choice, the same
  // fallback input-exe and input-winforms take when the source itself never grouped a control.
  for (const w of widgets.values()) if (w.kind === "radio" && !w.radioGroup) { const solo = `choice${w.order}`; buttonGroups.set(solo, [w.name]); w.radioGroup = solo; }

  const all = [...widgets.values()];
  const byName = (n) => widgets.get(n) ?? null;
  const fieldToLabel = new Map();
  for (const w of all) if (w.kind === "label" && w.labelForTarget && byName(w.labelForTarget)) { fieldToLabel.set(w.labelForTarget, w); w.consumedByLabel = true; }

  const names = new Set();
  const unique = (base) => { const s0 = declarable(base || "field"); let name = s0; let n = 2; while (names.has(name)) name = `${s0}${n++}`; names.add(name); return name; };
  const outputs = new Set();
  const fields = [];
  let hasModel = false;
  let hasRepeat = false;
  const radioGroupField = new Map();

  const fieldName = (w) => {
    const label = fieldToLabel.get(w.name);
    const base = (label?.text ? camel(label.text) : "") || stem(w.name);
    return unique(base);
  };

  const render = (parent, depth) => {
    const own = all.filter((w) => w.parent === parent).sort((a, b) => a.order - b.order);
    const pad = "  ".repeat(depth);
    const lines = [];
    for (const w of own) {
      if (w.rendered) continue;
      w.rendered = true;
      switch (w.kind) {
        case "label": {
          if (w.consumedByLabel) continue;
          if (w.text) lines.push(`${pad}<p>${esc(w.text)}</p>`);
          break;
        }
        case "input": case "textarea": {
          const field = fieldName(w);
          fields.push(field);
          hasModel = true;
          const id = `f-${kebab(field)}`;
          const label = fieldToLabel.get(w.name);
          if (label?.text) lines.push(`${pad}<label for="${id}">${esc(label.text)}</label>`);
          if (w.kind === "textarea") lines.push(`${pad}<textarea id="${id}" ng-model="${field}"></textarea>`);
          else lines.push(`${pad}<input id="${id}" type="${w.password ? "password" : "text"}" ng-model="${field}">`);
          break;
        }
        case "checkbox": {
          const field = unique(camel(w.text ?? "") || stem(w.name));
          fields.push(field); hasModel = true;
          lines.push(`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(w.text ?? "")}</label>`);
          break;
        }
        case "radio": {
          if (!radioGroupField.has(w.radioGroup)) {
            const owner = (buttonGroups.get(w.radioGroup) ?? []).map(byName).find((r) => r?.text);
            const base = owner ? camel(owner.text) : stem(w.radioGroup);
            radioGroupField.set(w.radioGroup, unique(base));
            fields.push(radioGroupField.get(w.radioGroup));
            hasModel = true;
          }
          const field = radioGroupField.get(w.radioGroup);
          lines.push(`${pad}<label><input type="radio" ng-model="${field}" value="${kebab(w.text ?? w.name)}"> ${esc(w.text ?? "")}</label>`);
          break;
        }
        case "combobox": {
          const field = fieldName(w);
          fields.push(field); hasModel = true;
          const id = `f-${kebab(field)}`;
          const label = fieldToLabel.get(w.name);
          if (label?.text) lines.push(`${pad}<label for="${id}">${esc(label.text)}</label>`);
          lines.push(`${pad}<select id="${id}" ng-model="${field}">`);
          if (!w.itemsDynamic && w.items.length) for (const it of w.items) lines.push(`${pad}  <option>${esc(it)}</option>`);
          else { hasRepeat = true; lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`); note(`the combo box ${field} is filled by code at runtime; the port takes it as \`${field}Options\`, which it must be handed.`); }
          lines.push(`${pad}</select>`);
          break;
        }
        case "button": {
          const wired = w.wired;
          // A handler name is already a Java identifier with its own humps; camel() is for turning a caption into
          // one and would flatten `loginButton` to `loginbutton`, so a wired button keeps the name as written.
          const fromHandler = (n) => n.charAt(0).toLowerCase() + n.slice(1);
          const event = wired ? fromHandler(w.handler.name.replace(/ActionPerformed$/, "")) || stem(w.name) : camel(w.text ?? "") || stem(w.name);
          outputs.add(event);
          if (wired) {
            if (w.handler.lines) note(`${w.handler.name} exists, ${w.handler.lines} line(s) long; it is not read further.`);
            else note(`${w.name} wires ${w.handler.name}, which this file does not define; nothing further was read.`);
          } else note(`the button ${w.name} has no addActionListener wired; it raises its event and what it should do, if anything, is a decision the port must make.`);
          lines.push(`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(w.text ?? "")}</button>`);
          break;
        }
        case "table": {
          if (w.columnsChecked && w.columns) lines.push(`${pad}<table>`, `${pad}  <thead><tr>${w.columns.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>`, `${pad}</table>`);
          else { note(`the table ${w.name}'s columns could not be read structurally; an empty table stands in and its rows come from the model at runtime.`); lines.push(`${pad}<table></table>`); }
          break;
        }
        case "tabs": {
          if (w.tabs.length) {
            lines.push(`${pad}<div class="tabs">`, `${pad}  <nav>`);
            for (const t of w.tabs) lines.push(`${pad}    <span>${esc(t.title)}</span>`);
            lines.push(`${pad}  </nav>`);
            for (const t of w.tabs) lines.push(...render(t.child, depth + 1));
            lines.push(`${pad}</div>`);
          } else { note(`the tabbed pane ${w.name} has no page added in a shape this reader reads; nothing was placed inside it.`); lines.push(`${pad}<div class="tabs"></div>`); }
          break;
        }
        case "panel": case "split": lines.push(`${pad}<div class="panel">`, ...render(w.name, depth + 1), `${pad}</div>`); break;
        default: note(`the control ${w.name} (${w.type}) has no equivalent this reader lowers; kept as a div.`); lines.push(`${pad}<div class="${kebab(w.type)}">`, ...render(w.name, depth + 1), `${pad}</div>`); break;
      }
    }
    return lines;
  };

  const body = render("", 1);
  // GroupLayout is the common case and buries every containment decision inside its own builder calls, so a
  // widget the code never `.add`ed anywhere real is rendered flat; the note says so rather than a guessed tree.
  const anyEdges = all.some((w) => w.parent !== "");
  if (layoutManagers.size) note(`the form's layout (${[...layoutManagers].join(", ")}) is named here and never reproduced; ${layoutStatements} statement(s) building or configuring it are not read. ${anyEdges ? "" : "None of it names which control belongs inside which container, so every control renders in one flat reading order."}`.trim());
  else if (!anyEdges && all.some((w) => w.kind === "panel" || w.kind === "split")) note("no .add call this reader read named which control belongs inside which container; every control renders in one flat reading order and the nesting was not reconstructed.");

  const open = `<div class="swing-form">`;
  const template = [open, ...(title ? [`  <h2>${esc(title)}</h2>`] : []), ...body, "</div>"].join("\n");
  return { template, outputs: [...outputs].sort(), fields, usesTwoWay: hasModel, usesNgFor: hasRepeat, usesNgIf: false, title, controlCount: all.length };
}
