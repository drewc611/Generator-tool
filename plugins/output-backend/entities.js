import { comparable, placeholder, templated } from "../output-fixtures/index.js";

// The same matcher serve.js itself runs at request time (output-site's own
// MATCH template, written into every port as src/app/match.js): a segment
// starting with ":" matches anything in that position. Judging ambiguity by
// any other rule than the one actually deciding requests would be a guess.
function matchesTemplate(pattern, path) {
  const want = String(pattern).split("/").filter(Boolean);
  const got = String(path).split(/[#?]/)[0].split("/").filter(Boolean);
  if (want.length !== got.length) return false;
  return want.every((seg, i) => seg.startsWith(":") || seg === got[i]);
}

/**
 * The real backend's own routes and seed data, inferred from the same API
 * surface every other emitter already reads: `ctx.api.calls`, refined by
 * `ctx.entities` (dsp-entities' observed shapes) and `ctx.spec` (a declared
 * document) when either is there. Nothing here invents an endpoint the app
 * never called; a call this reader cannot pair into a collection and an item
 * (an action route like `/orders/cancel`, or a write with no collection
 * beside it) is named and left to the fixture-or-501 path that already
 * serves it, never forced into a shape it does not have.
 */

const segmentsOf = (path) => templated(path).split("/").filter(Boolean);

/** Whether `path`'s own last segment is a `:id`-style param, judged on the path alone, never by comparing it against another path's own spelling. */
function isItemPath(path) {
  const segs = segmentsOf(path);
  return segs.length > 0 && segs.at(-1).startsWith(":");
}

/** The path with a trailing `:id`-style segment stripped, so a collection and its item share one key. */
export function resourceKey(path) {
  const segs = segmentsOf(path);
  if (isItemPath(path)) segs.pop();
  return segs.join("/");
}

/** The resource key's own last real segment, singularised the plain way (a trailing "s" dropped). */
function noun(key) {
  const parts = key.split("/").filter((p) => p && !/^(api|v\d+)$/i.test(p));
  const last = parts.at(-1) ?? "item";
  return last.replace(/s$/, "");
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** One call's op within its resource, or null when this reader does not recognise the shape. */
function opFor(call, isItem) {
  if (!isItem && call.method === "GET") return "list";
  if (!isItem && call.method === "POST") return "create";
  if (isItem && call.method === "GET") return "get";
  if (isItem && (call.method === "PUT" || call.method === "PATCH")) return "update";
  if (isItem && call.method === "DELETE") return "remove";
  return null;
}

/** A shape for `key`'s entity from whichever source actually observed one; `null` when none did. */
function shapeFor(ctx, key, name, calls) {
  const entity = ctx.entities?.find((e) => e.name === name || e.names?.includes(name));
  if (entity) return { properties: entity.properties, source: "observed traffic (dsp-entities)" };

  for (const call of calls) {
    const path = templated(call.path);
    const observed = ctx.model?.endpoints?.find((e) => e.method === call.method && templated(e.path) === path);
    const shape = observed?.observedBody;
    if (shape && shape !== "not json" && typeof shape === "object") {
      return { properties: shape, source: `an observed ${call.method} ${path}` };
    }
  }

  for (const call of calls) {
    const path = comparable(call.path);
    const op = ctx.spec?.operations?.find((o) => o.method === call.method && comparable(o.path) === path && o.declaredShape);
    if (op) {
      const shape = op.declaredShape;
      const props = shape.kind === "array" ? shape.props : shape.props ?? shape;
      if (props && typeof props === "object") return { properties: props, source: `the API document's claim for ${call.method} ${path}` };
    }
  }

  return null;
}

/**
 * Every call grouped by its resource, split into what this reader wires to a
 * real store and what it leaves for fixtures or a 501, and why.
 */
export function inferBackendEntities(ctx) {
  const groups = new Map();
  for (const call of ctx.api?.calls ?? []) {
    const key = resourceKey(call.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }

  const entities = [];
  const skipped = [];
  // A literal action route (no id at all) is collected separately, because a
  // path matcher cannot tell "cancel" from a real id once an item route sits
  // at the same depth: `DELETE /orders/:id` matches `DELETE /orders/cancel`
  // just as happily as it matches a real id, and treating "cancel" as one
  // would delete nothing and answer 404 where the honest answer is 501.
  const actions = [];

  for (const [key, calls] of groups) {
    const name = noun(key);
    const withOps = calls.map((call) => ({ call, op: opFor(call, isItemPath(call.path)) }));
    const recognised = withOps.filter((w) => w.op);
    for (const w of withOps.filter((w) => !w.op)) {
      skipped.push({ method: w.call.method, path: w.call.path, reason: "not a recognised collection/item shape (an action route, most likely)" });
      if (!isItemPath(w.call.path)) actions.push(w.call);
    }
    const hasWrite = recognised.some((w) => WRITE_METHODS.has(w.call.method));
    if (!hasWrite) {
      for (const w of recognised) skipped.push({ method: w.call.method, path: w.call.path, reason: "read only; already served by fixtures" });
      continue;
    }

    const shape = shapeFor(ctx, key, name, calls);
    const properties = shape?.properties ?? {};
    const seed = { id: 1, ...Object.fromEntries(Object.entries(properties).map(([k, t]) => [k, placeholder(t, k)])) };
    entities.push({
      name,
      key,
      verbs: recognised.map((w) => ({ method: w.call.method, path: templated(w.call.path), op: w.op })),
      properties,
      shapeSource: shape?.source ?? null,
      seed,
    });
  }

  // A verb whose own :id-shaped path would also match a real action route at
  // the same address is pulled back out and named, rather than left to route
  // one or the other by luck.
  for (const entity of entities) {
    const kept = [];
    for (const verb of entity.verbs) {
      const collision = actions.find((a) => a.method === verb.method && matchesTemplate(verb.path, a.path));
      if (collision) {
        skipped.push({ method: verb.method, path: verb.path, reason: `ambiguous with the action route \`${collision.method} ${collision.path}\`, which a path matcher cannot tell apart from a real id` });
      } else {
        kept.push(verb);
      }
    }
    entity.verbs = kept;
  }
  const usable = entities.filter((e) => e.verbs.some((v) => WRITE_METHODS.has(v.method)));
  for (const e of entities.filter((e) => !usable.includes(e))) {
    for (const v of e.verbs) skipped.push({ method: v.method, path: v.path, reason: "its only write was ambiguous with an action route; nothing left worth wiring" });
  }

  return { entities: usable, skipped };
}
