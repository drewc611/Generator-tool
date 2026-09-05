import { buildIr } from "../dsp-ir/ir.js";
import { jsString, guardHandler } from "../dsp-ir/emit.js";

/**
 * The Svelte printer. It is the argument for the IR: this file is under two
 * hundred lines and it accepts Angular and Vue equally, because by the time
 * markup reaches here neither of them exists any more.
 */

const pad = (depth) => "  ".repeat(depth);
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const setterFor = (target) => target.split(".").pop().replace(/[^\w$]/g, "");

function classAttribute(classes, out) {
  const literal = classes.filter((c) => c.kind === "literal").map((c) => c.value).join(" ").trim();
  const expressions = classes.filter((c) => c.kind === "expression");
  const conditionals = classes.filter((c) => c.kind === "conditional");

  if (literal && !expressions.length) out.push(`class="${literal}"`);
  else if (literal || expressions.length) {
    const parts = [...(literal ? [jsString(literal)] : []), ...expressions.map((e) => e.expression)];
    out.push(`class={[${parts.join(", ")}].filter(Boolean).join(" ")}`);
  }
  // Svelte has a directive for exactly this, which is better than joining a
  // string and is the reason a per target printer beats a shared one.
  for (const c of conditionals) out.push(`class:${c.name}={${c.when}}`);
}

function styleAttribute(styles, out) {
  if (!styles.length) return;
  const spreads = styles.filter((s) => s.kind === "spread");
  const declarations = styles.filter((s) => s.kind !== "spread");
  if (!spreads.length) {
    const body = declarations
      .map((s) => `${kebab(s.property)}: ${s.literal !== undefined ? s.literal : `{${s.expression}}${s.unit ?? ""}`}`)
      .join("; ");
    out.push(`style="${body}"`);
    return;
  }
  const parts = [
    ...spreads.map((s) => `...${s.expression}`),
    ...declarations.map((s) => `${camel(s.property)}: ${s.literal !== undefined ? jsString(s.literal) : s.expression}`),
  ];
  out.push(`style={Object.entries({ ${parts.join(", ")} }).map(([k, v]) => \`\${k}:\${v}\`).join(";")}`);
}

function attributes(node) {
  const out = [];
  classAttribute(node.classes, out);

  for (const attr of node.attrs) {
    if (attr.name === "key") continue;
    if (attr.kind === "flag") out.push(attr.name);
    else if (attr.kind === "static") out.push(`${attr.name}=${jsString(attr.value)}`);
    else if (attr.kind === "bound") out.push(`${attr.name}={${attr.expression}}`);
    else if (attr.kind === "template") {
      out.push(`${attr.name}="${attr.parts.map((p) => (p.expression !== undefined ? `{${p.expression}}` : p.literal)).join("")}"`);
    }
  }

  // Svelte spells the three input shapes differently: a checkbox binds its
  // checked flag and a radio group binds through the shared model.
  if (node.model) {
    const target = setterFor(node.model);
    if (node.modelKind === "checkbox") out.push(`bind:checked={${target}}`);
    else if (node.modelKind === "radio") out.push(`bind:group={${target}}`);
    else out.push(`bind:value={${target}}`);
  }
  for (const event of node.events) {
    let handler = guardHandler(event.name, event.handler, event.modifiers);
    // A statement list from an inline handler needs the block form of an arrow.
    if (/;/.test(handler) && !/^\{/.test(handler)) handler = `{ ${handler.replace(/[;\s]+$/, "")}; }`;
    out.push(`on:${event.name}={${/\bevent\b/.test(handler) ? `(event) => ${handler}` : `() => ${handler}`}}`);
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
        .map((p) => (p.expression !== undefined ? `{${p.expression}}` : p.literal.replace(/\s+/g, " ")))
        .join("")
        .trim();
      return body ? indent + body : "";
    }

    case "slot": {
      const name = node.name ? ` name="${node.name}"` : "";
      const fallback = (node.children ?? []).map((c) => print(c, depth + 1)).filter(Boolean);
      if (!fallback.length) return `${indent}<slot${name} />`;
      return [`${indent}<slot${name}>`, ...fallback, `${indent}</slot>`].join("\n");
    }

    case "html":
      return `${indent}{@html ${node.expression}}`;

    case "fragment":
      return node.children.map((c) => print(c, depth)).filter(Boolean).join("\n");

    case "when": {
      const inner = node.children.map((c) => print(c, depth + 1)).filter(Boolean).join("\n");
      return `${indent}{#if ${node.test}}\n${inner}\n${indent}{/if}`;
    }

    case "each": {
      const head = node.index ? `${node.item}, ${node.index}` : node.item;
      const inner = node.children.map((c) => print(c, depth + 1)).filter(Boolean).join("\n");
      if (node.object) {
        return `${indent}{#each Object.entries(${node.list}) as [${node.index}, ${node.item}] (${node.index})}\n${inner}\n${indent}{/each}`;
      }
      return `${indent}{#each ${node.list} as ${head} (${node.key})}\n${inner}\n${indent}{/each}`;
    }

    case "element": {
      if (!node.tag) return node.children.map((c) => print(c, depth)).filter(Boolean).join("\n");
      // Svelte renders a dynamic component through svelte:component.
      if (node.tagExpression) {
        const shed = { ...node, attrs: node.attrs.filter((a) => a.name !== "is") };
        const props = attributes(shed);
        const open = `<svelte:component this={${node.tagExpression}}${props.length ? " " + props.join(" ") : ""}`;
        const children = node.children.map((c) => print(c, depth + 1)).filter(Boolean);
        if (!children.length) return `${indent}${open} />`;
        return [`${indent}${open}>`, ...children, `${indent}</svelte:component>`].join("\n");
      }
      const props = attributes(node);
      const open = `<${node.tag}${props.length ? " " + props.join(" ") : ""}`;
      const children = node.children.map((c) => print(c, depth + 1)).filter(Boolean);
      if (!children.length) return `${indent}${open} />`;
      return [`${indent}${open}>`, ...children, `${indent}</${node.tag}>`].join("\n");
    }

    default:
      return "";
  }
}

export function toSvelte(html, { dialect, components = [] } = {}) {
  const ir = buildIr(html, { dialect, components });
  return { markup: print(ir.root, 1) || "  <!-- nothing to render -->", ...ir };
}
