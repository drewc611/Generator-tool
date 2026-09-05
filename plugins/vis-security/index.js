/**
 * One security scorecard over what the security analyzers already measured.
 *
 * The port's trust surface is read by several plugins: dsp-security (the sharp
 * edges in markup and scripts), dsp-supplychain (third-party code loaded without
 * a Subresource Integrity hash), dsp-iframes (embedded documents running with no
 * sandbox), dsp-cookies (cookies set with no consent mechanism in play) and
 * dsp-analytics (trackers whose return is a consent decision). Each writes its
 * own report; a reviewer who wants the whole picture opens five files.
 *
 * vis-security reads what those plugins left on the context and writes
 * SECURITY_SCORECARD.md, one table of every concern with the count it reported
 * and exactly what that count is. It invents nothing: every number here is
 * another plugin's, a concern whose plugin did not run is named "not measured"
 * rather than scored zero, and it writes nothing when none ran. It is a count,
 * not a grade, and it does not collide with dsp-security's own SECURITY.md.
 */

function collect(ctx) {
  const rows = [];

  const security = ctx.security?.findings;
  rows.push(security
    ? { concern: "Markup & script", present: true, count: security.length, note: "inline handler, eval, innerHTML, document.write, blank-noopener or no-CSP finding(s)" }
    : { concern: "Markup & script", present: false });

  const deps = ctx.supplychain?.deps;
  rows.push(deps
    ? { concern: "Supply chain", present: true, count: deps.filter((d) => !d.sri).length, of: deps.length, note: "external dependency(s) with no Subresource Integrity, of those loaded" }
    : { concern: "Supply chain", present: false });

  const iframes = ctx.iframes;
  rows.push(iframes
    ? { concern: "Iframe sandbox", present: true, count: iframes.unsandboxedThirdParty, of: iframes.thirdParty, note: "third-party iframe(s) with no sandbox, of third-party embeds" }
    : { concern: "Iframe sandbox", present: false });

  const cookies = ctx.cookies;
  rows.push(cookies
    ? {
        concern: "Cookies & consent",
        present: true,
        count: cookies.consent.length ? 0 : cookies.cookies.length,
        note: cookies.consent.length
          ? `${cookies.cookies.length} cookie write(s); a consent mechanism is present (${cookies.consent.join(", ")}), so ordering is the reviewer's to confirm`
          : "cookie write(s) with no consent mechanism found in the source",
      }
    : { concern: "Cookies & consent", present: false });

  const analytics = ctx.analytics;
  rows.push(analytics
    ? { concern: "Trackers", present: true, count: analytics.length, note: "third-party tracker(s) the source loaded; re-adding any is a consent decision" }
    : { concern: "Trackers", present: false });

  return rows;
}

export default {
  name: "vis-security",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      const rows = collect(ctx);
      const measured = rows.filter((r) => r.present);
      if (!measured.length) return log.debug("no security analyzers ran; no scorecard");

      const total = measured.reduce((n, r) => n + r.count, 0);
      ctx.securityScorecard = { rows, measured: measured.length, total };
      log.info(`security scorecard: ${total} item(s) flagged across ${measured.length} concern(s)`);
      await ctx.write("SECURITY_SCORECARD.md", render(rows, measured.length, total));
    });
  },
};

function render(rows, measured, total) {
  const body = rows
    .map((r) => {
      if (!r.present) return `| ${r.concern} | not measured | — |`;
      const count = r.of !== undefined ? `${r.count} / ${r.of}` : String(r.count);
      return `| ${r.concern} | ${count} | ${r.note} |`;
    })
    .join("\n");

  return `# Security, every concern on one page

This is a scorecard over what the security analyzers already measured, not a new
measurement. Each row is one plugin's own count and exactly what that count
means. A concern whose plugin did not run this time is "not measured", never
scored zero. It is a count, not a grade: portamp reports the trust surface the
old front end carried and leaves the ranking to a reviewer.

**${total}** item(s) flagged across **${measured}** concern(s) measured this run.

| concern | count | what it is |
| --- | --- | --- |
${body}

Each concern has its own report with the detail of every item: SECURITY.md
(dsp-security), SUPPLYCHAIN.md, IFRAMES.md, COOKIES.md and ANALYTICS.md. No
finding here carries a value, a secret, a cookie's contents or a signed URL;
this page only gathers headline numbers so the whole picture fits in one glance.

---

Nothing here was changed or invented. Every number is another plugin's, and what
to harden first is the reviewer's call.
`;
}
