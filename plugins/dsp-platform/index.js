import { readFile } from "node:fs/promises";

/**
 * The browser a legacy front end was written for is gone, and some of what it
 * called went with it. A script that reads document.all, opens a Web SQL
 * database, listens for DOMNodeInserted or reads event.keyCode still parses,
 * still ships, and fails or degrades only when it runs, which is the worst
 * time to learn it. This names each call to an API the platform has removed,
 * deprecated or never standardised, with the status the platform published
 * and the API that replaced it, located by file and line.
 *
 * It reads the call, never the arguments: what a page wrote to a database or
 * passed to escape() is a value this report must not repeat. It measures and
 * changes nothing, because whether a fallback still matters for the port's
 * users is a decision about who they are.
 */

// Each row is a fact about the platform, not a taste: the status is what the
// specification or the engines published, and the replacement is the API the
// same document names. Removed carries the year the last major engine dropped it.
const APIS = [
  { name: "document.all", re: /\bdocument\s*\.\s*all\b/g, status: "deprecated", since: null, use: "document.querySelectorAll or getElementById" },
  { name: "escape() / unescape()", re: /(?<![\w.$])(?:un)?escape\s*\(/g, status: "deprecated", since: null, use: "encodeURIComponent / decodeURIComponent" },
  { name: "showModalDialog", re: /\bshowModalDialog\s*\(/g, status: "removed", since: 2014, use: "<dialog>.showModal()" },
  { name: "attachEvent / detachEvent", re: /\.\s*(?:attach|detach)Event\s*\(/g, status: "never standard", since: null, use: "addEventListener / removeEventListener" },
  { name: "Application Cache", re: /\bapplicationCache\b|<html[^>]*\smanifest\s*=/g, status: "removed", since: 2020, use: "a service worker" },
  { name: "Web SQL (openDatabase)", re: /\bopenDatabase\s*\(/g, status: "removed", since: 2023, use: "IndexedDB" },
  { name: "mutation events", re: /\bDOM(?:NodeInserted|NodeRemoved|SubtreeModified|AttrModified|CharacterDataModified|NodeInsertedIntoDocument|NodeRemovedFromDocument)\b/g, status: "removed", since: 2024, use: "MutationObserver" },
  { name: "event.keyCode / which / charCode", re: /\.\s*(?:keyCode|charCode|which)\b/g, status: "deprecated", since: null, use: "event.key or event.code" },
  { name: "arguments.callee", re: /\barguments\s*\.\s*callee\b/g, status: "strict mode error", since: null, use: "a named function expression" },
  { name: "with statement", re: /(?<![\w.$])with\s*\(/g, status: "strict mode error", since: null, use: "a local binding" },
  { name: "String.prototype.substr", re: /\.\s*substr\s*\(/g, status: "deprecated", since: null, use: "slice or substring" },
  { name: "Date.prototype.getYear / setYear", re: /\.\s*(?:get|set)Year\s*\(/g, status: "deprecated", since: null, use: "getFullYear / setFullYear" },
  { name: "__defineGetter__ / __defineSetter__", re: /\.\s*__define(?:G|S)etter__\s*\(/g, status: "deprecated", since: null, use: "Object.defineProperty" },
  { name: "window.event", re: /\bwindow\s*\.\s*event\b/g, status: "legacy", since: null, use: "the event the handler receives" },
  { name: "unload event", re: /\bonunload\b|["']unload["']/g, status: "deprecated", since: null, use: "pagehide or visibilitychange" },
  { name: "synchronous XMLHttpRequest", re: /\.\s*open\s*\(\s*["'][A-Za-z]+["']\s*,[^,)]+,\s*false\s*[,)]/g, status: "deprecated", since: null, use: "an asynchronous request or fetch" },
  { name: "document.domain setter", re: /\bdocument\s*\.\s*domain\s*=[^=]/g, status: "deprecated", since: 2023, use: "postMessage or Cross-Origin Resource Sharing" },
  { name: "vendor prefixed API", re: /\b(?:webkit|moz|ms|o)(?:RequestAnimationFrame|CancelAnimationFrame|RequestFullScreen|RequestFullscreen|IndexedDB|URL|AudioContext|MatchesSelector|Transitionend|AnimationEnd)\b/g, status: "prefixed", since: null, use: "the unprefixed name" },
  { name: "user agent sniffing", re: /\bnavigator\s*\.\s*userAgent\b/g, status: "reduced", since: 2023, use: "feature detection" },
  { name: "captureEvents / releaseEvents", re: /\.\s*(?:capture|release)Events\s*\(/g, status: "removed", since: null, use: "addEventListener" },
  { name: "document.layers / document.charset", re: /\bdocument\s*\.\s*(?:layers|charset)\b/g, status: "removed", since: null, use: "querySelector / document.characterSet" },
];

const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

/** Every call in one file to an API the platform has moved on from, with its line. */
export function readPlatform(text, rel) {
  const findings = [];
  for (const api of APIS) {
    for (const m of text.matchAll(api.re)) {
      findings.push({ api: api.name, status: api.status, since: api.since, use: api.use, line: lineAt(text, m.index), file: rel });
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-platform",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|jsx|ts|tsx|vue|mjs|html?|shtml|php|jsp|asp)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (text) findings.push(...readPlatform(text, file.rel));
      }
      const byApi = new Map();
      for (const f of findings) {
        if (!byApi.has(f.api)) byApi.set(f.api, { api: f.api, status: f.status, since: f.since, use: f.use, count: 0, files: new Set() });
        const row = byApi.get(f.api);
        row.count += 1;
        row.files.add(f.file);
      }
      const apis = [...byApi.values()].map((r) => ({ ...r, files: [...r.files].sort() })).sort((a, b) => b.count - a.count || a.api.localeCompare(b.api));
      const removed = apis.filter((a) => a.status === "removed");
      ctx.platform = { findings, apis, removed };
      if (!findings.length) return log.debug("no removed or deprecated platform API is called");

      log.info(`${apis.length} platform API(s) the browser has moved on from, ${removed.length} removed outright`);
      ctx.unverified(
        `PLATFORM.md names ${findings.length} call(s) to ${apis.length} browser API(s) the platform has removed, deprecated or never ` +
        `standardised${removed.length ? `; ${removed.map((a) => a.api).join(", ")} no longer exist in a current browser and fail at runtime` : ""}. ` +
        `Each names the API that replaced it; none was rewritten here.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.platform?.findings?.length) return;
      await ctx.write("PLATFORM.md", render(ctx.platform));
    });
  },
};

function render({ findings, apis, removed }) {
  const rows = apis.map((a) => `| ${a.api} | ${a.status}${a.since ? ` (${a.since})` : ""} | ${a.use} | ${a.count} in ${a.files.length} file(s) |`);
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  const groups = [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([file, items]) =>
    `### \`${file}\`\n\n${items.map((f) => `- line ${f.line}: ${f.api} (${f.status})`).join("\n")}`);

  return `# The platform APIs the old front end calls that the browser has moved on from

Each row is a browser API the source calls that the platform has since
removed, deprecated, or never standardised, with the status the specification
or the engines published and the API the same documents name as its
replacement. A removed API fails at runtime in a current browser; a deprecated
one still works today and is scheduled not to; a prefixed or never standard
one worked in one engine.

Arguments are not shown: what a page wrote to a database or passed to
escape() is a value this report must not repeat.

| API | status | replaced by | calls |
| --- | --- | --- | --- |
${rows.join("\n")}

## Fails today

${removed.length
    ? removed.map((a) => `- **${a.api}**${a.since ? `, gone since ${a.since}` : ""}: ${a.count} call(s) in ${a.files.join(", ")}. Use ${a.use}.`).join("\n")
    : "Nothing the source calls has been removed outright; every finding is deprecated, prefixed or non standard and still runs today."}

## By file

${groups.join("\n\n")}

---

Nothing was rewritten. Whether a fallback for an old engine still matters is a
decision about who the port's users are, and this names what the decision is
about.
`;
}
