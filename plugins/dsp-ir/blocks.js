import { balanced } from "./scan.js";

/**
 * Angular's built in control flow, lowered onto the attribute dialect.
 *
 * From 17 on, a template can say `@if (x) { ... } @else { ... }` instead of
 * carrying *ngIf. Blocks are not attributes, so the markup parser cannot see
 * them; this pass rewrites each block into the ng-container form the dialect
 * table already reads, before anything parses.
 *
 * The rewrites are semantic, not cosmetic: an @else becomes the conjunction of
 * every branch it is not, so the emitted conditions mean exactly what the
 * blocks meant, and nothing is left "for a person" that a machine can state.
 */

const HEAD = /@(if|for|switch|defer)\s*[({]/g;

// The rewritten condition lands inside attr="...", so a double quoted string
// in it would end the attribute early. Single quotes say the same thing.
const attrSafe = (code) => String(code).replace(/"/g, "'");

function branchChain(conditions) {
  // The branch that runs is the first whose test passes, so each later branch
  // carries the negation of everything before it.
  return (own) => {
    const nots = conditions.map((c) => `!(${c})`);
    return own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
  };
}

export function lowerBlocks(source, note = () => {}) {
  let text = String(source ?? "");
  if (!/@(if|for|switch|defer)\s*[({]/.test(text) && !/@let\s/.test(text)) return text;

  let guard = 0;
  let match;
  HEAD.lastIndex = 0;
  while ((match = HEAD.exec(text)) && guard++ < 500) {
    const kind = match[1];
    const start = match.index;

    const headOpen = text.indexOf(kind === "defer" && text[match.index + 6] === "{" ? "{" : "(", start);
    const head = text[headOpen] === "(" ? balanced(text, headOpen) : null;
    const bodyOpen = text.indexOf("{", head ? headOpen + head.length : headOpen);
    if (bodyOpen < 0) break;
    const body = balanced(text, bodyOpen);
    if (!body) break;

    let end = bodyOpen + body.length;
    let replacement = "";

    if (kind === "if") {
      const conditions = [];
      const chain = [];
      let condition = head.slice(1, -1).trim();
      let block = body.slice(1, -1);
      for (;;) {
        chain.push({ condition, block });
        const rest = text.slice(end);
        const elseIf = /^\s*@else\s+if\s*\(/.exec(rest);
        const bare = /^\s*@else\s*\{/.exec(rest);
        if (elseIf) {
          const co = end + elseIf[0].length - 1;
          const c = balanced(text, co);
          const bo = text.indexOf("{", co + c.length);
          const b = balanced(text, bo);
          condition = c.slice(1, -1).trim();
          block = b.slice(1, -1);
          end = bo + b.length;
        } else if (bare) {
          const bo = end + bare[0].length - 1;
          const b = balanced(text, bo);
          condition = null;
          block = b.slice(1, -1);
          end = bo + b.length;
        } else break;
        if (condition === null) { chain.push({ condition, block }); break; }
      }
      const previous = [];
      replacement = chain.map(({ condition, block }) => {
        const test = condition === null ? branchChain(previous)(null) : previous.length ? branchChain(previous)(condition) : condition;
        if (condition !== null) previous.push(condition);
        return `<ng-container *ngIf="${attrSafe(test)}">${block}</ng-container>`;
      }).join("");
    }

    if (kind === "for") {
      // @for (item of items; track item.id; let i = $index) { ... } @empty { ... }
      const parts = head.slice(1, -1).split(";").map((p) => p.trim());
      const loop = /^(?:let\s+)?([\w$]+)\s+of\s+([\s\S]+)$/.exec(parts[0]);
      const track = parts.find((p) => p.startsWith("track "))?.slice(6).trim();
      if (!loop) { note(`An @for head could not be read: \`${head}\`. The block is kept as text.`); continue; }
      const key = track && track !== "$index" ? ` [key]="${track}"` : "";
      replacement = `<ng-container *ngFor="let ${loop[1]} of ${attrSafe(loop[2].trim())}"${key}>${body.slice(1, -1)}</ng-container>`;

      const empty = /^\s*@empty\s*\{/.exec(text.slice(end));
      if (empty) {
        const bo = end + empty[0].length - 1;
        const b = balanced(text, bo);
        replacement += `<ng-container *ngIf="!${attrSafe(loop[2].trim())} || !${attrSafe(loop[2].trim())}.length">${b.slice(1, -1)}</ng-container>`;
        end = bo + b.length;
      }
    }

    if (kind === "switch") {
      const subject = head.slice(1, -1).trim();
      const inner = body.slice(1, -1);
      const cases = [];
      let scan = 0;
      let step = 0;
      while (step++ < 100) {
        const c = /@case\s*\(/.exec(inner.slice(scan));
        const d = /@default\s*\{/.exec(inner.slice(scan));
        if (c && (!d || c.index < d.index)) {
          const co = scan + c.index + c[0].length - 1;
          const cv = balanced(inner, co);
          const bo = inner.indexOf("{", co + cv.length);
          const b = balanced(inner, bo);
          cases.push({ value: cv.slice(1, -1).trim(), block: b.slice(1, -1) });
          scan = bo + b.length;
        } else if (d) {
          const bo = scan + d.index + d[0].length - 1;
          const b = balanced(inner, bo);
          cases.push({ value: null, block: b.slice(1, -1) });
          scan = bo + b.length;
        } else break;
      }
      const tests = cases.filter((x) => x.value !== null).map((x) => `(${subject}) === (${x.value})`);
      replacement = cases.map((x, i) => {
        const test = x.value === null
          ? tests.map((t) => `!(${t})`).join(" && ")
          : `(${subject}) === (${x.value})`;
        return `<ng-container *ngIf="${attrSafe(test)}">${x.block}</ng-container>`;
      }).join("");
    }

    if (kind === "defer") {
      // Deferred loading is a delivery decision, not a meaning. The content is
      // kept inline; the trigger, the placeholder and the loading block are
      // named as flattened rather than silently dropped.
      note("An @defer block was flattened: its content renders inline in the port. Reintroduce lazy loading as a build decision, not a template one.");
      replacement = body.slice(1, -1);
      let rest;
      while ((rest = /^\s*@(placeholder|loading|error)\s*(?:\([^)]*\)\s*)?\{/.exec(text.slice(end)))) {
        const bo = end + rest[0].length - 1;
        const b = balanced(text, bo);
        if (!b) break;
        note(`The @${rest[1]} block of a deferred region was dropped with its trigger; its content is a transient state of a mechanism the port does not keep.`);
        end = bo + b.length;
      }
    }

    text = text.slice(0, start) + replacement + text.slice(end);
    HEAD.lastIndex = 0;
  }

  // @let is a template local; the IR has no slot for it yet, so it is named.
  text = text.replace(/@let\s+([\w$]+)\s*=\s*[^;]+;/g, (m, name) => {
    note(`\`${m.trim()}\` declared a template local. It was removed; declare \`${name}\` in the component instead.`);
    return "";
  });

  return text;
}
