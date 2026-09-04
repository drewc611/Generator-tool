import { buildIr } from "../dsp-ir/ir.js";
import { identifier, jsString, guardHandler, pascal } from "../dsp-ir/emit.js";

/**
 * The Lit target: the custom element with a rendering library, for teams that
 * want the platform plus ergonomics. Where output-html hand rolls escaping
 * and delegation because it depends on nothing, this leans on lit-html for
 * both, which is exactly the trade a team picks Lit to make.
 *
 *   lit: true
 */

const pad = (d) => "  ".repeat(d);
const componentName = (sel) => identifier(pascal(sel), "Screen");

function attributes(node) {
  const out = [];
  const literal = node.classes.filter((c) => c.kind === "literal").map((c) => c.value).join(" ").trim();
  const dynamic = node.classes.filter((c) => c.kind !== "literal");
  if (literal && !dynamic.length) out.push(`class="${literal}"`);
  else if (literal || dynamic.length) {
    const parts = [
      ...(literal ? [jsString(literal)] : []),
      ...dynamic.map((c) => (c.kind === "conditional" ? `(${c.when} ? ${jsString(c.name)} : "")` : `(${c.expression})`)),
    ];
    out.push(`class=\${[${parts.join(", ")}].filter(Boolean).join(" ")}`);
  }
  for (const attr of node.attrs) {
    if (attr.name === "key") continue;
    if (attr.kind === "flag") out.push(attr.name);
    else if (attr.kind === "static") out.push(`${attr.name}="${String(attr.value ?? "").replace(/"/g, "&quot;")}"`);
    else if (attr.kind === "bound") out.push(attr.name === "disabled" ? `?disabled=\${${attr.expression}}` : `${attr.name}=\${${attr.expression}}`);
    else if (attr.kind === "template") out.push(`${attr.name}="${attr.parts.map((p) => (p.expression !== undefined ? `\${${p.expression}}` : p.literal)).join("")}"`);
  }
  if (node.model) {
    const leaf = node.model.split(".").pop().replace(/[^\w$]/g, "");
    if (node.modelKind === "checkbox") {
      out.push(`.checked=\${this.${leaf}}`, `@change=\${(e) => { this.${leaf} = e.target.checked; }}`);
    } else if (node.modelKind === "radio") {
      const own = node.attrs.find((a) => a.name.toLowerCase() === "value");
      const option = own?.kind === "static" ? jsString(own.value) : own?.kind === "bound" ? `(${own.expression})` : null;
      if (option) out.push(`.checked=\${this.${leaf} === ${option}}`, `@change=\${() => { this.${leaf} = ${option}; }}`);
      else out.push(`@change=\${(e) => { this.${leaf} = e.target.value; }}`);
    } else if (node.modelKind === "select-multiple") {
      // A multiple select holds an array; the selected options are read from
      // the event, and each option below says whether it is in the model.
      out.push(`@change=\${(e) => { this.${leaf} = [...e.target.selectedOptions].map((o) => o.value); }}`);
    } else {
      out.push(`.value=\${this.${leaf}}`, `@input=\${(e) => { this.${leaf} = e.target.value; }}`);
    }
  }
  for (const event of node.events) {
    const body = event.handler.startsWith("this.") ? event.handler : `this.${event.handler}`;
    out.push(`@${event.name}=\${(event) => ${guardHandler(event.name, body, event.modifiers)}}`);
  }
  for (const s of node.styles) {
    if (s.kind === "declaration") out.push(`style=\${\`${s.property}: \${${s.literal !== undefined ? jsString(s.literal) : s.expression}}${s.unit ?? ""}\`}`);
  }
  return out;
}

function print(node, depth, scope = null) {
  if (!node) return "";
  const indent = pad(depth);
  switch (node.kind) {
    case "comment": return `${indent}<!--${node.text}-->`;
    case "text": {
      const body = node.parts.map((p) => (p.expression !== undefined ? `\${${p.expression}}` : p.literal.replace(/\s+/g, " "))).join("").trim();
      return body ? indent + body : "";
    }
    case "slot": {
      const name = node.name ? ` name="${node.name.replace(/"/g, "&quot;")}"` : "";
      const fallback = (node.children ?? []).map((c) => print(c, depth + 1, scope)).filter(Boolean);
      if (!fallback.length) return `${indent}<slot${name}></slot>`;
      return [`${indent}<slot${name}>`, ...fallback, `${indent}</slot>`].join("\n");
    }
    case "html": return `${indent}\${unsafeHTML(${node.expression})}`;
    case "fragment": return node.children.map((c) => print(c, depth, scope)).filter(Boolean).join("\n");
    case "when": {
      const inner = node.children.map((c) => print(c, depth + 1, scope)).filter(Boolean).join("\n");
      return `${indent}\${(${node.test}) ? html\`\n${inner}\n${indent}\` : nothing}`;
    }
    case "each": {
      const inner = node.children.map((c) => print(c, depth + 1, scope)).filter(Boolean).join("\n");
      return `${indent}\${repeat(${node.list} ?? [], (${node.item}) => ${node.key}, (${node.item}${node.index ? `, ${node.index}` : ""}) => html\`\n${inner}\n${indent}\`)}`;
    }
    case "element": {
      if (!node.tag) return node.children.map((c) => print(c, depth, scope)).filter(Boolean).join("\n");
      const props = attributes(node);
      // Inside a multiple select, an option with a literal value says
      // whether it is in the model, so the element renders its state.
      if (scope?.selectModel && node.tag === "option") {
        const value = node.attrs.find((a) => a.name.toLowerCase() === "value" && a.kind === "static");
        if (value) props.push(`?selected=\${(this.${scope.selectModel} ?? []).includes(${jsString(value.value)})}`);
      }
      const inner = node.modelKind === "select-multiple" && node.model
        ? { selectModel: node.model.split(".").pop().replace(/[^\w$]/g, "") }
        : scope;
      const open = `<${node.tag}${props.length ? " " + props.join(" ") : ""}`;
      const children = node.children.map((c) => print(c, depth + 1, inner)).filter(Boolean);
      if (!children.length) return `${indent}${open}></${node.tag}>`;
      return [`${indent}${open}>`, ...children, `${indent}</${node.tag}>`].join("\n");
    }
    default: return "";
  }
}

export function toLit(html, { dialect } = {}) {
  const ir = buildIr(html, { dialect });
  // A handler expression like `pick(o)` needs `this.` in a class; expressions
  // referring to reads become `this.` too, handled by prefixing the roots.
  const roots = new Set([...ir.reads, ...ir.models.map((m) => m.split(".")[0])]);
  const withThis = (code) => code.replace(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g, (m, before, name) =>
    roots.has(name) ? `${before}this.${name}` : m);
  const rewrite = (node) => {
    if (!node) return node;
    if (node.kind === "text") return { ...node, parts: node.parts.map((p) => (p.expression !== undefined ? { expression: withThis(p.expression) } : p)) };
    if (node.kind === "when") return { ...node, test: withThis(node.test), children: node.children.map(rewrite) };
    if (node.kind === "each") return { ...node, list: withThis(node.list), key: node.key, children: node.children.map(rewrite) };
    if (node.kind === "html") return { ...node, expression: withThis(node.expression) };
    if (node.kind === "element") return {
      ...node,
      attrs: node.attrs.map((a) => (a.kind === "bound" ? { ...a, expression: withThis(a.expression) } : a.kind === "template" ? { ...a, parts: a.parts.map((p) => (p.expression !== undefined ? { expression: withThis(p.expression) } : p)) } : a)),
      classes: node.classes.map((c) => (c.kind === "conditional" ? { ...c, when: withThis(c.when) } : c.kind === "expression" ? { ...c, expression: withThis(c.expression) } : c)),
      styles: node.styles.map((s) => (s.expression ? { ...s, expression: withThis(s.expression) } : s)),
      events: node.events.map((e) => ({ ...e, handler: withThis(e.handler) })),
      children: node.children.map(rewrite),
    };
    if (node.children) return { ...node, children: node.children.map(rewrite) };
    return node;
  };
  const root = rewrite(ir.root);
  return { markup: print(root, 3) || `${pad(3)}<!-- nothing to render -->`, ...ir };
}

export default {
  name: "output-lit",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.lit) return log.debug("not requested");

      let emitted = 0;
      for (const screen of ctx.screens) {
        const name = componentName(screen.selector);
        const tag = screen.selector.includes("-") ? screen.selector : `x-${screen.selector}`;
        const result = screen.template ? toLit(screen.template) : null;
        const collection = result?.collections[0] ?? "data";
        const props = [...new Set([...screen.inputs, ...(result?.reads ?? []), "loading", "error"])];
        await ctx.write(`src/elements/${name}.lit.js`, ELEMENT({ name, tag, props, models: result?.models ?? [], result, collection, screen }));
        emitted += 1;
      }
      log.info(`${emitted} lit element(s)`);
    });
  },
};

const ELEMENT = ({ name, tag, props, models, result, collection, screen }) => {
  const needsRepeat = result?.markup.includes("repeat(");
  const needsUnsafe = result?.markup.includes("unsafeHTML(");
  const empty = collection === "data" ? "!this.data || (Array.isArray(this.data) && this.data.length === 0)" : `!this.${collection} || this.${collection}.length === 0`;
  const fields = [...new Set([...props, ...models.map((m) => m.split(".").pop().replace(/[^\w$]/g, ""))])];

  return `import { LitElement, html, nothing } from "lit";${needsRepeat ? `\nimport { repeat } from "lit/directives/repeat.js";` : ""}${needsUnsafe ? `\nimport { unsafeHTML } from "lit/directives/unsafe-html.js";` : ""}

/**
 * <${tag}>, ported from ${screen.file} by portamp.
 *
 * Every state below is present on purpose. Delete one only when you have
 * checked the legacy screen genuinely cannot reach it.
 */
export class ${name} extends LitElement {
  static properties = {
${fields.map((p) => `    ${p}: {},`).join("\n")}
  };

  render() {
    if (this.loading) return html\`<p class="state state--loading">Loading…</p>\`;
    if (this.error) return html\`
      <div class="state state--error">
        <strong>Could not load</strong>
        <p>\${String(this.error.message ?? this.error)}</p>
        <button type="button" @click=\${() => this.dispatchEvent(new CustomEvent("retry", { bubbles: true, composed: true }))}>Try again</button>
      </div>\`;
    if (${empty}) return html\`<p class="state state--empty">Nothing to show yet.</p>\`;

    return html\`
${result ? result.markup : "      <!-- No template was found for this component. -->"}
    \`;
  }
}

customElements.define(${jsString(tag)}, ${name});
`;
};
