import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pascal } from "../dsp-ir/emit.js";

/**
 * portamp reads what it writes.
 *
 * Every other reader lowers a legacy dialect onto the IR. This one reads
 * React, the language portamp most often emits, and lowers its JSX onto the
 * same AngularJS attribute dialect the rest of the tool already reads. That
 * closes the loop two ways: a React front end becomes a source portamp can
 * port to Vue or Svelte, and the emitted React can be read back and checked
 * against what it came from, which is what vis-roundtrip does.
 *
 * JSX has no general inverse, so this handles the shapes portamp emits and the
 * common hand written ones: `{cond && (<x/>)}` is a conditional, `{list.map(
 * (item) => <x/>)}` is a loop, `{expr}` in text is interpolation, an input
 * with value and onChange is a model, and an event prop is an event. A ternary
 * or anything it cannot place is left as written and named, never guessed.
 */

/** The matching `}` for the `{` at `open`, respecting strings and nesting. */
function matchBrace(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === quote && text[i - 1] !== "\\") quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Insert an attribute into the first opening tag of a JSX fragment. */
function injectAttr(jsx, attr) {
  return jsx.replace(/<([a-zA-Z][\w.-]*)/, (m, tag) => `<${tag} ${attr}`);
}

/** Strip a `key={...}` attribute, which the dialect does not carry. */
const dropKey = (jsx) => jsx.replace(/\s+key=\{[^}]*\}/, "");

/** A React event prop name to the dialect event, or null if it has none. */
const EVENT = { onClick: "click", onChange: "change", onInput: "change", onSubmit: "submit",
  onBlur: "blur", onFocus: "focus", onKeyUp: "keyup", onKeyDown: "keydown",
  onMouseOver: "mouseover", onMouseOut: "mouseout", onDoubleClick: "dblclick" };

/** The call inside a handler expression: `(event) => foo(x)` -> `foo(x)`. */
function handlerCall(expr) {
  const arrow = /^\s*\(?[\w\s,]*\)?\s*=>\s*([\s\S]+?)\s*$/.exec(expr);
  let body = (arrow ? arrow[1] : expr).trim().replace(/^\{|\}$/g, "").trim().replace(/;$/, "");
  if (/^[\w.$]+$/.test(body)) body = `${body}()`;
  return body;
}

/**
 * Lower a JSX fragment onto the dialect. Recursive, so a loop inside a
 * conditional inside a loop all come across. `note` records what could not be
 * reversed rather than guessing at it.
 */
export function lowerReact(jsx, note = () => {}) {
  let out = "";
  let i = 0;
  while (i < jsx.length) {
    const c = jsx[i];
    if (c !== "{") { out += c; i += 1; continue; }
    // `{{` is a style-like object; skip the whole double-braced value.
    const end = matchBrace(jsx, i);
    if (end === -1) { out += c; i += 1; continue; }
    const inner = jsx.slice(i + 1, end).trim();

    // The list may be a call chain, related.slice(0, 3).map(...), as long as each call's arguments hold no bracket of their own,
    // and Object.entries(map).map(([key, value]) => ...) is the (key, value) loop the printer wrote for an object.
    const loop = /^(Object\.entries\()?([\w.$]+(?:\([^()]*\))?(?:\.[\w$]+(?:\([^()]*\))?)*)\)?\s*\.\s*map\s*\(\s*\(?\s*(?:\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]|([\w$]+))\s*(?:,\s*[\w$]+\s*)?\)?\s*=>\s*([\s\S]*)$/.exec(inner);
    if (loop) { loop.list = loop[2]; loop.head = loop[3] ? `(${loop[3]}, ${loop[4]})` : loop[5]; loop.body = loop[6]; }
    const cond = /^([^&]+?)\s*&&\s*([\s\S]*)$/.exec(inner);

    if (loop && /<[a-zA-Z]/.test(loop.body)) {
      // The arrow body wraps the JSX in one paren and .map() adds its own, so
      // strip every trailing paren, not just one. key is dropped before the
      // recursion so its expression is never read as interpolation.
      const body = dropKey(loop.body.replace(/^\(\s*/, "").replace(/[\s)]+$/, "").trim());
      out += injectAttr(lowerReact(body, note), `ng-repeat="${loop.head} in ${loop.list}"`);
    } else if (cond && /<[a-zA-Z]/.test(cond[2])) {
      const body = cond[2].replace(/^\(\s*/, "").replace(/[\s)]+$/, "").trim();
      out += injectAttr(lowerReact(body, note), `ng-if="${cond[1].trim()}"`);
    } else if (/\?/.test(inner) && /:/.test(inner) && /<[a-zA-Z]/.test(inner)) {
      note("A JSX ternary was left as written; a conditional with two branches is a person's call to split.");
      out += `{{ ${inner} }}`;
    } else if (/<[a-zA-Z]/.test(inner)) {
      // A brace holding markup this pass could not classify: recurse so its
      // own children still lower, rather than dropping them.
      out += lowerReact(inner, note);
    } else {
      out += `{{ ${inner} }}`;
    }
    i = end + 1;
  }
  return out;
}

/** Lower a component's whole return body: attributes first, then structure. */
export function lowerBody(jsx, note = () => {}) {
  let text = jsx
    // A style object never survives structural comparison and its inner braces
    // confuse the pass; drop it and say so once.
    .replace(/\s+style=\{\{[\s\S]*?\}\}/g, () => { note("A style prop was dropped; the dialect carries structure, not inline style."); return ""; })
    .replace(/\bclassName=/g, "class=");

  // Bound html on an element is the dialect's own binding.
  text = text.replace(/\s+dangerouslySetInnerHTML=\{\{\s*__html:\s*([\s\S]*?)\s*\}\}/g, (m, expr) => ` ng-bind-html="${expr.replace(/"/g, "'")}"`);

  // An input, textarea or select that binds value (or checked) and onChange is a two way model.
  // A handler's arrow carries a >, so an attribute list is read as text outside braces and whole brace groups.
  text = text.replace(/<(input|textarea|select)\b((?:[^>{]|\{[^{}]*\})*)>/g, (m, tag, attrs) => {
    const value = /\b(?:value|checked)=\{([\w.$]+)\}/.exec(attrs);
    if (value && /\bonChange=/.test(attrs)) {
      const rest = attrs.replace(/\b(?:value|checked)=\{[\w.$]+\}/, "").replace(/\bonChange=\{[^}]*\}/, "").replace(/\s+/g, " ").trim();
      return `<${tag} ng-model="${value[1]}"${rest ? " " + rest : ""}>`;
    }
    return m;
  });

  // Event props become dialect events.
  text = text.replace(/\son([A-Z]\w+)=\{([\s\S]*?)\}(?=\s|\/?>)/g, (m, name, expr) => {
    const event = EVENT[`on${name}`];
    if (!event) { note(`The \`on${name}\` handler has no dialect event; it was dropped.`); return ""; }
    return ` ng-${event}="${handlerCall(expr).replace(/"/g, "'")}"`;
  });

  return lowerReact(text, note);
}

export function readComponent(source, rel, note = () => {}) {
  const screens = [];
  // function Name(...) { ... } or const Name = (...) => ...
  const decl = /(?:export\s+default\s+)?function\s+([A-Z]\w*)\s*\(([^)]*)\)|(?:export\s+default\s+)?const\s+([A-Z]\w*)\s*=\s*\(([^)]*)\)\s*=>/g;
  let m;
  while ((m = decl.exec(source))) {
    const name = m[1] ?? m[3];
    const params = m[2] ?? m[4] ?? "";
    const destructured = /\{([^}]*)\}/.exec(params)?.[1] ?? "";
    const inputs = destructured.split(",").map((s) => s.trim().split(/[:=]/)[0].trim()).filter((n) => /^[\w$]+$/.test(n) && !["loading", "error", "onRetry", "children"].includes(n));

    // The component body is from the declaration to the balanced end; the
    // return's JSX is what we lower.
    const bodyStart = source.indexOf("{", m.index + m[0].length - 1);
    const ret = /return\s*\(([\s\S]*?)\);\s*\n?\s*\}?/.exec(source.slice(bodyStart)) ?? /return\s*(<[\s\S]*?>[\s\S]*?);/.exec(source.slice(bodyStart));
    const jsx = ret ? ret[1].trim() : null;
    const template = jsx ? lowerBody(jsx, note) : null;

    const outputs = inputs.filter((n) => /^on[A-Z]/.test(n)).map((n) => n.replace(/^on/, "").replace(/^./, (c) => c.toLowerCase()));
    screens.push({
      selector: name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
      className: name,
      file: rel,
      inputs: inputs.filter((n) => !/^on[A-Z]/.test(n)),
      outputs,
      template,
      templateOrigin: template ? "a React component, lowered" : null,
      usesNgIf: /ng-if/.test(template ?? ""),
      usesNgFor: /ng-repeat/.test(template ?? ""),
      usesTwoWay: /ng-model/.test(template ?? ""),
      rxjs: [],
      readBy: "react",
    });
  }
  return screens;
}

export default {
  name: "input-react",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(jsx|tsx)$/i.test(f.rel) && !/\.(test|spec|stories)\./i.test(f.rel));
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/\breturn\s*[(<]/.test(text) || !/<[A-Za-z]/.test(text)) continue;
        for (const screen of readComponent(text, file.rel, note)) {
          ctx.screens.push(screen);
          count += 1;
        }
      }
      if (!count) return log.debug("no React components");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} React component(s), lowered onto the dialect`);
    });
  },
};
