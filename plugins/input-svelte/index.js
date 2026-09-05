import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { pascal } from "../dsp-ir/emit.js";

/**
 * Reads Svelte components into the same screen shape as every other reader.
 *
 * A `.svelte` file is a `<script>`, a `<style>` and markup in Svelte's own small
 * language: `export let x` props, `{#if}`/`{#each}` blocks, `{expr}`
 * interpolation, `on:event` handlers, `bind:value` two way binding, and a
 * `createEventDispatcher` for outputs. All of it lowers onto the AngularJS
 * attribute dialect the rest of the tool already reads, so a Svelte component
 * reaches the translator, the endpoint map and every emitter as any other
 * component does, and the port can go the other way: Svelte in, React or Vue out.
 *
 * Svelte's blocks wrap arbitrary content, unlike an attribute directive, so a
 * block lowers to a transparent `<ng-container>` carrying the ng directive: the
 * IR treats ng-container as transparent, so no wrapper node is invented. Where a
 * binding has no honest equivalent (a class directive, an else if chain, `@html`)
 * the lowering says so through a note rather than guessing.
 */

const EVENT = new Set(["click", "change", "submit", "input", "blur", "focus",
  "keyup", "keydown", "keypress", "mouseover", "mouseout", "dblclick"]);

/** Split a `.svelte` file into its script, its markup, and drop its style. */
export function splitComponent(text) {
  // The close tag allows trailing whitespace or stray attributes (</script foo>),
  // so a script block cannot survive the strip and leak into the markup.
  const script = /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i.exec(text)?.[1] ?? "";
  let markup = text;
  for (const tag of ["script", "style"]) {
    markup = markup.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\b[^>]*>`, "gi"), "");
  }
  return { script, markup: markup.trim() };
}

/** The `export let` props are the inputs; `dispatch("name")` names are the outputs. */
export function readScript(script) {
  const inputs = [];
  for (const m of script.matchAll(/\bexport\s+let\s+([\w$]+)/g)) if (!inputs.includes(m[1])) inputs.push(m[1]);
  const outputs = [];
  for (const m of script.matchAll(/\bdispatch\s*\(\s*["'`]([\w-]+)["'`]/g)) if (!outputs.includes(m[1])) outputs.push(m[1]);
  const calls = [];
  for (const m of script.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1/g)) {
    calls.push({ method: "GET", path: m[2], headers: null, body: null });
  }
  return { inputs, outputs, calls };
}

/** The inner expression of a `{ ... }` value, or null when it is not braced. */
function braced(value) {
  const m = /^\s*\{\s*([\s\S]*?)\s*\}\s*$/.exec(value ?? "");
  return m ? m[1] : null;
}

/** An event handler reduced to its call: `() => remove(o)` -> `remove(o)`, `save` -> `save()`. */
function handlerCall(expr) {
  const arrow = /^\s*\(?[\w\s,]*\)?\s*=>\s*([\s\S]+?)\s*$/.exec(expr);
  let body = (arrow ? arrow[1] : expr).trim().replace(/;$/, "");
  if (/^[\w.$]+$/.test(body)) body = `${body}()`;
  return body;
}

/** One Svelte attribute, lowered onto the dialect. Returns the replacement token. */
function lowerAttr(name, value, note) {
  // The value may arrive as { expr }; unwrap it once so no brace reaches a directive.
  const expr = braced(value);

  // on:event={handler} and on:event|modifiers={handler}
  const on = /^on:([a-z]+)(\|[\w|]+)?$/i.exec(name);
  if (on) {
    const ev = on[1].toLowerCase();
    if (on[2]) note(`\`${name}\` carries event modifiers (${on[2].slice(1)}) the dialect does not spell; the handler was kept, the modifiers were not.`);
    if (!EVENT.has(ev)) { note(`\`on:${ev}\` has no dialect event; it was left as written.`); return value == null ? name : `${name}="${value}"`; }
    return `ng-${ev === "input" ? "change" : ev}="${handlerCall(expr ?? value ?? "")}"`;
  }
  // bind:value / bind:checked / bind:group are two way models.
  const bind = /^bind:([\w-]+)$/i.exec(name);
  if (bind) {
    const target = (expr ?? value ?? bind[1]).trim();
    if (bind[1] === "value" || bind[1] === "checked" || bind[1] === "group") return `ng-model="${target}"`;
    note(`\`bind:${bind[1]}\` is a two way binding with no dialect equivalent; it was left as a model on ${target}.`);
    return `ng-model="${target}"`;
  }
  // class:name={cond} toggles one class on a condition.
  const cls = /^class:([\w-]+)$/i.exec(name);
  if (cls) return `ng-class="{'${cls[1]}': ${expr ?? value ?? true}}"`;

  // An attribute whose value is a single { expr }.
  if (expr !== null) {
    const lower = name.toLowerCase();
    if (lower === "src") return `ng-src="${expr}"`;
    if (lower === "href") return `ng-href="${expr}"`;
    if (lower === "class") return `ng-class="${expr.replace(/"/g, "'")}"`;
    return `ng-attr-${lower}="${expr.replace(/"/g, "'")}"`;
  }
  // Shorthand {value} means value={value}.
  const shorthand = /^\{([\w$.]+)\}$/.exec(name);
  if (shorthand) return `${shorthand[1]}="{{ ${shorthand[1]} }}"`;

  return value == null ? name : `${name}="${value}"`;
}

/** Lower every opening tag's attributes, leaving text and block markers for the next pass. */
function lowerTags(markup, note) {
  return markup.replace(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^>"'{}])*?)(\/?)>/g, (whole, tag, attrs, slash) => {
    const parts = [];
    const re = /(on:[a-z]+(?:\|[\w|]+)?|bind:[\w-]+|class:[\w-]+|\{[\w$.]+\}|[^\s=/<>"'{}]+)(?:\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\}|[^\s"'>{}]+))?/g;
    let a;
    while ((a = re.exec(attrs))) {
      const name = a[1];
      let raw = a[2] ?? null;
      if (raw && (raw[0] === '"' || raw[0] === "'")) raw = raw.slice(1, -1);
      parts.push(lowerAttr(name, raw, note));
    }
    return `<${tag}${parts.length ? " " + parts.join(" ") : ""}${slash}>`;
  });
}

/**
 * Turn Svelte block markers into transparent ng-container wrappers. A stack
 * tracks each open if chain so an `{:else}` can negate the branches before it.
 */
function lowerBlocks(markup, note) {
  const stack = [];
  let out = "";
  let i = 0;
  const marker = /\{([#:/])(if|each|else|await|key|const|@?\w+)\b([^}]*)\}/g;
  marker.lastIndex = 0;
  let m;
  let last = 0;
  while ((m = marker.exec(markup))) {
    out += markup.slice(last, m.index);
    last = marker.lastIndex;
    const [kind, keyword, rest] = [m[1], m[2], (m[3] ?? "").trim()];

    if (kind === "#" && keyword === "if") {
      out += `<ng-container ng-if="${rest}">`;
      stack.push({ type: "if", conds: [rest] });
    } else if (kind === ":" && keyword === "else" && /^if\b/.test(rest)) {
      const frame = stack[stack.length - 1];
      const cond = rest.replace(/^if\b\s*/, "").trim();
      const negations = (frame?.conds ?? []).map((c) => `!(${c})`).join(" && ");
      out += `</ng-container><ng-container ng-if="${negations ? negations + " && " : ""}(${cond})">`;
      if (frame) frame.conds.push(cond);
      note("An `{:else if}` chain was lowered to sibling conditions; confirm the branches stay mutually exclusive.");
    } else if (kind === ":" && keyword === "else") {
      const frame = stack[stack.length - 1];
      const negations = (frame?.conds ?? []).map((c) => `!(${c})`).join(" && ") || "true";
      out += `</ng-container><ng-container ng-if="${negations}">`;
    } else if (kind === "/" && keyword === "if") {
      out += "</ng-container>";
      stack.pop();
    } else if (kind === "#" && keyword === "each") {
      // {#each LIST as ITEM, IDX (KEY)} -> ng-repeat, dropping the key the dialect does not carry.
      const each = /^([\s\S]+?)\s+as\s+([\w$]+)(?:\s*,\s*([\w$]+))?\s*(?:\(([\s\S]+)\))?\s*$/.exec(rest);
      if (!each) { note(`\`{#each ${rest}}\` could not be read as a loop; it was left as written.`); out += m[0]; }
      else {
        if (each[3]) note(`the each index \`${each[3]}\` maps to $index in the dialect.`);
        out += `<ng-container ng-repeat="${each[2]} in ${each[1].trim()}">`;
        stack.push({ type: "each" });
      }
    } else if (kind === "/" && keyword === "each") {
      out += "</ng-container>";
      stack.pop();
    } else if (kind === "#" && (keyword === "await" || keyword === "key")) {
      note(`a \`{#${keyword}}\` block has no dialect equivalent; its body was kept and the block boundary dropped.`);
    } else if (kind === "/" || kind === ":") {
      // Closing or continuation of a block we noted; drop the marker, keep the body.
    } else {
      out += m[0];
    }
  }
  out += markup.slice(last);
  return out;
}

/**
 * `{expr}` in text, and `{@html expr}`, become interpolation; `@html` is flagged.
 * Only text between tags is touched: a `{ ... }` inside a tag is already a lowered
 * attribute value (an ng-class object, say) and must not be interpolated again.
 */
function lowerText(markup, note) {
  const interp = (segment) =>
    segment.replace(/(?<!\{)\{\s*(@?[^{}]+?)\s*\}(?!\})/g, (whole, inner) => {
      const html = /^@html\s+([\s\S]+)$/.exec(inner);
      if (html) { note("an `{@html}` expression was lowered to interpolation; it renders raw HTML and needs a person's review for safety."); return `{{ ${html[1].trim()} }}`; }
      if (/^@/.test(inner)) return whole;
      return `{{ ${inner} }}`;
    });
  let out = "";
  let last = 0;
  const tag = /<[^>]*>/g;
  let m;
  while ((m = tag.exec(markup))) {
    out += interp(markup.slice(last, m.index)) + m[0];
    last = tag.lastIndex;
  }
  return out + interp(markup.slice(last));
}

export function lowerSvelte(markup, note = () => {}) {
  return lowerText(lowerBlocks(lowerTags(markup, note), note), note);
}

export function readComponent(text, rel, note = () => {}) {
  const { script, markup } = splitComponent(text);
  const { inputs, outputs, calls } = readScript(script);
  const template = markup ? lowerSvelte(markup, note) : null;
  const name = basename(rel, extname(rel));
  const screen = {
    selector: name.replace(/[^\w-]/g, "-").toLowerCase(),
    className: pascal(name),
    file: rel,
    inputs,
    outputs,
    template,
    templateOrigin: template ? "a Svelte component, lowered" : null,
    usesNgIf: /ng-if|ng-show|ng-hide/.test(template ?? ""),
    usesNgFor: /ng-repeat/.test(template ?? ""),
    usesTwoWay: /ng-model/.test(template ?? ""),
    rxjs: [],
    readBy: "svelte",
  };
  return { screen, calls };
}

export default {
  name: "input-svelte",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.svelte$/i.test(f.rel));
      if (!files.length) return log.debug("no Svelte components");
      let count = 0;
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const { screen, calls } = readComponent(text, file.rel, note);
        if (!screen.template) ctx.unverified(`<${screen.selector}> is a Svelte component with no markup, so only its states can be ported.`);
        ctx.screens.push(screen);
        ctx.api.calls.push(...calls.map((c) => ({ ...c, file: file.rel })));
        count += 1;
      }
      if (!count) return log.debug("no Svelte components read");
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Svelte component(s) lowered`);
    });
  },
};
