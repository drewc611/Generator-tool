/**
 * A strangler fig plan from the route table.
 *
 * A big bang cutover bets the product on the port being right everywhere at
 * once. Route by route, the old app keeps serving everything the new one does
 * not yet, and each step is small enough to reverse. The route table is what
 * makes this plannable at all, which is why dsp-routes exists.
 *
 * Ordering is by evidence, not by taste: routes whose screens the run has
 * ported and whose behaviour the conformance suite covers go first, because a
 * step you can prove beats a step you can only hope about.
 *
 *   migration: true
 */
export function planSteps(routes, screens, { hasConformance = false } = {}) {
  const ported = new Set(screens.map((s) => s.selector));

  const steps = routes
    .filter((r) => !r.redirectTo)
    .map((route) => {
      const screen = route.screen && ported.has(route.screen) ? route.screen : null;
      return {
        route: route.fullPath,
        screen,
        lazy: Boolean(route.lazy),
        proof: screen && hasConformance ? "conformance suite" : screen ? "manual check against the original" : null,
        // The order of battle: provable ports, then ported but unproven, then
        // the routes the run cannot serve yet.
        rank: screen && hasConformance ? 0 : screen ? 1 : 2,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.route.localeCompare(b.route));

  return steps;
}

export default {
  name: "output-migration",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.migration) return log.debug("not requested");
      if (!ctx.routes?.table?.length) {
        if (ctx.config.migration) ctx.unverified(
          "A migration plan was requested but no route table was found, and a strangler plan without routes " +
          "is a guess about the thing it exists to de risk. Declare the routes, or drive the app with " +
          "input-explore so they can be observed."
        );
        return log.info("no route table to plan from");
      }

      const hasConformance = ctx.written.some((f) => /conformance\.spec\.js$/.test(f));
      const steps = planSteps(ctx.routes.table, ctx.screens, { hasConformance });
      // The step's risk has a number already: how many unverified notes name
      // its screen. Zero is not proof of nothing, only of nothing named.
      for (const step of steps) {
        step.openItems = step.screen
          ? ctx.report.unverified.filter((n) => String(n).includes(`<${step.screen}>`) || String(n).includes(` ${step.screen} `)).length
          : null;
      }
      await ctx.write("MIGRATION.md", render(steps, hasConformance));
      await ctx.write("MIGRATION_MAP.mmd", mermaid(steps, ctx));
      log.info(`${steps.length} cutover step(s) planned, ${steps.filter((s) => s.rank === 0).length} provable`);
    });
  },
};

function render(steps, hasConformance) {
  const rows = steps.map((s, i) => {
    const target = s.screen ? `\`<${s.screen}>\`` : s.lazy ? "a lazy module the run has not read" : "**not ported yet**";
    const proof = s.proof ?? "cannot cut over until it exists in the port";
    const open = s.openItems === null ? "—" : s.openItems === 0 ? "none named" : `${s.openItems} in PORT_NOTES.md`;
    return `| ${i + 1} | \`${s.route}\` | ${target} | ${proof} | ${open} |`;
  });

  return `# The cutover, one route at a time

A big bang cutover bets the product on the port being right everywhere at once.
This plan does not. Each step moves one route to the new app behind the proxy
or router you already have; the old app keeps serving everything the new one
does not yet, and each step is small enough to reverse.

The order is by evidence, not preference: routes the run has ported and can
prove go first.

| step | route | serves | proven by | open items |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

"Open items" counts the unverified notes that name the step's screen: the
work a person still owes that step before its cutover. "None named" is not
proof of nothing, only of nothing the run could name.

## The rules that make this safe

- **One route per step.** Two at once means a failure has two suspects.
- **The rollback is the routing rule.** Every step is undone by pointing the
  route back at the old app; nothing else moves, so nothing else can break.
- **A step is done when its proof passes in production**, not when it deploys.
${hasConformance
    ? "- The conformance suite is the proof for the steps marked with it. Run it\n  against the route after cutover, not only before."
    : "- No conformance suite was emitted in this run. Turning it on (it is\n  output-tests) gives most of these steps a real proof instead of a manual one."}
- **The old app is decommissioned last**, when nothing routes to it, and not
  one step before.
`;
}

/**
 * The same plan as a picture. GitHub renders .mmd inline, so the map is
 * readable where the pull request is reviewed. Labels are quoted through
 * JSON.stringify and the ids are sanitised, because a route named after an
 * expression must not become mermaid syntax.
 */
function mermaid(steps, ctx) {
  const id = (s) => String(s).replace(/[^\w]/g, "_") || "root";
  const label = (s) => JSON.stringify(String(s));
  const lines = ["flowchart LR", `  legacy[${label("legacy app")}]`, `  port[${label("the port")}]`];
  for (const step of steps) {
    const node = `r_${id(step.route)}`;
    lines.push(`  ${node}[${label(step.route)}]`);
    if (step.screen) {
      lines.push(`  ${node} --> s_${id(step.screen)}[${label(step.screen)}]`);
      lines.push(`  s_${id(step.screen)} --> port`);
    } else {
      lines.push(`  ${node} -.->|${label("still legacy")}| legacy`);
    }
  }
  const endpoints = [...new Set((ctx.api?.calls ?? []).map((c) => `${c.method} ${String(c.path).split("?")[0]}`))].slice(0, 20);
  for (const endpoint of endpoints) {
    lines.push(`  port --> e_${id(endpoint)}[${label(endpoint)}]`);
  }
  return lines.join("\n") + "\n";
}
