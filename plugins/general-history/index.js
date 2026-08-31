import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * The run over time. Each run appends one line of numbers to a jsonl file
 * and rewrites HISTORY.md from all of them, so "is the port getting better"
 * has a table instead of a feeling. The record is counts only: no paths from
 * anybody's machine, no captured values, nothing a diff of the numbers would
 * embarrass.
 *
 * It records at verify, before the last reporters run, and says so: the file
 * count is "at the time of recording", while screens, endpoints and
 * unverified are final by then.
 */

export function renderHistory(entries) {
  const lines = [
    "# The run, over time",
    "",
    "One line per run, oldest first. Trend beats snapshot: an unverified count",
    "that only grows is a port that is guessing more, whatever today's number is.",
    "",
    "| ran at | screens | endpoints | unverified | files at recording |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...entries.map((e) => `| ${e.ranAt} | ${e.screens} | ${e.endpoints} | ${e.unverified} | ${e.files} |`),
    "",
  ];
  const last = entries.at(-1);
  const prev = entries.at(-2);
  if (last && prev) {
    const delta = last.unverified - prev.unverified;
    lines.push(
      delta > 0
        ? `Unverified went up by ${delta} since the previous run. New readers finding new gaps is fine; the same reader re-guessing is not, and DIFF.md says which this is.`
        : delta < 0
          ? `Unverified went down by ${-delta} since the previous run.`
          : "Unverified is unchanged since the previous run.",
      ""
    );
  }
  return lines.join("\n");
}

export default {
  name: "general-history",
  version: "0.1.0",
  class: "general",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      const entry = {
        ranAt: new Date().toISOString().slice(0, 19) + "Z",
        screens: ctx.screens.length,
        endpoints: new Set(ctx.api.calls.map((c) => `${c.method} ${c.path}`)).size,
        unverified: ctx.report.unverified.length,
        files: ctx.written.length,
      };

      const path = join(ctx.config.out, ".portamp", "history.jsonl");
      let previous = [];
      try {
        previous = (await readFile(path, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        previous = [];
      }
      const entries = [...previous, entry].slice(-200);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
      await ctx.write("HISTORY.md", renderHistory(entries));
      log.info(`run ${entries.length} recorded`);
    });
  },
};
