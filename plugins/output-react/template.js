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

function attributes(node, ctx) {
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

  // A model's setter and a change handler on the same element are one
  // onChange that does both. Two onChange props fight, React keeps the last,
  // and whichever loses is dropped without a word.
  const changeLike = node.model ? node.events.filter((e) => /^(change|input)$/.test(e.name)) : [];
  if (node.model) {
    // A checkbox's state lives in `checked`; a radio's in which of the group
    // is checked, keyed by its value. Wiring `value` to either writes "on"
    // into the model and the form breaks quietly.
    let bind = `value={${node.model}}`;
    let setter = `${setterFor(node.model)}(event.target.value)`;
    const mods = node.modelModifiers ?? [];
    if (mods.includes("number")) {
      // Vue's .number: cast when it parses, keep the text when it does not.
      setter = `${setterFor(node.model)}(Number.isNaN(event.target.valueAsNumber) ? event.target.value : event.target.valueAsNumber)`;
    }
    if (node.modelKind === "select-multiple") {
      // The multiple flag itself is already among the printed attributes.
      setter = `${setterFor(node.model)}([...event.target.selectedOptions].map((o) => o.value))`;
    } else if (node.modelKind === "checkbox") {
      bind = `checked={${node.model}}`;
      setter = `${setterFor(node.model)}(event.target.checked)`;
    } else if (node.modelKind === "radio") {
      const own = node.attrs.find((a) => a.name.toLowerCase() === "value");
      const option = own?.kind === "static" ? jsString(own.value) : own?.kind === "bound" ? `(${own.expression})` : null;
      if (option) {
        bind = `checked={${node.model} === ${option}}`;
        setter = `${setterFor(node.model)}(${option})`;
      } else {
        // Without a value there is nothing to compare the model against, so
        // the write half is kept and the read half is left to a person.
        bind = null;
        ctx?.note?.(`A radio bound to \`${node.model}\` has no value attribute, so its checked state cannot be derived. The setter is wired; add the value and the checked binding by hand.`);
      }
    }
    if (bind) out.push(bind);
    out.push(changeLike.length
      ? `onChange={(event) => { ${setter}; ${changeLike.map((e) => `${e.handler};`).join(" ")} }}`
      : `onChange={(event) => ${setter}}`);
    // Vue's .trim applies when the field settles, not per keystroke, so the
    // port trims on blur and typing stays undisturbed.
    if (mods.includes("trim")) {
      out.push(`onBlur={(event) => ${setterFor(node.model)}(event.target.value.trim())}`);
    }
    if (mods.includes("lazy")) {
      ctx?.note?.(`\`v-model.lazy\` updated \`${node.model}\` only when the field settled. React's onChange fires per keystroke; debounce the effect, not the state, if the difference matters.`);
    }
  }

  for (const event of node.events) {
    if (changeLike.includes(event)) continue;
    const base = camel(event.name);
    const on = `on${base.charAt(0).toUpperCase()}${base.slice(1)}`;
    out.push(`${on}={${/\bevent\b/.test(event.handler) ? `(event) => ${event.handler}` : `() => ${event.handler}`}}`);
  }

  const style = styleAttribute(node.styles);
  if (style) out.push(style);
  return out;
}

function print(node, depth, ctx) {
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
      if (node.children.length === 1) return print(node.children[0], depth, ctx);
      const children = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean);
      if (!children.length) return `${indent}<></>`;
      return [`${indent}<>`, ...children, `${indent}</>`].join("\n");
    }

    case "when": {
      const inner = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean).join("\n");
      // `a || b && (...)` is not `(a || b) && (...)`. The parens appear the
      // moment the test carries anything that binds looser than &&.
      const test = /\|\||\?/.test(node.test) ? `(${node.test})` : node.test;
      return `${indent}{${test} && (\n${inner}\n${indent})}`;
    }

    case "each": {
      const args = node.index ? `(${node.item}, ${node.index})` : `(${node.item})`;
      const inner = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean).join("\n");
      return `${indent}{${node.list}.map(${args} => (\n${withKey(inner, node.key)}\n${indent}))}`;
    }

    case "element": {
      if (!node.tag) {
        if (node.children.length === 1) return print(node.children[0], depth, ctx);
        const children = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean);
        if (!children.length) return `${indent}<></>`;
        return [`${indent}<>`, ...children, `${indent}</>`].join("\n");
      }

      // A tag that names another screen in the run is that screen, ported. The
      // bindings become props and the outputs become callbacks, which is what
      // the attribute pass already produces; only the name and the import are
      // this case's to add.
      const resolved = ctx?.components?.get(node.tag.toLowerCase());
      if (resolved) ctx.used.add(node.tag.toLowerCase());
      const tag = resolved ? resolved.name : node.tag;
      if (!resolved && node.tag.includes("-") && ctx?.components) {
        ctx.note(`<${node.tag}> looks like a component and is not in this run, so it is emitted as an unknown element. Port it in the same run and the reference will resolve.`);
      }

      const props = attributes(node, ctx);
      const open = `<${tag}${props.length ? " " + props.join(" ") : ""}`;
      const children = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean);
      if (!children.length) return `${indent}${open} />`;
      return [`${indent}${open}>`, ...children, `${indent}</${tag}>`].join("\n");
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

export function translate(html, { indent = 3, dialect, components = null } = {}) {
  const ir = buildIr(html, { dialect });
  const notes = [...ir.notes];
  const ctx = { components, used: new Set(), note: (t) => { if (!notes.includes(t)) notes.push(t); } };
  const jsx = print(ir.root, indent, ctx) || `${pad(indent)}<></>`;
  return { jsx, notes, models: ir.models, reads: ir.reads, collections: ir.collections, ir, components: [...ctx.used] };
}
