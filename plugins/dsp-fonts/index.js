import { readFile } from "node:fs/promises";
import { basename } from "node:path";

/**
 * How the old app loaded its type, and what the port should do differently.
 *
 * A legacy stylesheet often declares a face in several formats a browser has
 * not needed in a decade, ships no woff2, and leaves font-display unset, so
 * text is invisible while the font loads. None of that is a taste question:
 * the formats to drop, the display strategy and the preload are measurable,
 * so this reports them. Whether a licence lets a face travel is general-license's
 * job; this is about weight and the flash of invisible text.
 */

const FORMAT = /\.(woff2|woff|ttf|otf|eot|svg)(?:[?#]|["')]|$)/i;

export function readFonts(css, rel) {
  const faces = [];
  for (const m of css.matchAll(/@font-face\s*\{([\s\S]*?)\}/gi)) {
    const body = m[1];
    const family = /font-family\s*:\s*["']?([^;"']+)["']?/i.exec(body)?.[1]?.trim() ?? "(unnamed)";
    const formats = new Set();
    for (const s of body.matchAll(/url\([^)]*\)/gi)) {
      const ext = FORMAT.exec(s[0])?.[1]?.toLowerCase();
      if (ext) formats.add(ext);
    }
    const display = /font-display\s*:\s*(\w+)/i.exec(body)?.[1]?.toLowerCase() ?? null;
    faces.push({ family, formats: [...formats], display, file: rel });
  }
  const googleFonts = [...css.matchAll(/fonts\.googleapis\.com\/css2?\?([^"')]+)/gi)].map((m) => m[1]);
  return { faces, googleFonts };
}

/** The porting notes for one face: what to drop, what to add, what to fix. */
function adviseFace(face) {
  const wants = [];
  if (!face.formats.includes("woff2")) wants.push("no woff2, the format every current browser prefers and the smallest of them");
  const legacy = face.formats.filter((f) => ["eot", "svg", "ttf"].includes(f));
  if (legacy.length) wants.push(`${legacy.join(", ")} can be dropped: no browser the port targets needs them`);
  if (!face.display) wants.push("font-display is unset, so text is invisible while the font loads; swap or optional fixes it");
  return wants;
}

export default {
  name: "dsp-fonts",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const cssFiles = ctx.sources.files.filter((f) => /\.(css|scss|less|html?)$/i.test(f.rel));
      const faces = [];
      const googleFonts = new Set();
      for (const file of cssFiles) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/@font-face|googleapis/i.test(text)) continue;
        const read = readFonts(text, file.rel);
        for (const face of read.faces) faces.push({ ...face, wants: adviseFace(face) });
        for (const g of read.googleFonts) googleFonts.add(g);
      }
      // The font files actually in the tree, so a declared face missing its
      // woff2 can be told apart from one whose file just was not shipped.
      const fontFiles = ctx.sources.files.filter((f) => /\.(woff2|woff|ttf|otf|eot)$/i.test(f.rel)).map((f) => basename(f.rel));

      ctx.fonts = { faces, googleFonts: [...googleFonts], fontFiles };
      if (!faces.length && !googleFonts.size) return log.debug("no web fonts found");

      const needy = faces.filter((f) => f.wants.length);
      log.info(`${faces.length} @font-face(s), ${googleFonts.size} Google Fonts link(s), ${needy.length} with advice`);
      if (needy.length || googleFonts.size) {
        ctx.unverified(
          `FONTS.md reads ${faces.length} @font-face declaration(s) and ${googleFonts.size} hosted font link(s). ` +
          `Formats to drop, a display strategy and preload are measurable porting decisions the report names.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.fonts || (!ctx.fonts.faces.length && !ctx.fonts.googleFonts.length)) return;
      await ctx.write("FONTS.md", render(ctx.fonts));
    });
  },
};

function render({ faces, googleFonts, fontFiles }) {
  const rows = faces.map((f) =>
    `| ${f.family} | ${f.formats.join(", ") || "—"} | ${f.display ?? "**unset**"} |`);
  const advice = faces.filter((f) => f.wants.length).map((f) =>
    `### ${f.family}\n\n${f.wants.map((w) => `- ${w}`).join("\n")}`);

  return `# How the old app loaded its type

A face declared in several formats a browser has not needed in years, no
woff2, and font-display unset are measurable, not matters of taste. This is
what was there and what the port should change. Whether a licence lets a face
travel is a different report; this is about weight and the flash of invisible
text.

| family | formats | font-display |
| --- | --- | --- |
${rows.length ? rows.join("\n") : "| — | (no @font-face) | — |"}

${googleFonts.length ? `Hosted fonts loaded from Google: ${googleFonts.map((g) => `\`${g}\``).join(", ")}. Self hosting them removes a third party request and a privacy concern.\n` : ""}
${fontFiles.length ? `Font files in the tree: ${fontFiles.length}.\n` : ""}
${advice.length ? `## What to change\n\n${advice.join("\n\n")}\n` : "Every declared face ships woff2 with a display strategy. Nothing to change.\n"}
---

Preload the one or two faces above the fold, subset to the characters the
site uses, and drop the formats no target needs. Each is a build decision the
port's tooling should own.
`;
}
