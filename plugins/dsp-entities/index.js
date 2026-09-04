/**
 * The data model, inferred from what actually crossed the wire.
 *
 * Nobody documents entities; they document endpoints, and the entities leak
 * out of them. Two payload shapes that mostly agree are one entity seen from
 * two places, and the union of what was observed is the closest thing to a
 * model this app has. Property names and types only: the shapes came from
 * observed traffic that dsp-behavior already reduced to types, and no value
 * survives here either.
 */

const noun = (path) => {
  const parts = String(path).split("?")[0].split("/").filter((p) => p && !/^[:{$*]|^\d+$/.test(p) && !/^(api|v\d+)$/i.test(p));
  const last = parts.at(-1) ?? "entity";
  return last.replace(/s$/, "");
};

const jaccard = (a, b) => {
  const A = new Set(a);
  const B = new Set(b);
  const both = [...A].filter((x) => B.has(x)).length;
  return both / (A.size + B.size - both || 1);
};

export function inferEntities(shapes) {
  // shapes: [{ endpoint, properties: {name: type} }]
  const entities = [];
  for (const shape of shapes) {
    const keys = Object.keys(shape.properties);
    if (!keys.length) continue;
    const home = entities.find((e) => jaccard(Object.keys(e.properties), keys) >= 0.5);
    if (home) {
      home.seenAt.push(shape.endpoint);
      for (const [k, t] of Object.entries(shape.properties)) {
        if (home.properties[k] && home.properties[k] !== t) home.conflicts.push(`${k}: ${home.properties[k]} vs ${t} (${shape.endpoint})`);
        else home.properties[k] = t;
      }
      home.names.push(noun(shape.endpoint));
    } else {
      entities.push({ names: [noun(shape.endpoint)], properties: { ...shape.properties }, seenAt: [shape.endpoint], conflicts: [] });
    }
  }
  for (const e of entities) {
    // The most common noun across its endpoints names the entity.
    const counts = e.names.reduce((a, n) => (a[n] = (a[n] ?? 0) + 1, a), {});
    e.name = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
  }
  return entities;
}

/**
 * The edges between entities, read from their property names: `customerId`
 * on an order points at whatever entity answers to `customer`. A name match
 * is a reading, and each edge carries the property that argues for it.
 */
export function inferRelations(entities) {
  const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));
  const relations = [];
  for (const entity of entities) {
    for (const property of Object.keys(entity.properties)) {
      const m = /^([a-z][\w]*?)_?[iI]ds?$/.exec(property);
      if (!m) continue;
      const target = byName.get(m[1].toLowerCase()) ?? byName.get(m[1].toLowerCase().replace(/s$/, ""));
      if (target && target !== entity) {
        relations.push({
          from: entity.name,
          to: target.name,
          property,
          many: /s$/.test(property),
        });
      }
    }
  }
  return relations;
}

export default {
  name: "dsp-entities",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const shapes = [];
      for (const endpoint of ctx.model?.endpoints ?? []) {
        if (endpoint.observedBody && endpoint.observedBody !== "not json" && typeof endpoint.observedBody === "object") {
          shapes.push({ endpoint: `${endpoint.method} ${endpoint.path}`, properties: endpoint.observedBody });
        }
      }
      // A recovered form is an entity seen from the writing side.
      for (const form of ctx.forms ?? []) {
        const properties = Object.fromEntries(form.fields.map((f) => [f.name, f.constraints?.type === "number" ? "number" : "string"]));
        if (Object.keys(properties).length) shapes.push({ endpoint: `form ${form.screen}`, properties });
      }
      if (!shapes.length) return log.debug("no shapes to infer from");

      const entities = inferEntities(shapes);
      ctx.entities = entities;
      ctx.entityRelations = inferRelations(entities);
      log.info(`${entities.length} entit(ies), ${ctx.entityRelations.length} relation(s) from ${shapes.length} observed shape(s)`);
      for (const e of entities.filter((e) => e.conflicts.length)) {
        ctx.unverified(`The shape of \`${e.name}\` disagrees with itself: ${e.conflicts[0]}. Two endpoints, two types, one name; the service owner knows which is true.`);
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.entities) return;
      await ctx.write("ENTITIES.md", `# The data model, as observed

Nobody documented these; they leaked out of the endpoints. Two payload shapes
that mostly agree are one entity seen from two places. Property names and
types only; the values were somebody's real data and none survive here.

${ctx.entities.map((e) => `## ${e.name}

| property | type |
| --- | --- |
${Object.entries(e.properties).map(([k, t]) => `| \`${k}\` | ${t} |`).join("\n")}

Seen at: ${e.seenAt.map((s) => `\`${s}\``).join(", ")}${e.conflicts.length ? `\n\n**Disagrees with itself:** ${e.conflicts.join("; ")}` : ""}`).join("\n\n")}

${ctx.entityRelations?.length ? `
## How they point at each other

Read from property names alone: \`customerId\` on an order points at whatever
answers to \`customer\`. A name match is a reading, and each row carries the
property that argues for it.

| from | to | argued by | cardinality read |
| --- | --- | --- | --- |
${ctx.entityRelations.map((r) => `| ${r.from} | ${r.to} | \`${r.property}\` | ${r.many ? "many" : "one"} |`).join("\n")}
` : ""}
---

An entity here is a reading of traffic, not a schema. A property no observed
payload carried is not proven absent, and the service's own model outranks
this the moment somebody who owns it writes it down.
`);
    });
  },
};
