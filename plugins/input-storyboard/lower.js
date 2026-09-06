import { pascal } from "../dsp-ir/emit.js";
import { attrOf } from "../dsp-ir/markup.js";
import {
  attrText, connectionsOf, rootViewOf, segmentsOf, stateTitle, subviewsOf,
  topLevelViewOf, viewControllerOf,
} from "./parse.js";

/**
 * What an Interface Builder widget tree means, once parse.js has handed it
 * over as plain elements. A scene's own `<view>` is a real component
 * boundary somebody drew with Interface Builder, so this reader produces a
 * screen the way input-qt and input-glade already do from their own form
 * designers, laid out in the document order `<subviews>` already recorded.
 * A button's `<connections><action eventType="touchUpInside">` is the same
 * event wiring every other reader already names a handler for. What has no
 * honest equivalent, a control this reader does not recognise, a segmented
 * control filled from code, a button with no touchUpInside action wired, is
 * named through the caller's `note` rather than approximated.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kebab = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** camelCase's own word boundaries made explicit before kebab lowercases them away: an Objective-C/Swift
 * selector like `loginButtonTapped` carries no separator of its own, only the capital letters do. */
const splitCamel = (text) => String(text ?? "").replace(/([a-z0-9])([A-Z])/g, "$1-$2");
const camel = (text) => {
  const p = pascal(kebab(splitCamel(text)));
  return p ? p.charAt(0).toLowerCase() + p.slice(1) : "";
};
/** A name the emitted JavaScript can declare: a caption that spells a reserved word gets a suffix. Not shared with
 * the other readers' copies of this table: each keeps its own, since the naming choices differ reader to reader. */
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await async arguments eval undefined NaN Infinity".split(" "));
const declarable = (id) => (RESERVED.has(id) ? `${id}Field` : id);

// The shared markup reader lowercases every tag it reads (parseMarkup has no idea this dialect's own tags are
// camelCase), so every tag compared here is spelled lowercase: `textfield`, never `textField`. An attribute's
// value is untouched, which is why `customClass` keeps its real casing even though the tag around it does not.
const BOX = new Set(["view", "stackview", "scrollview"]);
const FIELD_LIKE = new Set(["textfield", "textview", "switch", "segmentedcontrol"]);

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
 * A `switch` has no caption of its own in Interface Builder; the nearest
 * `<label>` sibling immediately before or after it, when there is one and it
 * is not already spoken for, is read as that switch's caption and left out
 * of the tree as a label in its own right. A switch with no such neighbour
 * renders with no caption, because inventing one would be a guess. Mutates
 * the siblings in place (`_captionEl`, `_consumed`), the same restraint
 * input-qt's own `.field` and `.buttonGroup` bookkeeping already keeps.
 */
function linkSwitchCaptions(children) {
  children.forEach((el, i) => {
    if (el.tag !== "switch" || el._captionEl) return;
    const next = children[i + 1];
    const prev = children[i - 1];
    const cap = (next && next.tag === "label" && !next._consumed) ? next
      : (prev && prev.tag === "label" && !prev._consumed) ? prev : null;
    if (cap) { cap._consumed = true; el._captionEl = cap; }
  });
}

/**
 * Field names are settled before anything renders, in one walk over the
 * whole tree, so a control met in any order resolves to the same name.
 */
function prepare(children, state) {
  linkSwitchCaptions(children);
  for (const child of children) {
    if (FIELD_LIKE.has(child.tag)) {
      const id = attrOf(child, "id");
      const fallback = child.tag === "segmentedcontrol" ? `select${state.seq++}` : child.tag === "switch" ? `check${state.seq++}` : `field${state.seq++}`;
      child.field = state.unique(declarable(id || fallback));
      state.fields.push(child.field);
    }
    prepare(subviewsOf(child), state);
  }
}

function renderBox(el, state, depth) {
  const pad = "  ".repeat(depth);
  const lines = [`${pad}<div>`];
  for (const child of subviewsOf(el)) lines.push(...render(child, state, depth + 1));
  lines.push(`${pad}</div>`);
  return lines;
}

function renderLabel(el, depth) {
  const pad = "  ".repeat(depth);
  const text = attrText(el, "text") || "";
  return text ? [`${pad}<p>${esc(text)}</p>`] : [];
}

function renderInput(el, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  const type = attrOf(el, "secureTextEntry") === "YES" ? "password" : "text";
  return [`${pad}<input id="f-${field}" type="${type}" ng-model="${field}">`];
}

function renderTextarea(el, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  return [`${pad}<textarea id="f-${field}" ng-model="${field}"></textarea>`];
}

function renderSwitch(el, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  if (el._captionEl) {
    const text = attrText(el._captionEl, "text") || "";
    return [`${pad}<label><input id="f-${field}" type="checkbox" ng-model="${field}"> ${esc(text)}</label>`];
  }
  return [`${pad}<input id="f-${field}" type="checkbox" ng-model="${field}">`];
}

function renderSelect(el, state, depth) {
  const pad = "  ".repeat(depth);
  const field = el.field;
  const segments = segmentsOf(el);
  const lines = [`${pad}<select id="f-${field}" ng-model="${field}">`];
  if (segments.length) {
    for (const seg of segments) lines.push(`${pad}  <option>${esc(attrText(seg, "title") || "")}</option>`);
  } else {
    state.usesNgFor = true;
    state.note(`\`${field}\` declares no inline segments; they are populated from code at runtime, so the port takes them as \`${field}Options\`, which it must be handed.`);
    lines.push(`${pad}  <option ng-repeat="option in ${field}Options">{{ option }}</option>`);
  }
  lines.push(`${pad}</select>`);
  return lines;
}

function renderButton(el, state, depth) {
  const pad = "  ".repeat(depth);
  const id = attrOf(el, "id") || "";
  const label = stateTitle(el, "normal") || id || "";
  const actions = connectionsOf(el, "action");
  const touchUp = actions.find((a) => attrOf(a, "eventType") === "touchUpInside");
  if (!touchUp) {
    if (actions.length) state.note(`\`${id || label}\`'s action is wired to \`${attrOf(actions[0], "eventType") || "an unstated event"}\`, not touchUpInside; it is emitted with no click wiring found.`);
    else state.note(`\`${id || label}\` has no action connection wired; it is emitted with no wiring found.`);
    return [`${pad}<button type="button">${esc(label)}</button>`];
  }
  const selector = attrOf(touchUp, "selector") || "";
  const event = camel(selector.replace(/:/g, "")) || "click";
  state.outputs.add(event);
  return [`${pad}<button type="button" ng-click="on${pascal(event)}()">${esc(label)}</button>`];
}

function renderImage(el, state) {
  const id = attrOf(el, "id") || "an image view";
  state.note(`\`${id}\` is an image view; its image source was named as existing and not rendered.`);
  return [];
}

function renderTable(el, tag, state, depth) {
  const pad = "  ".repeat(depth);
  const id = attrOf(el, "id") || `a ${tag}`;
  state.note(`\`${id}\` is a \`${tag}\`; the port has a header only structural placeholder and rows the code must supply.`);
  return [`${pad}<table></table>`];
}

function render(el, state, depth) {
  if (el._consumed) return [];
  const tag = el.tag;
  if (BOX.has(tag)) return renderBox(el, state, depth);
  if (tag === "label") return renderLabel(el, depth);
  if (tag === "textfield") return renderInput(el, depth);
  if (tag === "textview") return renderTextarea(el, depth);
  if (tag === "switch") return renderSwitch(el, depth);
  if (tag === "segmentedcontrol") return renderSelect(el, state, depth);
  if (tag === "button") return renderButton(el, state, depth);
  if (tag === "imageview") return renderImage(el, state);
  if (tag === "tableview" || tag === "collectionview") return renderTable(el, tag, state, depth);
  const kids = subviewsOf(el);
  const id = attrOf(el, "id") || "";
  const customClass = attrOf(el, "customClass");
  state.note(`the element \`<${tag}>\`${customClass ? ` (customClass \`${customClass}\`)` : ""}${id ? ` (${id})` : ""} is not lowered${kids.length ? `; ${kids.length} child widget(s) inside it were not read either` : ""}; it is named here rather than approximated.`);
  return [];
}

/**
 * One scene lowered onto the shared dialect: `objectsEl` is the `<objects>`
 * element `scenesOf` found for it, whether a `.storyboard`'s own `<scene>`
 * or a `.xib`'s bare document root. `sceneId` is the `.storyboard`'s own
 * `sceneID`, or null for the xib shape, and stands in for a class name when
 * the view controller declares none. `rel` and `note` are only used in
 * notes that need to say where a structural problem was found.
 */
export function lowerScene(objectsEl, sceneId, rel, note = () => {}) {
  const vc = viewControllerOf(objectsEl);
  const root = vc ? rootViewOf(vc) : topLevelViewOf(objectsEl);
  if (!root) { note(`${rel}${sceneId ? ` scene ${sceneId}` : ""}: no view found; nothing was read.`); return null; }

  const className = (vc && attrOf(vc, "customClass")) || sceneId || attrOf(root, "id") || "Screen";
  const state = makeState();
  const kids = subviewsOf(root);
  prepare(kids, state);
  const lines = [];
  for (const child of kids) lines.push(...render(child, state, 1));
  const template = ["<div>", ...lines, "</div>"].join("\n");
  return {
    template,
    fields: state.fields,
    outputs: [...state.outputs].sort(),
    notes: state.notes,
    usesNgFor: state.usesNgFor,
    usesTwoWay: state.fields.length > 0,
    title: className,
    className,
    vcId: vc ? attrOf(vc, "id") : null,
    sceneId,
  };
}
