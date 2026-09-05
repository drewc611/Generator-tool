import { readFile } from "node:fs/promises";

/**
 * The sharp edges a legacy front end carries into its markup and its scripts:
 * an inline event handler that a Content Security Policy would forbid, an eval
 * that runs whatever a string holds, an innerHTML write that trusts its input,
 * a document.write that rewrites the page, a target=_blank link that hands the
 * opener to whatever it opened, a page that ships no CSP at all.
 *
 * This reads them and names them, and proposes the fix a person would make. It
 * performs none: rewriting how an app handles events or renders untrusted text
 * is a decision with behavior consequences, so each finding names the risk and
 * leaves the change to someone who can weigh it. Like the secret gate, it never
 * prints a captured value; a finding carries only its kind and a structural
 * detail, an attribute name or an href, never user data.
 */

// The href of a link, its quotes stripped, or null. The alternation keeps the
// catch-all branch clear of quote characters so the scan cannot backtrack.
const attrValue = (attrs, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "i").exec(attrs);
  if (!m) return null;
  const raw = m[1];
  return /^["']/.test(raw) ? raw.slice(1, -1) : raw;
};

export function readSecurity(text, rel) {
  const findings = [];

  // An inline handler is a CSP violation waiting to happen; the attribute name
  // is structural, the value it holds is not read.
  for (const m of text.matchAll(/\son([a-z]+)\s*=/gi)) {
    findings.push({ kind: "inline-handler", detail: `on${m[1].toLowerCase()}`, file: rel });
  }

  for (const _ of text.matchAll(/\beval\s*\(/g)) {
    findings.push({ kind: "eval", detail: "eval(...)", file: rel });
  }

  for (const _ of text.matchAll(/\.innerHTML\s*=/g)) {
    findings.push({ kind: "inner-html", detail: ".innerHTML =", file: rel });
  }
  for (const _ of text.matchAll(/dangerouslySetInnerHTML/g)) {
    findings.push({ kind: "inner-html", detail: "dangerouslySetInnerHTML", file: rel });
  }

  for (const _ of text.matchAll(/document\.write(?:ln)?\s*\(/g)) {
    findings.push({ kind: "document-write", detail: "document.write(...)", file: rel });
  }

  // Each <a> is captured attributes and all; the quoted alternations bound the
  // catch-all so a long unclosed tag cannot cause catastrophic backtracking.
  for (const m of text.matchAll(/<a\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi)) {
    const attrs = m[1];
    if (!/\btarget\s*=\s*["']?_blank\b/i.test(attrs)) continue;
    const rel_ = attrValue(attrs, "rel");
    if (rel_ && /\bnoopener\b/i.test(rel_)) continue;
    const href = attrValue(attrs, "href");
    findings.push({ kind: "blank-noopener", detail: href ?? "(no href)", file: rel });
  }

  // A full page with a head and no CSP meta ships without the one control that
  // would blunt an injected script. Reported once per such page.
  const looksLikePage = /<!doctype\s+html/i.test(text) || /<html[\s>]/i.test(text);
  if (looksLikePage && /<head[\s>]/i.test(text) && !/<meta[^>]+http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(text)) {
    findings.push({ kind: "no-csp", detail: "no Content-Security-Policy meta", file: rel });
  }

  return findings;
}

const PROPOSALS = {
  "inline-handler":
    "Move the handler to addEventListener in a script the page controls, then a Content Security Policy can forbid inline handlers outright.",
  eval:
    "eval runs whatever the string holds. Replace it with a parser for the shape actually expected (JSON.parse for data), or a lookup keyed by a known set.",
  "inner-html":
    "Assigning untrusted markup renders it. Use textContent for text, or sanitize before writing; in React, prefer children over dangerouslySetInnerHTML.",
  "document-write":
    "document.write rewrites the document and blocks the parser. Build the node and append it, or render through the framework the port emits.",
  "blank-noopener":
    "A target=_blank link lets the opened page reach back through window.opener. Add rel=\"noopener noreferrer\".",
  "no-csp":
    "The page ships no Content Security Policy. Add one that names the hosts the page actually loads from; the port's own hosts are the evidence for it.",
};

const TITLES = {
  "inline-handler": "Inline event handlers",
  eval: "eval",
  "inner-html": "innerHTML written directly",
  "document-write": "document.write",
  "blank-noopener": "target=_blank without rel=noopener",
  "no-csp": "No Content Security Policy",
};

export default {
  name: "dsp-security",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter(
        (f) => /\.(html?|shtml|php|jsp|js|jsx|ts|tsx|vue)$/i.test(f.rel) && !/\.min\./.test(f.rel)
      );
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readSecurity(text, file.rel));
      }
      if (!findings.length) return log.debug("no security signals");

      const byKind = {};
      for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      ctx.security = { findings, byKind };

      log.info(`${findings.length} security finding(s): ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ")}`);
      ctx.unverified(
        `SECURITY.md names ${findings.length} security finding(s) across ${Object.keys(byKind).length} kind(s) ` +
        `(${Object.keys(byKind).join(", ")}). Each is proposed a fix and none was performed; a port that carries the ` +
        `markup forward carries these until someone closes them.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.security?.findings?.length) return;
      await ctx.write("SECURITY.md", render(ctx.security));
    });
  },
};

function render({ findings, byKind }) {
  const groups = [];
  for (const kind of Object.keys(byKind)) {
    const here = findings.filter((f) => f.kind === kind);
    const seen = new Set();
    const lines = [];
    for (const f of here) {
      const key = `${f.file} ${f.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`- \`${f.file}\`: ${f.detail}`);
    }
    groups.push(
      `## ${TITLES[kind] ?? kind}\n\n${lines.join("\n")}\n\n> ${PROPOSALS[kind] ?? "Review this."}`
    );
  }

  return `# Security signals in the source

Read from the markup and the scripts. Each finding carries only its kind and a
structural detail, an attribute name or an href; no user data and no captured
value appears here, the same caution the secret gate keeps.

Nothing here was changed. Rewriting how an app handles events or renders text
is a decision with behavior consequences, so each finding names its risk and
proposes the fix rather than performing it.

${Object.entries(byKind).map(([k, n]) => `- ${TITLES[k] ?? k}: ${n}`).join("\n")}

${groups.join("\n\n")}
`;
}
