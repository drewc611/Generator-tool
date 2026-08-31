import { buildIr } from "../dsp-ir/ir.js";
import { jsString } from "../dsp-ir/emit.js";
import { parse } from "../dsp-ir/parse.js";

/**
 * The React printer. It takes the IR and knows nothing about where the markup
 * came from: an Angular template and a Vue single file component reach this
 * function as the same tree, which is the whole reason the IR exists.
 */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

const PROP = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly",
  maxlength: "maxLength", minlength: "minLength", colspan: "colSpan", rowspan: "rowSpan",
  autocomplete: "autoComplete", autofocus: "autoFocus", srcset: "srcSet",
  novalidate: "noValidate", enctype: "encType", usemap: "useMap", cellpadding: "cellPadding",
  cellspacing: "cellSpacing", frameborder: "frameBorder", contenteditable: "contentEditable",
  spellcheck: "spellCheck", crossorigin: "crossOrigin",
};

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const pad = (depth) => "  ".repeat(depth);
const escapeText = (s) => s.replace(/[{}]/g, (c) => `{"${c}"}`);

const setterFor = (target) => {
  const leaf = target.split(".").pop().replace(/[^\w$]/g, "");
  return `set${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}`;
};

function propName(name) {
  return PROP[name.toLowerCase()] ?? (name.includes("-") ? name : camel(name));
}

function classAttribute(classes) {
  if (!classes.length) return null;
  const literal = classes.filter((c) => c.kind === "literal").map((c) => c.value).join(" ").trim();
  const rest = classes.filter((c) => c.kind !== "literal");
  if (!rest.length) return `className=${jsString(literal)}`;
  if (!literal && rest.length === 1 && rest[0].kind === "expression") {
    return `className={${rest[0].expression}}`;
  }
  // A conditional that falls through has to drop out of the string rather than
  // land in it as `false`.
  const parts = [
    ...(literal ? [jsString(literal)] : []),
    ...rest.map((c) => (c.kind === "conditional" ? `${c.when} && ${jsString(c.name)}` : c.expression)),
  ];
  return `className={[${parts.join(", ")}].filter(Boolean).join(" ")}`;
}

function styleAttribute(styles) {
  if (!styles.length) return null;
  const parts = styles.map((s) => {
    if (s.kind === "spread") return `...${s.expression}`;
    if (s.literal !== undefined) return `${camel(s.property)}: ${jsString(s.literal)}`;
    return `${camel(s.property)}: ${s.unit ? `\`\${${s.expression}}${s.unit}\`` : s.expression}`;
  });
  return `style={{ ${parts.join(", ")} }}`;
}

function attributes(node) {
  const out = [];
  const className = classAttribute(node.classes);
  if (className) out.push(className);

  for (const attr of node.attrs) {
    if (attr.kind === "flag") out.push(propName(attr.name));
    else if (attr.kind === "static") out.push(`${propName(attr.name)}=${jsString(attr.value)}`);
    else if (attr.kind === "bound") out.push(`${propName(attr.name)}={${attr.expression}}`);
    else if (attr.kind === "template") {
      const body = attr.parts.map((p) => (p.expression !== undefined ? `\${${p.expression}}` : p.literal)).join("");
      out.push(`${propName(attr.name)}={\`${body}\`}`);
    }
  }

  if (node.model) {
    out.push(`value={${node.model}}`, `onChange={(event) => ${setterFor(node.model)}(event.target.value)}`);
  }

  for (const event of node.events) {
    const base = camel(event.name);
    const on = `on${base.charAt(0).toUpperCase()}${base.slice(1)}`;
    out.push(`${on}={${/\bevent\b/.test(event.handler) ? `(event) => ${event.handler}` : `() => ${event.handler}`}}`);
  }

  const style = styleAttribute(node.styles);
  if (style) out.push(style);
  return out;
}

function print(node, depth) {
  if (!node) return "";
  const indent = pad(depth);

  switch (node.kind) {
    case "comment":
      return `${indent}{/*${node.text.replace(/\*\//g, "*\\/")}*/}`;

    case "text": {
      const body = node.parts
        .map((p) => (p.expression !== undefined ? `{${p.expression}}` : escapeText(p.literal.replace(/\s+/g, " "))))
        .join("")
        .trim();
      return body ? indent + body : "";
    }

    case "slot":
      return `${indent}{children}`;

    case "html":
      return `${indent}<div dangerouslySetInnerHTML={{ __html: ${node.expression} }} />`;

    case "fragment": {
      const children = node.children.map((c) => print(c, depth + 1)).filter(Boolean);
      if (!children.length) return `${indent}<></>`;
      return [`${indent}<>`, ...children, `${indent}</>`].join("\n");
    }

    case "when": {
      const inner = node.children.map((c) => print(c, depth + 1)).filter(Boolean).join("\n");
      return `${indent}{${node.test} && (\n${inner}\n${indent})}`;
    }

    case "each": {
      const args = node.index ? `(${node.item}, ${node.index})` : `(${node.item})`;
      const inner = node.children.map((c) => print(c, depth + 1)).filter(Boolean).join("\n");
      return `${indent}{${node.list}.map(${args} => (\n${withKey(inner, node.key)}\n${indent}))}`;
    }

    case "element": {
      if (!node.tag) {
        const children = node.children.map((c) => print(c, depth + 1)).filter(Boolean);
        if (!children.length) return `${indent}<></>`;
        return [`${indent}<>`, ...children, `${indent}</>`].join("\n");
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

function withKey(inner, key) {
  const lines = inner.split("\n");
  const i = lines.findIndex((line) => line.trim().startsWith("<"));
  if (i < 0 || /\skey=\{/.test(lines[i])) return inner;
  lines[i] = lines[i].replace(/^(\s*<[\w.]+)/, `$1 key={${key}}`);
  return lines.join("\n");
}

export { buildIr, parse, VOID };

export function translate(html, { indent = 3, dialect } = {}) {
  const ir = buildIr(html, { dialect });
  const jsx = print(ir.root, indent) || `${pad(indent)}<></>`;
  return { jsx, notes: ir.notes, models: ir.models, reads: ir.reads, collections: ir.collections, ir };
}
