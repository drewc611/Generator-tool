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

export function buildFixtures(ctx) {
  const observed = new Map((ctx.model?.endpoints ?? []).map((e) => [`${e.method} ${templated(e.path)}`, e]));
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
    let body;
    if (shape && shape !== "not json" && typeof shape === "object") {
      body = Object.fromEntries(Object.entries(shape).map(([k, t]) => [k, placeholder(t, k)]));
    } else {
      body = { _portamp: `No response was observed for GET ${path}. Replace this file with the real shape once you have verified one.` };
    }
    fixtures.push({ name, path, body, observed: Boolean(shape && shape !== "not json") });
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
      const blind = fixtures.filter((f) => !f.observed).length;
      log.info(`${fixtures.length} fixture(s), ${blind} from shape unknown`);
      if (blind) {
        ctx.unverified(`${blind} fixture(s) describe endpoints whose response was never observed; each says so in its payload.`);
      }
    });
  },
};
