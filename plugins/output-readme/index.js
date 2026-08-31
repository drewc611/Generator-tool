/**
 * The index of everything the run wrote. A port that produces fifteen files
 * without a front page is a scavenger hunt; this one file says what each
 * artifact is, in reading order, with the honest numbers beside it. It runs
 * at verify so the list is what was actually written, not what was planned.
 */

const DESCRIBES = [
  [/^PORT_NOTES\.md$/, "every item the run could not verify, which is the file to read first"],
  [/^PORT_README\.md$/, "this index"],
  [/^ARCHITECTURE\.md$/, "what kind of app this is, with the signals for and against"],
  [/^ROUTES\.md$/, "the route table, cross checked against the screens"],
  [/^WEIGHT\.md$/, "how much port each screen is, heaviest first"],
  [/^STATE\.md$/, "where state should live, argued from reads"],
  [/^API_STYLE\.md$/, "the API's house style, for the port to keep"],
  [/^AUTH\.md$/, "the auth scheme and where the token lives"],
  [/^ASSETS\.md$/, "assets held against assets referenced"],
  [/^CSS_STATS\.md$/, "the stylesheet weighed"],
  [/^SECRET_CANDIDATES\.md$/, "strings random enough to be credentials, values withheld"],
  [/^DUPLICATION\.md$/, "screens that are nearly the same screen"],
  [/^A11Y\.md$/, "accessibility findings"],
  [/^COVERAGE\.md$/, "what portion of the legacy app the run accounted for"],
  [/^DEAD_CODE\.md$/, "removal candidates, never verdicts"],
  [/^DESIGN_UPLIFT\.md$/, "the palette brought to contrast without losing the brand"],
  [/^MODERNIZATION\.md$/, "what to build instead, with the evidence"],
  [/^MIGRATION\.md$/, "the order to do it in"],
  [/^src\/api\//, "the endpoint map and client; every URL lives here and nowhere else"],
  [/^src\/features\//, "ported components, every state present"],
  [/^src\/tokens/, "design tokens measured from the original"],
  [/^src\/i18n\//, "strings pulled out of the markup"],
  [/^fixtures\//, "response fixtures, types only"],
];

export function describe(file) {
  for (const [re, text] of DESCRIBES) if (re.test(file)) return text;
  return null;
}

export default {
  name: "output-readme",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      if (!ctx.written.length) return log.debug("nothing was written");

      // PORT_NOTES.md and the coverage reports land later in this same verify
      // stage, after this plugin's turn. PORT_NOTES.md is unconditional, so it
      // is listed by contract; the rest are named as possible late arrivals.
      const reports = [...new Set([...ctx.written.filter((f) => /^[A-Z_]+\.md$/.test(f)), "PORT_NOTES.md"])].sort();
      const code = ctx.written.filter((f) => !/^[A-Z_]+\.md$/.test(f)).sort();
      const lines = [
        "# What this run wrote",
        "",
        `${ctx.written.length + 1} file(s) from \`${ctx.config.src ?? "the source"}\`. ` +
          `${ctx.report.unverified.length} item(s) could not be verified; they are listed in PORT_NOTES.md and nowhere hidden.`,
        "",
        "## Reports",
        "",
        ...reports.map((f) => {
          const author = ctx.provenance?.[f]?.plugin ?? (f === "PORT_NOTES.md" ? "vis-parity" : null);
          return `- \`${f}\`${describe(f) ? ` — ${describe(f)}` : ""}${author ? ` *(${author})*` : ""}`;
        }),
        "",
        "Every artifact names the plugin that wrote it; `portamp explain <file>`",
        "answers the same question from the terminal.",
        "",
        "## Code and data",
        "",
        ...groupedCode(code, ctx.provenance ?? {}),
        "",
        "COVERAGE.md, and TIMELINE.md or DIFF.md when the run has an exploration",
        "or a history, are written moments after this index and may not be in the",
        "counts above.",
        "",
        "Read PORT_NOTES.md before trusting anything else here.",
        "",
      ];
      await ctx.write("PORT_README.md", lines.join("\n"));
      log.info("PORT_README.md indexes the run");
    });
  },
};

function groupedCode(files, provenance) {
  const groups = new Map();
  for (const file of files) {
    const dir = file.includes("/") ? file.split("/").slice(0, -1).join("/") + "/" : "./";
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }
  const lines = [];
  for (const [dir, members] of [...groups.entries()].sort()) {
    const what = describe(members[0]) ?? describe(dir);
    const authors = [...new Set(members.map((f) => provenance[f]?.plugin).filter(Boolean))];
    lines.push(`- \`${dir}\` (${members.length} file(s))${what ? ` — ${what}` : ""}${authors.length ? ` *(${authors.join(", ")})*` : ""}`);
  }
  return lines;
}
