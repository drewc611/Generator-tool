import { buildIr } from "../dsp-ir/ir.js";
import { jsString } from "../dsp-ir/emit.js";

/**
 * The Alpine target: the modernization path for the apps that were never
 * components. A jQuery page ported to React gets a build system it never
 * asked for; ported to Alpine it stays one HTML file with its behavior
 * written on the markup, which is the same shape it always had, minus the
 * selector soup.
 *
 * portamp writes no external URL, so the page references a vendored
 * alpine.min.js and says to put it there.
 */

const pascal = (sel) =>
  String(sel).split(/[-_\s]/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pad = (depth) => "  ".repeat(depth);

function attributes(node) {
  const out = [];
  const literal = node.classes.filter((c) => c.kind === "literal").map((c) => c.value).join(" ").trim();
  if (literal) out.push(`class="${esc(literal)}"`);
  const dynamic = node.classes.filter((c) => c.kind !== "literal");
  if (dynamic.length) {
    const parts = dynamic.map((c) => (c.kind === "conditional" ? `${c.name}: ${c.when}` : `[${c.expression}]: true`));
    out.push(`:class="${esc(`{ ${parts.join(", ")} }`)}"`);
  }
  for (const attr of node.attrs) {
    if (attr.kind === "flag") out.push(attr.name);
    else if (attr.kind === "static") out.push(`${attr.name}="${esc(attr.value)}"`);
    else if (attr.kind === "bound") out.push(`:${attr.name}="${esc(attr.expression)}"`);
    else if (attr.kind === "template") {
      const expr = attr.parts.map((p) => (p.expression !== undefined ? `\${${p.expression}}` : p.literal)).join("");
      out.push(`:${attr.name}="${esc("`" + expr + "`")}"`);
    }
  }
  if (node.model) out.push(`x-model="${esc(node.model)}"`);
  for (const event of node.events) out.push(`@${event.name}="${esc(event.handler)}"`);
  for (const s of node.styles) {
    if (s.kind === "declaration" && s.literal !== undefined) out.push(`style="${esc(`${s.property}: ${s.literal}`)}"`);
    else if (s.kind === "declaration") out.push(`:style="${esc(`{ ${jsString(s.property)}: ${s.expression}${s.unit ? ` + ${jsString(s.unit)}` : ""} }`)}"`);
    else if (s.kind === "spread") out.push(`:style="${esc(s.expression)}"`);
  }
  return out;
}

function print(node, depth) {
  if (!node) return "";
  const indent = pad(depth);
  switch (node.kind) {
    case "comment":
      return `${indent}<!--${node.text.replace(/--/g, "- -")}-->`;
    case "text": {
      const body = node.parts
        .map((p) => (p.expression !== undefined ? `<span x-text="${esc(p.expression)}"></span>` : esc(p.literal).replace(/\s+/g, " ")))
        .join("")
        .trim();
      return body ? indent + body : "";
    }
    case "slot":
      return `${indent}<!-- projected content went here; Alpine has no slot, inline it -->`;
    case "html":
      return `${indent}<div x-html="${esc(node.expression)}"></div>`;
    case "when": {
      const inner = node.children.map((c) => print(c, depth + 1)).filter(Boolean).join("\n");
      return `${indent}<template x-if="${esc(node.test)}">\n${indent}  <div>\n${inner}\n${indent}  </div>\n${indent}</template>`;
    }
    case "each": {
      const args = node.index ? `(${node.item}, ${node.index})` : node.item;
      const inner = node.children.map((c) => print(c, depth + 1)).filter(Boolean).join("\n");
      return `${indent}<template x-for="${esc(args)} in ${esc(node.list)}" :key="${esc(node.key)}">\n${inner}\n${indent}</template>`;
    }
    case "fragment":
      return node.children.map((c) => print(c, depth)).filter(Boolean).join("\n");
    case "element": {
      if (!node.tag) return node.children.map((c) => print(c, depth)).filter(Boolean).join("\n");
      const attrs = attributes(node);
      const open = `<${node.tag}${attrs.length ? " " + attrs.join(" ") : ""}`;
      const children = node.children.map((c) => print(c, depth + 1)).filter(Boolean);
      if (node.void) return `${indent}${open}>`;
      if (!children.length) return `${indent}${open}></${node.tag}>`;
      return [`${indent}${open}>`, ...children, `${indent}</${node.tag}>`].join("\n");
    }
    default:
      return "";
  }
}

export function toAlpine(html, { dialect } = {}) {
  const ir = buildIr(html, { dialect });
  return { markup: print(ir.root, 2), ...ir };
}

export default {
  name: "output-alpine",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.alpine) return log.debug("not requested");

      let emitted = 0;
      for (const screen of ctx.screens) {
        if (!screen.template) continue;
        const name = pascal(screen.selector) || "Screen";
        const result = toAlpine(screen.template);
        await ctx.write(`src/alpine/${name}.html`, PAGE({ name, screen, result }));
        emitted += 1;
      }
      log.info(emitted ? `${emitted} alpine page(s)` : "no templates to port");
    });
  },
};

const PAGE = ({ name, screen, result }) => {
  const fields = [
    ...result.models.map((m) => `${m.split(".").pop().replace(/[^\w$]/g, "")}: ''`),
    ...result.reads.map((r) => `${r}: undefined`),
    ...(result.collections[0] ? [] : []),
  ];
  return `<!doctype html>
<!-- Ported from ${screen.file} by portamp. Alpine target: one file, behavior
     on the markup, no build step, which is the shape the original had.
     Vendor alpine.min.js next to this file; portamp writes no external URL. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(name)}</title>
  <script defer src="./alpine.min.js"></script>
</head>
<body>
  <div x-data="{ ${fields.join(", ")} }">
${result.markup}
  </div>
  <!-- Wire data in by setting the x-data fields; every name above came from
       the legacy template. Handlers referenced there must be defined on the
       same x-data object. -->
</body>
</html>
`;
};
