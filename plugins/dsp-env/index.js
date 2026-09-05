import { readFile } from "node:fs/promises";

/**
 * The configuration a legacy front end reaches for at runtime. An app reads
 * process.env.API_URL, import.meta.env.VITE_KEY, an Angular environment
 * module, or a config object the server dropped on window, and every one of
 * those reads is a value somebody has to supply before the port runs. Nothing
 * in the source says what the value is, and the port must not guess one; what
 * the source does say, exactly, is the set of names.
 *
 * This reads the names and where each is read, whether the read carries a
 * fallback, and which names a .env file in the tree declares. It never reads
 * the right hand side of a .env line and never captures a fallback literal,
 * because both are where a value lives, and a report that repeats a value has
 * moved the exposure rather than named it. The keys land in ENV.md and, for
 * the ones a process environment supplies, in a .env.example with every
 * value blank, so the port asks for what it needs by name.
 */

const PROCESS_ENV = /\bprocess\s*\.\s*env\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\])/g;
const META_ENV = /\bimport\s*\.\s*meta\s*\.\s*env\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\])/g;
const ENV_MODULE_IMPORT = /import\s*\{[^}]*\benvironment\b[^}]*\}\s*from\s*["'][^"']*environments?\/environment[^"']*["']/;
const ENV_MODULE_READ = /\benvironment\s*\.\s*([A-Za-z_$][\w$]*)/g;
const WINDOW_CONFIG = /\b(?:window|globalThis)\s*\.\s*(__?[A-Za-z]*(?:ENV|CONFIG|SETTINGS)[A-Za-z_]*__?|[A-Za-z]*(?:Env|Config|Settings))\s*\.\s*([A-Za-z_$][\w$]*)/g;
const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const FALLBACK = /^\s*(\|\||\?\?)/;

const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

export const isDotenv = (rel) => /(^|\/)\.env(\.[\w.-]+)?$/.test(rel);
export const isDotenvExample = (rel) => /(^|\/)\.env\.(example|sample|template|dist)$/i.test(rel);

/** Every configuration read in one script, with its source and line; never a value. */
export function readEnv(text, rel) {
  const findings = [];
  const push = (source, key, m) => {
    if (!key) return;
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 8);
    findings.push({ source, key, line: lineAt(text, m.index), file: rel, fallback: FALLBACK.test(after) });
  };
  for (const m of text.matchAll(PROCESS_ENV)) push("process.env", m[1] ?? m[2], m);
  for (const m of text.matchAll(META_ENV)) push("import.meta.env", m[1] ?? m[2], m);
  if (ENV_MODULE_IMPORT.test(text)) {
    for (const m of text.matchAll(ENV_MODULE_READ)) push("environment module", m[1], m);
  }
  for (const m of text.matchAll(WINDOW_CONFIG)) push(`window.${m[1]}`, m[2], m);
  return findings.sort((a, b) => a.line - b.line);
}

/** The names a .env file declares. The right hand side of each line is never read. */
export function readDotenvNames(text) {
  const names = [];
  for (const line of text.split("\n")) {
    const m = DOTENV_LINE.exec(line);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export default {
  name: "dsp-env",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const scripts = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|svelte|mjs|cjs)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of scripts) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) findings.push(...readEnv(text, file.rel));
      }

      const declared = [];
      const liveFiles = [];
      for (const file of ctx.sources.files.filter((f) => isDotenv(f.rel))) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        const names = readDotenvNames(text);
        declared.push({ file: file.rel, names, example: isDotenvExample(file.rel) });
        if (!isDotenvExample(file.rel)) liveFiles.push(file.rel);
      }

      const keys = new Map();
      for (const f of findings) {
        const id = `${f.source}:${f.key}`;
        if (!keys.has(id)) keys.set(id, { source: f.source, key: f.key, reads: [], fallback: false });
        const k = keys.get(id);
        k.reads.push({ file: f.file, line: f.line });
        k.fallback = k.fallback || f.fallback;
      }
      const declaredNames = new Set(declared.flatMap((d) => d.names));
      const entries = [...keys.values()]
        .map((k) => ({ ...k, declared: declaredNames.has(k.key) }))
        .sort((a, b) => a.source.localeCompare(b.source) || a.key.localeCompare(b.key));
      const runtimeKeys = entries.filter((e) => e.source === "process.env" || e.source === "import.meta.env");
      const undeclared = runtimeKeys.filter((e) => !e.declared && !e.fallback);
      const readNever = [...declaredNames].filter((n) => !entries.some((e) => e.key === n)).sort();

      ctx.env = { entries, declared, liveFiles, undeclared, readNever };
      if (!entries.length && !declared.length) return log.debug("no runtime configuration is read");

      log.info(`${entries.length} configuration key(s) read from ${new Set(findings.map((f) => f.file)).size} file(s)`);
      if (entries.length) {
        ctx.unverified(
          `ENV.md names ${entries.length} configuration key(s) the old front end reads at runtime; ${undeclared.length} ` +
          `carry neither a fallback nor a .env declaration, so the port has no value for them until a person supplies one. ` +
          `Values were never read and none is guessed.`
        );
      }
      if (liveFiles.length) {
        ctx.unverified(
          `${liveFiles.join(", ")} carries real configuration values. The run read its key names only; the file must not be ` +
          `copied into the port or committed. Move the values to the deploy host's secret store and ship .env.example instead.`
        );
      }
    });

    on("emit", async (ctx) => {
      const env = ctx.env;
      if (!env || (!env.entries.length && !env.declared.length)) return;
      await ctx.write("ENV.md", render(env));
      const runtime = env.entries.filter((e) => e.source === "process.env" || e.source === "import.meta.env");
      if (runtime.length) await ctx.write(".env.example", renderExample(runtime));
    });
  },
};

function renderExample(runtime) {
  const lines = runtime.map((e) => {
    const where = e.reads.map((r) => `${r.file}:${r.line}`).join(", ");
    const note = e.fallback ? "; the source carries a fallback when unset" : "";
    return `# read at ${where}${note}\n${e.key}=`;
  });
  return `# Every configuration key the old front end read through ${[...new Set(runtime.map((e) => e.source))].join(" and ")}.
# The values are blank on purpose: the source never states them and this
# tool never guesses one. Fill each in per environment and keep the filled
# file out of version control.

${lines.join("\n\n")}
`;
}

function render({ entries, declared, liveFiles, undeclared, readNever }) {
  const rows = entries.map((e) => {
    const where = e.reads.map((r) => `${r.file}:${r.line}`).join(", ");
    const flags = [e.fallback ? "fallback in source" : null, e.declared ? "declared in .env" : null].filter(Boolean).join(", ") || "no fallback, not declared";
    return `| \`${e.key}\` | ${e.source} | ${where} | ${flags} |`;
  });

  const declaredSection = declared.length
    ? declared.map((d) =>
      `- \`${d.file}\`${d.example ? " (an example file)" : " (a live file; values were not read)"}: ${d.names.length ? d.names.map((n) => `\`${n}\``).join(", ") : "declares no names"}`
    ).join("\n")
    : "No .env file is in the tree.";

  return `# The configuration the old front end reads at runtime

Each key below is a value the app asks its environment for. The source names
the key and never the value, so the port has exactly the same gap: someone
supplies each of these per environment before it runs. Nothing here was
guessed, and the right hand side of any .env line was never read.

| key | read through | where | state |
| --- | --- | --- | --- |
${rows.join("\n") || "| | | | no runtime configuration is read |"}

## Supplied by nobody yet

${undeclared.length
    ? `${undeclared.length} key(s) read from the process environment carry no fallback in the source and appear in no .env file, so a fresh checkout of the port has no value for them:\n\n${undeclared.map((e) => `- \`${e.key}\``).join("\n")}\n\n\`.env.example\` beside this report lists every runtime key with a blank value.`
    : "Every key read from the process environment either carries a fallback in the source or is declared in a .env file."}

## Declared in the tree

${declaredSection}
${readNever.length ? `\nDeclared but never read by any script in the run: ${readNever.map((n) => `\`${n}\``).join(", ")}. A build step or a server may read them; the front end does not.\n` : ""}
${liveFiles.length ? `\n**${liveFiles.join(", ")} holds real values.** Do not copy it into the port and do not commit it. Ship the example file and put the values in the deploy host's secret store.\n` : ""}
---

Keys read through a window config object or an Angular environment module are
supplied by the server or the build, not the process environment, so they are
named above and left out of \`.env.example\`. How the port receives them is a
decision about the deploy, not a value this tool can invent.
`;
}
