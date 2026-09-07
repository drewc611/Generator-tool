import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";
import { elements } from "../dsp-ir/markup.js";
import { bulletinboard, childrenOf, controlsOf, dlgAttr, menuItems, readEvents } from "./parse.js";

/**
 * What a UNO dialog's control tree means, once parse.js has handed it over
 * as plain elements. A `<dlg:window>` with its `<dlg:bulletinboard>` is a
 * real component boundary somebody drew with the Dialog Editor, so this
 * reader produces a screen the way input-qt does from a Qt Designer form
 * and input-glade from a GTK Builder one. Unlike either, a UNO dialog's
 * layout is flat: every control is a direct child of the one bulletinboard,
 * placed by absolute `dlg:left`/`dlg:top`, with no layout manager and no
 * nested container to recurse through on purpose (a reader still recurses
 * defensively into anything unexpected, in case a real file nests one
 * anyway, but that is a defence, not a feature this format offers).
 *
 * Grouping heuristic, named honestly: the UNO dialog schema has no explicit
 * "these radio buttons form one group" reference the way Qt's buttonGroup
 * property or GTK's own `group` property does. A `<dlg:radiogroup>` wrapper
 * is read as the real, explicit group it is when a file uses one; where a
 * file instead places several `<dlg:radiobutton>` elements directly under
 * the bulletinboard with nothing else between them, this reader treats that
 * run of consecutive siblings as one group. That is this reader's own
 * structural convenience, not a rule the OpenOffice dialog format states,
 * and it is written down here rather than left to be rediscovered.
 *
 * What has no honest equivalent, a button with no `on-performaction` event
 * wired, a menulist with no inline items, a checkbox whose `dlg:value` could
 * be a label or a checked-state default and cannot be told apart, is named
 * through the caller's `note` rather than approximated.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// A dlg:id or a StarBasic macro name is typically already camelCase or PascalCase, unlike the snake_case ids GTK
// Builder writes, so a case transition is split into a word boundary before the rest of kebab lowercases everything;
// without it "LoginDialog" and "onLoginClick" would collapse to one word and lose the boundary pascal() needs back.
const kebab = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const camel = (text) => {
  const p = pascal(kebab(text));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** A name the emitted JavaScript can declare: a caption that spells a reserved word gets a suffix. Not shared with the
 * other readers' copies of this table: each keeps its own, since the naming choices differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (name) => (RESERVED.has(name) ? `${name}Field` : name);

/** Tags this reader understands the structure of, known controls and the two elements that hold their own children
 * (a menulist's popup, a radiogroup's radios). Anything else met while preparing fields is an unexpected element this
 * reader still walks into defensively, in case a real file nests a control somewhere this format does not expect one. */
const KNOWN = new Set([
  "dlg:text", "dlg:textfield", "dlg:checkbox", "dlg:radiobutton", "dlg:radiogroup",
  "dlg:menulist", "dlg:menupopup", "dlg:menuitem", "dlg:button", "dlg:img", "dlg:fixedline",
  "dlg:table", "dlg:tree", "script:event",
]);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), usesNgFor: false,
    seq: 1,
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
 * Field names and radio groups are settled before anything renders, one walk
 * over the bulletinboard's own children, so a run of consecutive radio
 * buttons resolves the same regardless of where in the walk it is met.
 * `runGroup` is the field name of the radio button run currently open; any
 * other control, known or not, closes it.
 */
function prepare(children, state, runGroup = { current: null }) {
  for (const child of children) {
    const tag = child.tag;
    if (tag === "dlg:radiogroup") {
      const groupId = dlgAttr(child, "dlg:id") || "";
      const field = state.unique(camel(groupId) || "choice");
      state.fields.push(field);
      for (const rb of childrenOf(child, "dlg:radiobutton")) rb.field = field;
      runGroup.current = null;
      continue;
    }
    if (tag === "dlg:radiobutton") {
      if (!runGroup.current) {
        const base = dlgAttr(child, "dlg:id") || "choice";
        runGroup.current = state.unique(camel(base) || "choice");
        state.fields.push(runGroup.current);
      }
      child.field = runGroup.current;
      continue;
    }
    runGroup.current = null;
    if (tag === "dlg:textfield") {
      child.field = state.unique(declarable(dlgAttr(child, "dlg:id") || `field${state.seq++}`));
      state.fields.push(child.field);
    } else if (tag === "dlg:checkbox") {
      child.field = state.unique(declarable(dlgAttr(child, "dlg:id") || `check${state.seq++}`));
      state.fields.push(child.field);
    } else if (tag === "dlg:menulist") {
      child.field = state.unique(declarable(dlgAttr(child, "dlg:id") || `select${state.seq++}`));
      state.fields.push(child.field);
    } else if (!KNOWN.has(tag)) {
      // An element with no vocabulary entry may still hold real controls a real file nested inside it; walked
      // defensively so their fields are not lost, even though this reader recurses into no known container.
      prepare(elements(child.children ?? []), state, runGroup);
    }
  }
}

function renderText(el, depth) {
  const pad = "  ".repeat(depth);
  const content = dlgAttr(el, "dlg:value") ?? "";
  return content ? [`${pad}<p>${esc(content)}</p>`] : [];
}

function renderTextfield(el, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  if (dlgAttr(el, "dlg:multiline") === "true") return [`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`];
  const type = dlgAttr(el, "dlg:echochar") !== null ? "password" : "text";
  return [`${pad}<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

/**
 * A checkbox's caption. `dlg:label`, when the file gives one, is the real
 * caption source; failing that `dlg:value` stands in for it, unless its
 * value is a bare `0` or `1`, which on a checkbox names a checked-state
 * default just as plausibly as it names a caption someone actually typed
 * "0" or "1" into. This reader does not guess which meaning it is: it names
 * the ambiguity and leaves the caption blank rather than risk printing a
 * checked-state flag as if it were a label.
 */
function checkboxLabel(el, state, name) {
  const label = dlgAttr(el, "dlg:label");
  if (label !== null) return label;
  const value = dlgAttr(el, "dlg:value");
  if (value === null) return "";
  if (/^[01]$/.test(value.trim())) {
    state.note(`\`${name}\`'s \`dlg:value\` is \`${value}\`, which on a checkbox may be a checked-state default rather than a caption; no \`dlg:label\` was given, so its caption could not be told apart from state and is left blank rather than guessed.`);
    return "";
  }
  return value;
}

function renderCheckbox(el, state, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  const name = dlgAttr(el, "dlg:id") || field;
  const label = checkboxLabel(el, state, name);
  return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(label)}</label>`];
}

function renderRadio(el, depth) {
  const pad = "  ".repeat(depth);
  const group = el.field;
  const label = dlgAttr(el, "dlg:value") ?? "";
  const value = attrSafe(kebab(label) || dlgAttr(el, "dlg:id") || "choice");
  return [`${pad}<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`];
}

function renderRadiogroup(el, state, depth) {
  const lines = [];
  for (const rb of childrenOf(el, "dlg:radiobutton")) lines.push(...renderRadio(rb, depth));
  return lines;
}

function renderSelect(el, state, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  const name = dlgAttr(el, "dlg:id") || field;
  const items = menuItems(el);
  const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
  if (items.length) {
    for (const it of items) lines.push(`${pad}  <option>${esc(it)}</option>`);
  } else {
    state.usesNgFor = true;
    state.note(`\`${name}\` declares no <dlg:menupopup> (or an empty one); its items are populated from code at runtime, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
  }
  lines.push(`${pad}</select>`);
  return lines;
}

function renderButton(el, state, depth) {
  const pad = "  ".repeat(depth);
  const label = dlgAttr(el, "dlg:value") ?? "";
  const name = dlgAttr(el, "dlg:id") || label || "a button";
  const wired = readEvents(el).find((e) => e.name === "on-performaction");
  if (!wired) {
    state.note(`\`${name}\` has no \`on-performaction\` <script:event> child wired; it is emitted with no wiring found.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  // StarBasic event handlers conventionally spell themselves onSomething, an on_ or on prefix that would otherwise
  // double up against the on this template already writes before every handler name (input-glade strips the same
  // shape of prefix from its own handler names for the same reason).
  const event = camel(wired.method.replace(/^on_?/i, "")) || "click";
  state.outputs.add(event);
  return [`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

function renderRule(el, tag, state, depth) {
  const pad = "  ".repeat(depth);
  const name = dlgAttr(el, "dlg:id") || tag.replace(/^dlg:/, "");
  state.note(`\`${name}\` is a <${tag}>, a separator the Dialog Editor drew; it is lowered to a plain rule with nothing further read from it.`);
  return [`${pad}<hr>`];
}

function renderTablePlaceholder(el, tag, state, depth) {
  const pad = "  ".repeat(depth);
  const kind = tag === "dlg:tree" ? "tree" : "table";
  const name = dlgAttr(el, "dlg:id") || `a ${kind}`;
  state.note(`\`${name}\` is a <${tag}>; its rows come from the code at runtime, so the port has a ${kind} with no header and none invented here.`);
  return [`${pad}<table></table>`];
}

function render(el, state, depth) {
  const tag = el.tag;
  if (tag === "dlg:text") return renderText(el, depth);
  if (tag === "dlg:textfield") return renderTextfield(el, depth);
  if (tag === "dlg:checkbox") return renderCheckbox(el, state, depth);
  if (tag === "dlg:radiobutton") return renderRadio(el, depth);
  if (tag === "dlg:radiogroup") return renderRadiogroup(el, state, depth);
  if (tag === "dlg:menulist") return renderSelect(el, state, depth);
  if (tag === "dlg:button") return renderButton(el, state, depth);
  if (tag === "dlg:img" || tag === "dlg:fixedline") return renderRule(el, tag, state, depth);
  if (tag === "dlg:table" || tag === "dlg:tree") return renderTablePlaceholder(el, tag, state, depth);
  const id = dlgAttr(el, "dlg:id") || "";
  const kids = elements(el.children ?? []);
  state.note(`the element \`${tag}\`${id ? ` (${id})` : ""} is not lowered${kids.length ? `; ${kids.length} child element(s) inside it were not read either` : ""}; it is named here rather than approximated.`);
  return [];
}

/**
 * One `.xdl` file lowered onto the shared dialect. `rel` is only used in
 * notes that need to say where a structural problem was found; `note` is
 * called for those, kept separate from the notes the control tree itself
 * gathers so a caller can prefix or route each kind differently.
 */
export function lowerXdl(windowEl, rel, note = () => {}) {
  const board = bulletinboard(windowEl);
  if (!board) { note(`${rel}: no <dlg:bulletinboard> in the <dlg:window> element; nothing was read.`); return null; }

  const state = makeState();
  const children = controlsOf(board);
  prepare(children, state);

  const lines = [];
  for (const child of children) lines.push(...render(child, state, 1));

  const title = dlgAttr(windowEl, "dlg:title");
  const id = dlgAttr(windowEl, "dlg:id") || "";
  const heading = title ? [`  <h2>${esc(title)}</h2>`] : [];
  const template = ["<div>", ...heading, ...lines, "</div>"].join("\n");
  const stem = kebab(id) || "screen";
  const className = pascal(stem) || "Screen";
  return {
    template,
    stem,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
    title: title || className,
    className,
  };
}
