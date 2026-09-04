import { readFile } from "node:fs/promises";

/**
 * What a legacy page keeps in its own markup: a `style="..."` on an element,
 * a `<style>` block in the head, an inline `<script>` with its body written
 * in place. Each is a debt the port would inherit. An inline style attribute
 * cannot be reached by the design tokens the port emits, so it cannot be
 * themed or reused; an inline `<style>` or `<script>` block is precisely what
 * a strict Content Security Policy refuses to run. A port that copies these
 * forward keeps a theming problem and a security problem at once.
 *
 * This counts them and reports where they live. It never captures the style
 * values or the block bodies, because the count is the finding and the
 * content is not this plugin's to carry.
 */

export function readInline(html, rel) {
  const tags = {};
  let count = 0;
  // The tag name is the run of letters and digits opening an element; the
  // style attribute may sit anywhere before the closing angle bracket. The
  // gap between the two excludes quotes and the bracket so a value in one
  // element cannot spill into the next, and it never backtracks.
  const attr = /<([a-zA-Z][a-zA-Z0-9]*)(?:[^>"']|"[^"]*"|'[^']*')*?\sstyle\s*=\s*["'][^"']*["']/g;
  for (const m of html.matchAll(attr)) {
    const tag = m[1].toLowerCase();
    tags[tag] = (tags[tag] ?? 0) + 1;
    count += 1;
  }

  const styleBlocks = (html.match(/<style\b[^>]*>[\s\S]*?<\/style(?:\s[^>]*)?>/gi) ?? []).length;

  let scriptBlocks = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi)) {
    const openTag = m[1];
    const body = m[2];
    // A script with a src loads its code from elsewhere and is not inline; a
    // script whose body is only whitespace carries nothing to move.
    if (/\bsrc\s*=/i.test(openTag)) continue;
    if (!body.trim()) continue;
    scriptBlocks += 1;
  }

  return { rel, styleAttrs: { count, tags }, styleBlocks, scriptBlocks };
}

export default {
  name: "dsp-inline",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|shtml|php|jsp|vue|hbs|handlebars)$/i.test(f.rel));
      const pages = [];
      const totals = { styleAttrs: 0, styleBlocks: 0, scriptBlocks: 0 };
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const read = readInline(text, file.rel);
        totals.styleAttrs += read.styleAttrs.count;
        totals.styleBlocks += read.styleBlocks;
        totals.scriptBlocks += read.scriptBlocks;
        pages.push(read);
      }
      ctx.inline = { pages, totals };

      const any = totals.styleAttrs + totals.styleBlocks + totals.scriptBlocks;
      log.info(`${pages.length} page(s) read for inline style and script, ${any} inline use(s) found`);
      if (any > 0) {
        ctx.unverified(
          `INLINE.md inventories ${totals.styleAttrs} inline style attribute(s), ${totals.styleBlocks} <style> block(s) ` +
          `and ${totals.scriptBlocks} inline <script> block(s) across ${pages.length} page(s). Inline styles cannot be themed ` +
          `with the tokens the port emits, and inline style and script are what a strict Content Security Policy forbids; ` +
          `moving them into stylesheets and modules is both a theming and a security win, and none was moved here.`
        );
      }
    });

    on("emit", async (ctx) => {
      const totals = ctx.inline?.totals;
      if (!totals || totals.styleAttrs + totals.styleBlocks + totals.scriptBlocks === 0) return;
      await ctx.write("INLINE.md", render(ctx.inline));
    });
  },
};

function render({ pages, totals }) {
  const seen = pages.filter((p) => p.styleAttrs.count + p.styleBlocks + p.scriptBlocks > 0);
  const rows = seen.map((p) => {
    const tagList = Object.entries(p.styleAttrs.tags)
      .map(([tag, n]) => `${tag}×${n}`)
      .join(", ");
    return `| \`${p.rel}\` | ${p.styleAttrs.count || "—"}${tagList ? ` (${tagList})` : ""} | ${p.styleBlocks || "—"} | ${p.scriptBlocks || "—"} |`;
  });

  return `# Inline style and script the pages carry

An inline \`style="..."\` attribute cannot be reached by the design tokens the
port emits, so it cannot be themed or reused. An inline \`<style>\` or
\`<script>\` block is exactly what a strict Content Security Policy refuses to
run. A port that keeps these inline keeps both a theming problem and a
security problem. This is the inventory, so each can be moved into a
stylesheet or a module on purpose.

| page | inline style attrs | \`<style>\` blocks | inline \`<script>\` blocks |
| --- | --- | --- | --- |
${rows.join("\n")}
| **total** | **${totals.styleAttrs || "—"}** | **${totals.styleBlocks || "—"}** | **${totals.scriptBlocks || "—"}** |

---

Moving inline styles into stylesheets lets the port's design tokens theme
them, and moving inline style and script out of the markup is what a strict
Content Security Policy requires. So the same move is both a theming win and a
security win. Nothing was moved here; the values and block bodies were counted,
never captured.
`;
}
