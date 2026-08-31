/**
 * Translates an Angular template into JSX.
 *
 * It handles the four constructs that make up most of a real template, plus
 * the ones that silently change behaviour when they are dropped. Anything it
 * cannot translate faithfully is left in place as a comment and reported, so
 * the gap is visible in the file and in PORT_NOTES.md rather than absent.
 */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

// Attributes React spells differently. Anything hyphenated (data-, aria-) is
// already correct and passes through untouched.
const PROP = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", readonly: "readOnly",
  maxlength: "maxLength", minlength: "minLength", colspan: "colSpan", rowspan: "rowSpan",
  autocomplete: "autoComplete", autofocus: "autoFocus", srcset: "srcSet",
  novalidate: "noValidate", enctype: "encType", usemap: "useMap", cellpadding: "cellPadding",
  cellspacing: "cellSpacing", frameborder: "frameBorder", contenteditable: "contentEditable",
  spellcheck: "spellCheck", crossorigin: "crossOrigin",
};

/* ------------------------------------------------------------------ parser */

export function parse(html) {
  const root = { type: "root", children: [] };
  const stack = [root];
  const re = /<!--([\s\S]*?)-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let last = 0;
  let match;

  const push = (node) => stack[stack.length - 1].children.push(node);
  const text = (value) => {
    if (value) push({ type: "text", text: value });
  };

  while ((match = re.exec(html))) {
    text(html.slice(last, match.index));
    last = re.lastIndex;

    if (match[1] !== undefined) {
      push({ type: "comment", text: match[1] });
    } else if (match[2]) {
      // Close the nearest matching open tag. Unbalanced markup closes nothing
      // rather than unwinding the whole document.
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === match[2]) {
          stack.length = i;
          break;
        }
      }
    } else {
      const node = { type: "element", tag: match[3], attrs: parseAttrs(match[4] ?? ""), children: [] };
      push(node);
      if (!match[5] && !VOID.has(node.tag.toLowerCase())) stack.push(node);
    }
  }
  text(html.slice(last));
  return root.children;
}

function parseAttrs(source) {
  const attrs = [];
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(source))) {
    if (!match[1].trim()) continue;
    attrs.push({ name: match[1], value: match[3] ?? match[4] ?? match[5] ?? null });
  }
  return attrs;
}

/* ----------------------------------------------------------------- helpers */

const PIPE = /\|\s*[a-zA-Z_$][\w$]*/;

function splitPipes(expression) {
  // A pipe inside a string literal is not a pipe. Only split at the top level.
  let depth = 0;
  let quote = null;
  for (let i = 0; i < expression.length; i += 1) {
    const c = expression[i];
    if (quote) {
      if (c === quote && expression[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === "|" && depth === 0 && expression[i + 1] !== "|" && expression[i - 1] !== "|") {
      return { value: expression.slice(0, i).trim(), pipes: expression.slice(i + 1).trim() };
    }
  }
  return { value: expression.trim(), pipes: null };
}

const GLOBALS = new Set(["true", "false", "null", "undefined", "this", "new", "typeof", "in", "of",
  "Math", "JSON", "Intl", "Object", "Array", "String", "Number", "Boolean", "Date", "event", "children"]);

/**
 * The root identifiers an expression reads. The emitter needs them because a
 * template referring to `orders` only runs if `orders` arrives from somewhere.
 */
function rootIdentifiers(code) {
  const found = [];
  const re = /(\.\s*)?\b([A-Za-z_$][\w$]*)\b(\s*:)?/g;
  let match;
  while ((match = re.exec(code))) {
    if (match[1]) continue;           // a property access, not a root
    if (match[3]) continue;           // an object literal key
    if (GLOBALS.has(match[2])) continue;
    found.push(match[2]);
  }
  return found;
}

function expr(raw, report) {
  const { value, pipes } = splitPipes(String(raw ?? "").trim());
  if (pipes) {
    const name = pipes.split(":")[0].trim();
    report.note(`The \`${name}\` pipe has no React equivalent. \`${value}\` is passed through unformatted; use Intl or a helper.`);
  }
  const code = value.replace(/\$event/g, "event");
  for (const id of rootIdentifiers(code)) report.ref(id);
  return code;
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function styleEntries(css) {
  return css
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(":");
      if (i < 0) return null;
      return `${camel(pair.slice(0, i).trim())}: ${JSON.stringify(pair.slice(i + 1).trim())}`;
    })
    .filter(Boolean);
}

const setterFor = (target) => {
  const leaf = target.split(".").pop().replace(/[^\w$]/g, "");
  return `set${leaf.charAt(0).toUpperCase()}${leaf.slice(1)}`;
};

/* ---------------------------------------------------------------- printing */

function interpolate(text, report) {
  // Text between braces becomes an expression; everything else is literal and
  // has to survive JSX, where braces are syntax.
  const out = [];
  const re = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    out.push({ literal: text.slice(last, match.index) });
    out.push({ code: expr(match[1], report) });
    last = re.lastIndex;
  }
  out.push({ literal: text.slice(last) });
  return out
    .map((part) => (part.code !== undefined ? `{${part.code}}` : part.literal.replace(/[{}]/g, (c) => `{"${c}"}`)))
    .join("");
}

/**
 * A class can arrive four ways and a style three. React takes one prop for
 * each, so they are collected and merged. Emitting them separately would leave
 * two className attributes on one element, and React silently keeps the last.
 */
function objectLiteralEntries(code) {
  const inner = code.trim().replace(/^\{/, "").replace(/\}$/, "");
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (quote) {
      if (c === quote && inner[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));

  const entries = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const i = part.indexOf(":");
    if (i < 0) return null;
    const key = part.slice(0, i).trim().replace(/^['"`]|['"`]$/g, "");
    entries.push({ key, value: part.slice(i + 1).trim() });
  }
  return entries.length ? entries : null;
}

function attributes(node, report) {
  const out = [];
  const classes = [];
  const styles = [];
  let staticClass = null;

  for (const { name, value } of node.attrs) {
    if (/^\*ng/.test(name) || name.startsWith("#")) continue;

    const banana = name.match(/^\[\((\w[\w.]*)\)\]$/);
    if (banana) {
      const target = expr(value, report);
      report.model(target);
      out.push(`value={${target}}`, `onChange={(event) => ${setterFor(target)}(event.target.value)}`);
      continue;
    }

    const event = name.match(/^\((\w[\w.:-]*)\)$/);
    if (event) {
      const handler = expr(value, report);
      const base = camel(event[1]);
      const on = `on${base.charAt(0).toUpperCase()}${base.slice(1)}`;
      out.push(`${on}={${/\bevent\b/.test(handler) ? `(event) => ${handler}` : `() => ${handler}`}}`);
      continue;
    }

    const bound = name.match(/^\[([^\]]+)\]$/);
    if (bound) {
      const target = bound[1];
      const code = expr(value, report);
      if (target === "ngClass") {
        const entries = objectLiteralEntries(code);
        if (entries) {
          for (const entry of entries) classes.push({ code: `${entry.value} && ${JSON.stringify(entry.key)}`, conditional: true });
        } else {
          // A string or an array. It still yields class names, so it goes in
          // the same list, but a reader should confirm the shape.
          classes.push({ code, conditional: false });
          report.note(`[ngClass]="${code}" on <${node.tag}> was not an object literal. It is joined into className as is; confirm it produces class names.`);
        }
      } else if (target === "ngStyle") {
        styles.push(`...${code}`);
      } else if (target === "class") {
        classes.push({ code, conditional: false });
      } else if (target.startsWith("class.")) {
        classes.push({ code: `${code} && ${JSON.stringify(target.slice(6))}`, conditional: true });
      } else if (target.startsWith("style.")) {
        const [property, unit] = target.slice(6).split(".");
        styles.push(`${camel(property)}: ${unit ? `\`\${${code}}${unit}\`` : code}`);
      } else if (target.startsWith("attr.")) {
        out.push(`${target.slice(5)}={${code}}`);
      } else {
        out.push(`${PROP[target.toLowerCase()] ?? camel(target)}={${code}}`);
      }
      continue;
    }

    if (name.toLowerCase() === "class") {
      staticClass = value ?? "";
      continue;
    }
    if (name.toLowerCase() === "style" && value) {
      styles.unshift(...styleEntries(value));
      continue;
    }

    const prop = PROP[name.toLowerCase()] ?? (name.includes("-") ? name : camel(name));
    if (value === null) {
      out.push(prop);
    } else if (/\{\{/.test(value)) {
      out.push(`${prop}={\`${value.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => `\${${expr(e, report)}}`)}\`}`);
    } else {
      out.push(`${prop}=${JSON.stringify(value)}`);
    }
  }

  if (classes.length === 0 && staticClass !== null) {
    out.unshift(`className=${JSON.stringify(staticClass)}`);
  } else if (classes.length) {
    const onlyPlain = classes.length === 1 && !classes[0].conditional && staticClass === null;
    if (onlyPlain) {
      out.unshift(`className={${classes[0].code}}`);
    } else {
      // A conditional that falls through must drop out of the string rather
      // than land in it as `false`.
      const parts = staticClass !== null ? [JSON.stringify(staticClass)] : [];
      out.unshift(`className={[${[...parts, ...classes.map((c) => c.code)].join(", ")}].filter(Boolean).join(" ")}`);
    }
  }
  if (styles.length) out.push(`style={{ ${styles.join(", ")} }}`);

  return out;
}

function printNode(node, depth, report) {
  const pad = "  ".repeat(depth);

  if (node.type === "text") {
    const value = node.text.replace(/\s+/g, " ");
    if (!value.trim()) return "";
    return pad + interpolate(value.trim(), report);
  }
  if (node.type === "comment") return `${pad}{/*${node.text.replace(/\*\//g, "*\\/")}*/}`;

  const structural = {};
  for (const { name, value } of node.attrs) {
    if (name.startsWith("*ng")) structural[name.slice(1)] = value;
  }

  let body = printElement(node, depth, report);

  if (structural.ngFor) {
    const loop = structural.ngFor;
    const item = loop.match(/let\s+([\w$]+)\s+of\s+([^;]+)/);
    if (item) {
      const index = loop.match(/index\s+as\s+([\w$]+)/);
      const trackBy = loop.match(/trackBy\s*:\s*([\w$.]+)/);
      report.collection(expr(item[2], report));
      report.local(item[1]);
      if (index) report.local(index[1]);
      if (trackBy) report.ref(trackBy[1].split(".")[0]);
      const args = index ? `(${item[1]}, ${index[1]})` : `(${item[1]})`;
      const key = trackBy
        ? `${trackBy[1]}(${index ? index[1] : "0"}, ${item[1]})`
        : index
          ? index[1]
          : `${item[1]}.id ?? ${item[1]}`;
      if (!trackBy && !index) {
        report.note(
          `<${node.tag}> repeated with *ngFor had no trackBy. The key falls back to \`${item[1]}.id\`; ` +
            "give it a stable key if the rows can reorder."
        );
      }
      body = reindent(body, depth, (inner) =>
        `${"  ".repeat(depth)}{${expr(item[2], report)}.map(${args} => (\n${withKey(inner, key, depth + 1)}\n${"  ".repeat(depth)}))}`
      );
    } else {
      report.note(`Could not read the *ngFor on <${node.tag}>: \`${loop}\`. Ported as a plain element.`);
    }
  }

  if (structural.ngIf) {
    const condition = structural.ngIf;
    const alias = condition.match(/^(.*?)\s+as\s+[\w$]+$/);
    if (alias) {
      report.note(`*ngIf="${condition}" used an alias. React has no equivalent; the condition alone was kept.`);
    }
    const elseRef = condition.match(/;\s*else\s+([\w$]+)/);
    if (elseRef) {
      report.note(`*ngIf on <${node.tag}> had an \`else ${elseRef[1]}\` branch. Wire the fallback in by hand.`);
    }
    const test = expr((alias ? alias[1] : condition).replace(/;\s*else\s+[\w$]+/, ""), report);
    body = reindent(body, depth, (inner) =>
      `${"  ".repeat(depth)}{${test} && (\n${inner}\n${"  ".repeat(depth)})}`
    );
  }

  return body;
}

// Rewrap a printed subtree, pushing it one level deeper so the result still
// reads like something a person indented.
function reindent(body, depth, wrap) {
  const inner = body
    .split("\n")
    .map((line) => (line ? "  " + line : line))
    .join("\n");
  return wrap(inner);
}

function withKey(inner, key, depth) {
  const lines = inner.split("\n");
  const i = lines.findIndex((line) => line.trim().startsWith("<"));
  if (i < 0) return inner;
  lines[i] = lines[i].replace(/^(\s*<[\w.]+)/, `$1 key={${key}}`);
  return lines.join("\n");
}

function printElement(node, depth, report) {
  const pad = "  ".repeat(depth);
  const tag = node.tag.toLowerCase();

  if (tag === "ng-content") return `${pad}{children}`;

  const props = attributes(node, report);
  const children = node.children
    .map((child) => printNode(child, depth + 1, report))
    .filter(Boolean);

  const name = tag === "ng-container" || tag === "ng-template" ? "" : node.tag;
  if (tag === "ng-template") {
    report.note("An <ng-template> was rendered inline. If it was an else branch or a named outlet, wire it by hand.");
  }

  const open = name
    ? `<${name}${props.length ? " " + props.join(" ") : ""}`
    : "<";

  if (!children.length) return name ? `${pad}${open} />` : `${pad}<></>`;
  return [`${pad}${open}>`, ...children, `${pad}</${name}>`].join("\n");
}

/* ------------------------------------------------------------------ public */

export function translate(html, { indent = 3 } = {}) {
  const notes = [];
  const models = new Set();
  const refs = new Set();
  const locals = new Set();
  const collections = new Set();
  const report = {
    note: (text) => {
      if (!notes.includes(text)) notes.push(text);
    },
    model: (target) => models.add(target),
    ref: (name) => refs.add(name),
    local: (name) => locals.add(name),
    collection: (code) => collections.add(code),
  };

  const nodes = parse(html ?? "");
  const printed = nodes.map((node) => printNode(node, indent, report)).filter(Boolean);

  let jsx;
  if (!printed.length) {
    jsx = `${"  ".repeat(indent)}<></>`;
  } else if (printed.length === 1) {
    jsx = printed[0];
  } else {
    const pad = "  ".repeat(indent);
    jsx = [`${pad}<>`, ...printed.map((p) => p.split("\n").map((l) => (l ? "  " + l : l)).join("\n")), `${pad}</>`].join("\n");
  }

  const modelRoots = new Set([...models].map((m) => m.split(".")[0]));
  const reads = [...refs].filter((name) => !locals.has(name) && !modelRoots.has(name)).sort();
  return { jsx, notes, models: [...models], reads, collections: [...collections] };
}
