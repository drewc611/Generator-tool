/**
 * Which reader claimed each file the scan kept, and which files no reader
 * did. Thirty odd readers each take the files they recognise, and a legacy
 * tree carries pages, templates and scripts none of them knows: a markup file
 * in a dialect the tool has no reader for, or a script whose components are
 * declared in a way no reader spotted. COVERAGE.md counts screens; this counts
 * files, so the question "what did the run not even look at" has an answer
 * instead of an assumption.
 *
 * Every file the scan kept lands in one of four rows: a screen, with the
 * reader that read it; a script the analyzers scanned that produced no
 * screen; a style, asset or data file the port carries or measures; or
 * markup no reader claimed, which is the row a port owner reads first. A
 * fifth row, named separately because it is a different kind of gap, is
 * every file the scan did not even look inside: its extension is not one any
 * reader has asked for, so it was never a candidate. It runs at verify so the
 * census is what the readers actually did.
 */

const MARKUP = /\.(html?|shtml|php|asp|jsp|inc|hbs|handlebars|mustache|marko|liquid|twig|jinja2?|j2|tpl|ejs|erb|njk|nunjucks|peb|pebble|volt|xslt?|cshtml|ftlh?|vm|vtl|pug|jade|cfml?|haml|slim|vue|riot|tag|svelte|jsx|tsx|xhtml|jsf|aspx|ascx|master)$/i;
const SCRIPT = /\.(js|mjs|cjs|ts)$/i;
const STYLE = /\.(css|scss|less)$/i;

export function census(files, screens, skipped = []) {
  const byFile = new Map();
  for (const s of screens) {
    if (s.file) byFile.set(s.file.replace(/^\.\//, ""), s.readBy ?? "a reader");
    // An Angular component's templateUrl is a second file the same reader read.
    if (typeof s.templateOrigin === "string" && /\.[a-z]+$/i.test(s.templateOrigin) && !/\s/.test(s.templateOrigin)) byFile.set(s.templateOrigin.replace(/^\.\//, ""), s.readBy ?? "a reader");
  }
  // A layout or partial a reader composed into screens was read, into each of them.
  const composedInto = new Map();
  for (const s of screens) for (const c of s.composed ?? []) {
    const rel = String(c).replace(/^\.\//, "");
    const row = composedInto.get(rel) ?? { file: rel, reader: s.readBy ?? "a reader", into: 0 };
    row.into += 1; composedInto.set(rel, row);
  }
  const rows = { screens: [], composed: [], scripts: [], styles: [], assets: [], unread: [] };
  for (const f of files) {
    const rel = f.rel.replace(/^\.\//, "");
    if (byFile.has(rel)) { rows.screens.push({ file: rel, reader: byFile.get(rel) }); continue; }
    if (composedInto.has(rel)) { rows.composed.push(composedInto.get(rel)); continue; }
    if (MARKUP.test(rel)) { rows.unread.push(rel); continue; }
    if (SCRIPT.test(rel)) { rows.scripts.push(rel); continue; }
    if (STYLE.test(rel)) { rows.styles.push(rel); continue; }
    rows.assets.push(rel);
  }
  const byReader = new Map();
  for (const s of rows.screens) byReader.set(s.reader, (byReader.get(s.reader) ?? 0) + 1);
  const notScanned = skipped.map((f) => f.rel).sort();
  return {
    ...rows,
    byReader: [...byReader.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    notScanned,
    total: files.length + skipped.length,
  };
}

export default {
  name: "vis-readers",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (!ctx.sources?.files?.length && !ctx.sources?.skipped?.length) return log.debug("no source files to account for");
      const c = census(ctx.sources.files, ctx.screens, ctx.sources.skipped ?? []);
      ctx.readers = c;
      log.info(
        `${c.screens.length} file(s) read as screens by ${c.byReader.length} reader(s), ${c.composed.length} composed into them, ` +
          `${c.unread.length} markup file(s) no reader claimed, ${c.notScanned.length} file(s) not scanned at all`
      );
      if (c.unread.length) {
        ctx.unverified(
          `READERS.md names ${c.unread.length} markup file(s) no reader claimed (${c.unread.slice(0, 3).join(", ")}${c.unread.length > 3 ? ", ..." : ""}); ` +
          `the port has nothing from them, and whether each is a page the port needs is a person's call.`
        );
      }
      if (c.notScanned.length) {
        ctx.unverified(
          `READERS.md names ${c.notScanned.length} file(s) this run never looked inside, its extension not one any reader has asked for ` +
          `(${c.notScanned.slice(0, 3).join(", ")}${c.notScanned.length > 3 ? ", ..." : ""}); a file dropped on the console and not read yet ends up here.`
        );
      }
      await ctx.write("READERS.md", render(c));
    });
  },
};

function render(c) {
  const list = (items) => (items.length ? items.map((f) => `- \`${f}\``).join("\n") : "none");
  return `# What each reader claimed, file by file

${c.total} file(s) were in the source tree. Each is in exactly one row below. COVERAGE.md
counts screens; this counts files, so "what did the run not even look at" has an
answer instead of an assumption.

| row | files |
| --- | --- |
| read as a screen | ${c.screens.length} |
| composed into screens as a layout or partial | ${c.composed.length} |
| scripts the analyzers scanned, no screen | ${c.scripts.length} |
| styles | ${c.styles.length} |
| assets and data | ${c.assets.length} |
| markup no reader claimed | ${c.unread.length} |
| not scanned: the extension is not one any reader asked for | ${c.notScanned.length} |

## By reader

${c.byReader.length ? c.byReader.map(([r, n]) => `- **${r}**: ${n} file(s)`).join("\n") : "No reader produced a screen this run."}

## Markup no reader claimed

${c.unread.length
    ? `${list(c.unread)}\n\nEach of these is a page or template in a shape no reader recognised, or one a reader looked at and found no component in. The port carries nothing from them. Whether each is a page the port needs, and which reader should learn its shape, is a person's call.`
    : "Every markup file the scan kept was read by a reader."}

## Not scanned

${c.notScanned.length
    ? `${list(c.notScanned)}\n\nThe scan never opened these: their extension is not one any reader has asked for, so this is a gap in what the tool reads, not a judgement about what they hold. A person dropping a file on the console and finding it here has an honest answer, not a silent miss.`
    : "Every file in the tree was at least opened by the scan."}

## Read as a screen

${c.screens.length ? c.screens.sort((a, b) => a.file.localeCompare(b.file)).map((s) => `- \`${s.file}\` by ${s.reader}`).join("\n") : "none"}

## Composed into screens

${c.composed.length ? `${c.composed.sort((a, b) => a.file.localeCompare(b.file)).map((s) => `- \`${s.file}\` by ${s.reader}, into ${s.into} screen(s)`).join("\n")}\n\nA layout or partial here is not a screen of its own: the reader wrote it into each page that renders inside it, so it ships as part of those components.` : "none"}

## Scripts the analyzers scanned

${list(c.scripts)}

---

A script here is not unread: the dependency, configuration, console, globals,
platform and complexity analyzers all read it. It produced no screen, which is
what a script that is not a component should do.
`;
}
