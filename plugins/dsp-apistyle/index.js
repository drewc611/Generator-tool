/**
 * The API's house style, read off the traffic the readers collected. A port
 * that renames /order_items to /orderItems has invented a second API; the
 * point of writing the conventions down is so the port keeps them, including
 * the inconsistencies, which are part of the contract now.
 */

const caseOf = (segment) => {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(segment)) return "kebab-case";
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(segment)) return "snake_case";
  if (/^[a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(segment)) return "camelCase";
  if (/^[a-z0-9]+$/.test(segment)) return "single word";
  return null;
};

const PAGINATION = {
  page: "page number", per_page: "page number", perPage: "page number", size: "page number",
  limit: "offset and limit", offset: "offset and limit", skip: "offset and limit", top: "offset and limit",
  cursor: "cursor", after: "cursor", next: "cursor", pageToken: "cursor",
};

export function readStyle(calls) {
  const cases = new Map();
  const versions = new Set();
  const pagination = new Map();
  const resources = [];

  for (const call of calls) {
    const [path, query] = String(call.path).split("?");
    for (const segment of path.split("/").filter(Boolean)) {
      if (/[{$:]/.test(segment) || /^\d+$/.test(segment)) continue;
      if (/^v\d+$/i.test(segment)) { versions.add(segment.toLowerCase()); continue; }
      const kind = caseOf(segment);
      if (kind) {
        cases.set(kind, (cases.get(kind) ?? 0) + 1);
        resources.push(segment);
      }
    }
    if (query) {
      for (const pair of query.split("&")) {
        const key = pair.split("=")[0];
        const style = PAGINATION[key];
        if (style) pagination.set(style, [...(pagination.get(style) ?? []), key]);
      }
    }
  }

  const plural = resources.filter((r) => /s$/.test(r)).length;
  return {
    cases: [...cases.entries()].sort((a, b) => b[1] - a[1]),
    versions: [...versions],
    pagination: [...pagination.entries()],
    plurality: resources.length ? { plural, total: resources.length } : null,
  };
}

export default {
  name: "dsp-apistyle",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", (ctx) => {
      if (!ctx.api.calls.length) return log.debug("no traffic to read");
      ctx.apiStyle = readStyle(ctx.api.calls);
      const lead = ctx.apiStyle.cases[0];
      log.info(lead ? `paths lean ${lead[0]}${ctx.apiStyle.cases.length > 1 ? ", not uniformly" : ""}` : "no readable segments");
    });

    on("emit", async (ctx) => {
      if (!ctx.apiStyle) return;
      const s = ctx.apiStyle;
      const lines = [
        "# API house style",
        "",
        "Read off the calls this run collected. The port keeps these conventions,",
        "inconsistencies included: the server expects them, and a renamed path is",
        "a second API with one client.",
        "",
      ];
      if (s.cases.length) {
        lines.push("## Path segments", "");
        for (const [kind, n] of s.cases) lines.push(`- ${kind}: ${n} segment(s)`);
        if (s.cases.length > 1) lines.push("", "More than one convention is in use. The port copies each path as written and does not harmonise.");
        lines.push("");
      }
      if (s.plurality) {
        lines.push(`## Resource naming`, "", `${s.plurality.plural} of ${s.plurality.total} resource segment(s) are plural.`, "");
      }
      lines.push("## Versioning", "", s.versions.length ? `Version prefix in use: ${s.versions.map((v) => `\`/${v}\``).join(", ")}.` : "No version segment appears in any path.", "");
      lines.push(
        "## Pagination",
        "",
        s.pagination.length
          ? s.pagination.map(([style, keys]) => `- ${style}, via ${[...new Set(keys)].map((k) => `\`${k}\``).join(", ")}`).join("\n")
          : "No pagination parameter was observed. Either the lists are unpaged or paging happens in a call this run never saw; the port should find out before shipping an unbounded table.",
        ""
      );
      await ctx.write("API_STYLE.md", lines.join("\n"));
    });
  },
};
