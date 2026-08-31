import { buildIr } from "../dsp-ir/ir.js";

/**
 * The printer with no framework underneath it.
 *
 * React, Svelte and Vue all supply a renderer, a way to spell a condition and a
 * way to attach a handler. A custom element supplies none of those, so this
 * file has to answer each one itself, and answering them is what makes it worth
 * having: a component that depends on nothing outlives every framework this
 * tool can emit.
 *
 * Markup is printed as a template literal. Interpolations are escaped, which is
 * the one thing a string renderer must never get wrong, and the only exception
 * is the node the IR already labelled raw.
 *
 * Handlers cannot live in a string, so each one is given an index and attached
 * by a single delegated listener per event type. That is also why this survives
 * re-rendering: the listener is on the host, not on a node that gets replaced.
 */

const pad = (depth) => "  ".repeat(depth);
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** A backtick or a `${` inside literal text would end the template early. */
const literal = (text) => text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const classExpression = (classes) => {
  const parts = classes.map((c) => {
    if (c.kind === "literal") return JSON.stringify(c.value);
    if (c.kind === "conditional") return `(${c.when} ? ${JSON.stringify(c.name)} : "")`;
    return `(${c.expression})`;
  });
  return parts.length === 1 && classes[0].kind === "literal" ? parts[0] : `[${parts.join(", ")}].filter(Boolean).join(" ")`;
};

const styleExpression = (styles) => {
  const spreads = styles.filter((s) => s.kind === "spread");
  const declarations = styles.filter((s) => s.kind !== "spread");
  const entries = declarations.map((s) => {
    const value = s.literal !== undefined
      ? JSON.stringify(s.literal)
      : s.unit ? `\`\${${s.expression}}${s.unit}\`` : `(${s.expression})`;
    return `[${JSON.stringify(kebab(s.property))}, ${value}]`;
  });
  const sources = [
    ...spreads.map((s) => `Object.entries(${s.expression} ?? {}).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()), v])`),
    ...(entries.length ? [`[${entries.join(", ")}]`] : []),
  ];
  return `[${sources.join(", ")}].flat().filter(([, v]) => v != null && v !== "").map(([k, v]) => k + ":" + v).join(";")`;
};

function attributes(node, ctx) {
  const out = [];

  if (node.classes.length) out.push(` class="\${esc(${classExpression(node.classes)})}"`);

  for (const attr of node.attrs) {
    if (attr.name === "key") continue;
    if (attr.kind === "flag") out.push(` ${attr.name}`);
    else if (attr.kind === "static") out.push(` ${attr.name}="${literal(String(attr.value ?? "").replace(/"/g, "&quot;"))}"`);
    else if (attr.kind === "bound") {
      // A false or absent bound attribute should not appear at all, which is
      // the behaviour every framework here gives for free and this does not.
      out.push(`\${attr(${JSON.stringify(attr.name)}, ${attr.expression})}`);
    } else if (attr.kind === "template") {
      const body = attr.parts.map((p) => (p.expression !== undefined ? `\${esc(${p.expression})}` : literal(p.literal))).join("");
      out.push(` ${attr.name}="${body}"`);
    }
  }

  if (node.model) {
    out.push(` value="\${esc(${node.model})}"`);
    out.push(` data-on-input="${ctx.handler("input", `${setterFor(node.model)} = event.target.value`)}"`);
  }
  for (const event of node.events) out.push(` data-on-${event.name}="${ctx.handler(event.name, event.handler)}"`);
  // A delegated listener fires long after the row that owns it was printed, so
  // the row has to carry its own index or the handler has no item to act on.
  if (ctx.scope() && (node.events.length || node.model)) out.push(` data-i="\${${ctx.scope().index}}"`);

  if (node.styles.length) out.push(` style="\${esc(${styleExpression(node.styles)})}"`);
  return out.join("");
}

const setterFor = (target) => `this.state.${target.split(".").pop().replace(/[^\w$]/g, "")}`;

function print(node, depth, ctx) {
  if (!node) return "";
  const indent = pad(depth);

  switch (node.kind) {
    case "comment":
      return `${indent}<!--${literal(node.text)}-->`;

    case "text": {
      const body = node.parts
        .map((p) => (p.expression !== undefined ? `\${esc(${p.expression})}` : literal(p.literal.replace(/\s+/g, " "))))
        .join("");
      return body.trim() ? indent + body.trim() : "";
    }

    case "slot":
      return `${indent}<slot></slot>`;

    // Already named as a trust decision by the IR. It is the one place the
    // escaping is skipped, and it is skipped on purpose.
    case "html":
      return `${indent}\${${node.expression} ?? ""}`;

    case "fragment":
      return node.children.map((c) => print(c, depth, ctx)).filter(Boolean).join("\n");

    case "when": {
      const inner = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean).join("\n");
      return `${indent}\${(${node.test}) ? \`\n${inner}\n${indent}\` : ""}`;
    }

    case "each": {
      // An index is always bound, named or not, because the delegated listener
      // needs one even when the template never asked for it.
      const index = node.index ?? "__i";
      const inner = ctx.within({ item: node.item, list: node.list, index }, () =>
        node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean).join("\n"));
      return `${indent}\${(${node.list} ?? []).map((${node.item}, ${index}) => \`\n${inner}\n${indent}\`).join("")}`;
    }

    case "element": {
      if (!node.tag) return node.children.map((c) => print(c, depth, ctx)).filter(Boolean).join("\n");
      const open = `<${node.tag}${attributes(node, ctx)}`;
      if (node.void) return `${indent}${open}>`;
      const children = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean);
      if (!children.length) return `${indent}${open}></${node.tag}>`;
      return [`${indent}${open}>`, ...children, `${indent}</${node.tag}>`].join("\n");
    }

    default:
      return "";
  }
}

export function toHtml(html, { dialect } = {}) {
  const ir = buildIr(html, { dialect });
  const handlers = [];
  const scopes = [];
  const ctx = {
    scope: () => scopes.at(-1) ?? null,
    within(scope, fn) {
      scopes.push(scope);
      try { return fn(); } finally { scopes.pop(); }
    },
    handler(event, body) {
      handlers.push({ event, body, scope: scopes.at(-1) ?? null });
      return handlers.length - 1;
    },
  };
  const markup = print(ir.root, 3, ctx) || `${pad(3)}<!-- nothing to render -->`;
  const notes = [...ir.notes];
  // Only the innermost row index is carried, so a handler two loops deep would
  // be handed the wrong item. Saying so beats emitting it quietly.
  if (handlers.some((h) => h.scope) && scopesNested(ir.root)) {
    notes.push("A handler sits inside nested loops. Only the innermost row is bound to it; check that one by hand.");
  }
  return { markup, handlers, events: [...new Set(handlers.map((h) => h.event))], ...ir, notes };
}

function scopesNested(node, depth = 0) {
  if (!node) return false;
  const next = node.kind === "each" ? depth + 1 : depth;
  if (next > 1) return true;
  return (node.children ?? []).some((c) => scopesNested(c, next));
}
