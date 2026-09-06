import { VOID_ELEMENTS } from "../dsp-ir/markup.js";
import { attrSafe } from "../dsp-ir/text.js";
import { bareAttr, isTapestryTag, parseMarkup, plainAttrs, tAttr } from "./parse.js";

/**
 * What a Tapestry `.tml` template means, once parse.js has handed it over as
 * plain elements and text. Tapestry's whole design is that a designer can
 * open the file and read it as HTML, because that is almost all it is: a
 * `<div>`, a `<h1>`, a `<label>` with no `t:` attribute and no `t:` namespaced
 * tag name carries no Tapestry meaning at all and passes through unchanged.
 * Only what actually names a `t:type`, wears the `t:` namespace as its own
 * tag, or holds a `${...}` expression is translated, onto the same
 * AngularJS attribute dialect every other reader in this tool targets:
 * `t:type="textfield"`/`"passwordfield"` becomes `ng-model`, `t:type="checkbox"`
 * (attribute or the `<t:checkbox>` element form) becomes a real checkbox
 * input with `ng-model`, `<t:if test="...">` becomes the dialect's own
 * `ng-if` wrapper the way `{% if %}` already does in input-jinja and
 * input-twig, and `<t:loop source="..." value="...">` becomes the dialect's
 * own `ng-repeat` wrapper the same way `{% for %}` does there. A `${x.y}`
 * bare property reference becomes `{{ x.y }}`; anything with a method call
 * or an operator inside `${...}` is a computed expression this reader does
 * not evaluate, the same restraint input-jasperreports keeps over a textField
 * expression beyond a bare `$F{}`/`$P{}`/`$V{}` reference.
 *
 * Two things Tapestry hides in Java code stay honest gaps rather than
 * guesses: a `t:model` names a `SelectModel` this reader cannot see, so a
 * select's options are named as a gap the port must be handed, the way
 * input-qt and input-glade already name an unresolved combo box; and a
 * submit button's click handler is matched in Java by naming convention
 * (`onSuccess()`, `onActionFromXxx()`), never written in the template, so no
 * `ng-click` is invented for one. A `t:type` this reader does not recognise
 * (Tapestry ships dozens: grid, pagelink, actionlink, zone, beaneditform and
 * more) is named through `note` rather than approximated, its own `t:`
 * attributes removed since they carry no meaning this reader can act on;
 * an unrecognised `t:` namespaced element is likewise named and its wrapper
 * dropped, its children kept, since inventing what it renders would be a
 * guess this tool never makes.
 */

/** A bare `${x.y}` property path and nothing else: no call, no operator. */
const BARE_PROPERTY = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** Every `${...}` in a run of text: a bare property becomes `{{ }}`, anything computed is named and rendered empty. */
function lowerText(text, note) {
  return String(text).replace(/\$\{([^{}]*)\}/g, (whole, inner) => {
    const expr = inner.trim();
    if (BARE_PROPERTY.test(expr)) return `{{ ${expr} }}`;
    note(`\`\${${expr}}\` is more than a bare property reference; this reader does not evaluate a computed expression, so it was rendered as an empty placeholder rather than any part of it.`);
    return "";
  });
}

/** name="value" pairs (or a bare boolean name) rendered in the order given, expression values quote safe. */
function renderAttrs(pairs) {
  return pairs.map(([name, value]) => (value === null ? name : `${name}="${attrSafe(value)}"`)).join(" ");
}

function openTag(tag, pairs, selfClose) {
  const attrText = renderAttrs(pairs);
  return `<${tag}${attrText ? ` ${attrText}` : ""}${selfClose ? " /" : ""}>`;
}

/** The `id`/`value` (and any plain, non `t:` attributes) a lowered field input carries. */
function fieldAttrs(el, extra = {}, note = () => {}) {
  const pairs = plainAttrs(el).filter((a) => a.name.toLowerCase() !== "id").map((a) => [a.name, a.value === null ? null : lowerText(a.value, note)]);
  const id = tAttr(el, "id");
  const out = [];
  if (id) out.push(["id", id]);
  out.push(...pairs);
  for (const [name, value] of Object.entries(extra)) out.push([name, value]);
  return out;
}

/** `t:type="textfield"` or `"passwordfield"`, on any element: a real text or password input with `ng-model`. */
function lowerTextField(el, kind, note) {
  const value = tAttr(el, "value");
  const extra = { type: kind === "passwordfield" ? "password" : "text" };
  if (value) extra["ng-model"] = value;
  else note(`\`t:type="${kind}"\`${tAttr(el, "id") ? ` on \`${tAttr(el, "id")}\`` : ""} has no \`t:value\`, so the property it binds to is not named; no \`ng-model\` was added.`);
  return openTag("input", fieldAttrs(el, extra, note), true);
}

/** `t:type="checkbox"` or the `<t:checkbox>` element form: a real checkbox input with `ng-model`. */
function lowerCheckbox(el, note) {
  const value = tAttr(el, "value");
  const extra = { type: "checkbox" };
  if (value) extra["ng-model"] = value;
  else note(`\`t:checkbox\`${tAttr(el, "id") ? ` \`${tAttr(el, "id")}\`` : ""} has no \`t:value\`, so the property it binds to is not named; no \`ng-model\` was added.`);
  return openTag("input", fieldAttrs(el, extra, note), true);
}

/** `t:type="select"` with its `t:model`: the model is a SelectModel built in Java this reader cannot see, so its
 * options are named as a gap the port must be handed, the way input-qt and input-glade already name an unresolved
 * combo box rather than guess at rows they cannot read. */
function lowerSelect(el, note) {
  const value = tAttr(el, "value");
  const model = tAttr(el, "model");
  const field = value || tAttr(el, "id") || "select";
  if (model) note(`\`t:model="${model}"\` names a SelectModel object built in Java code this reader cannot see, so the port takes its options as \`${field}Options\`, which it must be handed.`);
  else note(`\`t:type="select"\`${tAttr(el, "id") ? ` on \`${tAttr(el, "id")}\`` : ""} has no \`t:model\`, so this reader cannot say where its options come from; the port takes them as \`${field}Options\`, which it must be handed.`);
  const extra = {};
  if (value) extra["ng-model"] = value;
  const open = openTag("select", fieldAttrs(el, extra, note), false);
  return `${open}<option ng-repeat="option in ${field}Options">{{ option }}</option></select>`;
}

/** `t:type="submit"`: a literal caption is read from `literal:...`; a bound one this reader cannot evaluate is named
 * and left out rather than guessed. Tapestry wires no click handler in the template at all, matching the button by
 * naming convention in the Java class instead, so `ng-click` is never invented for it; that gap is named once per
 * button rather than once per run, since it is a fact about that button. */
function lowerSubmit(el, note) {
  const value = tAttr(el, "value");
  const id = tAttr(el, "id");
  const extra = { type: "submit" };
  if (value !== null) {
    const literal = /^literal:/.exec(value);
    if (literal) extra.value = value.slice(literal[0].length);
    else note(`\`t:value="${value}"\` on a submit button names a caption bound to a property this reader cannot evaluate; the caption was left out rather than guessed.`);
  }
  note(`The submit button${id ? ` \`${id}\`` : ""}'s click handler is matched by naming convention in the Java class (\`onSuccess()\` or \`onActionFrom${id ? id[0].toUpperCase() + id.slice(1) : "..."}()\`), never written in the template; no \`ng-click\` was invented for it.`);
  return openTag("input", fieldAttrs(el, extra, note), true);
}

const FIELD_VOCAB = { textfield: "textfield", passwordfield: "passwordfield" };

export function lowerTapestry(source, note = () => {}) {
  const root = parseMarkup(String(source ?? ""));
  return lowerNodes(root.children, note);
}

function lowerNodes(nodes, note) {
  return nodes.map((n) => lowerNode(n, note)).join("");
}

function lowerNode(n, note) {
  if (n.type === "text") return lowerText(n.text, note);
  if (n.type !== "el") return "";
  return lowerEl(n, note);
}

function lowerEl(el, note) {
  if (el.tag === "t:if") return lowerIf(el, note);
  if (el.tag === "t:loop") return lowerLoop(el, note);
  if (el.tag === "t:parameter") return lowerParameter(el, note);
  if (el.tag === "t:checkbox") return lowerCheckbox(el, note);

  if (isTapestryTag(el.tag)) {
    note(`\`<${el.tag}>\` has no vocabulary entry in this reader; it is named rather than approximated, and its wrapper was dropped so its content is kept without inventing what the component itself would have rendered.`);
    return lowerNodes(el.children, note);
  }

  const type = tAttr(el, "type");
  if (type) {
    if (FIELD_VOCAB[type]) return lowerTextField(el, type, note);
    if (type === "checkbox") return lowerCheckbox(el, note);
    if (type === "select") return lowerSelect(el, note);
    if (type === "submit") return lowerSubmit(el, note);
    note(`\`t:type="${type}"\` has no vocabulary entry in this reader; it is named rather than approximated, and its \`t:\` attributes were removed since they carry no meaning without it.`);
    return renderPlain(el, note);
  }

  const hasOtherT = (el.attrs ?? []).some((a) => /^t:/i.test(a.name));
  if (hasOtherT) {
    note(`\`<${el.tag}>\`${tAttr(el, "id") ? ` \`${tAttr(el, "id")}\`` : ""} carries Tapestry attributes with no \`t:type\` this reader recognises; they were removed since they carry no meaning without it.`);
  }
  return renderPlain(el, note);
}

/** An element with no vocabulary entry, plain or otherwise: its own tag and non `t:` attributes stand, its children
 * are lowered in turn, exactly what "pass through unchanged" means for anything with real content beneath it. */
function renderPlain(el, note) {
  const pairs = plainAttrs(el).map((a) => [a.name, a.value === null ? null : lowerText(a.value, note)]);
  const body = lowerNodes(el.children, note);
  if (VOID_ELEMENTS.has(el.tag)) return openTag(el.tag, pairs, true);
  return `${openTag(el.tag, pairs, false)}${body}</${el.tag}>`;
}

/** `<t:if test="...">...</t:if>`, wrapped the same way input-jinja and input-twig already wrap a `{% if %}` block:
 * an `ng-container` carrying `ng-if`, because an element cannot itself gain a condition when there is no host
 * element here to put it on, only whatever markup the block holds. */
function lowerIf(el, note) {
  const test = bareAttr(el, "test");
  const body = lowerNodes(el.children, note);
  if (!test) { note("A `<t:if>` block had no `test` attribute; its contents were kept unconditionally rather than guessing what governs them."); return body; }
  return `<ng-container ng-if="${attrSafe(test)}">${body}</ng-container>`;
}

/** `<t:loop source="..." value="...">...</t:loop>`, wrapped the same way input-jinja and input-twig already wrap a
 * `{% for %}` block: an `ng-container` carrying `ng-repeat`. */
function lowerLoop(el, note) {
  const source = bareAttr(el, "source");
  const value = bareAttr(el, "value");
  const body = lowerNodes(el.children, note);
  if (!source || !value) { note("A `<t:loop>` block was missing its `source` or `value` attribute; its contents were kept once, unrepeated, rather than guessing the loop."); return body; }
  return `<ng-container ng-repeat="${attrSafe(`${value} in ${source}`)}">${body}</ng-container>`;
}

/** `<t:parameter name="...">...</t:parameter>`: real structure a Zone or a Border composes by name, not markup a
 * client component can express, so its content is kept in document order and the placement itself, which the block's
 * name records, is named for a person porting the page to see rather than silently flattened away. */
function lowerParameter(el, note) {
  const name = bareAttr(el, "name");
  note(`A \`<t:parameter name="${name ?? "?"}">\` block holds this content for the component around it (a Zone or a Border, typically) to place by name; the port keeps the content in order, and that placement is Tapestry specific information a person porting the page should see.`);
  return lowerNodes(el.children, note);
}
