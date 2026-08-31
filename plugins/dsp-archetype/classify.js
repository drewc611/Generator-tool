/**
 * What kind of application is this.
 *
 * The readers already know which framework wrote the app. That is the less
 * useful question. What a rebuild needs to know is what the app *is*: a table
 * with filters behaves one way, a wizard another, and the decisions that follow
 * (routing, where state lives, what to fetch and when) fall out of that rather
 * than out of whether it was Angular.
 *
 * Every verdict carries the evidence that produced it and a confidence, and
 * nothing is asserted from a single signal. Where two archetypes are close the
 * report says so rather than picking one and sounding certain.
 */

/**
 * Each rule returns the signals it found. Confidence is the share of a rule's
 * signals that fired, so a shape matching four of four reads higher than one
 * matching two of four, and a rule that fires on nothing scores zero.
 */
const ARCHETYPES = [
  {
    id: "crud-table",
    name: "Table of records, edited in place",
    signals: (f, api) => [
      f.tables > 0 || f.loops > 0 ? `${f.tables ? `${f.tables} table(s)` : `${f.loops} repeated region(s)`}` : null,
      api.reads.length ? `${api.reads.length} read endpoint(s)` : null,
      api.writes.length ? `${api.writes.length} write endpoint(s) on the same resource` : null,
      f.destructive > 0 ? `${f.destructive} destructive control(s)` : null,
    ],
  },
  {
    id: "master-detail",
    name: "A list that opens one record",
    signals: (f, api) => [
      f.loops > 0 ? `${f.loops} repeated region(s)` : null,
      api.byId.length ? `${api.byId.length} endpoint(s) addressing a single record` : null,
      api.collections.length ? `${api.collections.length} collection endpoint(s)` : null,
      f.links > 1 ? `${f.links} link(s) out of the list` : null,
    ],
  },
  {
    id: "search-and-filter",
    name: "A collection narrowed by controls",
    signals: (f, api) => [
      f.searchFields > 0 ? `${f.searchFields} search or filter field(s)` : null,
      f.loops > 0 ? "results are a repeated region" : null,
      f.models > 0 ? `${f.models} two way bound control(s)` : null,
      api.query.length ? `query parameters observed: ${api.query.slice(0, 4).join(", ")}` : null,
    ],
  },
  {
    id: "form-entry",
    name: "A form that submits once",
    signals: (f, api) => [
      f.inputs + f.selects + f.checkboxes >= 2 ? `${f.inputs + f.selects + f.checkboxes} field(s)` : null,
      f.submits > 0 ? `${f.submits} submit control(s)` : null,
      api.writes.length ? `${api.writes.length} write endpoint(s)` : null,
      f.forms > 0 ? `${f.forms} form element(s)` : null,
    ],
  },
  {
    id: "wizard",
    name: "One task split across steps",
    signals: (f, api, ctx) => [
      f.stepMarkers > 1 ? `${f.stepMarkers} step marker(s) in the copy` : null,
      f.inputs + f.selects >= 2 ? `${f.inputs + f.selects} field(s)` : null,
      ctx.formScreens > 1 ? `${ctx.formScreens} separate form screen(s)` : null,
      ctx.chainedTransitions > 1 ? `${ctx.chainedTransitions} transition(s) between them` : null,
    ],
  },
  {
    id: "dashboard",
    name: "Many read only panels on one screen",
    signals: (f, api) => [
      f.charts > 0 ? `${f.charts} drawing surface(s)` : null,
      f.headings > 2 ? `${f.headings} headings on one screen` : null,
      api.reads.length > 2 ? `${api.reads.length} read endpoint(s)` : null,
      api.writes.length === 0 ? "nothing is written" : null,
    ],
  },
  {
    id: "selector-soup",
    name: "Behaviour attached to selectors, with no components",
    signals: (f, api, ctx) => [
      ctx.widgets > 0 ? `${ctx.widgets} selector(s) written to or listened on` : null,
      ctx.components === 0 ? "no component was declared anywhere" : null,
      ctx.widgets > 4 ? "enough of them to need boundaries" : null,
      api.reads.length + api.writes.length > 0 ? "and it talks to a server" : null,
    ],
  },
];

/** What the endpoints say, independent of any markup. */
export function readApi(calls = [], model = null) {
  const paths = calls.map((c) => ({ method: String(c.method || "GET").toUpperCase(), path: String(c.path || "") }));
  const byId = paths.filter((p) => /[:{$]|\/\d+(?:\/|$)/.test(p.path));
  const collections = paths.filter((p) => p.method === "GET" && !byId.includes(p));
  return {
    reads: paths.filter((p) => p.method === "GET"),
    writes: paths.filter((p) => ["POST", "PUT", "PATCH", "DELETE"].includes(p.method)),
    byId,
    collections,
    query: [...new Set((model?.endpoints ?? []).flatMap((e) => e.query ?? []))],
  };
}

export function classify({ shape, calls = [], model = null, widgets = [], components = 0 }) {
  const api = readApi(calls, model);
  const context = {
    widgets: widgets.length,
    components,
    formScreens: (model?.screens ?? []).filter((s) => s.kind === "form").length,
    chainedTransitions: (model?.transitions ?? []).length,
  };

  const scored = ARCHETYPES.map((a) => {
    const signals = a.signals(shape, api, context);
    const found = signals.filter(Boolean);
    return {
      id: a.id,
      name: a.name,
      confidence: found.length / signals.length,
      matched: found.length,
      of: signals.length,
      evidence: found,
      // What the rule looked for and did not find is the honest half: it is
      // exactly what would have to be true for the answer to be different.
      missing: signals.filter((s) => !s).length,
    };
  })
    // One signal is a coincidence. Two is the smallest thing worth reporting.
    .filter((a) => a.matched >= 2)
    .sort((a, b) => b.confidence - a.confidence || b.matched - a.matched);

  const best = scored[0] ?? null;
  const runnerUp = scored[1] ?? null;
  const contested = Boolean(best && runnerUp && best.confidence - runnerUp.confidence < 0.2);

  return { ranked: scored, best, contested, api, context };
}
