import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { attrOf } from "../dsp-ir/markup.js";
import { componentChildren, eventHandlers, nonVisualComponents, propertiesOf, rootComponents, valueOf } from "./parse.js";

/**
 * What a NetBeans `.form` file's component tree means, once parse.js has
 * handed it over as plain elements. A `<Component class="...">` under
 * `<SubComponents>` is a real component boundary somebody drew with the
 * Matisse GUI Builder, so this reader produces a screen the way input-qt and
 * input-swing already do from a widget tree and a generated method, laid out
 * in document order. What has no honest equivalent, an opaque property, a
 * combo box with no inline `<StringArray>` model, a button with no
 * `actionPerformed` wired, a widget class this reader does not lower, is
 * named through the caller's `note` rather than approximated.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// NetBeans names a component in camelCase (usernameField, loginButton), unlike the snake_case or plain-word ids the
// other structural readers already kebab, so a case transition is split into a word boundary first, the same
// convenience input-uno already keeps for its own camelCase dlg:id spellings.
const kebab = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => {
  const p = pascal(kebab(text));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** A name the emitted JavaScript can declare: a caption or a Java identifier that spells a reserved word gets a
 * suffix. Not shared with the other readers' copies of this table: each keeps its own. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);
/** The simple class name a fully qualified Java class spells: javax.swing.JLabel is JLabel. */
const simpleClass = (fq) => String(fq ?? "").split(".").pop();

const KINDS = {
  JPanel: "panel", JScrollPane: "panel", JSplitPane: "panel",
  JLabel: "label",
  JTextField: "input", JFormattedTextField: "input", JSpinner: "input", JPasswordField: "input",
  JTextArea: "textarea",
  JCheckBox: "checkbox",
  JRadioButton: "radio",
  JComboBox: "combobox",
  JButton: "button",
  JTable: "table",
};
const FIELD_TEXT = new Set(["JTextField", "JFormattedTextField", "JSpinner", "JPasswordField"]);

function makeState(nonVisual) {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), usesNgFor: false,
    byName: new Map(), buttonGroups: new Map(), fieldToLabel: new Map(), labels: [],
    nonVisual, seq: 1,
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

/**
 * A component's own `<Property>` children this widget's own rendering did
 * not already read on purpose (`consumed`), whose value this reader does not
 * interpret at all: named by property name and value type only, never by
 * what they hold, the same restraint input-qt's and input-glade's own
 * `noteOpaqueProps` keep.
 */
function noteOpaqueProps(comp, label, state, consumed = []) {
  const names = propertiesOf(comp).map((p) => attrOf(p, "name")).filter((n) => n && !consumed.includes(n));
  const opaque = names.map((n) => valueOf(comp, n)).filter((v) => v && v.kind === "opaque");
  if (opaque.length) {
    state.note(`\`${label}\` declares propert${opaque.length === 1 ? "y" : "ies"} this reader does not interpret beyond their names: ${opaque.map((p) => `${p.name} (${p.type})`).join(", ")}.`);
  }
}

/**
 * Field ids, radio groups and label pairings are settled before anything
 * renders, in one walk over the whole tree, so a label met before its
 * `labelFor` target (or after it) resolves the same either way.
 *
 * Radio grouping: a `<Property name="buttonGroup">` holding a
 * `<ComponentRef>` to a `<NonVisualComponents>` `ButtonGroup` is NetBeans'
 * own real, explicit rule and is read as the real answer, not a fallback.
 * A radio button with no such reference falls back to this reader's own
 * consecutive-siblings-in-declaration-order convenience: `runGroup` is the
 * field name of the run currently open in this container, and any other
 * component, known or not, closes it, the same convenience input-uno and
 * input-powerbuilder already keep, named honestly as their own rather than
 * a rule the format states.
 */
function prepare(components, state, runGroup) {
  for (const comp of components) {
    const klass = simpleClass(attrOf(comp, "class"));
    const name = attrOf(comp, "name");
    if (name) state.byName.set(name, comp);

    if (klass === "JLabel") {
      runGroup.current = null;
      const lf = valueOf(comp, "labelFor");
      if (lf?.kind === "componentref" && lf.ref) { comp.labelForTarget = lf.ref; state.labels.push(comp); }
    } else if (klass === "JRadioButton") {
      const bg = valueOf(comp, "buttonGroup");
      if (bg?.kind === "componentref" && bg.ref) {
        if (!state.buttonGroups.has(bg.ref)) {
          const nv = state.nonVisual.find((n) => n.name === bg.ref);
          const field = state.unique(camel(nv?.name ?? bg.ref) || "choice");
          state.buttonGroups.set(bg.ref, field);
          state.fields.push(field);
        }
        comp.field = state.buttonGroups.get(bg.ref);
        runGroup.current = null;
      } else {
        if (!runGroup.current) { runGroup.current = state.unique(camel(name) || "choice"); state.fields.push(runGroup.current); }
        comp.field = runGroup.current;
      }
    } else {
      runGroup.current = null;
      if (FIELD_TEXT.has(klass)) { comp.field = state.unique(declarable(name || `field${state.seq++}`)); state.fields.push(comp.field); }
      else if (klass === "JTextArea") { comp.field = state.unique(declarable(name || `field${state.seq++}`)); state.fields.push(comp.field); }
      else if (klass === "JCheckBox") { comp.field = state.unique(declarable(name || `check${state.seq++}`)); state.fields.push(comp.field); }
      else if (klass === "JComboBox") { comp.field = state.unique(declarable(name || `select${state.seq++}`)); state.fields.push(comp.field); }
    }
    prepare(componentChildren(comp), state, { current: null });
  }
}

/** The text a `labelFor` target's own paired label carries, or null when it has none paired. */
function labelTextFor(name, state) {
  const label = state.fieldToLabel.get(name);
  if (!label) return null;
  const text = valueOf(label, "text");
  return text?.kind === "string" ? text.value : "";
}

function render(components, state, depth) {
  const pad = "  ".repeat(depth);
  const lines = [];
  for (const comp of components) {
    const klass = simpleClass(attrOf(comp, "class"));
    const name = attrOf(comp, "name");
    const kind = KINDS[klass];

    switch (kind) {
      case "panel": {
        noteOpaqueProps(comp, name || klass, state, []);
        lines.push(`${pad}<div>`, ...render(componentChildren(comp), state, depth + 1), `${pad}</div>`);
        break;
      }
      case "label": {
        if (comp.consumedByLabel) break;
        const text = valueOf(comp, "text");
        const content = text?.kind === "string" ? text.value : "";
        noteOpaqueProps(comp, name || "a label", state, ["text", "labelFor"]);
        if (content) lines.push(`${pad}<p>${esc(content)}</p>`);
        break;
      }
      case "input": {
        const field = comp.field;
        const id = `f-${kebab(field)}`;
        const labelText = labelTextFor(name, state);
        let type = "text";
        if (klass === "JPasswordField") type = "password";
        noteOpaqueProps(comp, name || field, state, []);
        if (labelText !== null) lines.push(`${pad}<label for="${id}">${esc(labelText)}</label>`);
        lines.push(`${pad}<input id="${id}" type="${type}" ng-model="${field}">`);
        break;
      }
      case "textarea": {
        const field = comp.field;
        const id = `f-${kebab(field)}`;
        const labelText = labelTextFor(name, state);
        noteOpaqueProps(comp, name || field, state, []);
        if (labelText !== null) lines.push(`${pad}<label for="${id}">${esc(labelText)}</label>`);
        lines.push(`${pad}<textarea id="${id}" ng-model="${field}"></textarea>`);
        break;
      }
      case "checkbox": {
        const field = comp.field;
        const text = valueOf(comp, "text");
        noteOpaqueProps(comp, name || field, state, ["text"]);
        lines.push(`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(text?.kind === "string" ? text.value : "")}</label>`);
        break;
      }
      case "radio": {
        const group = comp.field;
        const text = valueOf(comp, "text");
        const label = text?.kind === "string" ? text.value : "";
        noteOpaqueProps(comp, name || group, state, ["text", "buttonGroup"]);
        const value = attrSafe(kebab(label) || name || "choice");
        lines.push(`${pad}<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`);
        break;
      }
      case "combobox": {
        const field = comp.field;
        const id = `f-${kebab(field)}`;
        const labelText = labelTextFor(name, state);
        const model = valueOf(comp, "model");
        noteOpaqueProps(comp, name || field, state, ["model"]);
        if (labelText !== null) lines.push(`${pad}<label for="${id}">${esc(labelText)}</label>`);
        lines.push(`${pad}<select id="${id}" ng-model="${field}">`);
        if (model?.kind === "stringarray" && model.items.length) {
          for (const it of model.items) lines.push(`${pad}  <option>${esc(it)}</option>`);
        } else {
          state.usesNgFor = true;
          state.note(`\`${name || field}\` declares no inline <StringArray> model; the port takes it as \`${field}Options\`, which it must be handed.`);
          lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
        }
        lines.push(`${pad}</select>`);
        break;
      }
      case "button": {
        const text = valueOf(comp, "text");
        const label = text?.kind === "string" ? text.value : (name ?? "");
        noteOpaqueProps(comp, name || label || "a button", state, ["text"]);
        const wired = eventHandlers(comp).find((h) => h.event === "actionPerformed");
        if (!wired) {
          state.note(`\`${name || label}\` has no actionPerformed EventHandler wired; it is emitted with no click handler found.`);
          lines.push(`${pad}<button type="button">${esc(label)}</button>`);
          break;
        }
        state.note(`${wired.handler} exists, wired from \`${name}\`'s actionPerformed; it is kept as existing and never read further.`);
        // The handler name is already a Java identifier with its own humps; camel() is for turning a caption into
        // one and would flatten loginButton to loginbutton, so a wired button keeps the name as written, the same
        // restraint input-swing already keeps over the handler name its own GEN-marked method carries.
        const fromHandler = (n) => n.charAt(0).toLowerCase() + n.slice(1);
        const event = fromHandler(wired.handler.replace(/ActionPerformed$/, "")) || camel(label) || "click";
        state.outputs.add(event);
        lines.push(`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`);
        break;
      }
      case "table": {
        noteOpaqueProps(comp, name || "a table", state, []);
        state.note(`\`${name || "a table"}\`'s columns could not be read structurally; an empty table stands in and its rows come from the model at runtime.`);
        lines.push(`${pad}<table></table>`);
        break;
      }
      default: {
        const kids = componentChildren(comp);
        state.note(`the widget class \`${klass}\`${name ? ` (${name})` : ""} has no vocabulary entry this reader lowers${kids.length ? `; ${kids.length} child component(s) inside it were not read either` : ""}; it is named here rather than approximated.`);
        break;
      }
    }
  }
  return lines;
}

/**
 * A `.form` file's `<Form>` element lowered onto the shared dialect. `note`
 * is called only for a structural problem that stops this reader before it
 * has anything to walk; every widget level gap lands in the returned
 * `notes` instead, so a caller can prefix each with the file it came from.
 */
export function lowerForm(formEl, note = () => {}) {
  const roots = rootComponents(formEl);
  if (!roots.length) { note("no <SubComponents> under the <Form> element; nothing was read."); return null; }

  const state = makeState(nonVisualComponents(formEl));
  prepare(roots, state, { current: null });

  for (const label of state.labels) {
    const target = state.byName.get(label.labelForTarget);
    if (target?.field) { state.fieldToLabel.set(label.labelForTarget, label); label.consumedByLabel = true; }
    else state.note(`\`${attrOf(label, "name") || "a label"}\`'s labelFor references \`${label.labelForTarget}\`, not a field this reader lowered; the label stands alone.`);
  }

  const lines = render(roots, state, 1);
  const template = ["<div>", ...lines, "</div>"].join("\n");
  return {
    template,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
  };
}
