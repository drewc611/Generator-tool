import { pascal } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";

/**
 * What a FLUID widget tree means, once parse.js has handed it over as plain
 * nodes. A root `Fl_Window` (or any class ending in `Window`) is a real
 * component boundary the way a Qt Designer `<widget>` or a GTK Builder
 * `<object>` is, so this reader produces a screen the way input-qt and
 * input-glade do, laid out top to bottom by each widget's own `xywh`
 * position since FLUID keeps no separate layout manager to read instead.
 *
 * FLUID gives radio grouping no keyword of its own: an `Fl_Round_Button`
 * radios with its siblings purely by FLTK's own runtime rule, that any
 * `Fl_Group` holding more than one of them groups them automatically, so
 * this reader groups by shared immediate parent, the one structural signal
 * the format actually gives, rather than a consecutive-siblings fallback
 * invented for a format with no signal at all.
 *
 * A callback is raw C++, not a name reference: a clean `functionName(...)`
 * call resolves to an output named after it, and anything else (an
 * arithmetic statement, a conditional, a member call) is named through a
 * note rather than turned into an invented handler. Every purely visual or
 * behavioral property this format carries (hide, deactivate, resizable,
 * align, labelfont, labelsize, color, selection_color, box, and a subtype
 * this reader has no honest translation for) is left opaque and is never
 * named per occurrence; only `Fl_Input`'s `FL_MULTILINE_INPUT` subtype is
 * translated for real, into a textarea, because it is the one case this
 * reader's own vocabulary (a field the port renders one way or another)
 * actually turns on.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isIdent = (s) => /^[A-Za-z_$][\w$]*$/.test(String(s ?? ""));
/** A name FLUID itself already wrote as a valid identifier (a widget's own `custName`, a callback's own `handleOk`)
 * is kept exactly as written, case and all: collapsing it through kebab-case first, the way a name built from a
 * label has to be, would flatten `handleOk` into `handleok`. Only a name that is not already an identifier (a
 * label with spaces, a widget with none at all) is rebuilt from its words. */
function toIdentifier(text) {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (isIdent(s)) return s;
  const words = s.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return "";
  return words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join("");
}

const CONTAINER_CLASSES = new Set(["Fl_Group", "Fl_Pack", "Fl_Tabs", "Fl_Scroll"]);
const isContainerClass = (klass) => /Window$/.test(klass) || CONTAINER_CLASSES.has(klass);

function makeState() {
  const names = new Set();
  const notes = [];
  return {
    fields: [], outputs: new Set(), usesNgFor: false, seq: 1,
    note(text) { if (!notes.includes(text)) notes.push(text); },
    notes,
    unique(base) {
      const stem = base || "field";
      let name = stem; let n = 2;
      while (names.has(name)) name = `${stem}${n++}`;
      names.add(name);
      return name;
    },
  };
}

/** `xywh {x y w h}` read into its four numbers, or null when absent or not that shape. */
function parseXywh(raw) {
  if (raw === undefined) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? { x: parts[0], y: parts[1], w: parts[2], h: parts[3] } : null;
}

/** Top to bottom, left to right by each widget's own `xywh`; a widget with none sorts after every positioned one. */
function byPosition(a, b) {
  const pa = parseXywh(a.props.xywh);
  const pb = parseXywh(b.props.xywh);
  const ay = pa ? pa.y : Infinity;
  const by = pb ? pb.y : Infinity;
  if (ay !== by) return ay - by;
  const ax = pa ? pa.x : Infinity;
  const bx = pb ? pb.x : Infinity;
  return ax - bx;
}

/**
 * Field ids and radio groups settled in one walk before anything renders, so
 * render never has to ask "has this widget's field been named yet". Radio
 * grouping is scoped to one call of `prepare`, which is called once per
 * parent, so `localRadioGroup` resetting between calls is exactly "shared
 * immediate parent" grouping, the same pattern input-qt keeps for a
 * `QButtonGroup`-free run of `QRadioButton`s.
 */
function prepare(node, state) {
  if (!node.children) return;
  let localRadioGroup = null;
  for (const child of node.children) {
    const klass = child.class;
    if (klass === "Fl_Round_Button") {
      if (!localRadioGroup) {
        localRadioGroup = state.unique(toIdentifier(node.name) || toIdentifier(node.props.label) || "choice");
        state.fields.push(localRadioGroup);
      }
      child.field = localRadioGroup;
    } else if (klass === "Fl_Check_Button") {
      child.field = state.unique(toIdentifier(child.name) || `check${state.seq++}`);
      state.fields.push(child.field);
    } else if (klass === "Fl_Input" || klass === "Fl_Choice") {
      child.field = state.unique(toIdentifier(child.name) || `field${state.seq++}`);
      state.fields.push(child.field);
    }
    prepare(child, state);
  }
}

function renderContainer(node, klass, state, depth) {
  const pad = "  ".repeat(depth);
  const lines = [`${pad}<div>`];
  const kids = [...(node.children ?? [])].sort(byPosition);
  for (const child of kids) lines.push(...render(child, state, depth + 1));
  lines.push(`${pad}</div>`);
  return lines;
}

function renderInput(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = node.field;
  const label = node.props.label;
  const lines = [];
  if (label) lines.push(`${pad}<label for="f-${field}">${esc(label)}</label>`);
  if (node.props.type === "FL_MULTILINE_INPUT") {
    lines.push(`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`);
  } else {
    lines.push(`${pad}<input id="f-${field}" type="text" ng-model="${field}">`);
  }
  return lines;
}

function renderCheckbox(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = node.field;
  const label = node.props.label ?? "";
  return [`${pad}<label><input type="checkbox" ng-model="${field}"> ${esc(label)}</label>`];
}

function renderRadio(node, state, depth) {
  const pad = "  ".repeat(depth);
  const group = node.field;
  const label = node.props.label ?? "";
  const value = attrSafe(kebab(label) || node.name || "choice");
  return [`${pad}<label><input type="radio" ng-model="${group}" value="${value}"> ${esc(label)}</label>`];
}

function renderChoice(node, state, depth) {
  const pad = "  ".repeat(depth);
  const field = node.field;
  const items = (node.children ?? []).filter((c) => c.class === "MenuItem");
  const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
  if (items.length) {
    for (const it of items) lines.push(`${pad}  <option>${esc(it.props.label ?? "")}</option>`);
  } else {
    state.usesNgFor = true;
    state.note(`\`${node.name || field}\` declares no inline MenuItem options; they are filled from code at runtime, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
  }
  lines.push(`${pad}</select>`);
  return lines;
}

/** `functionName(...)` at the start of a callback's own text, the one C++ shape this reader resolves to a name; anything
 * else (an arithmetic statement, a member call, a bare block) is left to the caller's note rather than guessed at. */
function callbackHandlerName(callback) {
  const m = /^([A-Za-z_]\w*)\s*\(/.exec(callback.trim());
  return m ? toIdentifier(m[1]) : null;
}

function renderButton(node, state, depth) {
  const pad = "  ".repeat(depth);
  const label = node.props.label ?? "";
  const who = node.name || label || "a button";
  const callback = node.props.callback;
  if (callback === undefined) {
    state.note(`\`${who}\` has no callback wired in the .fl file; it is emitted with no wiring found.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  const handler = callbackHandlerName(callback);
  if (!handler) {
    state.note(`\`${who}\`'s callback exists but is not a recognizable \`functionName(...)\` call shape; it is named here rather than turned into an invented handler.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  state.outputs.add(handler);
  return [`${pad}<button type="button" ng-click="on${pascal(handler)}()">${esc(label)}</button>`];
}

function render(node, state, depth) {
  const klass = node.class;
  if (isContainerClass(klass)) return renderContainer(node, klass, state, depth);
  if (klass === "Fl_Input") return renderInput(node, state, depth);
  if (klass === "Fl_Check_Button") return renderCheckbox(node, state, depth);
  if (klass === "Fl_Round_Button") return renderRadio(node, state, depth);
  if (klass === "Fl_Choice") return renderChoice(node, state, depth);
  if (klass === "Fl_Button" || klass === "Fl_Return_Button" || klass === "Fl_Light_Button") return renderButton(node, state, depth);
  const kids = node.children ?? [];
  state.note(`the widget class \`${klass}\`${node.name ? ` (${node.name})` : ""} is not lowered${kids.length ? `; ${kids.length} child node(s) inside it were not read either` : ""}; it is named here rather than approximated.`);
  return [];
}

/**
 * One root window lowered onto the shared dialect. The window's own `label`
 * is its title, informational the way a Qt Designer `windowTitle` used to
 * become a heading, but FLUID's own convention treats a window's label as
 * chrome, not on-screen prose, so unlike input-qt this reader never turns it
 * into a paragraph inside the body.
 */
export function lowerFluid(rootWindow) {
  const state = makeState();
  prepare(rootWindow, state);
  const lines = [];
  const kids = [...(rootWindow.children ?? [])].sort(byPosition);
  for (const child of kids) lines.push(...render(child, state, 1));
  const template = ["<div>", ...lines, "</div>"].join("\n");
  const label = rootWindow.props.label || rootWindow.name || "Fluid Window";
  const stem = kebab(rootWindow.name || label);
  const className = pascal(stem || "fluid-window");
  return {
    template,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
    title: label,
    className,
    stem,
  };
}
