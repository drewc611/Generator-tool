import { readFile } from "node:fs/promises";
import { pascal } from "../dsp-ir/emit.js";
import { readPdf } from "./parse.js";

/**
 * Technical documents into the pipeline. A data sheet or a manual shipped as
 * PDF is legacy front end the same way a .shtml page is: somebody's words,
 * laid out once, that a port has to carry without inventing any. The reader
 * extracts what the file proves — text with sizes and positions, the link
 * annotations, the outline, the document's own title — and each document
 * becomes a screen the emitters turn into a component like any other. What
 * the file does not prove is a note, never a guess: an encrypted document is
 * refused by name, an exotic stream is skipped and said, and glyphs with no
 * text mapping are counted rather than replaced with lookalikes.
 *
 * With --site true the documents join the site: each gets its route beside
 * the pages, the old .pdf address redirects to it, and the original file is
 * copied into the port because the PDF, not the port's reading of it, stays
 * the document of record.
 */

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";

/** Body text is the size most of the document is set in, measured by characters. */
export function headingSizes(lines) {
  const weight = new Map();
  for (const l of lines) weight.set(l.size, (weight.get(l.size) ?? 0) + l.text.length);
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const heads = [...weight.keys()].filter((s) => s > body * 1.15).sort((a, b) => b - a);
  return { body, levels: new Map(heads.map((s, i) => [s, Math.min(i + 1, 3)])) };
}

/** The document as markup: headings by measured size, paragraphs by gaps. */
export function documentHtml(doc, rel) {
  const lines = doc.pages.flatMap((p) => p.lines.map((l) => ({ ...l })));
  const { body, levels } = headingSizes(lines);
  const parts = [];
  const contents = [];
  let paragraph = [];
  let prevY = null;
  const flush = () => {
    if (paragraph.length) parts.push(`<p>${esc(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  for (const page of doc.pages) {
    prevY = null;
    for (const line of page.lines) {
      const level = levels.get(line.size);
      if (level) {
        flush();
        const id = slug(line.text);
        contents.push({ level, id, text: line.text });
        parts.push(`<h${level} id="${esc(id)}">${esc(line.text)}</h${level}>`);
      } else {
        if (prevY !== null && prevY - line.y > Math.max(body, line.size) * 1.8) flush();
        paragraph.push(line.text);
      }
      prevY = line.y;
    }
    flush();
  }
  flush();

  const toc = contents.length >= 2
    ? `<nav aria-label="In this document"><ul>\n${contents.map((c) => `<li><a href="#${esc(c.id)}">${esc(c.text)}</a></li>`).join("\n")}\n</ul></nav>\n`
    : "";
  const uris = [...new Set(doc.pages.flatMap((p) => p.links.map((l) => l.uri).filter(Boolean)))];
  const linkList = uris.length
    ? `<h2 id="referenced-addresses">Referenced addresses</h2>\n<ul>\n${uris.map((u) => `<li><a href="${esc(u)}" rel="noopener">${esc(u)}</a></li>`).join("\n")}\n</ul>\n`
    : "";
  const original = `<p><a href="/${esc(rel.replace(/^\.\//, ""))}">The original document (PDF)</a></p>`;
  return `<article>\n${toc}${parts.join("\n")}\n${linkList}${original}\n</article>`;
}

export default {
  name: "input-pdf",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    const docs = [];

    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.pdf$/i.test(f.rel));
      if (!files.length) return log.debug("no documents");

      for (const file of files) {
        const bytes = await readFile(file.path).catch(() => null);
        const doc = bytes ? readPdf(bytes) : null;
        if (!doc) { log.debug(`${file.rel}: not a readable PDF`); continue; }
        if (doc.encrypted) {
          ctx.unverified(`${file.rel} is encrypted. Nothing was read from it; supply a decrypted copy, because guessing at a password is not a thing this tool does.`);
          continue;
        }
        const rel = file.rel.replace(/^\.\//, "");
        const name = rel.replace(/\.pdf$/i, "").split("/").filter((p) => p !== ".").join("-");
        const selector = name.toLowerCase().replace(/[^\w-]/g, "-");
        const lines = doc.pages.flatMap((p) => p.lines);
        const { levels } = headingSizes(lines);
        const firstHeading = lines.find((l) => levels.get(l.size) === 1)?.text ?? null;

        for (const p of doc.problems) ctx.unverified(`${rel}: ${p}`);
        if (doc.unmapped) {
          ctx.unverified(`${rel}: ${doc.unmapped} glyph(s) carry no text mapping and were dropped rather than replaced with lookalikes. The original document is kept beside the page.`);
        }

        const screen = {
          selector,
          className: pascal(selector),
          file: rel,
          inputs: [],
          outputs: [],
          template: documentHtml(doc, rel),
          templateOrigin: "a PDF document, read from its own text operators",
          usesNgIf: false,
          usesNgFor: false,
          usesTwoWay: false,
          rxjs: [],
          readBy: "pdf",
          title: doc.info.title ?? firstHeading ?? name,
        };
        ctx.screens.push(screen);
        docs.push({ rel, screen, doc });
      }
      if (docs.length) {
        log.info(`${docs.length} document(s) read: ${docs.reduce((n, d) => n + d.doc.pages.length, 0)} page(s), ${docs.reduce((n, d) => n + d.doc.outline.length, 0)} outline entr(ies)`);
      }
    });

    // After input-static has assembled the site: the documents join it, each
    // with a route beside the pages and its old address redirected.
    on("plan", (ctx) => {
      if (!ctx.site || !docs.length) return;
      const taken = new Set(ctx.site.pages.map((p) => p.route));
      for (const { rel, screen } of docs) {
        let route = "/" + rel.replace(/\.pdf$/i, "").replace(/^\.\//, "");
        if (taken.has(route)) {
          ctx.unverified(`${rel}: the route ${route} already belongs to a page, so the document lives at ${route}-pdf.`);
          route = `${route}-pdf`;
        }
        taken.add(route);
        ctx.site.pages.push({
          rel,
          route,
          selector: screen.selector,
          className: screen.className,
          title: screen.title,
          description: null,
          og: {},
          canonical: null,
          assets: [rel.split("/").at(-1)],
          cssLinks: [],
          printLinks: [],
          icons: [],
        });
        ctx.site.graph.nodes.push(route);
        ctx.site.redirects.push({ from: "/" + rel, to: route, kind: "extension dropped" });
      }
      log.info(`${docs.length} document(s) joined the site with their originals kept`);
    });

    on("emit", async (ctx) => {
      if (!docs.length) return;
      const lines = [
        "# The documents, read",
        "",
        "What each PDF proved about itself. The port's reading is beside the",
        "original, never instead of it: the PDF stays the document of record",
        "and is copied into the port.",
        "",
      ];
      for (const { rel, doc, screen } of docs) {
        const all = doc.pages.flatMap((p) => p.lines);
        const heads = all.filter((l) => headingSizes(all).levels.has(l.size));
        lines.push(`## \`${rel}\``, "");
        lines.push(`- ${doc.pages.length} page(s), read as **${screen.title}**.`);
        lines.push(`- ${heads.length} heading(s) by measured size; ${doc.outline.length} outline entr(ies) declared by the document itself.`);
        const uris = doc.pages.flatMap((p) => p.links.map((l) => l.uri).filter(Boolean));
        lines.push(`- ${uris.length} link annotation(s)${uris.length ? `: ${[...new Set(uris)].join(", ")}` : ""}.`);
        if (doc.info.producer) lines.push(`- Produced by ${doc.info.producer}.`);
        if (doc.unmapped) lines.push(`- ${doc.unmapped} glyph(s) had no text mapping and were dropped, counted, and noted.`);
        for (const p of doc.problems) lines.push(`- ${p}`);
        if (doc.outline.length) {
          lines.push("", "The declared outline:", "");
          for (const o of doc.outline) lines.push(`${"  ".repeat(o.level - 1)}- ${o.title}`);
        }
        lines.push("");
      }
      await ctx.write("DOCS.md", lines.join("\n"));
      log.info(`DOCS.md describes ${docs.length} document(s)`);
    });
  },
};
