/**
 * What a screen is made of, read off the IR.
 *
 * Deliberately structural. By the time markup reaches the IR nobody knows which
 * framework wrote it, and the shape of a screen is the same question whether it
 * arrived as Angular, as Vue, or as a page somebody drove in a browser. A
 * recogniser that looked at framework syntax would have to be written once per
 * reader and would answer a narrower question.
 */

const TEXT_INPUT = new Set(["input", "textarea", "select"]);
const SUBMIT_WORDS = /\b(save|create|submit|add|update|send|apply|confirm|continue|next|finish|pay|checkout)\b/i;
const DESTRUCTIVE = /\b(delete|remove|archive|cancel|discard|revoke)\b/i;
const SEARCH_WORDS = /\b(search|filter|query|find|lookup)\b/i;
const STEP_WORDS = /\b(step|stage|wizard|next|back|previous|continue|of\s+\d)\b/i;

const empty = () => ({
  elements: 0, tables: 0, rows: 0, loops: 0, nestedLoops: 0,
  inputs: 0, selects: 0, checkboxes: 0, forms: 0, submits: 0, destructive: 0,
  buttons: 0, links: 0, headings: 0, conditionals: 0, images: 0, charts: 0,
  searchFields: 0, stepMarkers: 0, models: 0, pagination: 0, editors: 0,
  collections: [], texts: [],
});

/** Every literal word in a node, so a control can be recognised by its label. */
function textOf(node) {
  if (!node) return "";
  if (node.kind === "text") return node.parts.map((p) => p.literal ?? "").join(" ");
  return (node.children ?? []).map(textOf).join(" ");
}

const attrValue = (node, name) => {
  const attr = (node.attrs ?? []).find((a) => a.name.toLowerCase() === name);
  return attr?.kind === "static" ? String(attr.value ?? "") : "";
};

export function shapeOf(ir) {
  const facts = empty();
  if (!ir?.root) return facts;

  const visit = (node, loopDepth) => {
    if (!node) return;

    switch (node.kind) {
      case "when":
        facts.conditionals += 1;
        node.children.forEach((c) => visit(c, loopDepth));
        return;

      case "each":
        facts.loops += 1;
        if (loopDepth >= 1) facts.nestedLoops += 1;
        if (node.list && !facts.collections.includes(node.list)) facts.collections.push(node.list);
        node.children.forEach((c) => visit(c, loopDepth + 1));
        return;

      case "text":
        facts.texts.push(textOf(node).trim());
        return;

      case "fragment":
        node.children.forEach((c) => visit(c, loopDepth));
        return;

      case "element": {
        const tag = String(node.tag ?? "").toLowerCase();
        if (tag) facts.elements += 1;

        const label = (textOf(node) + " " + attrValue(node, "placeholder") + " " + attrValue(node, "aria-label") + " " + attrValue(node, "name")).trim();

        if (tag === "table") facts.tables += 1;
        if (tag === "tr") facts.rows += 1;
        if (tag === "form") facts.forms += 1;
        if (tag === "img" || tag === "picture") facts.images += 1;
        if (tag === "canvas" || tag === "svg") facts.charts += 1;
        if (/^h[1-6]$/.test(tag)) facts.headings += 1;
        if (tag === "a") facts.links += 1;

        if (TEXT_INPUT.has(tag)) {
          const type = attrValue(node, "type").toLowerCase();
          if (type === "checkbox" || type === "radio") facts.checkboxes += 1;
          else if (tag === "select") facts.selects += 1;
          else facts.inputs += 1;
          if (SEARCH_WORDS.test(label) || type === "search") facts.searchFields += 1;
        }

        if (tag === "button" || (tag === "input" && /^(submit|button)$/.test(attrValue(node, "type")))) {
          facts.buttons += 1;
          if (SUBMIT_WORDS.test(label)) facts.submits += 1;
          if (DESTRUCTIVE.test(label)) facts.destructive += 1;
        }

        if (attrValue(node, "contenteditable") || (node.attrs ?? []).some((a) => a.name === "contenteditable" && a.kind === "flag")) facts.editors += 1;
        if (tag === "textarea" && Number(attrValue(node, "rows") || 0) >= 5) facts.editors += 1;

        if (STEP_WORDS.test(label)) facts.stepMarkers += 1;
        if (/\b(page|next|previous|prev|showing\s+\d|per\s+page)\b/i.test(label)) facts.pagination += 1;
        if (node.model) facts.models += 1;

        node.children.forEach((c) => visit(c, loopDepth));
        return;
      }

      default:
        return;
    }
  };

  visit(ir.root, 0);
  return facts;
}

/** Add two shapes, so a whole app can be described the way one screen is. */
export function mergeShapes(shapes) {
  const total = empty();
  for (const s of shapes) {
    for (const [k, v] of Object.entries(s)) {
      if (Array.isArray(v)) total[k] = [...new Set([...total[k], ...v])];
      else total[k] += v;
    }
  }
  return total;
}
