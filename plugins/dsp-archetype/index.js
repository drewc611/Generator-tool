import { buildIr } from "../dsp-ir/ir.js";
import { classify } from "./classify.js";
import { mergeShapes, shapeOf } from "./shape.js";

/**
 * Recognises what the legacy app is, so the plan for rebuilding it can follow
 * from that rather than from taste.
 *
 * This runs on the IR, so it answers the same question whether the app arrived
 * as Angular, as Vue, as jQuery, or as a thing somebody drove in a browser with
 * no source at all. That is the whole reason the IR exists.
 *
 * It never says only what the app is. It says what it looked at, what it found,
 * what it did not find, and how close the second answer was.
 */

/**
 * Things worth saying whatever the archetype turns out to be. Each one is a
 * fact about the old app that will otherwise be reproduced in the new one.
 */
function observe({ shape, api, screens, model }) {
  const found = [];

  if (api.collections.length && !shape.pagination && !api.query.some((q) => /page|offset|limit|cursor|size/i.test(q))) {
    found.push({
      id: "unbounded-collection",
      severity: "high",
      what: "A collection is fetched with no sign of paging.",
      why: "Nothing in the markup or the observed traffic mentions a page, an offset or a limit, so the screen appears to load the whole table and render every row. That is survivable at the size the data was when this was written and not at the size it is now.",
    });
  }

  if (shape.models > 0 && !api.query.length) {
    found.push({
      id: "state-not-in-url",
      severity: "medium",
      what: "Filter controls hold their value in the component, not in the address.",
      why: "A filtered view cannot be linked, bookmarked or reloaded. Putting the controls in the query string costs little and is the difference between a screen somebody can send to a colleague and one they have to describe.",
    });
  }

  const unseen = (model?.screens ?? []).filter((s) => s.states && !s.states.empty);
  if (unseen.length) {
    found.push({
      id: "states-never-seen",
      severity: "medium",
      what: `${unseen.length} screen(s) were never observed in their empty state.`,
      why: "An empty state that renders nothing is the most common defect in a port, because nobody sees it until the data runs out in production.",
    });
  }

  if (shape.destructive > 0) {
    found.push({
      id: "destructive-controls",
      severity: "medium",
      what: `${shape.destructive} control(s) delete or discard something.`,
      why: "portamp cannot tell from the markup whether any of them confirms first. Check each one, and give the new ones an undo rather than a dialog where the action can be reversed.",
    });
  }

  if (shape.nestedLoops > 0) {
    found.push({
      id: "nested-repetition",
      severity: "low",
      what: `${shape.nestedLoops} repeated region(s) sit inside another one.`,
      why: "Rows inside rows are where a list becomes slow and where a key becomes load bearing. Worth a component boundary in the port.",
    });
  }

  const heavy = screens.filter((s) => s.ir && shapeOf(s.ir).elements > 60);
  if (heavy.length) {
    found.push({
      id: "large-templates",
      severity: "low",
      what: `${heavy.length} template(s) render more than sixty elements: ${heavy.map((s) => s.selector).join(", ")}.`,
      why: "A screen that large is usually several screens that were never separated. The rebuild is the cheapest moment to separate them.",
    });
  }

  return found;
}

export default {
  name: "dsp-archetype",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const screens = ctx.screens ?? [];
      const withTemplates = screens.filter((s) => s.template);

      const shapes = withTemplates.map((s) => shapeOf(s.ir ?? buildIr(s.template)));
      const shape = mergeShapes(shapes);

      // With no source there is no markup, but an exploration described the
      // screens it drove, and that is enough to recognise the shape.
      if (!withTemplates.length && ctx.model?.screens?.length) {
        for (const s of ctx.model.screens) {
          if (s.kind === "list") shape.loops += 1;
          if (s.kind === "form") { shape.inputs += (s.fields ?? []).length; shape.submits += 1; shape.forms += 1; }
          if (s.collection?.columns?.length) shape.tables += 1;
          shape.headings += 1;
        }
      }

      const verdict = classify({
        shape,
        calls: ctx.api?.calls ?? [],
        model: ctx.model ?? null,
        widgets: ctx.widgets ?? [],
        components: screens.length,
      });

      if (!verdict.best) {
        log.info("not enough signal to name a shape");
        ctx.unverified(
          "portamp could not recognise the shape of this app. Nothing matched two independent signals, " +
          "which usually means there was very little to read: no templates, no observed traffic, and no exploration."
        );
        return;
      }

      const observations = observe({ shape, api: verdict.api, screens: withTemplates, model: ctx.model });
      ctx.archetype = { ...verdict, shape, observations };

      const pct = Math.round(verdict.best.confidence * 100);
      log.info(`${verdict.best.id} (${verdict.best.matched}/${verdict.best.of} signals), ${observations.length} observation(s)`);

      if (verdict.contested) {
        ctx.unverified(
          `The shape of this app is not clear cut: ${verdict.best.id} and ${verdict.ranked[1].id} scored within ` +
          `twenty points of each other. ARCHITECTURE.md lists the evidence for both; read it before trusting either.`
        );
      } else if (pct < 60) {
        ctx.unverified(
          `The shape of this app was read as ${verdict.best.id} on ${verdict.best.matched} of ${verdict.best.of} ` +
          `signals, which is a weak match. ARCHITECTURE.md says what was missing.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.archetype) return;
      await ctx.write("ARCHITECTURE.md", render(ctx.archetype));
    });
  },
};

function render({ ranked, best, contested, api, shape, observations }) {
  const pct = (c) => `${Math.round(c * 100)}%`;

  const candidates = ranked.map((a) => {
    const head = a === best ? `### ${a.name}  (${a.id})` : `### ${a.name}  (${a.id})`;
    return `${head}

Matched ${a.matched} of ${a.of} signals, ${pct(a.confidence)}.

${a.evidence.map((e) => `- ${e}`).join("\n")}
${a.missing ? `\n${a.missing} signal(s) this shape usually shows were not found.` : ""}`;
  }).join("\n\n");

  const notes = observations.length
    ? observations.map((o) => `### ${o.what}\n\n_${o.severity}_ — ${o.why}`).join("\n\n")
    : "Nothing beyond the shape itself.";

  return `# What this app is

portamp read the structure, not the framework. Everything below came from the
intermediate representation, the endpoints, and whatever the exploration saw, so
it would say the same thing about the same app written in anything.

## The reading

**${best.name}**, on ${best.matched} of ${best.of} signals (${pct(best.confidence)}).
${contested ? `
This is contested. \`${ranked[1].id}\` scored ${pct(ranked[1].confidence)}, close
enough that the two readings are not distinguishable from what portamp could
see. Both are set out below. Read them before you rely on either.
` : ""}
## Every candidate, and what it rested on

${candidates}

## What the endpoints say

| | |
| --- | --- |
| reads | ${api.reads.length} |
| writes | ${api.writes.length} |
| addressing one record | ${api.byId.length} |
| collections | ${api.collections.length} |
| query keys observed | ${api.query.length ? api.query.join(", ") : "none"} |

## What the markup is made of

| | | | |
| --- | --- | --- | --- |
| elements | ${shape.elements} | repeated regions | ${shape.loops} |
| tables | ${shape.tables} | conditionals | ${shape.conditionals} |
| fields | ${shape.inputs + shape.selects + shape.checkboxes} | bound controls | ${shape.models} |
| submits | ${shape.submits} | destructive controls | ${shape.destructive} |

## Worth knowing whatever the shape is

${notes}

---

This is a reading, not a fact. It is built from what could be seen: templates
that parsed, endpoints that appeared in the source or in observed traffic, and
screens an exploration actually reached. A part of the app none of those touched
did not vote.
`;
}
