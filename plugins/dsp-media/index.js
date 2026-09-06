import { readFile } from "node:fs/promises";
import { lineAt } from "../dsp-ir/emit.js";

/**
 * The video and audio a legacy front end embedded, and the contract it carried.
 *
 * A media element is the one place on a page where accessibility is not a matter
 * of contrast or a label but of a second track: a video with speech and no
 * captions is unusable to anyone who cannot hear it, and that is a track a
 * screenshot never shows and a pixel diff never catches. A few other habits ride
 * along and a port inherits each:
 *
 *   - no captions track on a video, the WCAG failure above.
 *   - no controls and no autoplay, which leaves the user no way to start it.
 *   - autoplay, which modern browsers block with sound and which a port must
 *     decide to keep on purpose rather than by default.
 *
 * This finds each <video> and <audio>, records which of controls, autoplay,
 * loop, muted and a captions track are present, and names the gaps. It reads the
 * markup and the attribute names only; it never records a src, which can carry a
 * signed URL, the caution the secret gate keeps. It counts and changes nothing.
 */

const MEDIA = /<(video|audio)\b([^>]*)>/gi;
const hasAttr = (attrs, name) => new RegExp(`\\b${name}\\b`, "i").test(attrs);

const captionsIn = (inner) => /<track\b[^>]*\bkind\s*=\s*(['"])(captions|subtitles)\1/i.test(inner);

export function readMedia(text, rel) {
  const findings = [];
  for (const m of text.matchAll(MEDIA)) {
    const kind = m[1].toLowerCase();
    const attrs = m[2] ?? "";
    const close = new RegExp(`</${kind}\\s*>`, "i");
    const rest = text.slice(m.index + m[0].length);
    const end = rest.search(close);
    const inner = end === -1 ? rest : rest.slice(0, end);

    const controls = hasAttr(attrs, "controls");
    const autoplay = hasAttr(attrs, "autoplay");
    const loop = hasAttr(attrs, "loop");
    const muted = hasAttr(attrs, "muted");
    const captions = kind === "video" ? captionsIn(inner) : true;

    const issues = [];
    if (kind === "video" && !captions) issues.push("no captions track");
    if (!controls && !autoplay) issues.push("no controls and no autoplay: nothing starts it");
    if (autoplay) issues.push("autoplay: a port keeps this on purpose, not by default");

    findings.push({ kind, controls, autoplay, loop, muted, captions, issues, line: lineAt(text, m.index), file: rel });
  }
  return findings.sort((a, b) => a.line - b.line);
}

export default {
  name: "dsp-media",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(html?|vue|svelte|jsx|tsx)$/i.test(f.rel) && !/\.min\./.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readMedia(text, file.rel));
      }
      const videos = findings.filter((f) => f.kind === "video").length;
      const audios = findings.filter((f) => f.kind === "audio").length;
      const noCaptions = findings.filter((f) => f.kind === "video" && !f.captions).length;
      const withIssues = findings.filter((f) => f.issues.length).length;
      ctx.media = { findings, videos, audios, noCaptions, withIssues };
      if (!findings.length) return log.debug("no media elements");

      log.info(`${findings.length} media element(s): ${videos} video, ${audios} audio, ${noCaptions} without captions`);
      ctx.unverified(
        `MEDIA.md names ${findings.length} media element(s) the old front end embedded (${videos} video, ${audios} audio); ` +
        `${noCaptions} video(s) carry no captions track, the second track anyone who cannot hear the audio depends on. ` +
        "None was changed here; adding captions is content a person writes."
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.media?.findings?.length) return;
      await ctx.write("MEDIA.md", render(ctx.media));
    });
  },
};

function render({ findings, videos, audios, noCaptions, withIssues }) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const groups = [...byFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, items]) => {
      const lines = items.map((f) => {
        const state = [f.controls && "controls", f.autoplay && "autoplay", f.loop && "loop", f.muted && "muted", f.kind === "video" && (f.captions ? "captions" : null)].filter(Boolean).join(", ") || "no attributes";
        const tail = f.issues.length ? ` — ${f.issues.join("; ")}` : "";
        return `- line ${f.line}: \`<${f.kind}>\` (${state})${tail}`;
      });
      return `### \`${file}\`\n\n${lines.join("\n")}`;
    });

  return `# The media the old front end embedded

A media element is the one place accessibility is a second track, not a colour
or a label: a video with speech and no captions is unusable to anyone who
cannot hear it, and captions are a track a screenshot never shows and a pixel
diff never catches. This lists every \`<video>\` and \`<audio>\`, the attributes
it carried, and the gaps a port inherits.

**${videos}** video and **${audios}** audio element(s); **${noCaptions}** video(s)
carry no captions track; **${withIssues}** element(s) have at least one gap named
below. The \`src\` of each is deliberately not recorded, since it can carry a
signed URL.

${groups.join("\n\n")}

---

Nothing was changed. Captions are content a person writes; whether an autoplay
was load-bearing and whether controls were replaced by a custom player is the
port owner's call.
`;
}
