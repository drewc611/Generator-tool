import { readFile } from "node:fs/promises";

/**
 * What delays the first paint. A browser building a page stops the moment it
 * meets a resource it must fetch and run before it can continue: a synchronous
 * script in the head halts the parser until the file arrives and executes, a
 * stylesheet holds the first paint until the CSS is in hand, and an @import
 * inside CSS waits for one file only to discover it must fetch another. A port
 * rebuilds the markup and inherits these blocks unless somebody looks; this
 * looks, names each one with the line it sits on, and leaves the unblocking to
 * a person because moving a script is a decision, not a fact.
 */

// The line a match sits on is the count of newlines before its index, plus one.
const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
};

// The head is everything before the first body tag. A script or link after it
// is past the first paint boundary and does not block the same way.
const headEnd = (html) => {
  const m = /<body\b/i.exec(html);
  return m ? m.index : html.length;
};

export function readRenderBlocking(html, rel) {
  const findings = [];
  const limit = headEnd(html);

  // A head script with a src and neither async nor defer stops the parser.
  for (const m of html.matchAll(/<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>/gi)) {
    if (m.index >= limit) continue;
    const attrs = `${m[1]} ${m[3]}`;
    if (/\b(async|defer)\b/i.test(attrs)) continue;
    findings.push({ kind: "blocking-script", detail: m[2], line: lineAt(html, m.index), file: rel });
  }

  // A stylesheet link in the head blocks the first paint. Often acceptable,
  // worth naming so the choice to keep it is made on purpose.
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    if (m.index >= limit) continue;
    const attrs = m[1];
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(attrs)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;
    findings.push({ kind: "blocking-stylesheet", detail: href, line: lineAt(html, m.index), file: rel });
  }

  // An @import inside an inline style block serializes CSS fetches.
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const body = block[1];
    const base = block.index + block[0].indexOf(body);
    for (const im of body.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi)) {
      findings.push({ kind: "css-import", detail: im[1], line: lineAt(html, base + im.index), file: rel });
    }
  }

  return findings;
}

// A standalone stylesheet blocks paint whole; only a leading @import chain adds
// the extra serialized fetch, so a .css file is read for imports at its top,
// before the first rule opens a brace.
export function readCssImports(css, rel) {
  const findings = [];
  const firstRule = css.search(/[^\s@;]*\{/);
  const head = firstRule === -1 ? css : css.slice(0, firstRule);
  for (const im of head.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/gi)) {
    findings.push({ kind: "css-import", detail: im[1], line: lineAt(css, im.index), file: rel });
  }
  return findings;
}

export default {
  name: "dsp-render-blocking",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|shtml|php|jsp|css)$/i.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        if (/\.css$/i.test(file.rel)) findings.push(...readCssImports(text, file.rel));
        else findings.push(...readRenderBlocking(text, file.rel));
      }

      const byKind = {};
      for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      ctx.renderBlocking = { findings, byKind };

      log.info(`${findings.length} render blocking resource(s) across ${files.length} file(s)`);
      if (findings.length) {
        ctx.unverified(
          `RENDER.md names ${findings.length} resource(s) that delay a page's first paint (head scripts with no ` +
          `async or defer, stylesheets in the head, CSS @import chains). Whether each should be unblocked is a ` +
          `judgment for the port; none was moved here.`
        );
      }
    });

    on("emit", async (ctx) => {
      const findings = ctx.renderBlocking?.findings ?? [];
      if (!findings.length) return;
      await ctx.write("RENDER.md", render(findings));
    });
  },
};

const FIX = {
  "blocking-script": "Give the tag async or defer, or move it to the end of body, so the parser is not held while it fetches and runs.",
  "blocking-stylesheet": "Inline the critical rules and load the rest with a media trick, so the first paint does not wait on the full sheet.",
  "css-import": "Replace the @import with a <link> in the markup, or concat the files in a bundler, so the fetches do not serialize.",
};

const TITLE = {
  "blocking-script": "Synchronous head scripts",
  "blocking-stylesheet": "Head stylesheets",
  "css-import": "CSS @import chains",
};

function render(findings) {
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.kind)) groups.set(f.kind, []);
    groups.get(f.kind).push(f);
  }

  const sections = [...groups.entries()].map(([kind, items]) => {
    const lines = items.map((f) => `- \`${f.file}\` line ${f.line}: ${f.detail}`).join("\n");
    return `## ${TITLE[kind] ?? kind}\n\n${lines}\n\n${FIX[kind] ?? ""}`;
  });

  return `# What delays the first paint

A browser stops building the page when it meets a resource it must fetch and
run before it can continue. Each one below held the old page; the port is the
chance to unblock it. Nothing here was moved, only named with the line it sits
on so the choice to keep or unblock it is made on purpose.

${sections.join("\n\n")}
`;
}
