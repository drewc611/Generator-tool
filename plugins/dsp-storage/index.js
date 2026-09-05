import { readFile } from "node:fs/promises";

/**
 * The browser storage a legacy front end kept its state in.
 *
 * A page that reads and writes localStorage, sessionStorage or IndexedDB holds
 * state the server never sees: a remembered filter, a draft, a token, a whole
 * offline cache. A port that reproduces the screens but not the storage loses
 * that state on the first load, silently, because nothing in the markup shows
 * it. This finds where the old app touched storage and names the keys, so the
 * port can decide what to carry: localStorage survives a reload and a restart,
 * sessionStorage lasts one tab, an IndexedDB database is a store of its own.
 *
 * It names the key, never the value. A key is an identifier the code chose; the
 * value in a setItem is exactly the sort of thing the secret gate keeps out of
 * a report, a token or a payload, so it is never read. It measures; the port
 * owner decides what state migrates and how.
 */

const STORES = { localStorage: "localStorage", sessionStorage: "sessionStorage" };
// getItem/setItem/removeItem/key with a literal first argument, and bracket access.
const CALL = /\b(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem|key)\s*\(\s*(['"`])([^'"`]*)\3/g;
const BRACKET = /\b(localStorage|sessionStorage)\s*\[\s*(['"`])([^'"`]*)\2\s*\]/g;
const CLEAR = /\b(localStorage|sessionStorage)\s*\.\s*clear\s*\(/g;
const IDB = /\bindexedDB\s*\.\s*open\s*\(\s*(['"`])([^'"`]*)\1/g;

const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

const OP = { getItem: "read", setItem: "write", removeItem: "remove", key: "enumerate" };

export function readStorage(text, rel) {
  const findings = [];
  for (const m of text.matchAll(CALL)) {
    findings.push({ store: STORES[m[1]], op: OP[m[2]] ?? m[2], key: m[4] || "(empty)", line: lineAt(text, m.index), file: rel });
  }
  for (const m of text.matchAll(BRACKET)) {
    findings.push({ store: STORES[m[1]], op: "access", key: m[3] || "(empty)", line: lineAt(text, m.index), file: rel });
  }
  for (const m of text.matchAll(CLEAR)) {
    findings.push({ store: STORES[m[1]], op: "clear", key: null, line: lineAt(text, m.index), file: rel });
  }
  for (const m of text.matchAll(IDB)) {
    findings.push({ store: "indexedDB", op: "open", key: m[2] || "(unnamed)", line: lineAt(text, m.index), file: rel });
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-storage",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|svelte|mjs|html?)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readStorage(text, file.rel));
      }
      const byStore = {};
      for (const f of findings) {
        byStore[f.store] = byStore[f.store] ?? new Set();
        if (f.key) byStore[f.store].add(f.key);
      }
      ctx.storage = { findings, byStore };
      if (!findings.length) return log.debug("no browser storage touched in the scripts");

      const summary = Object.entries(byStore).map(([s, keys]) => `${s} (${keys.size} key${keys.size === 1 ? "" : "s"})`).join(", ");
      log.info(`${findings.length} storage use(s) across ${new Set(findings.map((f) => f.file)).size} file(s): ${summary}`);
      ctx.unverified(
        `STORAGE.md names ${findings.length} place(s) the old front end read or wrote browser storage (${summary}). That ` +
        "is state the port must decide to carry: localStorage survives a reload, sessionStorage lasts a tab, an IndexedDB " +
        "database is its own store. The keys are named; the values are never read. Nothing was migrated here."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.storage?.findings?.length) return;
      await ctx.write("STORAGE.md", render(ctx.storage));
    });
  },
};

function render({ findings, byStore }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const keyList = Object.entries(byStore)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([store, keys]) => `- **${store}**: ${[...keys].sort().map((k) => `\`${k}\``).join(", ") || "(no literal keys)"}`)
    .join("\n");

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) => `- line ${f.line}: ${f.store} ${f.op}${f.key ? ` \`${f.key}\`` : ""}`);
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  return `# The browser storage the old front end kept state in

The old app read and wrote state the server never saw: whatever it put in
localStorage, sessionStorage or IndexedDB. A port that rebuilds the screens but
not the storage loses that state on the first load, silently, because nothing in
the markup shows it. This names where the app touched storage and which keys it
used, so the port can decide what to carry across.

The value each write stored is not shown. A key is an identifier the code chose;
a value can be a token, a draft or a payload, exactly the sort of thing a report
must not repeat, so it is never read.

## The keys, by store

${keyList}

localStorage survives a reload and a restart; sessionStorage lasts a single tab
and is gone when it closes; an IndexedDB database is a store of its own the port
would have to recreate. Which of these state carries into the new app, and how,
is the port owner's decision.

## Where it was touched

${groups.join("\n\n")}

---

Nothing was migrated. This measures the storage the old app relied on and names
the keys; carrying the state, and choosing where it should live in the port, is
the owner's call.
`;
}
