import { readFile } from "node:fs/promises";

/**
 * An OpenAPI document as a source.
 *
 * A spec is somebody's claim about the service. The client's calls are what
 * the front end actually does. Reading both makes the disagreements visible,
 * and the disagreements are the finding: an operation no screen ever calls is
 * either dead or unported, and a call the spec has never heard of is the
 * undocumented dependency that breaks quietly in the rewrite.
 *
 * Spec operations do not join the endpoint map. The map drives what the port
 * calls, and the port should call what the app called, not what a document
 * hoped. JSON only; a YAML spec is reported as unread rather than half read.
 */

const METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export function readSpec(document) {
  const operations = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      if (!METHODS.has(method)) continue;
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: op?.operationId ?? null,
        deprecated: Boolean(op?.deprecated),
        // What the document claims comes back. A claim, not an observation:
        // consumers must label it as the spec's word, never as portamp's.
        declaredShape: declaredShape(document, op),
      });
    }
  }
  return operations;
}

/** Follow a local $ref inside the same document; anything remote stays unread. */
function deref(document, schema, depth = 0) {
  if (!schema || depth > 6) return null;
  if (schema.$ref) {
    if (!String(schema.$ref).startsWith("#/")) return null;
    let node = document;
    for (const step of schema.$ref.slice(2).split("/")) node = node?.[step];
    return deref(document, node, depth + 1);
  }
  return schema;
}

/** The 2xx json response's top level shape as {name: type}, or null. */
export function declaredShape(document, op) {
  const responses = op?.responses ?? {};
  const success = responses["200"] ?? responses["201"] ?? responses["2XX"] ?? responses.default;
  const schema = deref(
    document,
    success?.content?.["application/json"]?.schema ?? success?.schema ?? null
  );
  if (!schema) return null;
  const describe = (node, depth) => {
    const s = deref(document, node, depth);
    if (!s || depth > 3) return null;
    if (s.type === "array") {
      const item = describe(s.items, depth + 1);
      return item ? { kind: "array", props: item.props ?? { value: s.items?.type ?? "string" } } : null;
    }
    if (s.type === "object" || s.properties) {
      const props = {};
      for (const [key, value] of Object.entries(s.properties ?? {})) {
        const resolved = deref(document, value, depth + 1);
        props[key] = resolved?.type === "array" ? "object" : resolved?.type ?? (resolved?.properties ? "object" : "string");
      }
      return Object.keys(props).length ? { kind: "object", props } : null;
    }
    return null;
  };
  return describe(schema, 0);
}

/** `/orders/{id}` and `/orders/:id` and `/orders/${id}` are one shape. */
const shape = (path) =>
  String(path).split("?")[0]
    .replace(/\{[\w$]+\}|:[\w$]+|\$\{[^}]+\}|\b\d+\b/g, "*")
    .replace(/\/+$/, "") || "/";

export function crossCheck(operations, calls) {
  const called = new Map(calls.map((c) => [`${c.method} ${shape(c.path)}`, c]));
  const specced = new Map(operations.map((o) => [`${o.method} ${shape(o.path)}`, o]));

  return {
    uncalled: operations.filter((o) => !called.has(`${o.method} ${shape(o.path)}`)),
    undocumented: calls.filter((c) => !specced.has(`${c.method} ${shape(c.path)}`)),
    deprecatedInUse: operations.filter((o) => o.deprecated && called.has(`${o.method} ${shape(o.path)}`)),
  };
}

export default {
  name: "input-openapi",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    // Runs at plan, after every reader has contributed its calls.
    on("plan", async (ctx) => {
      const candidates = ctx.sources.specs?.length
        ? ctx.sources.specs
        : ctx.sources.files.filter((f) => /\.(json)$/.test(f.rel) && /openapi|swagger|spec/i.test(f.rel));

      let spec = null;
      let from = null;
      for (const file of candidates) {
        const text = await readFile(file.path ?? file, "utf8").catch(() => "");
        try {
          const parsed = JSON.parse(text);
          if (parsed.openapi || parsed.swagger) { spec = parsed; from = file.rel ?? file; break; }
        } catch { /* not this one */ }
      }
      const yaml = ctx.sources.files.find((f) => /openapi|swagger/i.test(f.rel) && /\.ya?ml$/.test(f.rel));
      if (!spec && yaml) {
        ctx.unverified(`${yaml.rel} looks like a spec and is YAML, which this reader does not parse. Convert it to JSON and it will be read.`);
      }
      if (!spec) return log.debug("no spec among the sources");

      const operations = readSpec(spec);
      const report = crossCheck(operations, ctx.api.calls ?? []);
      ctx.spec = { from, operations, ...report };
      log.info(`${operations.length} operation(s) in ${from}; ${report.undocumented.length} call(s) it has never heard of`);

      for (const call of report.undocumented) {
        ctx.unverified(`${call.method} ${call.path} (${call.file}) is not in ${from}. The rewrite depends on an endpoint the contract does not admit exists.`);
      }
      for (const op of report.deprecatedInUse) {
        ctx.unverified(`${op.method} ${op.path} is deprecated in ${from} and the app still calls it. The port would build on something already scheduled to go.`);
      }
      if (report.uncalled.length) {
        ctx.unverified(`${report.uncalled.length} operation(s) in ${from} are never called by anything this run read. Dead surface, or screens the run has not seen; SPEC_COVERAGE.md lists them.`);
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.spec) return;
      await ctx.write("SPEC_COVERAGE.md", render(ctx.spec, ctx.api.calls.length));
    });
  },
};

function render(spec, callCount) {
  const list = (items, empty) => items.length
    ? items.map((x) => `- \`${x.method} ${x.path}\`${x.operationId ? ` (${x.operationId})` : ""}${x.file ? ` — from ${x.file}` : ""}`).join("\n")
    : empty;

  return `# The spec, against what the app actually does

\`${spec.from}\` makes claims about the service. The client's calls are what the
front end actually does. This is where they disagree, and the disagreements
are the finding.

## Calls the spec has never heard of

The undocumented dependencies. Each one is something the rewrite relies on
that the contract does not admit exists.

${list(spec.undocumented, "None. Every call the app makes is in the spec.")}

## Operations nothing calls

Dead surface, or screens this run has not read. Which one it is decides
whether the port needs them.

${list(spec.uncalled, "None. The app exercises the whole spec.")}

## Deprecated and still in use

${list(spec.deprecatedInUse, "Nothing the app calls is marked deprecated.")}

---

${spec.operations.length} operation(s) in the spec, ${callCount} call(s) read
from the app. A spec is a claim, not a measurement; where the two disagree,
trust the traffic and fix the document.
`;
}
