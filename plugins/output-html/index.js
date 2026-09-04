import { toHtml } from "./print.js";
import { jsString, pascal, unique } from "../dsp-ir/emit.js";


const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * A custom element, depending on nothing.
 *
 * Every other target here bets that a particular framework will still be a good
 * idea in ten years. This one does not. It is also the target that makes the
 * portable claim checkable: if the IR really is framework blind, then emitting
 * to a platform with no framework at all should not need anything upstream to
 * change, and it did not.
 *
 * A tag name needs a hyphen to be a valid custom element, which every selector
 * ported from a component framework already has.
 *
 *   html: true
 */
export default {
  name: "output-html",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.html) return log.debug("not requested");

      let emitted = 0;
      for (const screen of ctx.screens) {
        const name = pascal(screen.selector) || "Screen";
        const tag = kebab(screen.selector).includes("-") ? kebab(screen.selector) : `x-${kebab(screen.selector)}`;
        const result = screen.template ? toHtml(screen.template) : null;
        const props = unique([...screen.inputs, ...(result?.reads ?? []), "loading", "error"]);
        const collection = result?.collections[0] ?? "data";

        await ctx.write(`src/elements/${name}.js`, ELEMENT({ name, tag, props, result, collection, screen }));
        for (const note of result?.notes ?? []) ctx.unverified(`<${tag}>: ${note}`);
        emitted += 1;
      }
      if (emitted) await ctx.write("src/elements/runtime.js", RUNTIME);
      log.info(`${emitted} custom element(s)`);
    });
  },
};

const RUNTIME = `/**
 * The whole runtime, because a custom element does not come with one.
 *
 * Escaping is the only thing a string renderer has to get right every single
 * time, so it lives in one place and every interpolation goes through it.
 */
const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (value) =>
  value == null ? "" : String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** An absent or false attribute should not be printed at all. */
export const attr = (name, value) => {
  if (value == null || value === false) return "";
  if (value === true) return " " + name;
  return " " + name + '="' + esc(value) + '"';
};

/**
 * Replacing innerHTML destroys the focused node, so a component that re-renders
 * on input loses the caret after every keystroke. The node is found again by
 * its position in the tree, which holds for the case that matters: typing,
 * where the shape does not change.
 */
const pathOf = (root, node) => {
  const path = [];
  while (node && node !== root && node.parentNode) {
    path.unshift([...node.parentNode.children].indexOf(node));
    node = node.parentNode;
  }
  return path;
};

export function paint(root, html) {
  const active = root.activeElement;
  const path = active ? pathOf(root, active) : null;
  const caret = active && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;

  root.innerHTML = html;

  if (!path) return;
  const restored = path.reduce((node, i) => node?.children?.[i], root);
  if (typeof restored?.focus !== "function") return;
  restored.focus();
  if (caret && typeof restored.setSelectionRange === "function") {
    try { restored.setSelectionRange(caret[0], caret[1]); } catch { /* not a text input */ }
  }
}

/**
 * One listener per event type, on the shadow root.
 *
 * Re-rendering replaces every node underneath, so a listener attached to a node
 * would be lost on the first update. The root survives, so the listener does.
 *
 * It has to be the root and not the host. An event that crosses a shadow
 * boundary is retargeted, so a listener on the host sees the host as the
 * target and can never find the node that was actually clicked.
 */
export function delegate(host, root, events, dispatch) {
  for (const type of events) {
    root.addEventListener(type, (event) => {
      const target = event.target?.closest?.("[data-on-" + type + "]");
      if (!target || !root.contains(target)) return;
      dispatch(Number(target.dataset["on" + type[0].toUpperCase() + type.slice(1)]), event, target);
    });
  }
}
`;

const leafOf = (target) => target.split(".").pop().replace(/[^\w$]/g, "");

const ELEMENT = ({ name, tag, props, result, collection, screen }) => {
  const models = result?.models ?? [];
  const templateHandlers = result?.handlers ?? [];

  // A handler runs outside render(), so the names the template body uses are
  // not in scope there. Each one reopens them from state, minus the row, which
  // arrives as an argument and must not be shadowed by it.
  const scopeFor = (item) => {
    const names = unique([...props, ...models.map(leafOf)]).filter((n) => n !== item && n !== "event");
    return names.length ? `const { ${names.join(", ")} } = this.state; ` : "";
  };

  const handlers = templateHandlers.map((h) => {
    const item = h.scope ? h.scope.item : null;
    const body = h.body.startsWith("this.state.") ? `${h.body}` : `${scopeFor(item)}${h.body}`;
    return `    // ${h.event}${h.scope ? ` on a row of ${h.scope.list}` : ""}\n    (event, ${item ?? "_item"}) => { ${body}; },`;
  });

  // The error state's retry is a handler like any other, so it gets an index
  // like any other. It was a dead attribute until it did.
  const retry = templateHandlers.length;
  handlers.push(`    // retry, from the error state\n    () => { this.dispatchEvent(new CustomEvent("retry", { bubbles: true, composed: true })); },`);
  const events = [...new Set([...(result?.events ?? []), "click"])];

  const rowLookup = (result?.handlers ?? []).some((h) => h.scope)
    ? `\n    const row = node.dataset.i === undefined ? undefined : (this.state.${(result.handlers.find((h) => h.scope).scope.list).replace(/^this\./, "")} ?? [])[Number(node.dataset.i)];`
    : "\n    const row = undefined;";

  const empty = collection === "data"
    ? "!this.state.data || (Array.isArray(this.state.data) && this.state.data.length === 0)"
    : `!${collection} || ${collection}.length === 0`;

  const scope = unique([...props, ...models.map(leafOf)]);

  return `import { attr, delegate, esc, paint } from "./runtime.js";

/**
 * <${tag}>, ported from ${screen.file} by portamp.
 *
 * Every state below is present on purpose. Delete one only when you have
 * checked the legacy screen genuinely cannot reach it.
 *
 * Attributes are strings, which is all the platform gives. Anything richer is
 * set as a property: element.${props[0] ?? "data"} = value.
 */
export class ${name} extends HTMLElement {
  static observedAttributes = [${props.map((p) => jsString(kebab(p))).join(", ")}];

  state = {
${unique([...props, ...models.map(leafOf)]).map((p) => `    ${p}: undefined,`).join("\n")}
  };

  #handlers = [
${handlers.join("\n") || "    // no handlers in this template"}
  ];

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    delegate(this, this.shadowRoot, [${events.map(jsString).join(", ")}], (index, event, node) => {${rowLookup}
      this.#handlers[index]?.call(this, event, row);
      this.render();
    });
    this.render();
  }

  attributeChangedCallback(name, _old, value) {
    this.state[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    this.render();
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.render();
  }

  render() {
    if (!this.shadowRoot) return;
    const { ${scope.length ? unique(scope).join(", ") : ""} } = this.state;
    paint(this.shadowRoot, \`
      <slot name="styles"></slot>
      \${loading ? \`
        <p class="state state--loading" role="status">Loading…</p>
      \` : error ? \`
        <div class="state state--error" role="alert">
          <strong>Could not load</strong>
          <p>\${esc(error.message ?? error)}</p>
          <button type="button" data-on-click="${retry}">Try again</button>
        </div>
      \` : ${empty} ? \`
        <p class="state state--empty">Nothing to show yet.</p>
      \` : \`
${result ? result.markup : "        <!-- No template was found for this component. -->"}
      \`}
    \`);
  }
}

customElements.define(${jsString(tag)}, ${name});
`;
};
