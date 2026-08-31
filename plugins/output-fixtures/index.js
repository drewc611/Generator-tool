/**
 * JSON fixtures from observed response shapes. Types only: every string is a
 * named placeholder, every number is zero, and an endpoint whose response was
 * never observed gets a fixture that says so in its payload instead of rows
 * somebody will mistake for the real thing. No captured value survives into
 * a fixture, which is the same privacy line every other emitter holds.
 */

const templated = (path) => String(path).replace(/\$\{([^}]+)\}/g, (_, n) => `:${n.split(".").pop().trim()}`).split("?")[0];

const placeholder = (type, name) => {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "object") return {};
  return `<${name}>`;
};

// `/orders/{id}` in a spec and `/orders/:id` in a call are one shape.
const comparable = (path) => templated(path).replace(/\{[\w$]+\}|:[\w$]+/g, "*");

export function buildFixtures(ctx) {
  const observed = new Map((ctx.model?.endpoints ?? []).map((e) => [`${e.method} ${templated(e.path)}`, e]));
  const declared = new Map(
    (ctx.spec?.operations ?? [])
      .filter((op) => op.declaredShape)
      .map((op) => [`${op.method} ${comparable(op.path)}`, op.declaredShape])
  );
  const fixtures = [];
  const seen = new Set();
  for (const call of ctx.api?.calls ?? []) {
    if (call.method !== "GET") continue;
    const path = templated(call.path);
    if (seen.has(path)) continue;
    seen.add(path);
    const name = (path.split("/").filter((s) => s && !s.startsWith(":")).at(-1) ?? "items").replace(/[^\w-]/g, "-");
    const endpoint = observed.get(`GET ${path}`);
    const shape = endpoint?.observedBody;
    const spec = declared.get(`GET ${comparable(path)}`);
    let body;
    let source = null;
    if (shape && shape !== "not json" && typeof shape === "object") {
      body = Object.fromEntries(Object.entries(shape).map(([k, t]) => [k, placeholder(t, k)]));
      source = "observed";
    } else if (spec) {
      // The document's word, never portamp's: a declared shape is a claim,
      // and the payload says whose.
      const row = Object.fromEntries(Object.entries(spec.props).map(([k, t]) => [k, placeholder(t, k)]));
      body = spec.kind === "array" ? [row] : row;
      const note = `This shape is the API document's claim for GET ${path}; no response was observed to confirm it.`;
      if (Array.isArray(body)) body.push({ _portamp: note });
      else body._portamp = note;
      source = "spec";
    } else {
      body = { _portamp: `No response was observed for GET ${path}. Replace this file with the real shape once you have verified one.` };
    }
    fixtures.push({ name, path, body, observed: source === "observed", fromSpec: source === "spec" });
  }
  return fixtures;
}

export default {
  name: "output-fixtures",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.fixtures) return log.debug("not requested");
      const fixtures = buildFixtures(ctx);
      if (!fixtures.length) return log.debug("no GETs to fixture");

      const used = new Set();
      for (const fixture of fixtures) {
        let file = fixture.name;
        for (let i = 2; used.has(file); i += 1) file = `${fixture.name}-${i}`;
        used.add(file);
        await ctx.write(`fixtures/${file}.json`, JSON.stringify(fixture.body, null, 2) + "\n");
      }
      const fromSpec = fixtures.filter((f) => f.fromSpec).length;
      const blind = fixtures.filter((f) => !f.observed && !f.fromSpec).length;
      log.info(`${fixtures.length} fixture(s): ${fixtures.length - blind - fromSpec} observed, ${fromSpec} from the spec's claim, ${blind} unknown`);
      if (fromSpec) {
        ctx.unverified(`${fromSpec} fixture(s) carry the API document's declared shape, unconfirmed by any observed response; each says so in its payload.`);
      }
      if (blind) {
        ctx.unverified(`${blind} fixture(s) describe endpoints whose response was never observed; each says so in its payload.`);
      }
    });
  },
};
