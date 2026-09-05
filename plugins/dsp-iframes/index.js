import { readFile } from "node:fs/promises";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The iframes a legacy front end embedded, and the two contracts they carry.
 *
 * An iframe drops a whole other document into the page, and a port inherits two
 * things a screenshot never shows:
 *
 *   - a title. To a screen reader an iframe is one item in the list of regions,
 *     and with no title it is announced as "frame" with nothing to say what is
 *     inside. A titled iframe is a named region; an untitled one is a dead end.
 *   - a sandbox. An iframe with no sandbox runs its embedded document with the
 *     same powers the page has: scripts, forms, popups, top-level navigation.
 *     For a third-party embed that is the whole page's trust handed to code the
 *     team does not control; sandbox is the allowlist that takes it back.
 *
 * This finds each <iframe>, records whether it has a title and a sandbox and
 * whether its src points at a host the page itself is not served from, and names
 * the gaps. It records the host of a cross-origin src (the origin only, never
 * the path or its query, which can carry a token) so the report can say which
 * embeds are third-party; a same-origin or relative src is named as such. It
 * counts and changes nothing.
 */

const IFRAME = /<iframe\b([^>]*)>/gi;
const SRC = /\bsrc\s*=\s*(['"])(.*?)\1/i;
const TITLE = /\btitle\s*=\s*(['"])(.*?)\1/i;
const SANDBOX = /\bsandbox\b/i;

// The host of an absolute URL, or null for a relative or non-http src. Only the
// host is returned, never the path or query, which can carry a token.
function hostOf(src) {
  const m = /^(?:https?:)?\/\/([^/?#]+)/i.exec(src.trim());
  return m ? m[1].toLowerCase() : null;
}

export function readIframes(text, rel) {
  const findings = [];
  for (const m of text.matchAll(IFRAME)) {
    const attrs = m[1] ?? "";
    const srcM = SRC.exec(attrs);
    const host = srcM ? hostOf(srcM[2]) : null;
    const title = TITLE.test(attrs) && (TITLE.exec(attrs)[2] ?? "").trim().length > 0;
    const sandbox = SANDBOX.test(attrs);
    const thirdParty = Boolean(host);

    const issues = [];
    if (!title) issues.push("no title: a screen reader announces it as an unnamed frame");
    if (!sandbox) issues.push(thirdParty ? "no sandbox on a third-party embed: it runs with the page's own powers" : "no sandbox");

    findings.push({ host, thirdParty, title, sandbox, issues, line: lineAt(text, m.index), file: rel });
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-iframes",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|vue|svelte|jsx|tsx)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readIframes(text, file.rel));
      }
      const thirdParty = findings.filter((f) => f.thirdParty).length;
      const noTitle = findings.filter((f) => !f.title).length;
      const unsandboxedThirdParty = findings.filter((f) => f.thirdParty && !f.sandbox).length;
      const hosts = [...new Set(findings.map((f) => f.host).filter(Boolean))].sort();
      ctx.iframes = { findings, thirdParty, noTitle, unsandboxedThirdParty, hosts };
      if (!findings.length) return log.debug("no iframes");

      log.info(`${findings.length} iframe(s), ${thirdParty} third-party, ${noTitle} without a title`);
      ctx.unverified(
        `IFRAMES.md names ${findings.length} iframe(s) the old front end embedded; ${noTitle} carry no title (a screen reader ` +
        `announces those as unnamed frames) and ${unsandboxedThirdParty} third-party embed(s) run with no sandbox, with the ` +
        "page's own powers. Only the host of a cross-origin src is recorded, never its path. None was changed here."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.iframes?.findings?.length) return;
      await ctx.write("IFRAMES.md", render(ctx.iframes));
    });
  },
};

function render({ findings, thirdParty, noTitle, unsandboxedThirdParty, hosts }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) => {
        const origin = f.thirdParty ? `third-party \`${f.host}\`` : "same-origin";
        const state = [f.title && "title", f.sandbox && "sandbox"].filter(Boolean).join(", ") || "no title, no sandbox";
        const tail = f.issues.length ? ` — ${f.issues.join("; ")}` : "";
        return `- line ${f.line}: \`<iframe>\` (${origin}; ${state})${tail}`;
      });
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  const hostList = hosts.length ? `\nThird-party hosts embedded: ${hosts.map((h) => `\`${h}\``).join(", ")}.\n` : "";

  return `# The iframes the old front end embedded

An iframe drops a whole other document into the page. Two contracts ride with
it and a port inherits both:

- a **title** names the frame; without one a screen reader announces only
  "frame" with nothing to say what is inside.
- a **sandbox** is the allowlist that decides what the embedded document may do;
  without one it runs with the page's own powers, and for a third-party embed
  that is the page's trust handed to code the team does not control.

**${findings.length}** iframe(s); **${thirdParty}** third-party; **${noTitle}**
with no title; **${unsandboxedThirdParty}** third-party embed(s) with no sandbox.
Only the host of a cross-origin \`src\` is recorded, never its path or query.
${hostList}
${groups.join("\n\n")}

---

Nothing was changed. A title is copy a person writes; which sandbox tokens an
embed truly needs is a decision about what it is allowed to do.
`;
}
