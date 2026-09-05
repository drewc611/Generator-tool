/**
 * A screen, as a fixed vector of numbers.
 *
 * The archetype recogniser reads a screen with hand written rules. This turns
 * the same screen into a point in space so a model can be trained on the
 * labelled corpus and a new screen placed by where it lands rather than by which
 * rules happened to fire. The features are the ones the rules already trust,
 * read off the IR by shapeOf and off the endpoints by readApi, so nothing new is
 * measured and nothing framework specific leaks in: the vector is the same
 * whether the screen arrived as Angular, as Vue, or as a page driven in a
 * browser.
 */

import { buildIr } from "../dsp-ir/ir.js";
import { shapeOf } from "../dsp-archetype/shape.js";
import { readApi } from "../dsp-archetype/classify.js";

// The order is the model's contract. Every vector, a corpus prototype or a live
// query, lists these features in exactly this order, so a mean, a spread and a
// prototype coordinate all line up with the feature they describe.
export const FEATURES = [
  "loops", "nestedLoops", "tables", "forms", "inputs", "selects", "checkboxes",
  "submits", "destructive", "buttons", "links", "headings", "charts", "searchFields",
  "stepMarkers", "models", "editors", "conditionals",
  "reads", "writes", "byId", "collections", "query",
  "widgets", "components",
  "boardWords", "calendarWords", "chatWords", "draftWords",
];

// The word signals the rule based recogniser keys on for the shapes that markup
// structure alone cannot name: a board, a calendar, a conversation, a document.
const BOARD = /\b(todo|doing|done|backlog|in progress|column|lane|board)\b/i;
const CALENDAR = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|week|month|calendar|schedule)\b/i;
const CHAT = /\b(send|message|reply|typing|chat)\b/i;
const DRAFT = /\b(save|draft|autosave|saved|publish|revert)\b/i;

function wordFlags(shape) {
  const text = (shape.texts ?? []).join(" ");
  return {
    boardWords: BOARD.test(text) ? 1 : 0,
    calendarWords: CALENDAR.test(text) ? 1 : 0,
    chatWords: CHAT.test(text) ? 1 : 0,
    draftWords: DRAFT.test(text) ? 1 : 0,
  };
}

/**
 * Assemble the vector from parts already computed. The run reaches this with a
 * shape merged across every screen and its endpoints already read, so it is not
 * re measured here.
 */
export function vectorFromParts({ shape, api, widgets = 0, components = 0 }) {
  const named = {
    loops: shape.loops, nestedLoops: shape.nestedLoops, tables: shape.tables,
    forms: shape.forms, inputs: shape.inputs, selects: shape.selects,
    checkboxes: shape.checkboxes, submits: shape.submits, destructive: shape.destructive,
    buttons: shape.buttons, links: shape.links, headings: shape.headings,
    charts: shape.charts, searchFields: shape.searchFields, stepMarkers: shape.stepMarkers,
    models: shape.models, editors: shape.editors, conditionals: shape.conditionals,
    reads: api.reads.length, writes: api.writes.length, byId: api.byId.length,
    collections: api.collections.length, query: api.query.length,
    widgets, components, ...wordFlags(shape),
  };
  return FEATURES.map((k) => Number(named[k] ?? 0));
}

/**
 * Assemble the vector from a corpus miniature: its markup, its calls and, where
 * it carries them, the widgets and component count its label depends on.
 */
export function vectorFromEntry(entry) {
  const shape = shapeOf(buildIr(entry.html || ""));
  const api = readApi(entry.calls ?? [], entry.model ?? null);
  return vectorFromParts({
    shape,
    api,
    widgets: (entry.widgets ?? []).length,
    components: entry.components ?? 1,
  });
}
