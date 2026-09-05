import { boundHtml, buildIr } from "../dsp-ir/ir.js";
import { VOID } from "../dsp-ir/parse.js";
import { singleQuoted } from "../dsp-ir/emit.js";
import { attrSafe } from "../dsp-ir/text.js";

/**
 * The Angular printer, which closes a loop: portamp reads the old Angular
 * dialect and the block syntax, and this emits the block syntax back out. An
 * AngularJS controller from 2013 comes out the far end as a standalone
 * component saying @for, having passed through a middle that knew neither.
 *
 * Same double quoted attribute rules as the Vue printer; expressions that
 * carry a double quote get it swapped for the single the template language
 * treats identically.
 */

const pad = (depth) => "  ".repeat(depth);

function classAttribute(classes, out) {
  const literal = classes.filter((c) => c.kind === "literal").map((c) => c.value).join(" ").trim();
  if (literal) out.push(`class="${literal}"`);
  for (const c of classes.filter((c) => c.kind === "conditional")) out.push(`[class.${c.name}]="${attrSafe(c.when)}"`);
  for (const c of classes.filter((c) => c.kind === "expression")) out.push(`[ngClass]="${attrSafe(c.expression)}"`);
}

function styleAttribute(styles, out) {
  for (const s of styles) {
    if (s.kind === "spread") out.push(`[ngStyle]="${attrSafe(s.expression)}"`);
    else if (s.literal !== undefined) out.push(`[style.${s.property}]="${singleQuoted(s.literal)}"`);
    else out.push(`[style.${s.property}${s.unit ? "." + s.unit : ""}]="${attrSafe(s.expression)}"`);
  }
}

function attributes(node) {
  const out = [];
  classAttribute(node.classes, out);
  for (const attr of node.attrs) {
    if (attr.name === "key") continue;
    if (attr.kind === "flag") out.push(attr.name);
    else if (attr.kind === "static") out.push(`${attr.name}="${String(attr.value ?? "").replace(/"/g, "&quot;")}"`);
    else if (attr.kind === "bound") out.push(`[${attr.name}]="${attrSafe(attr.expression)}"`);
    else if (attr.kind === "template") {
      out.push(`${attr.name}="${attr.parts.map((p) => (p.expression !== undefined ? `{{ ${attrSafe(p.expression)} }}` : p.literal)).join("")}"`);
    }
  }
  if (node.model) out.push(`[(ngModel)]="${attrSafe(node.model)}"`);
  for (const event of node.events) {
    // Angular spells key filters on the event name and has statements but no
    // blocks, so prevent and stop become leading statements on $event.
    const mods = event.modifiers ?? [];
    const key = mods.find((m) => /^(enter|esc|escape|tab|space|delete|arrowup|arrowdown|arrowleft|arrowright|up|down|left|right)$/.test(m) && /^key/.test(event.name));
    const name = key ? `${event.name}.${key.replace(/^(up|down|left|right)$/, "arrow$1")}` : event.name;
    const lead = [
      ...(mods.includes("prevent") ? ["$event.preventDefault(); "] : []),
      ...(mods.includes("stop") ? ["$event.stopPropagation(); "] : []),
    ].join("");
    out.push(`(${name})="${attrSafe(lead + event.handler.replace(/\bevent\b/g, "$event"))}"`);
  }
  styleAttribute(node.styles, out);
  return out;
}

function print(node, depth) {
  if (!node) return "";
  const indent = pad(depth);
  switch (node.kind) {
    case "comment": return `${indent}<!--${node.text}-->`;
    case "text": {
      const body = node.parts.map((p) => (p.expression !== undefined ? `{{ ${p.expression} }}` : p.literal.replace(/\s+/g, " "))).join("").trim();
      return body ? indent + body : "";
    }
    case "slot": {
      // Fallback content inside ng-content is native from Angular 18.
      const select = node.name ? ` select="[${node.name}]"` : "";
      const fallback = (node.children ?? []).map((c) => print(c, depth + 1)).filter(Boolean);
      if (!fallback.length) return `${indent}<ng-content${select} />`;
      return [`${indent}<ng-content${select}>`, ...fallback, `${indent}</ng-content>`].join("\n");
    }
    case "html": return `${indent}<div [innerHTML]="${attrSafe(node.expression)}"></div>`;
    case "fragment": return node.children.map((c) => print(c, depth)).filter(Boolean).join("\n");
    case "when": {
      const inner = node.children.map((c) => print(c, depth + 1)).filter(Boolean).join("\n");
      return `${indent}@if (${node.test}) {\n${inner}\n${indent}}`;
    }
    case "each": {
      const inner = node.children.map((c) => print(c, depth + 1)).filter(Boolean).join("\n");
      // Angular iterates entries through the keyvalue pipe; the pair comes
      // back as {key, value}, so the original names are rebound to it.
      if (node.object) {
        return `${indent}@for (entry of ${node.list} | keyvalue; track entry.key) {\n${indent}  @let ${node.index} = entry.key;\n${indent}  @let ${node.item} = entry.value;\n${inner}\n${indent}}`;
      }
      return `${indent}@for (${node.item} of ${node.list}; track ${node.key}) {\n${inner}\n${indent}}`;
    }
    case "element": {
      if (!node.tag) return node.children.map((c) => print(c, depth)).filter(Boolean).join("\n");
      const props = attributes(node);
      const html = boundHtml(node);
      if (html) props.push(`[innerHTML]="${attrSafe(html.expression)}"`);
      const open = `<${node.tag}${props.length ? " " + props.join(" ") : ""}`;
      if (VOID.has(node.tag.toLowerCase())) return `${indent}${open} />`;
      const children = html ? [] : node.children.map((c) => print(c, depth + 1)).filter(Boolean);
      if (!children.length) return `${indent}${open}></${node.tag}>`;
      return [`${indent}${open}>`, ...children, `${indent}</${node.tag}>`].join("\n");
    }
    default: return "";
  }
}

export function toAngular(html, { dialect } = {}) {
  const ir = buildIr(html, { dialect });
  return { markup: print(ir.root, 2) || "    <!-- nothing to render -->", ...ir };
}
