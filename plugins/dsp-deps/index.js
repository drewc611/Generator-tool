import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The libraries a legacy front end stands on, with the version of each and
 * whether that version is still maintained by the people who wrote it. A
 * package.json or bower.json declares some; a script tag names the rest by
 * the file it loads (jquery-1.8.3.min.js, /ajax/libs/vue/2.6.14/vue.min.js,
 * vue@2.6.14 on a CDN); a vendored copy carries its version in the banner on
 * its first line. None of that says whether the version is safe to keep, and
 * this tool does not guess: it carries a short table of dates the projects
 * themselves published, the day AngularJS, Bootstrap 3 and 4, Vue 2 and each
 * Angular major left support, the year jQuery 1 and 2 saw their last release,
 * the day moment declared itself finished, and names a library not in the
 * table as not assessed rather than as fine.
 *
 * It reports; replacing a library is a decision about the product. Two
 * versions of one library loaded together and a dependency with no version
 * pinned are named as facts the port owner decides on.
 */

// Each row is a fact the project published about itself. The date is the day
// support ended; a null date is a status without a date, which is all the
// project stated.
const KNOWN = [
  { name: "angular", major: 1, status: "end of life", since: "2021-12-31", note: "AngularJS long term support ended" },
  { name: "jquery", major: 1, status: "unsupported", since: "2016-05-20", note: "1.12.4 was the last 1.x release" },
  { name: "jquery", major: 2, status: "unsupported", since: "2016-05-20", note: "2.2.4 was the last 2.x release" },
  { name: "bootstrap", major: 2, status: "end of life", since: "2013-08-19", note: "superseded by Bootstrap 3" },
  { name: "bootstrap", major: 3, status: "end of life", since: "2019-07-24", note: "Bootstrap 3 left support" },
  { name: "bootstrap", major: 4, status: "end of life", since: "2023-01-01", note: "Bootstrap 4 left support" },
  { name: "vue", major: 2, status: "end of life", since: "2023-12-31", note: "Vue 2 reached end of life" },
  { name: "moment", major: 2, status: "maintenance mode", since: "2020-09-15", note: "the project declared itself finished and recommends alternatives" },
  { name: "prototype", major: 1, status: "dormant", since: "2015-09-22", note: "1.7.3 was the last release" },
  { name: "mootools", major: 1, status: "dormant", since: "2016-01-14", note: "1.6.0 was the last release" },
  { name: "@angular/core", major: 12, status: "end of life", since: "2022-11-12", note: "Angular 12 left long term support" },
  { name: "@angular/core", major: 13, status: "end of life", since: "2023-05-04", note: "Angular 13 left long term support" },
  { name: "@angular/core", major: 14, status: "end of life", since: "2023-11-18", note: "Angular 14 left long term support" },
  { name: "@angular/core", major: 15, status: "end of life", since: "2024-05-18", note: "Angular 15 left long term support" },
  { name: "@angular/core", major: 16, status: "end of life", since: "2024-11-08", note: "Angular 16 left long term support" },
  { name: "@angular/core", major: 17, status: "end of life", since: "2025-05-15", note: "Angular 17 left long term support" },
  { name: "@angular/core", major: 18, status: "end of life", since: "2025-11-19", note: "Angular 18 left long term support" },
  { name: "@angular/core", major: 19, status: "end of life", since: "2026-05-19", note: "Angular 19 left long term support" },
];

const VERSION = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/;
// A library file named with its version: jquery-1.8.3.min.js, angular.1.8.3.js.
const FILE_WITH_VERSION = /([a-z][a-z0-9_.-]*?)[-.@](\d+\.\d+(?:\.\d+)?)(?:[.-]min)?\.js$/i;
// A cdnjs style path: /ajax/libs/vue/2.6.14/vue.min.js.
const CDNJS = /\/ajax\/libs\/([a-z0-9_.-]+)\/(\d+\.\d+(?:\.\d+)?)\//i;
// An unpkg or jsdelivr style path: /npm/vue@2.6.14/dist/vue.js or /vue@2.6.14.
const AT_VERSION = /\/(?:npm\/)?((?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+)@(\d+\.\d+(?:\.\d+)?)(?:\/|$)/i;
const SCRIPT_SRC = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
// The banner a vendored minified library keeps on its first line.
const BANNER = /^\s*\/\*!?\s*(?:v)?\s*([A-Za-z][A-Za-z0-9 .]*?)\s+(?:JavaScript Library\s+)?v?(\d+\.\d+(?:\.\d+)?)/;

const lineAt = (text, index) => {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

// Numeric per segment, so 1.8.3 sorts before 1.12.4; an unpinned entry sorts last.
const compareVersions = (a, b) => {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1);
  const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

const majorOf = (version) => {
  const m = VERSION.exec(version ?? "");
  return m ? Number(m[1]) : null;
};

/** The status the project itself published for this major, or not assessed. */
export function assess(name, version) {
  const major = majorOf(version);
  if (major === null) return { status: "unpinned", since: null, note: "no version is stated, so nothing can be said about it" };
  const row = KNOWN.find((k) => k.name === name.toLowerCase() && k.major === major);
  if (row) return { status: row.status, since: row.since, note: row.note };
  const family = KNOWN.filter((k) => k.name === name.toLowerCase());
  if (family.length && family.every((k) => k.major < major)) return { status: "later than the table", since: null, note: "newer than every dated major this tool knows for it" };
  return { status: "not assessed", since: null, note: "no published support date is on file for it" };
}

/** The dependencies a manifest declares; the spec is reduced to its first version. */
export function readManifest(text, rel) {
  let json;
  try { json = JSON.parse(text); } catch { return []; }
  const found = [];
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = json?.[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, spec] of Object.entries(deps)) {
      const m = VERSION.exec(String(spec));
      const pinned = m && !/^(latest|\*|x|>|git|http|file|link|workspace)/i.test(String(spec).trim());
      found.push({ name, version: pinned ? m[0] : null, evidence: { file: rel, line: null, how: field } });
    }
  }
  return found;
}

/** The libraries a page loads by a script tag whose path carries a version. */
export function readScriptTags(text, rel) {
  const found = [];
  for (const m of text.matchAll(SCRIPT_SRC)) {
    const src = m[1];
    const path = src.replace(/[?#].*$/, "");
    let name = null; let version = null;
    const cdn = CDNJS.exec(path); const at = AT_VERSION.exec(path); const file = FILE_WITH_VERSION.exec(path.split("/").pop());
    if (cdn) [name, version] = [cdn[1], cdn[2]];
    else if (at) [name, version] = [at[1], at[2]];
    else if (file) [name, version] = [file[1], file[2]];
    if (!name) continue;
    found.push({ name: name.toLowerCase(), version, evidence: { file: rel, line: lineAt(text, m.index), how: "script tag" } });
  }
  return found;
}

/** The version a vendored library states in its own banner. Only the first line is read. */
export function readBanner(text, rel) {
  const head = text.slice(0, 400).split("\n").find((l) => l.trim()) ?? "";
  const m = BANNER.exec(head);
  if (!m) return null;
  const name = m[1].trim().toLowerCase().replace(/\s+/g, "-");
  return { name, version: m[2], evidence: { file: rel, line: 1, how: "banner" } };
}

export default {
  name: "dsp-deps",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const found = [];
      // A manifest is read at the source root only. A nested one belongs to a
      // package of its own, and reading it would blame this app for that one's choices.
      for (const manifest of ["package.json", "bower.json"]) {
        const text = await readFile(join(ctx.config.src, manifest), "utf8").catch(() => "");
        if (text) found.push(...readManifest(text, manifest));
        if (manifest === "bower.json" && text) {
          ctx.unverified("bower.json is in the tree. Bower has been deprecated by its authors since 2017; the port should declare these dependencies in package.json or not at all.");
        }
      }
      for (const file of ctx.sources.files) {
        if (/\.(html?|shtml|php|jsp|asp|inc|hbs|handlebars|vue)$/i.test(file.rel)) {
          const text = await readFile(file.path, "utf8").catch(() => "");
          if (text) found.push(...readScriptTags(text, file.rel));
        } else if (/\.js$/i.test(file.rel)) {
          const text = await readFile(file.path, "utf8").catch(() => "");
          const banner = text && readBanner(text, file.rel);
          if (banner) found.push(banner);
        }
      }

      const libraries = new Map();
      for (const f of found) {
        const id = `${f.name}@${f.version ?? "?"}`;
        if (!libraries.has(id)) libraries.set(id, { name: f.name, version: f.version, evidence: [], ...assess(f.name, f.version) });
        libraries.get(id).evidence.push(f.evidence);
      }
      const rows = [...libraries.values()].sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version));
      const byName = new Map();
      for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
      const duplicates = [...byName.entries()].filter(([, v]) => new Set(v.map((r) => r.version).filter(Boolean)).size > 1).map(([name, v]) => ({ name, versions: v.map((r) => r.version).filter(Boolean) }));
      const dated = rows.filter((r) => r.since);
      const unpinned = rows.filter((r) => r.status === "unpinned");

      ctx.deps = { libraries: rows, duplicates, dated, unpinned };
      if (!rows.length) return log.debug("no dependency declared or loaded by version");

      log.info(`${rows.length} librar${rows.length === 1 ? "y" : "ies"} by version, ${dated.length} past a published support date`);
      if (dated.length) {
        ctx.unverified(
          `DEPENDENCIES.md names ${dated.length} librar${dated.length === 1 ? "y" : "ies"} at a version its own project has stopped supporting ` +
          `(${dated.map((r) => `${r.name} ${r.version}`).join(", ")}). Whether the port keeps, upgrades or drops each is a product decision; none was changed.`
        );
      }
      for (const d of duplicates) {
        ctx.unverified(`${d.name} is loaded at ${d.versions.length} versions (${d.versions.join(", ")}). The port should carry one, and which one is a decision about the code that calls it.`);
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.deps?.libraries?.length) return;
      await ctx.write("DEPENDENCIES.md", render(ctx.deps));
    });
  },
};

function render({ libraries, duplicates, dated, unpinned }) {
  const where = (r) => r.evidence.map((e) => `${e.file}${e.line ? `:${e.line}` : ""} (${e.how})`).join(", ");
  const rows = libraries.map((r) =>
    `| \`${r.name}\` | ${r.version ?? "unpinned"} | ${r.status}${r.since ? ` since ${r.since}` : ""} | ${r.note} | ${where(r)} |`);

  return `# The libraries the old front end stands on

Each row is a library the source declares in a manifest, loads by a script tag
whose path carries a version, or vendors with its version in the file's banner.
The status column is only what each project published about that major
version, with the date; a library this tool has no published date for is
marked not assessed, which means exactly that and not that it is fine.

| library | version | status | what the project said | evidence |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

## Past a published support date

${dated.length
    ? dated.map((r) => `- \`${r.name}\` ${r.version}: ${r.status} since ${r.since}; ${r.note}.`).join("\n")
    : "None of the versioned libraries is past a support date this tool knows."}

## Loaded at more than one version

${duplicates.length
    ? duplicates.map((d) => `- \`${d.name}\`: ${d.versions.join(", ")}. The port should carry one.`).join("\n")
    : "No library is loaded at two versions."}

## Declared with no version

${unpinned.length
    ? unpinned.map((r) => `- \`${r.name}\` (${where(r)}): the spec pins nothing, so every install may differ.`).join("\n")
    : "Every declared dependency states a version."}

---

Nothing was upgraded or removed. A library past its support date is a fact
about the source; what the port does about it is a decision about the product,
and the code that calls the library decides how large that decision is.
`;
}
