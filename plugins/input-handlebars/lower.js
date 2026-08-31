/**
 * Handlebars, lowered onto the attribute dialect.
 *
 * The block helpers with an exact meaning are carried across: #if, #unless,
 * #each with its else, and triple stache raw HTML. A helper call becomes a
 * function call and says so; a partial cannot be inlined without its file and
 * is named instead of guessed at.
 *
 * Inside an #each, handlebars resolves bare names against the row. That
 * resolution needs the data to reproduce, so `this` is rewritten to the item
 * and bare names are left as written, with a note saying which block they
 * were in.
 */

const attrSafe = (code) => String(code).replace(/"/g, "'");

export function lowerHandlebars(source, note = () => {}, resolvePartial = null, depth = 0) {
  let text = String(source ?? "").replace(/\{\{!--[\s\S]*?--\}\}/g, "").replace(/\{\{![\s\S]*?\}\}/g, "");

  // A partial whose template is in the run inlines, the way the runtime would
  // have rendered it. Arguments on the partial cannot be carried by inlining
  // and are named. The depth guard stops a partial that includes itself.
  if (resolvePartial && depth < 6) {
    text = text.replace(/\{\{>\s*([\w./-]+)([^}]*)\}\}/g, (m, name, args) => {
      const body = resolvePartial(name);
      if (body == null) return m;
      if (args.trim()) note(`The partial \`${name}\` was inlined; the arguments \`${args.trim()}\` were not carried, so its names resolve against this screen's scope.`);
      return lowerHandlebars(body, note, resolvePartial, depth + 1);
    });
  }

  const out = [];
  const stack = [];
  const itemName = () => (stack.filter((f) => f.kind === "each").length ? `item${stack.filter((f) => f.kind === "each").length > 1 ? stack.filter((f) => f.kind === "each").length : ""}` : null);

  let last = 0;
  const re = /\{\{\{?\s*([\s\S]*?)\s*\}?\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    out.push(text.slice(last, m.index));
    last = re.lastIndex;
    const raw = m[0];
    const code = m[1].trim();
    const triple = raw.startsWith("{{{");

    if (code.startsWith("#if ")) {
      const test = code.slice(4).trim();
      out.push(`<ng-container ng-if="${attrSafe(test)}">`);
      stack.push({ kind: "if", tried: [test] });
      continue;
    }
    if (code.startsWith("#unless ")) {
      const test = `!(${code.slice(8).trim()})`;
      out.push(`<ng-container ng-if="${attrSafe(test)}">`);
      stack.push({ kind: "if", tried: [test] });
      continue;
    }
    if (code.startsWith("#each ")) {
      const list = code.slice(6).trim();
      const depth = stack.filter((f) => f.kind === "each").length + 1;
      const item = `item${depth > 1 ? depth : ""}`;
      out.push(`<ng-container ng-repeat="${item} in ${attrSafe(list)}">`);
      stack.push({ kind: "each", item, list });
      continue;
    }
    if (code === "else" || code.startsWith("else if ")) {
      const frame = stack[stack.length - 1];
      if (frame?.kind === "if") {
        const nots = frame.tried.map((c) => `!(${c})`);
        const own = code.startsWith("else if ") ? code.slice(8).trim() : null;
        const test = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
        if (own) frame.tried.push(own);
        out.push(`</ng-container><ng-container ng-if="${attrSafe(test)}">`);
      } else if (frame?.kind === "each") {
        // {{else}} on an #each is the empty state, which is exactly the state
        // ports most often lose.
        out.push(`</ng-container><ng-container ng-if="!${attrSafe(frame.list)} || !${attrSafe(frame.list)}.length">`);
        frame.kind = "if";
        frame.tried = [];
      }
      continue;
    }
    if (/^\/(if|unless|each)$/.test(code)) {
      if (stack.length) { stack.pop(); out.push("</ng-container>"); }
      continue;
    }
    if (code.startsWith(">")) {
      note(`The partial \`{{${code}}}\` renders a template this run does not hold, so it could not be inlined. It was removed; port the partial and wire it in.`);
      continue;
    }
    if (code.startsWith("@")) {
      note(`\`{{${code}}}\` is loop metadata the dialect does not carry. Rewire it from the loop index in the port.`);
      continue;
    }

    let expr = code;
    const item = itemName();
    if (item) {
      if (expr === "this" || expr === ".") expr = item;
      else if (expr.startsWith("this.") || expr.startsWith("./")) expr = `${item}.${expr.replace(/^this\.|^\.\//, "")}`;
      else if (/^[\w$]+(\.[\w$]+)*$/.test(expr)) {
        // A bare name inside an #each resolves against the row first in
        // handlebars. Without the data the winner is unknowable, so it stays
        // as written and the ambiguity has a name.
        note(`Inside an #each, \`{{${expr}}}\` resolves against the row before the outer scope. It was kept as written; prefix it with the row where it was a row field.`);
      }
    }
    const call = /^([\w$]+)((?:\s+(?:[\w$.@/]+|"[^"]*"|'[^']*'))+)$/.exec(expr);
    if (call) {
      const args = call[2].trim().split(/\s+/).join(", ");
      expr = `${call[1]}(${args})`;
      note(`The helper \`{{${code}}}\` became the call \`${expr}\`. Confirm a function by that name exists in the port.`);
    }

    if (triple) {
      out.push(`<ng-container ng-bind-html="${attrSafe(expr)}"></ng-container>`);
      continue;
    }
    out.push(`{{ ${expr} }}`);
  }
  out.push(text.slice(last));

  while (stack.length) { stack.pop(); out.push("</ng-container>"); }
  return out.join("");
}
