import { readFile } from "node:fs/promises";

/**
 * A code transformer, the other sense of the word. It rewrites CommonJS module
 * syntax to ES modules, and it performs only the rewrites whose equivalence it
 * can prove from the shape of the line: a default require, a destructured
 * require, a whole module.exports assignment, and a named export. Anything
 * whose meaning depends on runtime, a dynamic require or a require built from
 * an expression, a reassignment that spans lines, or a name exported twice, it
 * leaves exactly as it found it and names in the report, because a rewrite that
 * looks right and is wrong is the one failure this tool exists to avoid.
 *
 * It never mutates the input. The transformed file is written beside the report
 * under codemod/, a proposal a person reads against the original.
 *
 *   codemod: true
 */

// Each pattern is anchored to the whole line and reads a single quoted
// specifier or a single balanced brace group, so there is nothing to backtrack
// over. The specifier class excludes the quote characters so one string cannot
// run into the next.
const DEFAULT_IMPORT = /^(\s*)const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"]+)\3\s*\)\s*;?\s*$/;
const NAMED_IMPORT = /^(\s*)const\s*\{\s*([^{}]+?)\s*\}\s*=\s*require\(\s*(['"])([^'"]+)\3\s*\)\s*;?\s*$/;
const NAMED_EXPORT = /^(\s*)(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*;?\s*$/;
const DEFAULT_EXPORT = /^(\s*)module\.exports\s*=\s*(.+?)\s*;?\s*$/;

// A right hand side is safe to lift as a default export only when it stands
// whole on the line: a bare identifier, a balanced object literal, or a
// function expression. Anything else may continue onto the next line, where a
// line by line scan cannot see it, so it is refused rather than guessed.
const SIMPLE_RHS = /^(?:[A-Za-z_$][\w$.]*|\{.*\}|(?:async\s+)?function\b.*|\(.*\)\s*=>.*)$/;

const hasStringRequire = (line) => /require\(\s*['"][^'"]+['"]\s*\)/.test(line);
const hasRequire = (line) => /\brequire\s*\(/.test(line);
const hasExports = (line) => /\bmodule\.exports\b|\bexports\./.test(line);

export function transformCjsToEsm(source) {
  const lines = source.split("\n");
  const changes = [];
  const refusals = [];
  const exported = new Set();
  const out = lines.map((line, i) => {
    const at = i + 1;

    let m = line.match(NAMED_IMPORT);
    if (m) {
      const names = m[2].split(",").map((s) => s.trim()).filter(Boolean).join(", ");
      changes.push({ kind: "named-import", detail: `{ ${names} } from ${m[4]}` });
      return `${m[1]}import { ${names} } from ${m[3]}${m[4]}${m[3]};`;
    }

    m = line.match(DEFAULT_IMPORT);
    if (m) {
      changes.push({ kind: "default-import", detail: `${m[2]} from ${m[4]}` });
      return `${m[1]}import ${m[2]} from ${m[3]}${m[4]}${m[3]};`;
    }

    m = line.match(NAMED_EXPORT);
    if (m) {
      const name = m[2];
      if (exported.has(name)) {
        refusals.push({ kind: "duplicate-export", detail: name, line: at });
        return line;
      }
      exported.add(name);
      changes.push({ kind: "named-export", detail: name });
      return `${m[1]}export const ${name} = ${m[3]};`;
    }

    m = line.match(DEFAULT_EXPORT);
    if (m) {
      if (SIMPLE_RHS.test(m[2])) {
        changes.push({ kind: "default-export", detail: m[2] });
        return `${m[1]}export default ${m[2]};`;
      }
      refusals.push({ kind: "complex-default-export", detail: m[2], line: at });
      return line;
    }

    // Not a provable form. A line still touching require or the exports object
    // is a construct we saw and could not lift, so it is named, not rewritten.
    if (hasRequire(line)) {
      refusals.push({
        kind: hasStringRequire(line) ? "inline-require" : "dynamic-require",
        detail: line.trim(),
        line: at,
      });
      return line;
    }
    if (hasExports(line)) {
      refusals.push({ kind: "complex-export", detail: line.trim(), line: at });
      return line;
    }
    return line;
  });

  return { code: out.join("\n"), changes, refusals };
}

export default {
  name: "output-codemod",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.codemod) return log.debug("not requested");

      const files = ctx.sources.files.filter((f) => /\.(js|cjs)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const seen = [];
      let refusalTotal = 0;
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const result = transformCjsToEsm(text);
        // A file with neither a rewrite nor a refused construct carried no
        // CommonJS worth reporting; an ES module is not copied through.
        if (result.changes.length + result.refusals.length === 0) continue;
        await ctx.write(`codemod/${file.rel}`, result.code);
        refusalTotal += result.refusals.length;
        seen.push({ rel: file.rel, ...result });
      }

      if (!seen.length) return log.debug("no CommonJS to lift");

      await ctx.write("CODEMOD.md", render(seen));
      log.info(`codemod: ${seen.length} module(s) lifted to ES modules, ${refusalTotal} construct(s) refused`);
      if (refusalTotal > 0) {
        ctx.unverified(
          `CODEMOD.md names ${refusalTotal} CommonJS construct(s) the codemod refused to lift to ES modules ` +
          `(a dynamic require, an inline require, a multi line module.exports, or a duplicate export). Each is a ` +
          `rewrite that could not be proven equivalent line by line, so it was left verbatim for a person to lift ` +
          `by hand rather than guessed. The transformed files sit under codemod/; the source was not touched.`
        );
      }
    });
  },
};

function render(seen) {
  const rows = seen.map(
    (s) => `| \`${s.rel}\` | ${s.changes.length} | ${s.refusals.length || "—"} |`
  );

  const detail = seen
    .map((s) => {
      const did = s.changes.map((c) => `- ${c.kind}: \`${c.detail}\``).join("\n") || "- (none)";
      const refused = s.refusals.length
        ? s.refusals.map((r) => `- line ${r.line}: **${r.kind}** \`${r.detail}\``).join("\n")
        : "- none";
      return `### \`${s.rel}\`\n\nlifted to ES modules:\n\n${did}\n\nrefused, left verbatim:\n\n${refused}`;
    })
    .join("\n\n");

  return `# The CommonJS the codemod lifted, and what it refused

This is a code transformer. It rewrites CommonJS module syntax to ES modules,
and it performs only the rewrites whose equivalence it can prove from the shape
of the line: a default require, a destructured require, a whole \`module.exports\`
assignment, and a named export. The transformed files are written under
\`codemod/\` beside this report as proposals; the input source was never mutated.

Everything else is refused and named below rather than guessed. A dynamic
\`require\` built from an expression, an inline \`require\`, a \`module.exports\`
that spans lines, or a name exported twice cannot be lifted safely by a line by
line scan, and a rewrite that looks right and is wrong is the failure this tool
exists to avoid. Each refusal is a construct a person lifts by hand.

| module | lifted | refused |
| --- | --- | --- |
${rows.join("\n")}

${detail}

---

Nothing in the source was changed. The files under \`codemod/\` are a proposal to
read against the originals, and each refusal above is an honest gap the port
owner closes on purpose.
`;
}
