/**
 * What the rebuild should be, given what the old app turned out to be.
 *
 * These are decisions, not preferences. Each one names the thing in the legacy
 * app that makes it necessary, so a reader can disagree with the premise rather
 * than with the taste. A recommendation that cannot point at evidence is not
 * here.
 */

export const BY_ARCHETYPE = {
  "crud-table": [
    {
      id: "server-state-cache",
      title: "Keep the rows in a cache keyed by the query, not in the screen",
      because: "The old screen owns its rows, so every visit refetches and two screens showing the same records disagree.",
      instead: "A request cache keyed by the endpoint and its parameters. The screen asks for a query and renders whatever the cache has, including the fact that it is loading or stale.",
    },
    {
      id: "filters-in-url",
      title: "Put the filters in the address bar",
      because: "Filter state lives in the component, so a filtered view cannot be linked, bookmarked, or restored by a reload.",
      instead: "The query string is the source of truth. The controls read from it and write to it, and the fetch derives from it.",
    },
    {
      id: "bounded-rows",
      title: "Stop rendering every row",
      because: "Nothing in the old app pages or limits the collection.",
      instead: "Server side paging where the endpoint can offer it, and windowed rendering where it cannot. Both are worth it; only one needs the service to change.",
    },
    {
      id: "optimistic-writes",
      title: "Apply a write immediately and roll it back if it fails",
      because: "Every write in the old app is a round trip the person waits through.",
      instead: "Update the cache, send the request, and put the row back if the server disagrees. The failure path is the part to build first.",
    },
    {
      id: "undo-not-confirm",
      title: "Give a destructive action an undo instead of a dialog",
      because: "Destructive controls are present and a confirmation dialog is the usual answer.",
      instead: "Perform it, and offer to reverse it for a few seconds. A dialog interrupts everyone to protect against the rare case; an undo protects against it without interrupting anyone.",
    },
  ],

  "master-detail": [
    {
      id: "route-per-record",
      title: "Give the detail view its own address",
      because: "The list opens a record, and in the old app that record is a state the URL does not describe.",
      instead: "A nested route. The list stays mounted, the detail is a segment, and the browser's back button means what a person expects it to mean.",
    },
    {
      id: "prefetch-on-intent",
      title: "Start fetching the record when somebody looks like they want it",
      because: "The record is fetched after the click, so the wait is entirely visible.",
      instead: "Fetch on hover or focus. By the time the click lands the answer is usually there, and nothing is wasted if it is not.",
    },
    {
      id: "keep-list-alive",
      title: "Do not throw the list away to show one record",
      because: "A full page swap loses the scroll position and the filters.",
      instead: "The detail renders beside or over the list, and closing it returns to exactly where they were.",
    },
  ],

  "search-and-filter": [
    {
      id: "debounce-and-cancel",
      title: "Cancel the request the last keystroke made",
      because: "A control is bound to a query, so every keystroke can start a request and the answers can arrive out of order.",
      instead: "Debounce the input and abort the in flight request when a newer one starts. Out of order responses are the bug people describe as the search being wrong.",
    },
    {
      id: "distinguish-empty",
      title: "Say `no matches` and `nothing searched yet` differently",
      because: "A single empty state cannot tell somebody whether their filter is too narrow or they have not asked anything.",
      instead: "Two states, with the second offering to clear the filters.",
    },
  ],

  "form-entry": [
    {
      id: "validate-on-blur",
      title: "Validate when a field is left, not while it is typed",
      because: "The old form validates on every change, so it tells people they are wrong before they have finished being right.",
      instead: "Check on blur and on submit. Once a field has failed, check it as it changes so the error clears as soon as it is fixed.",
    },
    {
      id: "server-errors-inline",
      title: "Put the server's complaint next to the field it is about",
      because: "The rules the service enforces are not the rules the form enforces, so some failures only happen on submit.",
      instead: "Map the error response back onto fields, and keep the values. A form that clears itself on a failed submit is the reason people write things down first.",
    },
  ],

  wizard: [
    {
      id: "step-per-route",
      title: "Make each step an address",
      because: "The steps are one screen swapping its contents, so the back button leaves the flow entirely.",
      instead: "A route per step, and a guard that sends somebody back to the first unfinished one.",
    },
    {
      id: "persist-the-draft",
      title: "Keep the answers if the page reloads",
      because: "The progress lives in memory, so a refresh or a crash costs everything entered so far.",
      instead: "Persist the draft per step. Long forms get abandoned at exactly the moment the work is lost.",
    },
  ],

  dashboard: [
    {
      id: "panels-load-alone",
      title: "Let each panel load, fail and retry by itself",
      because: "The panels are read only and fetched together, so the slowest one sets the speed of the screen and one failure empties it.",
      instead: "A query per panel with its own loading, error and empty state. A dashboard where one tile is broken and the rest are fine is a working dashboard.",
    },
    {
      id: "stale-while-revalidate",
      title: "Show the last answer while fetching the next",
      because: "Every refresh blanks the screen before it fills it.",
      instead: "Render what is cached, fetch behind it, and mark it as refreshing. Numbers that flicker are harder to read than numbers that are a few seconds old.",
    },
  ],

  "selector-soup": [
    {
      id: "draw-boundaries-first",
      title: "Decide the components before writing any of them",
      because: "Nothing in the old app declares a boundary, so the port would inherit whatever the file layout happened to be.",
      instead: "Start from WIDGETS.md: a selector that is both written to and listened on is a component in everything but name. Name them, then build them.",
    },
    {
      id: "one-owner-per-node",
      title: "Give every part of the page exactly one owner",
      because: "Several handlers write to the same selector, so what is on screen depends on which ran last.",
      instead: "One component owns a region and renders it from state. Nothing else reaches in.",
    },
  ],
};

/** Answers to things that are true regardless of the shape. */
export const BY_OBSERVATION = {
  "unbounded-collection": {
    id: "page-the-collection",
    title: "Page or window the collection",
    because: "No paging appeared in the markup or the traffic.",
    instead: "Ask the service for a page. Where it cannot offer one, render a window of rows and keep the rest out of the document.",
  },
  "state-not-in-url": {
    id: "url-is-the-state",
    title: "Make the address describe the screen",
    because: "The controls hold their values privately.",
    instead: "Read and write the query string. It costs a hook and it makes every view shareable.",
  },
  "states-never-seen": {
    id: "build-the-empty-state",
    title: "Build the empty state on purpose",
    because: "Screens were never observed with no data, so nobody has designed what they say.",
    instead: "Write it before the happy path. An empty state that explains what would fill it is the difference between a new user staying and leaving.",
  },
  "destructive-controls": {
    id: "reversible-actions",
    title: "Make the dangerous actions reversible",
    because: "Controls that delete or discard are present and their confirmation could not be verified.",
    instead: "Undo where the action can be reversed, and a typed confirmation only where it truly cannot.",
  },
  "nested-repetition": {
    id: "extract-the-row",
    title: "Make the row a component",
    because: "Repetition inside repetition renders more than it needs to.",
    instead: "A row component with a stable key, so changing one row does not touch the others.",
  },
  "large-templates": {
    id: "split-the-screen",
    title: "Split the large screens",
    because: "Templates past sixty elements are usually several screens that were never separated.",
    instead: "Separate them along the boundaries the data already suggests. The rebuild is the cheapest time this will ever be.",
  },
};

export function planFor(archetype) {
  const shape = archetype?.best?.id;
  const fromShape = (BY_ARCHETYPE[shape] ?? []).map((d) => ({ ...d, source: `the app reads as ${shape}` }));

  const fromObservations = (archetype?.observations ?? [])
    .map((o) => (BY_OBSERVATION[o.id] ? { ...BY_OBSERVATION[o.id], source: o.what, severity: o.severity } : null))
    .filter(Boolean);

  // A decision the shape already implies does not need saying twice.
  const seen = new Set(fromShape.map((d) => d.id));
  const merged = [...fromShape, ...fromObservations.filter((d) => !seen.has(d.id))];

  // Where the reading is contested, the runner up's decisions are worth having
  // in front of you rather than discarded by a twenty point margin.
  const alternative = archetype?.contested && archetype.ranked[1]
    ? { id: archetype.ranked[1].id, decisions: BY_ARCHETYPE[archetype.ranked[1].id] ?? [] }
    : null;

  return { decisions: merged, alternative };
}
