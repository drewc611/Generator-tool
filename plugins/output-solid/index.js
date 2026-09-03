import { buildIr } from "../dsp-ir/ir.js";
import { jsString, guardHandler } from "../dsp-ir/emit.js";

/**
 * The Solid target. Solid is the one target where spelling matters for
 * correctness, not taste: a destructured prop stops updating and a signal
 * read without its call never updates at all. So this printer rewrites every
 * expression, qualifying props as props.x and signals as x(), instead of
 * emitting code that looks right and quietly is not reactive.
 */

const pascal = (sel) =>
  String(sel).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

const unique = (list) => [...new Set(list)];
const pad = (depth) => "  ".repeat(depth);
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/** Rewrite bare root identifiers by the map, leaving strings and keys alone. */
export function qualify(code, rewrite, locals = new Set()) {
  const text = String(code);
  const strings = [];
  // The placeholder cannot collide with code: NUL never appears in a template
  // expression, and a bare number would.
  const masked = text.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, (s) => {
    strings.push(s);
    return `\u0000${strings.length - 1}\u0000`;
  });
  const rewritten = masked.replace(/(\.\s*)?\b([A-Za-z_$][\w$]*)\b(\s*:)?/g, (m, dot, name, colon) => {
    if (dot || colon || locals.has(name) || !rewrite.has(name)) return m;
    return rewrite.get(name);
  });
  return rewritten.replace(/\u0000(\d+)\u0000/g, (_, i) => strings[Number(i)]);
}

function attributes(node, ctx) {
  const out = [];
  const q = (code) => qualify(code, ctx.rewrite, ctx.locals);

  const literal = node.classes.filter((c) => c.kind === "literal").map((c) => c.value).join(" ").trim();
  const dynamic = node.classes.filter((c) => c.kind !== "literal");
  if (literal && !dynamic.length) out.push(`class=${jsString(literal)}`);
  else if (dynamic.length) {
    const parts = [
      ...(literal ? [jsString(literal)] : []),
      ...dynamic.map((c) => (c.kind === "conditional" ? `${q(c.when)} && ${jsString(c.name)}` : q(c.expression))),
    ];
    out.push(`class={[${parts.join(", ")}].filter(Boolean).join(" ")}`);
  }

  for (const attr of node.attrs) {
    if (attr.kind === "flag") out.push(attr.name);
    else if (attr.kind === "static") out.push(`${attr.name}=${jsString(attr.value)}`);
    else if (attr.kind === "bound") out.push(`${attr.name}={${q(attr.expression)}}`);
    else if (attr.kind === "template") {
      out.push(`${attr.name}={\`${attr.parts.map((p) => (p.expression !== undefined ? `\${${q(p.expression)}}` : p.literal)).join("")}\`}`);
    }
  }

  if (node.model) {
    const leaf = node.model.split(".").pop().replace(/[^\w$]/g, "");
    const setter = `set${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}`;
    if (node.modelKind === "checkbox") {
      out.push(`checked={${leaf}()}`, `onChange={(e) => ${setter}(e.target.checked)}`);
    } else if (node.modelKind === "radio") {
      const own = node.attrs.find((a) => a.name.toLowerCase() === "value");
      const option = own?.kind === "static" ? jsString(own.value) : own?.kind === "bound" ? `(${q(own.expression)})` : null;
      if (option) out.push(`checked={${leaf}() === ${option}}`, `onChange={() => ${setter}(${option})}`);
      else out.push(`onInput={(e) => ${setter}(e.target.value)}`);
    } else {
      out.push(`value={${leaf}()}`, `onInput={(e) => ${setter}(e.target.value)}`);
    }
  }

  for (const event of node.events) {
    const name = `on${event.name.charAt(0).toUpperCase()}${camel(event.name).slice(1)}`;
    const handler = guardHandler(event.name, q(event.handler), event.modifiers);
    out.push(`${name}={${/\bevent\b/.test(handler) ? `(event) => ${handler}` : `() => ${handler}`}}`);
  }

  for (const s of node.styles) {
    // Solid's style object takes CSS property names as written in CSS.
    if (s.kind === "declaration") {
      const value = s.literal !== undefined ? jsString(s.literal) : s.unit ? `\`\${${q(s.expression)}}${s.unit}\`` : q(s.expression);
      out.push(`style={{ ${jsString(s.property)}: ${value} }}`);
    }
    if (s.kind === "spread") out.push(`style={${q(s.expression)}}`);
  }
  return out;
}

function print(node, depth, ctx) {
  if (!node) return "";
  const indent = pad(depth);
  const q = (code) => qualify(code, ctx.rewrite, ctx.locals);

  switch (node.kind) {
    case "comment":
      return `${indent}{/*${node.text.replace(/\*\//g, "*\\/")}*/}`;
    case "text": {
      const body = node.parts
        .map((p) => (p.expression !== undefined ? `{${q(p.expression)}}` : p.literal.replace(/\s+/g, " ").replace(/[{}]/g, (c) => `{"${c}"}`)))
        .join("")
        .trim();
      return body ? indent + body : "";
    }
    case "slot": {
      const name = node.name ? node.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : "children";
      const fallback = (node.children ?? []).map((c) => print(c, depth + 2, ctx)).filter(Boolean);
      if (!fallback.length) return `${indent}{props.${name}}`;
      return [`${indent}{props.${name} ?? (`, `${pad(depth + 1)}<>`, ...fallback, `${pad(depth + 1)}</>`, `${indent})}`].join("\n");
    }
    case "html":
      return `${indent}<div innerHTML={${q(node.expression)}} />`;
    case "when": {
      const inner = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean).join("\n");
      return `${indent}<Show when={${q(node.test)}}>\n${inner}\n${indent}</Show>`;
    }
    case "each": {
      ctx.locals.add(node.item);
      if (node.index) ctx.locals.add(node.index);
      const args = node.object
        ? `([${node.index}, ${node.item}])`
        : node.index ? `(${node.item}, ${node.index})` : `(${node.item})`;
      // A condition that is the whole row body cannot keep its JSX braces
      // here: the callback returns an expression, not JSX children.
      const sole = node.children.length === 1 && node.children[0].kind === "when" ? node.children[0] : null;
      const inner = (sole ? sole.children : node.children).map((c) => print(c, depth + 1, ctx)).filter(Boolean).join("\n");
      const test = sole ? q(sole.test) : null;
      ctx.locals.delete(node.item);
      if (node.index) ctx.locals.delete(node.index);
      const source = node.object ? `Object.entries(${q(node.list)})` : q(node.list);
      if (sole) return `${indent}<For each={${source}}>{${args} => ${/\|\||\?/.test(test) ? `(${test})` : test} && (\n${inner}\n${indent})}</For>`;
      return `${indent}<For each={${source}}>{${args} => (\n${inner}\n${indent})}</For>`;
    }
    case "fragment": {
      const children = node.children.map((c) => print(c, depth, ctx)).filter(Boolean);
      return children.join("\n");
    }
    case "element": {
      if (!node.tag) {
        const children = node.children.map((c) => print(c, depth, ctx)).filter(Boolean);
        return children.join("\n");
      }
      const props = attributes(node, ctx);
      const open = `<${node.tag}${props.length ? " " + props.join(" ") : ""}`;
      const children = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean);
      if (!children.length) return `${indent}${open} />`;
      return [`${indent}${open}>`, ...children, `${indent}</${node.tag}>`].join("\n");
    }
    default:
      return "";
  }
}

export function toSolid(html, { dialect } = {}) {
  const ir = buildIr(html, { dialect });
  const rewrite = new Map();
  for (const m of ir.models) {
    const leaf = m.split(".")[0];
    rewrite.set(leaf, `${leaf.split(".").pop().replace(/[^\w$]/g, "")}()`);
  }
  for (const read of ir.reads) rewrite.set(read, `props.${read}`);
  const ctx = { rewrite, locals: new Set() };
  const body = print(ir.root, 3, ctx);
  return { body, ...ir };
}

export default {
  name: "output-solid",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.solid) return log.debug("not requested");

      let emitted = 0;
      for (const screen of ctx.screens) {
        const Name = pascal(screen.selector) || "Screen";
        const result = screen.template ? toSolid(screen.template) : null;
        const collection = result?.collections[0] ?? "data";
        const props = unique([...screen.inputs, ...(result?.reads ?? []), "loading", "error", "onRetry"]);
        await ctx.write(`src/solid/${Name}.jsx`, COMPONENT({ Name, props, screen, result, collection }));
        emitted += 1;
      }
      log.info(`${emitted} solid component(s)`);
    });
  },
};

const COMPONENT = ({ Name, props, screen, result, collection }) => {
  const models = result?.models ?? [];
  const signals = models
    .map((m) => {
      const leaf = m.split(".").pop().replace(/[^\w$]/g, "");
      return `  const [${leaf}, set${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}] = createSignal("");`;
    })
    .join("\n");
  const uses = ["Show", ...(result?.body.includes("<For") ? ["For"] : [])];
  const qualifiedCollection = collection === "data" ? "props.data" : `props.${collection.split(".")[0]}`;

  return `import { ${[...(models.length ? ["createSignal"] : []), ...uses].join(", ")} } from "solid-js";
import { tokens as T } from "../tokens.js";

/**
 * Ported from ${screen.file} by portamp. Solid target.
 *
 * Props are read as props.x and signals as x() on purpose: destructuring
 * either is how Solid components stop updating. Every state below is present
 * on purpose; delete one only when you have checked the legacy screen
 * genuinely cannot reach it.
 */
export default function ${Name}(props) {
${signals ? signals + "\n" : ""}  return (
    <div style={{ padding: \`\${T.space[3]}px\`, color: T.color.ink, background: T.color.surface }}>
      <Show when={!props.loading} fallback={<div style={{ color: T.color.inkMuted }}>Loading…</div>}>
        <Show
          when={!props.error}
          fallback={
            <div>
              <div style={{ "font-weight": T.weight.bold }}>Could not load</div>
              <div style={{ color: T.color.inkMuted }}>{String(props.error?.message ?? props.error)}</div>
              <button onClick={props.onRetry}>Try again</button>
            </div>
          }
        >
          <Show when={${qualifiedCollection} == null || ${qualifiedCollection}.length !== 0} fallback={<div style={{ color: T.color.inkMuted }}>Nothing to show yet.</div>}>
${result?.body ?? `            {/* No template was found. Port the body from ${screen.file}. */}`}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
`;
};
