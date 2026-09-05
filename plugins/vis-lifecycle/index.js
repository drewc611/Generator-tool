/**
 * One lifecycle scorecard over what the cleanup analyzers already measured.
 *
 * A component port has to tear down what the old page only set up. Three
 * plugins read that debt, each on its own axis: dsp-timers (a setInterval or
 * setTimeout with no matching clear), dsp-events (a window or document
 * addEventListener with no matching remove) and dsp-observers (an
 * IntersectionObserver, ResizeObserver, MutationObserver or PerformanceObserver
 * with no disconnect). Each writes its own report; a port owner who wants the
 * whole picture opens three files.
 *
 * vis-lifecycle reads what those plugins left on the context and writes
 * LIFECYCLE_SCORECARD.md, one table of every axis with the count it reported
 * and exactly what that count is. It invents nothing: every number here is
 * another plugin's, an axis whose plugin did not run is named "not measured"
 * rather than scored zero, and it writes nothing when none ran. It is a count,
 * not a grade. dsp-storage is deliberately not here: a storage write is a
 * persistence surface, not a teardown the port forgot, and it keeps its own
 * report.
 */

export function collect(ctx) {
  const rows = [];

  const timers = ctx.timers;
  rows.push(timers
    ? { axis: "Timers", present: true, count: timers.uncleared, of: timers.findings.length, note: "timer(s) with no matching clear in the same file, of those scheduled" }
    : { axis: "Timers", present: false });

  const events = ctx.events;
  rows.push(events
    ? { axis: "Listeners", present: true, count: events.unremoved, of: events.findings.length, note: "global listener(s) with no matching remove in the same file, of those attached" }
    : { axis: "Listeners", present: false });

  const observers = ctx.observers;
  rows.push(observers
    ? { axis: "Observers", present: true, count: observers.unclosed, of: observers.findings.length, note: "observer(s) with no disconnect in the same file, of those constructed" }
    : { axis: "Observers", present: false });

  return rows;
}

/**
 * The scorecard's headline number, reckoned from what the analyzers left at
 * plan. general-policy's --max-leaks ceiling imports this rather than reading
 * the scorecard, so the gate agrees with the report and does not depend on
 * which verify handler ran first.
 */
export const leaksTotal = (ctx) => collect(ctx).filter((r) => r.present).reduce((n, r) => n + r.count, 0);

export default {
  name: "vis-lifecycle",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      const rows = collect(ctx);
      const measured = rows.filter((r) => r.present);
      if (!measured.length) return log.debug("no cleanup analyzers ran; no scorecard");

      const total = measured.reduce((n, r) => n + r.count, 0);
      ctx.lifecycleScorecard = { rows, measured: measured.length, total };
      log.info(`lifecycle scorecard: ${total} leak(s) flagged across ${measured.length} axis(es)`);
      await ctx.write("LIFECYCLE_SCORECARD.md", render(rows, measured.length, total));
    });
  },
};

function render(rows, measured, total) {
  const body = rows
    .map((r) => {
      if (!r.present) return `| ${r.axis} | not measured | — |`;
      return `| ${r.axis} | ${r.count} / ${r.of} | ${r.note} |`;
    })
    .join("\n");

  return `# Lifecycle, every teardown on one page

This is a scorecard over what the cleanup analyzers already measured, not a new
measurement. Each row is one plugin's own count and exactly what that count
means. An axis whose plugin did not run this time is "not measured", never
scored zero. It is a count, not a grade: a teardown present in the file is not
proof it runs on every path, only that one exists to wire into the component's
unmount, and which leak matters most is the port owner's call.

**${total}** leak(s) flagged across **${measured}** axis(es) measured this run.

| axis | count | what it is |
| --- | --- | --- |
${body}

Each axis has its own report with the file and line of every item: TIMERS.md,
EVENTS.md and OBSERVERS.md. This page only gathers their headline numbers so the
whole picture fits in one glance. Storage writes are not leaks and keep their
own report in STORAGE.md.

---

Nothing here was changed or invented. Every number is another plugin's.
`;
}
