import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { pascal } from "../dsp-ir/emit.js";

/**
 * XSLT, the front end of the early 2000s: an XML document and a stylesheet
 * the browser or the server ran to make the page. The stylesheet is a
 * template in a strict grammar, so this reads it as one: xsl:for-each is a
 * loop over the selected nodes, xsl:if and xsl:choose/when/otherwise are the
 * conditional chain, xsl:value-of is an interpolation, xsl:attribute sets an
 * attribute on its parent, xsl:element names one, xsl:apply-templates over a
 * select with a matching template is that template's body repeated, and
 * xsl:call-template inlines the named template. XPath is lowered to the JS
 * path it names, a/b/@c to a.b.c, count() to .length, not() to !, position()
 * to the index, with the document as the one input called data.
 *
 * XPath is a language and this is not an XPath engine: a predicate filter, an
 * axis, a key or a function this table does not know is named through the
 * notes and kept as written, never guessed. xsl:sort, xsl:param and xsl:copy
 * are named as well. The port then has the shape of the page and the names of
 * its data, which is what a port of an XSLT front end needs first.
 */

/** A strict little XML parser, enough for a well formed stylesheet. */
export function parseXml(text) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < text.length) {
    if (text.startsWith("<!--", i)) { i = text.indexOf("-->", i) + 3; continue; }
    if (text.startsWith("<![CDATA[", i)) { const end = text.indexOf("]]>", i); top().children.push({ text: text.slice(i + 9, end) }); i = end + 3; continue; }
    if (text.startsWith("<?", i)) { i = text.indexOf("?>", i) + 2; continue; }
    if (text.startsWith("<!", i)) { i = text.indexOf(">", i) + 1; continue; }
    if (text[i] === "<") {
      if (text[i + 1] === "/") { const end = text.indexOf(">", i); if (stack.length > 1) stack.pop(); i = end + 1; continue; }
      let j = i + 1; let quote = null;
      while (j < text.length) { const c = text[j]; if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === ">") break; j += 1; }
      const raw = text.slice(i + 1, j);
      const selfClose = /\/\s*$/.test(raw);
      const body = raw.replace(/\/\s*$/, "");
      const tag = /^[^\s/>]+/.exec(body)[0];
      const attrs = {};
      for (const m of body.slice(tag.length).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decode(m[2] ?? m[3] ?? "");
      const node = { tag, attrs, children: [] };
      top().children.push(node);
      if (!selfClose) stack.push(node);
      i = j + 1;
      continue;
    }
    const next = text.indexOf("<", i);
    const chunk = text.slice(i, next < 0 ? text.length : next);
    if (chunk) top().children.push({ text: decode(chunk) });
    i = next < 0 ? text.length : next;
  }
  return root;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** An XPath expression as the JS path it names, relative to `ctx`; what the table does not know is kept and named. */
export function xpathToJs(expr, ctx = "data", note = () => {}) {
  let e = String(expr).trim();
  if (!e) return ctx;
  // The guard reads the whole expression, strings included, because a
  // predicate usually carries one: item[@kind='book'].
  if (/\[[^\]]*[^\d\]][^\]]*\]|::|\bkey\(|\bid\(|\bdocument\(|\/\//.test(e)) {
    note(`The XPath \`${expr}\` uses a predicate, axis or function this reader does not lower; it is kept as written for a person to translate.`);
    return e;
  }
  const parts = e.split(/('(?:[^'])*'|"(?:[^"])*")/);
  return parts.map((part, i) => {
    if (i % 2) return part;
    return part
      .replace(/\bcount\(([^()]+)\)/g, "$1.length")
      .replace(/\bstring-length\(([^()]+)\)/g, "$1.length")
      .replace(/\bnormalize-space\(([^()]+)\)/g, "$1.trim()")
      .replace(/\bnot\(/g, "!(")
      .replace(/\bposition\(\)/g, "($index + 1)")
      .replace(/\bconcat\(([^()]+)\)/g, (m, args) => `(${args.split(",").map((a) => a.trim()).join(" + ")})`)
      .replace(/\btext\(\)/g, ".")
      .replace(/\band\b/g, "&&")
      .replace(/\bor\b/g, "||")
      .replace(/(^|[^!<>=])=(?!=)/g, "$1==")
      .replace(/\[(\d+)\]/g, (m, n) => `[${Number(n) - 1}]`)
      .replace(/(^|[\s(!,+])\.(?=$|[\s)\]=!<>,+])/g, `$1${ctx}`)
      .replace(/(^|[\s(!,+])\.\//g, "$1")
      .replace(/(^|[\s(!,+])\/([A-Za-z_])/g, "$1data.$2")
      .replace(/\.\.\//g, "PARENT.")
      .replace(/@/g, "")
      .replace(/([A-Za-z_][\w-]*|\])\//g, "$1.")
      .replace(/(^|[\s(!,+=|&])([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)(?=$|[\s)\]\[.=!<>,+|&])/g, (m, pre, path) => {
        if (/^(data|true|false|null|PARENT|\$index)\b/.test(path) || /^\d/.test(path) || path === ctx || path.startsWith(`${ctx}.`)) return m;
        return `${pre}${ctx}.${path}`;
      })
      .replace(/\bPARENT\./g, () => { note(`The XPath \`${expr}\` walks to a parent node (..); the port has no parent pointer and the path is left for a person.`); return "PARENT."; })
      .replace(/-([a-z])/g, (m, c) => c.toUpperCase());
  }).join("");
}

const q = (s) => String(s).replace(/"/g, "'");

/** Lower a parsed stylesheet onto the dialect. Returns { template }. */
export function lowerXslt(text, note = () => {}) {
  const doc = parseXml(text);
  const sheet = doc.children.find((n) => /^(xsl:)?(stylesheet|transform)$/.test(n.tag ?? ""));
  if (!sheet) { note("The file is not an XSLT stylesheet (no xsl:stylesheet root); nothing was read from it."); return { template: null }; }
  const templates = sheet.children.filter((n) => n.tag === "xsl:template");
  const main = templates.find((t) => t.attrs.match === "/") ?? templates.find((t) => t.attrs.match);
  if (!main) { note("The stylesheet has no template matching the document root; nothing renders the page."); return { template: null }; }
  const byMatch = new Map(templates.filter((t) => t.attrs.match && t !== main).map((t) => [t.attrs.match.replace(/^.*\//, ""), t]));
  const byName = new Map(templates.filter((t) => t.attrs.name).map((t) => [t.attrs.name, t]));
  const variables = new Map();
  let depth = 0;

  const children = (nodes, ctx) => nodes.map((n) => lower(n, ctx)).join("");
  const lower = (node, ctx) => {
    if (node.text !== undefined) return node.text.replace(/\s+/g, " ").replace(/\{([^{}]+)\}/g, (m, p) => `{{ ${xpathToJs(p, ctx, note)} }}`);
    const t = node.tag;
    if (t === "xsl:value-of") {
      const expr = xpathToJs(node.attrs.select ?? ".", ctx, note);
      return node.attrs["disable-output-escaping"] === "yes" ? `<span ng-bind-html="${q(expr)}"></span>` : `{{ ${expr} }}`;
    }
    if (t === "xsl:text") return node.children.map((c) => c.text ?? "").join("");
    if (t === "xsl:for-each") {
      const list = xpathToJs(node.attrs.select ?? ".", ctx, note);
      const item = (node.attrs.select ?? "item").split("/").pop().replace(/^@/, "").replace(/[^\w]/g, "") || "item";
      if (node.children.some((c) => c.tag === "xsl:sort")) note(`An xsl:sort inside the loop over \`${node.attrs.select}\` ordered the rows; the port renders them in the order the data arrives.`);
      return `<ng-container ng-repeat="${q(`${item} in ${list}`)}">${children(node.children.filter((c) => c.tag !== "xsl:sort"), item)}</ng-container>`;
    }
    if (t === "xsl:if") return `<ng-container ng-if="${q(xpathToJs(node.attrs.test ?? "true", ctx, note))}">${children(node.children, ctx)}</ng-container>`;
    if (t === "xsl:choose") {
      const tried = [];
      return node.children.filter((c) => c.tag === "xsl:when" || c.tag === "xsl:otherwise").map((c) => {
        const nots = tried.map((x) => `!(${x})`);
        if (c.tag === "xsl:when") {
          const test = xpathToJs(c.attrs.test ?? "true", ctx, note);
          const full = [...nots, tried.length ? `(${test})` : test].join(" && ");
          tried.push(test);
          return `<ng-container ng-if="${q(full)}">${children(c.children, ctx)}</ng-container>`;
        }
        return `<ng-container ng-if="${q(nots.join(" && ") || "true")}">${children(c.children, ctx)}</ng-container>`;
      }).join("");
    }
    if (t === "xsl:apply-templates") {
      const select = node.attrs.select;
      if (!select) { note("An xsl:apply-templates with no select applies every template to the children; the port has no equivalent and the children are rendered as text."); return `{{ ${ctx} }}`; }
      const key = select.split("/").pop();
      const target = byMatch.get(key);
      if (!target) { note(`xsl:apply-templates select="${select}" matches no template in the stylesheet this run holds; the nodes are rendered as text.`); return `{{ ${xpathToJs(select, ctx, note)} }}`; }
      if (depth > 8) { note("Templates apply each other more than eight deep; the recursion was stopped."); return ""; }
      depth += 1;
      const out = `<ng-container ng-repeat="${q(`${key.replace(/[^\w]/g, "") || "node"} in ${xpathToJs(select, ctx, note)}`)}">${children(target.children, key.replace(/[^\w]/g, "") || "node")}</ng-container>`;
      depth -= 1;
      return out;
    }
    if (t === "xsl:call-template") {
      const target = byName.get(node.attrs.name);
      if (!target) { note(`xsl:call-template name="${node.attrs.name}" names a template this run does not hold; the call was removed.`); return ""; }
      if (node.children.some((c) => c.tag === "xsl:with-param")) note(`The call to template \`${node.attrs.name}\` passed parameters; its body is inlined and the parameters are not bound.`);
      if (depth > 8) return "";
      depth += 1; const out = children(target.children, ctx); depth -= 1;
      return out;
    }
    if (t === "xsl:variable") {
      if (node.attrs.select) variables.set(node.attrs.name, xpathToJs(node.attrs.select, ctx, note));
      else note(`The variable \`${node.attrs.name}\` is built from markup; it was not carried and its uses are left as written.`);
      return "";
    }
    if (t === "xsl:param" || t === "xsl:sort" || t === "xsl:with-param") { if (t === "xsl:param") note(`The parameter \`${node.attrs.name}\` was supplied by the caller; the port has no value for it.`); return ""; }
    if (t === "xsl:copy-of" || t === "xsl:copy") { note(`xsl:${t.slice(4)} copies nodes verbatim; the selection is rendered as bound html.`); return `<span ng-bind-html="${q(xpathToJs(node.attrs.select ?? ".", ctx, note))}"></span>`; }
    if (t === "xsl:comment" || t === "xsl:message" || t === "xsl:output" || t === "xsl:strip-space" || t === "xsl:preserve-space") return "";
    if (t === "xsl:element") return element(node.attrs.name ?? "div", {}, node.children, ctx);
    if (t?.startsWith("xsl:")) { note(`<${t}> has no dialect equivalent; its contents were kept and what it did is not in the port.`); return children(node.children, ctx); }
    return element(t, node.attrs, node.children, ctx);
  };

  const element = (tag, attrs, kids, ctx) => {
    const parts = [];
    for (const [k, v] of Object.entries(attrs)) {
      if (/^xmlns/.test(k) || k.startsWith("xsl:")) continue;
      if (/\{[^{}]+\}/.test(v)) parts.push(`${k}="${v.replace(/\{([^{}]+)\}/g, (m, p) => `{{ ${q(xpathToJs(p, ctx, note))} }}`)}"`);
      else parts.push(`${k}="${v}"`);
    }
    const rest = [];
    for (const c of kids) {
      if (c.tag === "xsl:attribute") {
        const value = c.children.map((x) => x.text !== undefined ? x.text : x.tag === "xsl:value-of" ? `{{ ${q(xpathToJs(x.attrs.select ?? ".", ctx, note))} }}` : "").join("").trim();
        parts.push(`${c.attrs.name}="${value}"`);
      } else rest.push(c);
    }
    const attrText = parts.length ? " " + parts.join(" ") : "";
    const VOID = new Set(["input", "img", "br", "hr", "meta", "link"]);
    if (VOID.has(tag)) return `<${tag}${attrText}>`;
    return `<${tag}${attrText}>${children(rest, ctx)}</${tag}>`;
  };

  let out = children(main.children, "data");
  for (const [name, expr] of variables) out = out.replace(new RegExp(`\\$${name}\\b`, "g"), () => `(${expr})`);
  if (/\$\w+/.test(out)) note("A `$variable` remains in the template with no select this reader could carry; it is left as written.");
  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(out);
  return { template: (body ? body[1] : out).replace(/>\s+</g, "><").trim() };
}

export default {
  name: "input-xslt",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.xslt?$/i.test(f.rel));
      if (!files.length) return log.debug("no XSLT stylesheets");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      let count = 0;
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text.trim()) continue;
        const { template } = lowerXslt(text, note);
        if (!template) continue;
        const selector = basename(file.rel).replace(/\.xslt?$/i, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^\w-]/g, "-");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          inputs: ["data"],
          outputs: [],
          template,
          templateOrigin: "an XSLT stylesheet, lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "xslt",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} XSLT stylesheet(s) lowered onto the dialect`);
    });
  },
};
