/**
 * One accessibility scorecard over what the dsp analyzers already measured.
 *
 * The port's accessibility is read by seven plugins, each on its own axis:
 * dsp-landmarks (regions), dsp-labels (control names), dsp-a11y (contrast and
 * target size), dsp-focus (the keyboard), dsp-media (captions), dsp-tables
 * (grids) and dsp-iframes (embedded documents). Each writes its own report, and
 * a port owner who wants the whole picture has to open seven files.
 *
 * vis-a11y reads what those plugins left on the context and writes A11Y.md, one
 * table of every axis with the count it reported and exactly what that count is.
 * It invents nothing: every number here is another plugin's, and an axis whose
 * plugin did not run is named "not measured" rather than scored zero. It is a
 * count, not a grade; portamp does not know which gap matters most to this
 * product, so it does not pretend to.
 */

function collect(ctx) {
  const rows = [];

  const landmarks = ctx.landmarks;
  rows.push(landmarks
    ? { axis: "Landmarks", present: true, count: landmarks.filter((p) => p.issues?.length).length, of: landmarks.length, note: "page(s) with a landmark gap, of pages read" }
    : { axis: "Landmarks", present: false });

  const labels = ctx.labels?.findings;
  rows.push(labels
    ? { axis: "Control names", present: true, count: labels.length, note: "form control(s) with no accessible name" }
    : { axis: "Control names", present: false });

  const a11y = ctx.a11y;
  rows.push(a11y
    ? { axis: "Contrast & target size", present: true, count: a11y.length, note: "contrast and target-size finding(s)" }
    : { axis: "Contrast & target size", present: false });

  const focus = ctx.focus;
  rows.push(focus
    ? { axis: "Focus", present: true, count: focus.findings.length, note: "focus signal(s): positive tabindex, autofocus, accesskey, programmatic focus" }
    : { axis: "Focus", present: false });

  const media = ctx.media;
  rows.push(media
    ? { axis: "Media captions", present: true, count: media.noCaptions, of: media.videos, note: "video(s) with no captions track, of videos found" }
    : { axis: "Media captions", present: false });

  const tables = ctx.tables;
  rows.push(tables
    ? { axis: "Tables", present: true, count: tables.noCaption + tables.noScope, of: tables.dataTables, note: "data-table gap(s) in caption or scope, over tables with headers" }
    : { axis: "Tables", present: false });

  const iframes = ctx.iframes;
  rows.push(iframes
    ? { axis: "Iframes", present: true, count: iframes.noTitle, of: iframes.findings.length, note: "iframe(s) with no title, of iframes found" }
    : { axis: "Iframes", present: false });

  return rows;
}

export default {
  name: "vis-a11y",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      const rows = collect(ctx);
      const measured = rows.filter((r) => r.present);
      if (!measured.length) return log.debug("no accessibility analyzers ran; no scorecard");

      const total = measured.reduce((n, r) => n + r.count, 0);
      ctx.a11yScorecard = { rows, measured: measured.length, total };
      log.info(`accessibility scorecard: ${total} item(s) flagged across ${measured.length} axis(es)`);
      await ctx.write("ACCESSIBILITY.md", render(rows, measured.length, total));
    });
  },
};

function render(rows, measured, total) {
  const body = rows
    .map((r) => {
      if (!r.present) return `| ${r.axis} | not measured | — |`;
      const count = r.of !== undefined ? `${r.count} / ${r.of}` : String(r.count);
      return `| ${r.axis} | ${count} | ${r.note} |`;
    })
    .join("\n");

  return `# Accessibility, every axis on one page

This is a scorecard over what the accessibility analyzers already measured, not a
new measurement. Each row is one plugin's own count and exactly what that count
means. An axis whose plugin did not run this time is "not measured", never scored
zero. It is a count, not a grade: portamp does not know which gap matters most to
this product, so it does not pretend to rank them.

**${total}** item(s) flagged across **${measured}** axis(es) measured this run.

| axis | count | what it is |
| --- | --- | --- |
${body}

Each axis has its own report with the file and line of every item: LANDMARKS.md,
LABELS.md, A11Y.md (dsp-a11y, the recovered palette's contrast), FOCUS.md,
MEDIA.md, TABLES.md and IFRAMES.md. This page only gathers their headline
numbers so the whole picture fits in one glance.

---

Nothing here was changed or invented. Every number is another plugin's, and what
to fix first is the port owner's call.
`;
}
