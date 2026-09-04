import { readFile } from "node:fs/promises";

/**
 * The image weight the port should not inherit.
 *
 * A legacy page usually ships one fixed size of every image, at whatever
 * dimensions the largest layout needed, with no lazy loading and no width or
 * height, so the browser reflows when each one arrives. The port can do better
 * with information the markup already carries, but which srcset to generate
 * and which format to encode are build decisions, so this proposes them per
 * image rather than rewriting the tag.
 */

export function readImages(html, rel) {
  const images = [];
  for (const m of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = m[1];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? null;
    if (!src || /^data:/.test(src)) continue;
    const image = {
      src,
      file: rel,
      hasSrcset: /\bsrcset\s*=/i.test(attrs),
      hasSizes: /\bsizes\s*=/i.test(attrs),
      hasLoading: /\bloading\s*=/i.test(attrs),
      hasDimensions: /\bwidth\s*=/i.test(attrs) && /\bheight\s*=/i.test(attrs),
      hasAlt: /\balt\s*=/i.test(attrs),
      format: (/\.([a-z0-9]+)(?:[?#]|$)/i.exec(src)?.[1] ?? "").toLowerCase(),
    };
    const wants = [];
    if (!image.hasSrcset) wants.push("a srcset so a small screen does not download the desktop image");
    if (image.hasSrcset && !image.hasSizes) wants.push("a sizes hint, or the srcset cannot be chosen from before layout");
    if (!image.hasLoading) wants.push('loading="lazy" for anything below the fold');
    if (!image.hasDimensions) wants.push("explicit width and height, so the page does not reflow when it arrives");
    if (["jpg", "jpeg", "png"].includes(image.format)) wants.push(`a modern format (WebP or AVIF) beside the ${image.format}`);
    if (!image.hasAlt) wants.push("an alt attribute (empty if decorative), which it has none of");
    image.wants = wants;
    images.push(image);
  }
  return images;
}

export default {
  name: "dsp-images",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|shtml|php|jsp|vue|hbs|handlebars)$/i.test(f.rel));
      const images = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/<img\b/i.test(text)) continue;
        images.push(...readImages(text, file.rel));
      }
      ctx.images = images;
      if (!images.length) return log.debug("no images to weigh");

      const needy = images.filter((i) => i.wants.length);
      log.info(`${images.length} image(s), ${needy.length} could carry the port lighter`);
      if (needy.length) {
        ctx.unverified(
          `IMAGES.md weighs ${images.length} image(s); ${needy.length} ship at one fixed size with no lazy loading or ` +
          `dimensions. Which srcset and format to build is a decision, so the proposals are named, not applied.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.images?.length) return;
      await ctx.write("IMAGES.md", render(ctx.images));
    });
  },
};

function render(images) {
  const perfect = images.filter((i) => !i.wants.length);
  const needy = images.filter((i) => i.wants.length);
  const sections = needy.map((i) =>
    `### \`${i.src}\`\n\nin \`${i.file}\`${i.format ? `, ${i.format}` : ""}\n\n${i.wants.map((w) => `- ${w}`).join("\n")}`);

  return `# The image weight the port should not inherit

A legacy page usually ships one fixed size of every image, no lazy loading,
no dimensions. The port can do better with what the markup already says, but
which sizes to generate and which format to encode are build decisions, so
these are proposals per image, not rewrites of the tag.

${images.length} image(s) found; ${perfect.length} already carry their own weight well.

${sections.length ? sections.join("\n\n") : "Every image already carries a srcset, a loading hint and its dimensions. Nothing to propose."}

---

Applying any of these is a build step the port's own tooling should own; the
tool measures what is missing and leaves the encoding to a person.
`;
}
