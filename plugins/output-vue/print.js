import { buildIr } from "../dsp-ir/ir.js";
import { jsString, singleQuoted } from "../dsp-ir/emit.js";

/**
 * The Vue printer, and the third target.
 *
 * The first target proves nothing, the second proves the IR is possible, and
 * the third proves it is cheap. This file adds Vue to a tool whose reader was
 * written for Angular without touching the reader, the endpoint map, the token
 * extractor or the IR.
 *
 * The awkward part of printing Vue is that every expression is carried inside a
 * double quoted attribute, so the printer has to keep the quoting straight.
 */

const pad = (depth) => "  ".repeat(depth);
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * An expression lives inside `attr="..."`, so a double quote in it would close
 * the attribute early. Escaping is only reached when one is actually present,
 * which keeps the common output readable and the uncommon output correct.
 */
const attrValue = (code) =>
  /["&]/.test(code) ? code.replace(/&/g, "&amp;").replace(/"/g, "&quot;") : code;

/**
 * A key in an object literal that is not a plain identifier has to be quoted,
 * and it has to be quoted with single quotes for the same reason.
 */
const key = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : singleQuoted(name));

const bind = (name, code) => `:${name}="${attrValue(code)}"`;

function classAttribute(classes, out) {
  const literal = classes.filter((c) => c.kind === "literal").map((c) => c.value).join(" ").trim();
  const expressions = classes.filter((c) => c.kind === "expression");
  const conditionals = classes.filter((c) => c.kind === "conditional");

  if (literal) out.push(`class="${literal}"`);
  if (!expressions.length && !conditionals.length) return;

  // Vue takes an object for the conditional case, which is what the IR already
  // holds, so this is the one target where nothing has to be reassembled.
  const object = conditionals.length
    ? `{ ${conditionals.map((c) => `${key(c.name)}: ${c.when}`).join(", ")} }`
    : null;
  const parts = [...expressions.map((e) => e.expression), ...(object ? [object] : [])];
  out.push(bind("class", parts.length === 1 ? parts[0] : `[${parts.join(", ")}]`));
}

function styleAttribute(styles, out) {
  if (!styles.length) return;
  const spreads = styles.filter((s) => s.kind === "spread");
  const declarations = styles.filter((s) => s.kind !== "spread");

  if (!spreads.length && declarations.every((s) => s.literal !== undefined)) {
    out.push(`style="${declarations.map((s) => `${kebab(s.property)}: ${s.literal}`).join("; ")}"`);
    return;
  }

  const entries = declarations.map((s) => {
    const value = s.literal !== undefined
      ? singleQuoted(s.literal)
      : s.unit
        ? `\`\${${s.expression}}${s.unit}\``
        : s.expression;
    return `${key(kebab(s.property))}: ${value}`;
  });
  const parts = [...spreads.map((s) => s.expression), ...(entries.length ? [`{ ${entries.join(", ")} }`] : [])];
  out.push(bind("style", parts.length === 1 ? parts[0] : `[${parts.join(", ")}]`));
}

function attributes(node) {
  const out = [];
  classAttribute(node.classes, out);

  for (const attr of node.attrs) {
    if (attr.name === "key") continue;
    if (attr.kind === "flag") out.push(attr.name);
    else if (attr.kind === "static") out.push(`${attr.name}="${attrValue(attr.value ?? "")}"`);
    else if (attr.kind === "bound") out.push(bind(attr.name, attr.expression));
    else if (attr.kind === "template") {
      const body = attr.parts.map((p) => (p.expression !== undefined ? `{{ ${p.expression} }}` : p.literal)).join("");
      out.push(`${attr.name}="${attrValue(body)}"`);
    }
  }

  // The modifiers ride back out: .trim and .number are behaviour, and this
  // is the one target that can keep their exact spelling.
  if (node.model) {
    const mods = (node.modelModifiers ?? []).map((m) => `.${m}`).join("");
    out.push(`v-model${mods}="${attrValue(node.model)}"`);
  }
  for (const event of node.events) {
    // `$event` is the name Vue gives the argument, and the IR normalised it to
    // `event` on the way in, so it is spelled back on the way out. Modifiers
    // ride the event name natively; Vue is the one target that keeps them all.
    const mods = event.modifiers?.length ? `.${event.modifiers.join(".")}` : "";
    out.push(`@${event.name}${mods}="${attrValue(event.handler.replace(/\bevent\b/g, "$event"))}"`);
  }
  styleAttribute(node.styles, out);
  return out;
}

function print(node, depth) {
  if (!node) return "";
  const indent = pad(depth);

  switch (node.kind) {
    case "comment":
      return `${indent}<!--${node.text}-->`;

    case "text": {
      const body = node.parts
        .map((p) => (p.expression !== undefined ? `{{ ${p.expression} }}` : p.literal.replace(/\s+/g, " ")))
        .join("")
        .trim();
      return body ? indent + body : "";
    }

    case "slot": {
      const name = node.name ? ` name="${attrValue(node.name)}"` : "";
      const fallback = (node.children ?? []).map((c) => print(c, depth + 1)).filter(Boolean);
      if (!fallback.length) return `${indent}<slot${name} />`;
      return [`${indent}<slot${name}>`, ...fallback, `${indent}</slot>`].join("\n");
    }

    case "html":
      return `${indent}<div v-html="${attrValue(node.expression)}"></div>`;

    case "fragment":
      return node.children.map((c) => print(c, depth)).filter(Boolean).join("\n");

    // A condition and a loop are attributes in Vue, not blocks, so they are
    // pushed onto the element underneath rather than wrapped around it.
    case "when":
      return node.children.map((c) => print(withDirective(c, `v-if="${attrValue(node.test)}"`), depth)).filter(Boolean).join("\n");

    case "each": {
      const head = node.index ? `(${node.item}, ${node.index})` : node.item;
      // Vue iterates an object natively; the pair form keeps the key name.
      const source = node.object ? `(${node.item}, ${node.index}) in ${node.list}` : `${head} in ${node.list}`;
      const directive = `v-for="${attrValue(source)}" ${bind("key", node.object ? node.index : node.key)}`;
      return node.children.map((c) => print(withDirective(c, directive), depth)).filter(Boolean).join("\n");
    }

    case "element": {
      const tag = node.tag ?? "template";
      const props = [...(node.directives ?? []), ...attributes(node)];
      const open = `<${tag}${props.length ? " " + props.join(" ") : ""}`;
      const children = node.children.map((c) => print(c, depth + 1)).filter(Boolean);
      if (node.void) return `${indent}${open} />`;
      if (!children.length) return `${indent}${open}></${tag}>`;
      return [`${indent}${open}>`, ...children, `${indent}</${tag}>`].join("\n");
    }

    default:
      return "";
  }
}

/**
 * A structural directive has to land on a real tag. A node that has none, or
 * that already carries a directive of the same kind, gets a `<template>`
 * wrapper, which is the element Vue provides for exactly this.
 */
function withDirective(node, directive) {
  if (!node || node.kind !== "element" || !node.tag || (node.directives ?? []).length) {
    return { kind: "element", tag: "template", void: false, directives: [directive], attrs: [], classes: [], styles: [], events: [], model: null, children: [node].filter(Boolean) };
  }
  return { ...node, directives: [directive] };
}

export function toVue(html, { dialect } = {}) {
  const ir = buildIr(html, { dialect });
  return { markup: print(ir.root, 2) || "    <!-- nothing to render -->", ...ir };
}
