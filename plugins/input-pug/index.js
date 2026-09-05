import { readFile } from "node:fs/promises";

import { pascal } from "../dsp-ir/emit.js";
import { attrSafe, matchBracket, readInputs, splitCommas } from "../dsp-ir/text.js";

/**
 * Pug, once Jade, the template language of the Express era: a tree written as
 * indentation, tags with .class#id(attrs) shorthand, text after a tag or
 * behind a pipe, and control flow as keywords at the start of a line. The
 * tree is read from the indentation and lowered onto the dialect: if with its
 * else if and else chain negated the way the engine evaluates it, unless as
 * the negated test, each and for as a loop with an index renamed to the
 * dialect's own and an else as the empty state, case and when as the
 * equalities they test, #{expr} as interpolation and !{expr} as bound html,
 * an attribute with an expression as ng-class, ng-href, ng-disabled or
 * ng-attr as its name decides, extends and block composed the way the
 * compiler composes them, a held include inlined, and a mixin defined in the
 * file expanded at its call with its arguments substituted and named.
 *
 * Unbuffered code (- var x), a filter (:markdown), an include the run does
 * not hold and an outer loop's index read inside an inner loop are named
 * rather than approximated. The locals a view reads are its inputs, taken
 * from the expressions only.
 */

const VOID = new Set(["img", "input", "br", "hr", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);
const BOOL = new Set(["disabled", "checked", "selected", "readonly", "required", "open", "multiple", "hidden"]);
const CONTROL = /^(if|else if|else|unless|each|for|while|case|when|default|mixin|block|append|prepend|extends|include|doctype)\b/;

/** #{expr} and !{expr} inside text. */
export function lowerText(text) {
  let out = ""; let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && (text.startsWith("#{", i + 1) || text.startsWith("!{", i + 1) || text.startsWith("#[", i + 1))) { out += text.slice(i + 1, i + 3); i += 3; continue; }
    if (text.startsWith("#[", i)) {
      // #[strong word] is a tag written inside text; it is a line of its own.
      const end = matchBracket(text, i + 1);
      if (end < 0) { out += text.slice(i); break; }
      out += lowerTree(parseTree(text.slice(i + 2, end - 1)));
      i = end;
      continue;
    }
    const bang = text.startsWith("!{", i); const plain = text.startsWith("#{", i);
    if (!bang && !plain) { out += text[i]; i += 1; continue; }
    const end = matchBracket(text, i + 1);
    if (end < 0) { out += text.slice(i); break; }
    const expr = text.slice(i + 2, end - 1).trim();
    out += bang ? `<span ng-bind-html="${attrSafe(expr)}"></span>` : `{{ ${expr} }}`;
    i = end;
  }
  return out;
}

/** One line's tag head: tag, classes, id, attribute list, self close, and what follows. */
export function parseTag(line) {
  let i = 0;
  // svg:path is a tag; "li: a" is a tag and an inline child after the colon.
  const tagM = /^[a-zA-Z][\w-]*(?::(?=\w)[\w-]+)?/.exec(line);
  let tag = tagM ? tagM[0] : "div";
  i = tagM ? tagM[0].length : 0;
  const classes = []; let id = null;
  for (;;) {
    const m = /^([.#])([\w-]+)/.exec(line.slice(i));
    if (!m) break;
    if (m[1] === ".") classes.push(m[2]); else id = m[2];
    i += m[0].length;
  }
  let attrs = "";
  if (line[i] === "(") { const e = matchBracket(line, i); if (e < 0) return null; attrs = line.slice(i + 1, e - 1); i = e; }
  const andAttrs = /^&attributes\(([^)]*)\)/.exec(line.slice(i));
  if (andAttrs) i += andAttrs[0].length;
  let selfClose = false;
  if (line[i] === "/") { selfClose = true; i += 1; }
  let mode = "text"; let rest = line.slice(i);
  if (rest.startsWith(":")) { mode = "inline"; rest = rest.slice(1).trim(); }
  else if (rest.startsWith("!=")) { mode = "html"; rest = rest.slice(2).trim(); }
  else if (rest.startsWith("=")) { mode = "code"; rest = rest.slice(1).trim(); }
  else if (rest === ".") { mode = "blockText"; rest = ""; }
  else rest = rest.replace(/^ /, "");
  return { tag, classes, id, attrs, selfClose, mode, rest, andAttrs: andAttrs?.[1] ?? null };
}

/** Attribute list text onto dialect attributes. */
export function lowerAttrs(text, classes, id, note) {
  const parts = [];
  const extraClasses = [...classes];
  for (const raw of splitCommas(text.replace(/\n/g, " "))) {
    // (a="x" b=expr c) is also legal with spaces only, so each comma part may hold several.
    for (const item of splitWordsKeepingValues(raw)) {
      const m = /^([\w:@.-]+)(?:\s*(!?=)\s*([\s\S]+))?$/.exec(item.trim());
      if (!m) { note(`The attribute \`${item.trim().slice(0, 30)}\` has a shape this reader does not know; it was dropped.`); continue; }
      const [, name, op, value] = m;
      if (!op) { parts.push(name); continue; }
      const isString = /^(["'`])[\s\S]*\1$/.test(value) && !/`[^`]*\$\{/.test(value);
      const plain = isString ? value.slice(1, -1) : null;
      if (name === "class") { if (isString) extraClasses.push(...plain.split(/\s+/).filter(Boolean)); else parts.push(`ng-class="${attrSafe(value)}"`); continue; }
      if (name === "id" && isString) { id = plain; continue; }
      if (isString) { parts.push(`${name}="${lowerText(plain).replace(/"/g, "&quot;")}"`); continue; }
      if (BOOL.has(name)) { parts.push(`ng-${name}="${attrSafe(value)}"`); continue; }
      if (name === "href" || name === "src") { parts.push(`ng-${name}="{{ ${attrSafe(value)} }}"`); continue; }
      if (name === "style") { parts.push(`ng-style="${attrSafe(value)}"`); continue; }
      parts.push(`ng-attr-${name}="{{ ${attrSafe(value)} }}"`);
    }
  }
  const head = [];
  if (id) head.push(`id="${id}"`);
  if (extraClasses.length) head.push(`class="${extraClasses.join(" ")}"`);
  const all = [...head, ...parts];
  return all.length ? " " + all.join(" ") : "";
}

function splitWordsKeepingValues(text) {
  const out = []; let depth = 0; let quote = null; let start = 0; let sawEq = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) { if (c === "\\") i += 1; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") depth -= 1;
    else if (c === "=") sawEq = true;
    else if (/\s/.test(c) && depth === 0) {
      // A value is a JS expression and may carry spaces (a ? "x" : ""); a space
      // ends the attribute only where the next word is another attribute's name
      // and the value so far does not end in an operator waiting for more.
      const before = text.slice(start, i);
      if (sawEq && /=\s*$/.test(before)) continue;
      if (sawEq && /[?:+\-*/&|=<>,!]\s*$/.test(before)) continue;
      // The next word may also be a bare boolean (checked) followed by another attribute.
      if (sawEq && !/^\s*[\w:@.-]+(\s*!?=|\s*,|\s*$|\s+[\w:@.-]+\s*(!?=|,|$|\s))/.test(text.slice(i))) continue;
      if (i > start) out.push(before); start = i + 1; sawEq = false;
    }
  }
  if (text.length > start) out.push(text.slice(start));
  return out.filter((x) => x.trim());
}

/** Lines into a tree by indentation. */
export function parseTree(source) {
  const root = { indent: -1, line: "", children: [] };
  const stack = [root];
  const lines = String(source ?? "").replace(/\r\n/g, "\n").split("\n");
  for (let n = 0; n < lines.length; n += 1) {
    const raw = lines[n];
    if (!raw.trim()) continue;
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, "  ").length;
    let line = raw.trim();
    // An attribute list may run over several lines; it closes where its bracket does.
    const open = /^(?:\+[\w-]+|[a-zA-Z][\w-]*(?::[\w-]+)?)?(?:[.#][\w-]+)*\(/.exec(line);
    while (open && matchBracket(line, open[0].length - 1) < 0 && n + 1 < lines.length) { n += 1; line += " " + lines[n].trim(); }
    const node = { indent, line, children: [], n: n + 1 };
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root;
}

/** The text of a node's subtree as written, for block text and raw includes. */
const subtreeText = (node) => node.children.map((c) => `${c.line}${c.children.length ? " " + subtreeText(c) : ""}`).join(" ");

/** Compose extends/block and includes; returns a tree ready to lower. */
export function compose(root, resolve, note, depth = 0) {
  const inline = (node) => {
    node.children = node.children.flatMap((c) => {
      const im = /^include(?::\w+)?\s+(\S+)$/.exec(c.line);
      if (im && resolve && depth < 6) {
        const body = resolve(im[1]);
        if (body == null) { note(`include ${im[1]} names a file this run does not hold; the tag was removed and the content stands without it.`); return []; }
        if (!/\.(pug|jade)$/i.test(im[1]) && /\.\w+$/.test(im[1])) return [{ indent: c.indent, line: `| ${String(body).replace(/[{}#!]/g, (ch) => `&#${ch.charCodeAt(0)};`).replace(/\n/g, " ")}`, children: [], n: c.n }];
        const sub = compose(parseTree(body), resolve, note, depth + 1);
        return sub.children.map((k) => { shift(k, c.indent - (sub.children[0]?.indent ?? 0)); return k; });
      }
      inline(c); return [c];
    });
    return node;
  };
  const ext = root.children.find((c) => /^extends\s+/.test(c.line));
  if (ext && resolve && depth < 6) {
    const name = ext.line.replace(/^extends\s+/, "").trim();
    const layout = resolve(name);
    if (layout != null) {
      // An include at the top of an extending template usually carries mixins;
      // it is inlined first so they are declared before the page is composed.
      inline(root);
      const blocks = new Map();
      for (const c of root.children) {
        const bm = /^(block|append|prepend)\s+(?:(append|prepend)\s+)?(\w+)$/.exec(c.line);
        if (bm) blocks.set(bm[3], { mode: bm[2] ?? (bm[1] === "block" ? "replace" : bm[1]), children: c.children });
        else if (c !== ext && c.line && !/^(mixin|include)\b/.test(c.line)) note("Markup outside any block in a template that extends a layout is never rendered by Pug; it was dropped.");
      }
      const layoutTree = compose(parseTree(layout), resolve, note, depth + 1);
      const fill = (node) => {
        node.children = node.children.flatMap((c) => {
          const bm = /^block\s+(\w+)$/.exec(c.line);
          if (bm) {
            const own = blocks.get(bm[1]);
            if (!own) return c.children.map((k) => (fill(k), k));
            const kids = own.mode === "replace" ? own.children : own.mode === "append" ? [...c.children, ...own.children] : [...own.children, ...c.children];
            return kids.map((k) => (fill(k), k));
          }
          fill(c); return [c];
        });
        return node;
      };
      // Mixins the child declared stay visible to the composed page.
      const mixins = root.children.filter((c) => /^mixin\s+/.test(c.line));
      root = fill(layoutTree);
      root.children = [...mixins, ...root.children.filter((c) => !/^extends\s+/.test(c.line))];
      return root;
    }
    note(`extends ${name} names a layout this run does not hold; the template stands without it.`);
    root.children = root.children.filter((c) => c !== ext);
  }
  return inline(root);
}
const shift = (node, by) => { node.indent += by; node.children.forEach((k) => shift(k, by)); };

/** Lower a composed tree onto the dialect. */
export function lowerTree(root, note = () => {}) {
  const mixins = new Map();
  const out = [];
  const lowerChildren = (children) => {
    for (let idx = 0; idx < children.length; idx += 1) {
      const node = children[idx];
      const line = node.line;
      if (line.startsWith("//-")) continue;
      if (line.startsWith("//")) { continue; }
      if (line.startsWith("|")) { out.push(lowerText(line.slice(1).replace(/^ /, ""))); continue; }
      if (line.startsWith("<")) { out.push(lowerText(line)); lowerChildren(node.children); continue; }
      if (line.startsWith("-")) { note(`Unbuffered code \`${line.slice(0, 40)}\` ran while rendering; it was not carried and its values are not in the port.`); continue; }
      if (line.startsWith("=") || line.startsWith("!=")) { const html = line.startsWith("!="); const expr = line.replace(/^!?=/, "").trim(); out.push(html ? `<span ng-bind-html="${attrSafe(expr)}"></span>` : `{{ ${expr} }}`); continue; }
      if (line.startsWith(":")) { note(`The filter \`${line.split(/\s/)[0]}\` transformed its block on the server; the block was kept as text.`); out.push(lowerText(subtreeText(node))); continue; }
      if (/^doctype\b/.test(line)) continue;
      if (/^mixin\s+/.test(line)) {
        const mm = /^mixin\s+([\w-]+)(?:\(([^)]*)\))?/.exec(line);
        mixins.set(mm[1], { params: (mm[2] ?? "").split(",").map((p) => p.trim()).filter(Boolean), children: node.children });
        continue;
      }
      if (line.startsWith("+")) {
        const cm = /^\+([\w-]+)(?:\(([\s\S]*)\))?(.*)$/.exec(line);
        const mixin = mixins.get(cm[1]);
        if (!mixin) { note(`+${cm[1]} calls a mixin this run does not hold (an include the run lacks); the call was removed.`); continue; }
        const args = cm[2] !== undefined ? splitCommas(cm[2]) : [];
        const bound = new Map(mixin.params.map((p, i) => [p.replace(/^\.\.\./, ""), args[i] ?? "undefined"]));
        const clone = JSON.parse(JSON.stringify(mixin.children));
        // The mixin's `block` is the caller's own children, spliced in where it stood.
        const substitute = (arr) => arr.flatMap((n) => {
          if (n.line === "block") return JSON.parse(JSON.stringify(node.children));
          for (const [p, v] of bound) {
            const lit = /^(["'])([\s\S]*)\1$/.exec(v);
            n.line = n.line.replace(new RegExp(`#\\{\\s*${p}\\s*\\}`, "g"), () => (lit ? lit[2] : `#{${v}}`));
            // A parameter followed by = is an attribute name; followed by == it is the parameter.
            n.line = n.line.replace(new RegExp(`(?<![\\w.$])${p}\\b(?!\\s*=(?!=))`, "g"), () => v);
          }
          n.children = substitute(n.children);
          return [n];
        });
        note(`The mixin \`+${cm[1]}\` was expanded at its call site with its arguments substituted textually. Check any body text that shares a parameter's name.`);
        lowerChildren(substitute(clone));
        continue;
      }
      const cm = CONTROL.exec(line);
      if (cm) {
        const kw = cm[1];
        if (kw === "if" || kw === "unless") {
          const tests = [];
          let t = kw === "if" ? line.slice(2).trim() : `!(${line.slice(6).trim()})`;
          out.push(`<ng-container ng-if="${attrSafe(t)}">`); tests.push(t); lowerChildren(node.children); out.push("</ng-container>");
          while (children[idx + 1] && /^else( if\b|$)/.test(children[idx + 1].line)) {
            idx += 1; const sib = children[idx];
            const nots = tests.map((c) => `!(${c})`);
            const own = /^else if\s+/.test(sib.line) ? sib.line.replace(/^else if\s+/, "").trim() : null;
            const test = own ? [...nots, `(${own})`].join(" && ") : nots.join(" && ");
            if (own) tests.push(own);
            out.push(`<ng-container ng-if="${attrSafe(test)}">`); lowerChildren(sib.children); out.push("</ng-container>");
          }
          continue;
        }
        if (kw === "each" || kw === "for") {
          const em = /^(?:each|for)\s+(\w+)(?:\s*,\s*(\w+))?\s+in\s+([\s\S]+)$/.exec(line);
          if (!em) { note(`\`${line.slice(0, 40)}\` loops in a shape this reader does not know; its body was kept once, unrepeated.`); out.push("<ng-container>"); lowerChildren(node.children); out.push("</ng-container>"); continue; }
          const at = out.length;
          out.push(`<ng-container ng-repeat="${attrSafe(`${em[1]} in ${em[3]}${em[2] ? " track by $index" : ""}`)}">`);
          lowerChildren(node.children);
          if (em[2]) {
            // Inside a nested loop the dialect's $index is the inner one; the
            // outer index is reached through $parent, as AngularJS spells it.
            let inner = 0; const open = [];
            for (let k = at + 1; k < out.length; k += 1) {
              const parent = "$parent.".repeat(inner) + "$index";
              const re = new RegExp(`(?<![\\w.$])${em[2]}\\b`, "g");
              if (inner && re.test(out[k])) note(`The index \`${em[2]}\` of an outer loop is read inside a nested loop; it was written as \`${parent}\`, which the port must carry from the outer loop.`);
              out[k] = out[k].replace(re, parent);
              if (/^<ng-container\b/.test(out[k])) { open.push(/ng-repeat=/.test(out[k])); if (open[open.length - 1]) inner += 1; }
              else if (out[k] === "</ng-container>" && open.pop()) inner -= 1;
            }
          }
          out.push("</ng-container>");
          if (children[idx + 1] && children[idx + 1].line === "else") {
            idx += 1;
            out.push(`<ng-container ng-if="!${attrSafe(em[3])} || !${attrSafe(em[3])}.length">`); lowerChildren(children[idx].children); out.push("</ng-container>");
          }
          continue;
        }
        if (kw === "while") { note(`\`${line.slice(0, 40)}\` loops on a condition; the port repeats over a list it must be given.`); out.push("<ng-container>"); lowerChildren(node.children); out.push("</ng-container>"); continue; }
        if (kw === "case") {
          const subject = line.slice(4).trim(); const tried = []; let pending = [];
          for (const w of node.children) {
            const wm = /^when\s+([\s\S]+?)(?::\s*(.*))?$/.exec(w.line);
            if (wm) {
              const own = `(${subject}) == ${wm[1].trim()}`;
              tried.push(own);
              // A when with no body falls through to the next one that has one.
              if (!wm[2] && !w.children.length) { pending.push(own); continue; }
              const test = [...pending, own].join(" || ");
              pending = [];
              out.push(`<ng-container ng-if="${attrSafe(test)}">`);
              if (wm[2]) lowerChildren([{ line: wm[2].trim(), children: [], indent: w.indent }]); else lowerChildren(w.children);
              out.push("</ng-container>");
            } else if (/^default\b/.test(w.line)) {
              out.push(`<ng-container ng-if="${attrSafe(tried.map((c) => `!(${c})`).join(" && ") || "true")}">`); lowerChildren(w.children); out.push("</ng-container>");
            }
          }
          continue;
        }
        if (kw === "block" || kw === "append" || kw === "prepend") { lowerChildren(node.children); continue; }
        if (kw === "extends" || kw === "include") { note(`\`${line}\` was not composed: its target is not in this run. The line was removed.`); continue; }
        if (kw === "else" || kw === "when" || kw === "default") continue;
      }
      // An element.
      const head = parseTag(line);
      if (!head) { note(`\`${line.slice(0, 40)}\` could not be read as a tag; it was kept as text.`); out.push(lowerText(line)); continue; }
      if (head.andAttrs !== null) note(`&attributes(${head.andAttrs}) spread attributes onto <${head.tag}>; they are not in the port.`);
      const attrs = lowerAttrs(head.attrs, head.classes, head.id, note);
      const tag = head.tag;
      if (VOID.has(tag) || head.selfClose) { out.push(`<${tag}${attrs}>`); continue; }
      out.push(`<${tag}${attrs}>`);
      if (head.mode === "inline") lowerChildren([{ line: head.rest, children: node.children, indent: node.indent + 1 }]);
      else {
        if (head.mode === "text" && head.rest) out.push(lowerText(head.rest));
        else if (head.mode === "code") out.push(`{{ ${head.rest} }}`);
        else if (head.mode === "html") out.push(`<span ng-bind-html="${attrSafe(head.rest)}"></span>`);
        if (head.mode === "blockText") out.push(lowerText(subtreeText(node)));
        else lowerChildren(node.children);
      }
      out.push(`</${tag}>`);
    }
  };
  lowerChildren(root.children);
  return out.join("");
}


export default {
  name: "input-pug",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(pug|jade)$/i.test(f.rel));
      if (!files.length) return log.debug("no Pug templates");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      // A view names its layout relative to itself (../layout); the run holds files by their path.
      const bare = (name) => String(name).replace(/^(\.\.?\/)+/, "").replace(/\.(pug|jade)$/i, "");
      const resolve = (name) => {
        const clean = String(name).replace(/^(\.\.?\/)+/, "");
        const withExt = /\.\w+$/.test(clean) ? clean : `${clean}.pug`;
        const keys = [...bodies.keys()];
        const key = keys.find((k) => k === withExt || k.endsWith(`/${withExt}`))
          ?? keys.find((k) => bare(k) === bare(withExt) || bare(k).endsWith(`/${bare(withExt)}`))
          ?? keys.find((k) => bare(k).split("/").pop() === bare(withExt).split("/").pop());
        return key ? bodies.get(key) : null;
      };
      const extended = new Set();
      for (const text of bodies.values()) for (const m of text.matchAll(/^\s*extends\s+(\S+)/gm)) extended.add(bare(m[1]));

      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const raw = bodies.get(rel) ?? "";
        if (!raw.trim()) continue;
        if ([...extended].some((p) => bare(rel) === p || bare(rel).endsWith(`/${p}`))) { note(`${rel} is a layout other templates extend; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const tree = compose(parseTree(raw), resolve, note);
        let template = lowerTree(tree, note);
        const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(template);
        if (body) template = body[1];
        template = template.trim();
        if (!template) continue;
        const selector = rel.replace(/^(views|templates)\//, "").replace(/\.(pug|jade)$/i, "").split("/").join("-").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          inputs: readInputs(template),
          outputs: [],
          template,
          templateOrigin: "a Pug template, composed and lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "pug",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Pug template(s) composed and lowered onto the dialect`);
    });
  },
};
