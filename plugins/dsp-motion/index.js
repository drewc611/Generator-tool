import { readFile } from "node:fs/promises";

/**
 * The motion the old app never made optional.
 *
 * A page built before `prefers-reduced-motion` existed animates the same for
 * everyone, including people for whom motion is nausea or a seizure risk. The
 * fix is one media query, and whether it is present is measurable: this counts
 * the animations and transitions a stylesheet declares and reports whether any
 * reduced-motion block honours the request to still them.
 */

export function readMotion(css, rel) {
  // A rough but honest count: keyframes defined, animation/transition
  // properties used, and scroll-behavior smooth, all of which move.
  const keyframes = (css.match(/@(?:-\w+-)?keyframes\s+[\w-]+/gi) ?? []).length;
  const animations = (css.match(/\banimation(?:-name)?\s*:/gi) ?? []).length;
  const transitions = (css.match(/\btransition(?:-property)?\s*:/gi) ?? []).length;
  const smoothScroll = /scroll-behavior\s*:\s*smooth/i.test(css);
  const reducedMotion = /@media[^{]*prefers-reduced-motion\s*:\s*reduce/i.test(css);
  const moves = keyframes + animations + transitions || (smoothScroll ? 1 : 0);
  return { rel, keyframes, animations, transitions, smoothScroll, reducedMotion, moves };
}

export default {
  name: "dsp-motion",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(css|scss|less|html?)$/i.test(f.rel));
      const reads = [];
      let honoured = false;
      let motion = 0;
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!/animation|transition|@keyframes|scroll-behavior/i.test(text)) continue;
        const read = readMotion(text, file.rel);
        reads.push(read);
        motion += read.moves;
        if (read.reducedMotion) honoured = true;
      }
      ctx.motion = { reads, honoured, motion };
      if (!motion) return log.debug("no motion declared");

      log.info(`${motion} moving declaration(s) across ${reads.length} file(s), reduced-motion ${honoured ? "honoured" : "not honoured"}`);
      if (!honoured) {
        ctx.unverified(
          `MOTION.md finds ${motion} animation or transition declaration(s) and no \`prefers-reduced-motion: reduce\` block. ` +
          `The port should still motion for people who ask for it; the fix is one media query, named in the report.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.motion?.reads.length) return;
      await ctx.write("MOTION.md", render(ctx.motion));
    });
  },
};

function render({ reads, honoured, motion }) {
  const rows = reads.map((r) =>
    `| \`${r.rel}\` | ${r.keyframes} | ${r.animations} | ${r.transitions} | ${r.smoothScroll ? "yes" : "—"} |`);

  return `# The motion the old app never made optional

${motion} moving declaration(s) across ${reads.length} file(s). Reduced motion
is **${honoured ? "honoured" : "not honoured"}**: ${honoured
  ? "a `prefers-reduced-motion: reduce` block exists, so the port has a pattern to keep."
  : "no `prefers-reduced-motion: reduce` block was found, so everyone gets the same motion, including people for whom it is nausea or a seizure risk."}

| file | @keyframes | animation | transition | smooth scroll |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

${honoured ? "" : `## The fix

Wrap the motion so a request to still it is honoured:

\`\`\`css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
\`\`\`
`}
---

This counts declarations, not seconds of movement. A single long animation
and a dozen short transitions read the same here; the report is where the
motion is, not how much it hurts.
`;
}
