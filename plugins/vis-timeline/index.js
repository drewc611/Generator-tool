import { actionLabel, extractRule } from "../dsp-behavior/model.js";

/**
 * The exploration, replayed as a timeline.
 *
 * The trace already holds what was clicked, what fired, and what the app said
 * back; spread over time and annotated, it reads as the session it was. This
 * is where "how did it ever reach that screen" gets answered without
 * re-driving anything.
 */
export default {
  name: "vis-timeline",
  version: "0.1.0",
  class: "vis",
  setup({ on, log }) {
    on("verify", async (ctx) => {
      const exploration = ctx.sources.exploration;
      if (!exploration?.steps?.length) return log.debug("nothing was explored");

      const screens = new Map((exploration.screens ?? []).map((s) => [s.id, s]));
      const name = (id) => screens.get(id)?.title || screens.get(id)?.headings?.[0] || id;

      // Recorded labels and messages are captures of somebody's screen. The
      // action label is generalised the way the behaviour model generalises
      // it, and of the messages only the complaints survive, as rules: a
      // validation message is the app's contract, a row's contents are its
      // customer's data.
      const rows = exploration.steps.map((step, i) => {
        const action = step.action ?? {};
        const label = actionLabel(step, exploration.screens ?? []) || action.selector || "";
        const did = action.kind === "fill" ? `typed into ${label}` : `${action.kind ?? "did"} ${label}`.trim();
        // The concrete path carries the record it addressed; the shape does
        // not. A version segment carries a digit and is not a record.
        const mask = (path) => String(path).split("?")[0].split("/")
          .map((seg) => (/\d/.test(seg) && !/^v\d+$/i.test(seg) ? ":id" : seg)).join("/");
        const fired = (step.requests ?? []).map((r) => `\`${r.method} ${mask(r.path)}\``).join(", ");
        const complaints = (step.messages ?? []).filter((m) => /required|must be|invalid|cannot|too (short|long)|already|please|not a valid/i.test(String(m)));
        const said = complaints.slice(0, 2).map((m) => `"${extractRule(m)}"`).join(", ")
          || ((step.messages ?? []).length ? `(${step.messages.length} message(s), none a complaint)` : "");
        const moved = step.to !== step.from ? ` → **${name(step.to)}**` : step.changed ? " (the screen changed)" : " (nothing visible changed)";
        return `| ${i + 1} | ${name(step.from)} | ${did}${moved} | ${fired || "—"} | ${said || "—"} |`;
      });

      await ctx.write("TIMELINE.md", `# The exploration, step by step

${exploration.recordedAt ? `Recorded ${exploration.recordedAt} against \`${exploration.baseUrl}\`.` : ""}
Every row is something input-explore actually did, in order, with what the app
did back. A step that fired no request and changed nothing visible is still a
step: it is how the dead controls were found.

| # | on | what was done | requests fired | the app said |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

${exploration.skipped?.length ? `## Not attempted\n\n${exploration.skipped.map((s) => `- ${s.reason ?? s}`).join("\n")}\n` : ""}
The budget was ${exploration.budget?.performed ?? exploration.steps.length} of ${exploration.budget?.maxSteps ?? "?"} steps, which is the size of the
claim this timeline can make: what it never did, it cannot describe.
`);
      log.info(`${exploration.steps.length} step(s) on the timeline`);
    });
  },
};
