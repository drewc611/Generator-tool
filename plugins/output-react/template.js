import { buildIr } from "../dsp-ir/ir.js";
import { jsString, guardHandler } from "../dsp-ir/emit.js";

/**
 * The React printer. It takes the IR and knows nothing about where the markup
 * came from: an Angular template and a Vue single file component reach this
 * function as the same tree, which is the whole reason the IR exists.
 */

const PROP = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly",
  maxlength: "maxLength", minlength: "minLength", colspan: "colSpan", rowspan: "rowSpan",
  autocomplete: "autoComplete", autofocus: "autoFocus", srcset: "srcSet",
  novalidate: "noValidate", enctype: "encType", usemap: "useMap", cellpadding: "cellPadding",
  cellspacing: "cellSpacing", frameborder: "frameBorder", contenteditable: "contentEditable",
  spellcheck: "spellCheck", crossorigin: "crossOrigin", "accept-charset": "acceptCharset",
  // SVG presentation attributes, which react spells camelCased.
  "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap", "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit", "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset", "stroke-opacity": "strokeOpacity",
  "fill-rule": "fillRule", "clip-rule": "clipRule", "fill-opacity": "fillOpacity",
  "stop-color": "stopColor", "stop-opacity": "stopOpacity",
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
    let handler = guardHandler(event.name, event.handler, event.modifiers, ctx?.note);
    // An inline handler from the old web can be a statement list. A list is
    // not an expression, so an arrow needs the block form around it.
    if (/;/.test(handler) && !/^\{/.test(handler)) handler = `{ ${handler.replace(/[;\s]+$/, "")}; }`;
    out.push(`${on}={${/\bevent\b/.test(handler) ? `(event) => ${handler}` : `() => ${handler}`}}`);
  }

  const style = styleAttribute(node.styles);
  if (style) out.push(style);
  return out;
}

function print(node, depth, ctx) {
  if (!node) return "";
  if (node.line && ctx.where) ctx.where.line = node.line;
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

    case "slot": {
      // A named slot arrives as a prop; the children inside the tag are the
      // fallback, rendered only when the caller passed nothing for it.
      const name = node.name ? camel(node.name) : "children";
      const fallback = (node.children ?? []).map((c) => print(c, depth + 2, ctx)).filter(Boolean);
      if (!fallback.length) return `${indent}{${name}}`;
      return [`${indent}{${name} ?? (`, `${pad(depth + 1)}<>`, ...fallback, `${pad(depth + 1)}</>`, `${indent})}`].join("\n");
    }

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
      // An object's entries are not an array: (key, value) iteration maps
      // over Object.entries with the pair destructured back to its names.
      const args = node.object
        ? `([${node.index}, ${node.item}])`
        : node.index ? `(${node.item}, ${node.index})` : `(${node.item})`;
      const list = node.object ? `Object.entries(${node.list})` : node.list;
      const key = node.object ? node.index : node.key;
      // A condition that is the whole row body cannot keep its JSX braces
      // here: the map callback returns an expression, not JSX children.
      const sole = node.children.length === 1 && node.children[0].kind === "when" ? node.children[0] : null;
      if (sole) {
        const body = sole.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean).join("\n");
        const test = /\|\||\?/.test(sole.test) ? `(${sole.test})` : sole.test;
        return `${indent}{${list}.map(${args} => ${test} && (\n${withKey(body, key)}\n${indent}))}`;
      }
      const inner = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean).join("\n");
      return `${indent}{${list}.map(${args} => (\n${withKey(inner, key)}\n${indent}))}`;
    }

    case "element": {
      if (!node.tag) {
        if (node.children.length === 1) return print(node.children[0], depth, ctx);
        const children = node.children.map((c) => print(c, depth + 1, ctx)).filter(Boolean);
        if (!children.length) return `${indent}<></>`;
        return [`${indent}<>`, ...children, `${indent}</>`].join("\n");
      }

      // A dynamic tag needs a capitalized name before JSX will treat it as a
      // component, so the expression is bound to one for the row.
      if (node.tagExpression) {
        const shed = { ...node, tagExpression: null, tag: "Dyn", attrs: node.attrs.filter((a) => a.name !== "is") };
        return `${indent}{(() => { const Dyn = ${node.tagExpression}; return (\n${print(shed, depth + 1, ctx)}\n${indent}); })()}`;
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
      // Bound html is the element's own prop; a nested div would be an element the author never wrote.
      if (node.children.length === 1 && node.children[0].kind === "html") return `${indent}${open} dangerouslySetInnerHTML={{ __html: ${node.children[0].expression} }} />`;
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

export function translate(html, { indent = 3, dialect, components = null } = {}) {
  const ir = buildIr(html, { dialect, components: components ? [...components.keys()] : [] });
  const notes = [...ir.notes];
  // The grammar stamped the nodes; the printer keeps a cursor so its own
  // notes say the line too, the same spelling the reader's notes use.
  const where = { line: null };
  const ctx = {
    components,
    used: new Set(),
    where,
    note: (t) => {
      const said = where.line ? `line ${where.line}: ${t}` : t;
      if (!notes.includes(said)) notes.push(said);
    },
  };
  const jsx = print(ir.root, indent, ctx) || `${pad(indent)}<></>`;
  return { jsx, notes, models: ir.models, reads: ir.reads, collections: ir.collections, ir, components: [...ctx.used] };
}
