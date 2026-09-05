/**
 * One performance scorecard over what the performance analyzers already measured.
 *
 * The port's weight and its first paint are read by several plugins: dsp-perf
 * (the script habits that stall a page: a synchronous XHR, a request in a loop,
 * an interval poll), dsp-render-blocking (what the parser waits on before it can
 * paint), dsp-inline (style and script that cannot be cached or themed),
 * dsp-images (pictures shipped at one fixed size), dsp-fonts (faces with no woff2
 * or no font-display) and general-size (the bytes the port itself weighs). Each
 * writes its own report; a reviewer who wants the whole picture opens six files.
 *
 * vis-perf reads what those plugins left on the context and writes
 * PERFORMANCE.md, one table of every concern with the count it reported and
 * exactly what that count is. It invents nothing: every number is another
 * plugin's, a concern whose plugin did not run is "not measured" rather than
 * scored zero, and it writes nothing when none ran. The port's size is shown
 * beside the table as a measurement, not summed into the flagged items, because
 * a byte is not a defect. It is a count, not a grade. It does not collide with
 * dsp-perf's PERF.md or general-size's SIZE.md.
 */

// The same three checks dsp-fonts advises on; a face with any of them is a gap.
const fontGap = (face) =>
  !face.formats.includes("woff2") ||
  face.formats.some((f) => ["eot", "svg", "ttf"].includes(f)) ||
  !face.display;

export function collect(ctx) {
  const rows = [];

  const perf = ctx.perf;
  rows.push(perf
    ? { concern: "Script habits", present: true, count: perf.length, note: "sync XHR, document.write, request-in-loop or interval-poll finding(s)" }
    : { concern: "Script habits", present: false });

  const blocking = ctx.renderBlocking?.findings;
  rows.push(blocking
    ? { concern: "First paint", present: true, count: blocking.length, note: "render-blocking script, stylesheet or @import the parser waits on" }
    : { concern: "First paint", present: false });

  const totals = ctx.inline?.totals;
  rows.push(totals
    ? { concern: "Inline style & script", present: true, count: totals.styleAttrs + totals.styleBlocks + totals.scriptBlocks, note: "inline style attribute(s), <style> block(s) and inline <script> block(s)" }
    : { concern: "Inline style & script", present: false });

  const images = ctx.images;
  rows.push(images
    ? { concern: "Images", present: true, count: images.filter((i) => i.wants?.length).length, of: images.length, note: "image(s) missing a srcset, lazy loading, dimensions, a modern format or alt, of images found" }
    : { concern: "Images", present: false });

  const faces = ctx.fonts?.faces;
  rows.push(faces
    ? { concern: "Fonts", present: true, count: faces.filter(fontGap).length, of: faces.length, note: "face(s) with no woff2, a legacy format or font-display unset, of faces declared" }
    : { concern: "Fonts", present: false });

  return rows;
}

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;

/**
 * The scorecard's headline number, reckoned from what the analyzers left at
 * plan. The port's size is not in it, because a byte is not a defect.
 * general-policy's --max-perf ceiling imports this rather than reading the
 * scorecard, so the gate agrees with the report and does not depend on which
 * verify handler ran first.
 */
export const perfTotal = (ctx) => collect(ctx).filter((r) => r.present).reduce((n, r) => n + r.count, 0);

export default {
  name: "vis-perf",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      const rows = collect(ctx);
      const measured = rows.filter((r) => r.present);
      const size = ctx.size ? kb(ctx.size.total) : null;
      if (!measured.length && size === null) return log.debug("no performance analyzers ran; no scorecard");

      const total = measured.reduce((n, r) => n + r.count, 0);
      ctx.perfScorecard = { rows, measured: measured.length, total, sizeKb: size };
      log.info(`performance scorecard: ${total} item(s) flagged across ${measured.length} concern(s)${size === null ? "" : `, port weighs ${size} KB`}`);
      await ctx.write("PERFORMANCE.md", render(rows, measured.length, total, size));
    });
  },
};

function render(rows, measured, total, size) {
  const body = rows
    .map((r) => {
      if (!r.present) return `| ${r.concern} | not measured | — |`;
      const count = r.of !== undefined ? `${r.count} / ${r.of}` : String(r.count);
      return `| ${r.concern} | ${count} | ${r.note} |`;
    })
    .join("\n");

  const weight = size === null
    ? "The port's own weight was not measured this run."
    : `The port itself weighs **${size} KB** on disk (components, api client, tokens and host), per general-size. That is a measurement, not a defect, so it is shown here and not summed into the items above.`;

  return `# Performance, every concern on one page

This is a scorecard over what the performance analyzers already measured, not a
new measurement. Each row is one plugin's own count and exactly what that count
means. A concern whose plugin did not run this time is "not measured", never
scored zero. It is a count, not a grade: portamp reports the weight and the
first-paint habits the old front end carried and leaves the priorities to a
reviewer.

**${total}** item(s) flagged across **${measured}** concern(s) measured this run.

| concern | count | what it is |
| --- | --- | --- |
${body}

${weight}

Each concern has its own report with the detail of every item: PERF.md
(dsp-perf), RENDER.md (dsp-render-blocking), INLINE.md, IMAGES.md, FONTS.md and
SIZE.md. This
page only gathers their headline numbers so the whole picture fits in one glance.

---

Nothing here was changed or invented. Every number is another plugin's, and what
to speed up first is the reviewer's call.
`;
}
