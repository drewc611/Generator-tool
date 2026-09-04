/**
 * A Postman collection from the endpoint map. Requests only, one per
 * endpoint, addressed through a {{baseUrl}} variable with path parameters as
 * their own variables. No observed value, no header captured from anybody's
 * session, and no response examples: a schema nobody verified is the failure
 * this tool exists to avoid, in Postman exactly as in OpenAPI.
 */

const templated = (path) =>
  String(path)
    .replace(/\$\{([^}]+)\}/g, (_, name) => `:${name.split(".").pop().trim()}`)
    .split("?")[0];

export function buildCollection(calls) {
  const seen = new Set();
  const items = [];
  for (const call of calls) {
    const path = templated(call.path);
    const key = `${call.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const segments = path.split("/").filter(Boolean);
    items.push({
      name: key,
      request: {
        method: call.method,
        header: [],
        url: {
          raw: `{{baseUrl}}${path}`,
          host: ["{{baseUrl}}"],
          path: segments.map((s) => (s.startsWith(":") ? `{{${s.slice(1)}}}` : s)),
          variable: segments.filter((s) => s.startsWith(":")).map((s) => ({ key: s.slice(1), value: "" })),
        },
        description: `Seen in ${call.file ?? "the legacy source"}. portamp records the request, never the response; add examples only from a response you verified.`,
      },
    });
  }
  return {
    info: {
      name: "portamp port",
      description: "Requests the legacy app makes, read from its source. Set baseUrl before sending anything, and mind that sending is a live call to a real server.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: items,
    variable: [{ key: "baseUrl", value: "" }],
  };
}

export default {
  name: "output-postman",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.postman) return log.debug("not requested");
      if (!ctx.api.calls.length) return log.debug("no traffic to describe");
      const collection = buildCollection(ctx.api.calls);
      await ctx.write("postman_collection.json", JSON.stringify(collection, null, 2) + "\n");
      log.info(`${collection.item.length} request(s), no responses on purpose`);
    });
  },
};
