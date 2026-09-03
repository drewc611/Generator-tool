/**
 * The endpoint map, written as a specification.
 *
 * Two sources feed this and they are not equal. A call read out of the source
 * proves the request exists and nothing more: the client says what goes out, it
 * never says what comes back. A call watched against a running app also carries
 * the status codes and query keys that were actually seen.
 *
 * So response schemas are absent here, deliberately. Inventing one would give
 * whoever picks this up a contract nobody ever verified, which is the failure
 * this tool exists to avoid. Every gap is marked, in the document and in the
 * notes, where a reader will meet it.
 *
 *   openapi: true
 */

/** `:id`, `${id}` and `{id}` all mean the same thing to a specification. */
const templated = (path) =>
  String(path)
    .replace(/\$\{\s*([\w$.]+)\s*\}/g, (_, n) => `{${n.split(".").pop()}}`)
    .replace(/:([\w$]+)/g, "{$1}")
    .split("?")[0];

const paramsIn = (path) => [...templated(path).matchAll(/\{([\w$]+)\}/g)].map((m) => m[1]);

// A query string written into the call site is as much of the contract as
// the path is; only a key whose name is itself an expression stays out.
const queryIn = (path) => {
  const query = String(path).split("?")[1];
  if (!query) return [];
  return [...new Set(query.split("&").map((pair) => pair.split("=")[0]).filter((k) => k && !/[{$]/.test(k)))];
};

const summarise = (method, path) => {
  const segments = templated(path).split("/").filter(Boolean);
  const noun = segments.filter((s) => !s.startsWith("{")).pop() ?? "resource";
  // A path ending in a parameter addresses one of them, not the collection.
  const subject = segments.at(-1)?.startsWith("{") ? `one ${noun.replace(/s$/, "")}` : noun;
  return { GET: `Read ${subject}`, POST: `Create ${subject}`, PUT: `Replace ${subject}`, PATCH: `Update ${subject}`, DELETE: `Remove ${subject}` }[method] ?? `${method} ${subject}`;
};

const UNVERIFIED = "Shape not verified. portamp records what the client sends; it does not claim to know what the service returns.";

/** A recorded body is kept as its shape. The values were somebody's real data. */
function schemaFromShape(shape) {
  if (!shape || typeof shape !== "object") return null;
  const properties = {};
  for (const [k, v] of Object.entries(shape)) {
    properties[k] = { type: ["string", "number", "boolean"].includes(v) ? v : v === "object" ? "object" : "string" };
  }
  return Object.keys(properties).length ? { type: "object", properties } : null;
}

export function buildDocument(ctx) {
  const paths = {};
  const gaps = [];

  const observed = new Map((ctx.model?.endpoints ?? []).map((e) => [`${e.method} ${templated(e.path)}`, e]));
  const fromSource = (ctx.api?.calls ?? []).map((c) => ({ ...c, templated: templated(c.path) }));

  // Everything the source knows about, plus anything only the live run saw.
  const all = [...fromSource];
  for (const [key, e] of observed) {
    if (!all.some((c) => `${c.method} ${c.templated}` === key)) {
      all.push({ method: e.method, path: e.path, templated: templated(e.path), file: "observed", body: null });
    }
  }

  for (const call of all) {
    const key = `${call.method} ${call.templated}`;
    const seen = observed.get(key);
    const operation = {
      summary: summarise(call.method, call.path),
      operationId: call.name ?? undefined,
      description: seen
        ? `Seen against the running system by input-explore. Source: ${call.file}.`
        : `Read from ${call.file}. Not exercised against a running system.`,
      parameters: [
        ...paramsIn(call.path).map((name) => ({
          name, in: "path", required: true, schema: { type: "string" },
          description: "Type not determined; the call site did not say.",
        })),
        ...(seen?.query ?? []).map((name) => ({
          name, in: "query", required: false, schema: { type: "string" },
          description: "Observed in a real request.",
        })),
        ...queryIn(call.path).filter((name) => !(seen?.query ?? []).includes(name)).map((name) => ({
          name, in: "query", required: false, schema: { type: "string" },
          description: "Read from the call site in the source; never observed live.",
        })),
      ],
      responses: {},
    };

    if (!operation.parameters.length) delete operation.parameters;

    if (call.body === "unknown") {
      operation.requestBody = {
        required: true,
        description: UNVERIFIED,
        content: { "application/json": { schema: { type: "object", description: UNVERIFIED } } },
      };
      gaps.push(`Request body for ${key} is undetermined; the call site did not describe it.`);
    } else if (seen?.observedBody && seen.observedBody !== "not json") {
      const schema = schemaFromShape(seen.observedBody);
      if (schema) {
        operation.requestBody = {
          required: true,
          description: "Property names and types are from an observed request. No captured value is reproduced here.",
          content: { "application/json": { schema } },
        };
      }
    }

    const statuses = seen?.statuses?.length ? seen.statuses : [200];
    for (const status of statuses) {
      operation.responses[String(status)] = {
        description: seen?.statuses?.length ? "Status observed against the running system." : "Assumed. No response was ever observed.",
      };
    }
    gaps.push(`Response body for ${key} has no schema. ${UNVERIFIED}`);

    (paths[call.templated] ??= {})[call.method.toLowerCase()] = operation;
  }

  return {
    document: {
      openapi: "3.0.3",
      info: {
        title: "Endpoints the ported front end calls",
        version: "0.0.0",
        description: [
          "Generated by portamp from the front end, not from the service.",
          "",
          "This describes the requests the client makes. It is not the service's own",
          "contract and it does not describe responses: a caller cannot see a shape it",
          "never asserted. Treat every response as unverified until the team that owns",
          "the service confirms it.",
        ].join("\n"),
      },
      servers: [{ url: "{baseUrl}", variables: { baseUrl: { default: "/", description: "Set to wherever the service is." } } }],
      paths,
    },
    gaps,
  };
}

export default {
  name: "output-openapi",
  version: "0.1.0",
  class: "output",
  setup({ on, log }) {
    on("emit", async (ctx) => {
      if (!ctx.config.openapi) return log.debug("not requested");

      const { document, gaps } = buildDocument(ctx);
      const count = Object.keys(document.paths).length;
      if (!count) return log.info("no endpoints to describe");

      await ctx.write("openapi.json", JSON.stringify(document, null, 2) + "\n");
      for (const gap of gaps) ctx.unverified(gap);
      log.info(`${count} path(s) described, ${gaps.length} gap(s) named`);
    });
  },
};
