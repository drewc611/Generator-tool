import { attrSafe } from "../dsp-ir/text.js";

/**
 * Underscore template syntax, lowered onto the attribute dialect.
 *
 * `<%= %>` blocks are a full scripting language and this pass does not pretend
 * to run one. It carries across the three constructs that make up nearly every
 * real template: interpolation, if/else, and _.each. Anything else inside
 * <% %> is removed and named, because a dropped construct with a note beats a
 * half construct that renders wrong.
 *
 * The output is markup in the AngularJS attribute dialect, which dsp-ir
 * already reads: interpolation as {{ }}, conditions as ng-if on a container
 * that dissolves, loops as ng-repeat.
 */


export function lowerUnderscore(source, note = () => {}) {
  const text = String(source ?? "");
  const out = [];
  // Each open container remembers what closes it and, for an if chain, the
  // conditions already tried, so an else can negate them.
  const stack = [];

  let last = 0;
  const re = /<%([-=])?([\s\S]*?)%>/g;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    last = re.lastIndex;
    const kind = m[1];
    const code = m[2].trim();

    if (kind) {
      // <%- %> escaped its value; <%= %> did not, and the port always escapes.
      if (kind === "=") {
        note("`<%= %>` interpolated without escaping. The port escapes everything; a value that carried markup will show as text.");
      }
      out.push(`{{ ${code} }}`);
      continue;
    }

    // function (x) { and (x) => { and x => { open the same callback.
    const callback = code.replace(/\(\s*(\[?[\w$,\s]+\]?)\s*\)\s*=>\s*\{$/, "function ($1) {").replace(/([\w$]+)\s*=>\s*\{$/, "function ($1) {");
    // The list may be a call such as Object.keys(o); Object.entries(o).forEach(function ([k, v]) { is the (key, value) loop over an object.
    const each = /^_\.each\s*\(\s*([\w$.]+(?:\([^()]*\))?)\s*,\s*function\s*\(\s*([\w$]+)(?:\s*,\s*([\w$]+))?\s*\)\s*\{$/.exec(callback);
    const forEach = /^([\w$.]+(?:\([^()]*\))?)\.forEach\s*\(\s*function\s*\(\s*([\w$]+)(?:\s*,\s*([\w$]+))?\s*\)\s*\{$/.exec(callback);
    const entries = /^Object\.entries\(\s*([\w$.]+)\s*\)\.forEach\s*\(\s*function\s*\(\s*\[\s*([\w$]+)\s*,\s*([\w$]+)\s*\]\s*\)\s*\{$/.exec(callback);
    const loop = each ?? forEach;
    if (entries) {
      out.push(`<ng-container ng-repeat="${attrSafe(`(${entries[2]}, ${entries[3]}) in ${entries[1]}`)}">`);
      stack.push({ kind: "each" });
      continue;
    }
    if (loop) {
      const list = each ? each[1] : forEach[1];
      // The dialect spells the index $index; the body's reads of its own name are spelled so when the loop closes.
      out.push(`<ng-container ng-repeat="${loop[2]} in ${attrSafe(list)}${loop[3] ? " track by $index" : ""}">`);
      stack.push({ kind: "each", index: loop[3] ?? null, opener: out.length - 1 });
      continue;
    }

    const iff = /^if\s*\(([\s\S]+)\)\s*\{$/.exec(code);
    if (iff) {
      out.push(`<ng-container ng-if="${attrSafe(iff[1].trim())}">`);
      stack.push({ kind: "if", tried: [iff[1].trim()] });
      continue;
    }

    const elseIf = /^\}\s*else\s+if\s*\(([\s\S]+)\)\s*\{$/.exec(code);
    const elseBare = /^\}\s*else\s*\{$/.exec(code);
    if ((elseIf || elseBare) && stack.length && stack[stack.length - 1].kind === "if") {
      const frame = stack[stack.length - 1];
      const nots = frame.tried.map((c) => `!(${c})`);
      const own = elseIf ? elseIf[1].trim() : null;
      const test = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
      if (own) frame.tried.push(own);
      out.push(`</ng-container><ng-container ng-if="${attrSafe(test)}">`);
      continue;
    }

    if (/^\}\s*\)?;?$/.test(code)) {
      if (stack.length) {
        const frame = stack.pop();
        if (frame.index) {
          const safe = frame.index.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const spans = /\{\{[\s\S]*?\}\}|\bng-[\w-]+="[^"]*"/g;
          for (let i = frame.opener + 1; i < out.length; i += 1) out[i] = out[i].replace(spans, (span) => span.replace(new RegExp(`(?<![\\w.$])${safe}(?![\\w$])`, "g"), "$index"));
        }
        out.push("</ng-container>");
      }
      continue;
    }

    note(`A template construct could not be carried across and was removed: \`<% ${code} %>\`.`);
  }
  out.push(text.slice(last));

  while (stack.length) { stack.pop(); out.push("</ng-container>"); }
  return out.join("");
}
