import { readFile } from "node:fs/promises";

/**
 * The third party code a page loads from someone else's host. Every external
 * <script src> is code the app runs with the app's own privileges, fetched
 * fresh from a machine the team does not control; a stylesheet from a CDN can
 * reshape the whole surface. A port that copies these tags forward inherits
 * that trust silently, and inherits the day the remote file changes under it.
 *
 * This reads them and reports them, and flags the ones with no Subresource
 * Integrity, because a hash is the only thing that proves the file that
 * arrives is the file that was reviewed. It measures; it proposes self hosting
 * or an integrity attribute rather than editing the tag on its own.
 */

// Absolute only: a resource with no scheme is the app's own and not a third
// party. The host parse is bounded and rejects the quote characters so a
// crafted attribute cannot make the scan backtrack catastrophically.
const HOST = /^(?:https?:)?\/\/([^\/\s"']+)/;
const isAbsolute = (url) => /^(?:https?:)?\/\//i.test(url);

const hostOf = (url) => HOST.exec(url)?.[1] ?? null;

const attr = (tag, name) =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, "i").exec(tag);

const hasAttr = (tag, name) => new RegExp(`\\b${name}\\b`, "i").test(tag);

export function readSupplyChain(html, rel) {
  const scripts = [];
  const styles = [];

  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const tag = m[1];
    const src = attr(tag, "src");
    if (!src) continue;
    const url = (src[1] ?? src[2] ?? src[3] ?? "").trim();
    if (!isAbsolute(url)) continue;
    scripts.push({
      url,
      host: hostOf(url),
      sri: hasAttr(tag, "integrity"),
      crossorigin: hasAttr(tag, "crossorigin"),
    });
  }

  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const tag = m[1];
    const href = attr(tag, "href");
    if (!href) continue;
    const url = (href[1] ?? href[2] ?? href[3] ?? "").trim();
    if (!isAbsolute(url)) continue;
    const relAttr = attr(tag, "rel");
    const relVal = (relAttr?.[1] ?? relAttr?.[2] ?? relAttr?.[3] ?? "").toLowerCase();
    const isStylesheet = /\bstylesheet\b/.test(relVal) || /\.css(?:[?#]|$)/i.test(url);
    if (!isStylesheet) continue;
    styles.push({
      url,
      host: hostOf(url),
      sri: hasAttr(tag, "integrity"),
      crossorigin: hasAttr(tag, "crossorigin"),
    });
  }

  return { scripts, styles };
}

export default {
  name: "dsp-supplychain",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|shtml|php|jsp|vue|hbs|handlebars)$/i.test(f.rel));
      const byUrl = new Map();
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const { scripts, styles } = readSupplyChain(text, file.rel);
        const record = (entry, kind) => {
          if (!byUrl.has(entry.url)) {
            byUrl.set(entry.url, {
              url: entry.url,
              host: entry.host,
              kind,
              sri: entry.sri,
              crossorigin: entry.crossorigin,
              files: new Set(),
            });
          }
          const dep = byUrl.get(entry.url);
          dep.files.add(file.rel);
          // A hash or a crossorigin proven on any page counts for the dep: the
          // safe spelling is what the port should learn from.
          if (entry.sri) dep.sri = true;
          if (entry.crossorigin) dep.crossorigin = true;
        };
        for (const s of scripts) record(s, "script");
        for (const s of styles) record(s, "style");
      }

      const deps = [...byUrl.values()]
        .map((d) => ({ ...d, files: [...d.files].sort() }))
        .sort((a, b) => (a.host ?? "").localeCompare(b.host ?? "") || a.url.localeCompare(b.url));
      ctx.supplychain = { deps };
      if (!deps.length) return log.debug("no external third party code loaded");

      const noSri = deps.filter((d) => !d.sri).length;
      log.info(`${deps.length} external dependency(s) loaded, ${noSri} without integrity`);
      ctx.unverified(
        `SUPPLYCHAIN.md inventories ${deps.length} external dependency(s) the pages load from another host; ` +
        `${noSri} carry no Subresource Integrity hash, so a swapped remote file would run unchallenged. Each is code ` +
        `the port inherits the trust of; none was pinned or self hosted here.`
      );
    });

    on("emit", async (ctx) => {
      // A run that loaded nothing external writes no report: an empty
      // SUPPLYCHAIN.md in every port is noise, and the absence is the good news.
      if (!ctx.supplychain?.deps?.length) return;
      await ctx.write("SUPPLYCHAIN.md", render(ctx.supplychain.deps));
    });
  },
};

function render(deps) {
  const yes = (b) => (b ? "yes" : "no");
  const rows = deps.map((d) =>
    `| \`${d.host ?? "?"}\` | ${d.kind} | ${yes(d.sri)} | ${d.files.map((f) => `\`${f}\``).join(", ")} |`);

  const unpinned = deps.filter((d) => !d.sri);
  const flagged = unpinned.map((d) =>
    `### \`${d.url}\`\n\nLoaded as a ${d.kind} from \`${d.host ?? "?"}\` with no integrity hash. The remote file can be ` +
    `swapped under the app without the markup changing. Either self host it and review it on update, or add an ` +
    `\`integrity\` hash with \`crossorigin\` so the browser refuses a file that does not match.`);

  return `# The third party code the pages load

Each row is code fetched from a host the team does not control. An external
\`<script>\` runs with the app's own privileges; a stylesheet from a CDN can
reshape the whole surface. The port inherits this trust the moment it copies
the tag forward, and inherits the day the remote file changes.

| host | kind | integrity | seen in |
| --- | --- | --- | --- |
${rows.join("\n")}

${flagged.length
  ? `## Loaded without integrity\n\nA script or stylesheet from a CDN with no hash can be swapped under you, and the app would run whatever arrived.\n\n${flagged.join("\n\n")}\n`
  : "Every external dependency carried an integrity hash. The port can pin them as they are.\n"}
---

Nothing here was pinned or self hosted for you: adopting a hash or moving a
file in house is a decision about how the port trusts its dependencies, and it
is made on purpose rather than quietly.
`;
}
