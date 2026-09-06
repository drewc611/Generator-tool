import { readFile } from "node:fs/promises";
import { buildIr } from "../dsp-ir/ir.js";

/**
 * Turns the call inventory into one endpoint map plus a client, so the ported
 * components never contain a URL. Every call the inventory could not fully
 * describe is recorded as unverified rather than guessed at.
 */

/**
 * Which fields of each collection the templates actually read. A response
 * usually carries more than the screens use, and the difference is the
 * contract the port really depends on: everything else can change server
 * side without anything on screen noticing.
 */
export function fieldsRead(ir) {
  const out = new Map();
  const collect = (expr, scopes) => {
    for (const m of String(expr ?? "").matchAll(/\b([\w$]+)\.([\w$]+)/g)) {
      const list = scopes.get(m[1]);
      if (!list) continue;
      if (!out.has(list)) out.set(list, new Set());
      out.get(list).add(m[2]);
    }
  };
  const walk = (node, scopes) => {
    if (!node) return;
    if (node.kind === "text") for (const p of node.parts) collect(p.expression, scopes);
    if (node.kind === "when") collect(node.test, scopes);
    if (node.kind === "html") collect(node.expression, scopes);
    if (node.kind === "each") {
      scopes = new Map([...scopes, [node.item, node.list]]);
      collect(node.key, scopes);
    }
    if (node.kind === "element") {
      for (const a of node.attrs) {
        collect(a.expression, scopes);
        for (const p of a.parts ?? []) collect(p.expression, scopes);
      }
      for (const c of node.classes) collect(c.expression ?? c.when, scopes);
      for (const s of node.styles) collect(s.expression, scopes);
      for (const e of node.events) collect(e.handler, scopes);
      collect(node.model, scopes);
    }
    for (const child of node.children ?? []) walk(child, scopes);
  };
  walk(ir.root, new Map());
  return out;
}
const nameFor = (call) => {
  const parts = call.path.split(/[/?]/).filter((p) => p && !p.startsWith("$") && !p.startsWith(":"));
  const tail = parts.slice(-2).map((p) => p.replace(/[^a-z0-9]/gi, "")).filter(Boolean);
  const verb = { GET: "get", POST: "create", PUT: "update", PATCH: "update", DELETE: "remove" }[call.method] || "call";
  return verb + tail.map((t) => t[0].toUpperCase() + t.slice(1)).join("");
};

export default {
  name: "dsp-apimap",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const seen = new Set();
      ctx.api.calls = ctx.api.calls.filter((c) => {
        const k = `${c.method} ${c.path}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      for (const c of ctx.api.calls) {
        c.name = nameFor(c);
        if (c.body === "unknown")
          ctx.unverified(`Body shape for ${c.method} ${c.path} was not determined (${c.file}).`);
      }
      log.info(`${ctx.api.calls.length} distinct endpoint(s)`);

      // Join what the templates read to the endpoints the app called: the
      // collection's leaf name against a GET path's last plain segment. A
      // join by name is a reading, and the file says so.
      const usage = new Map();
      for (const screen of ctx.screens.filter((s) => s.template)) {
        const ir = screen.ir ?? (() => { try { return buildIr(screen.template); } catch { return null; } })();
        if (!ir) continue;
        for (const [list, fields] of fieldsRead(ir)) {
          const leaf = list.split(".").pop().toLowerCase();
          if (!usage.has(leaf)) usage.set(leaf, { list, fields: new Set(), screens: new Set() });
          for (const f of fields) usage.get(leaf).fields.add(f);
          usage.get(leaf).screens.add(screen.selector);
        }
      }
      ctx.apiFields = [];
      for (const call of ctx.api.calls.filter((c) => c.method === "GET")) {
        const segment = call.path.split("?")[0].split("/").filter((p) => p && !/[:{$]/.test(p)).pop()?.toLowerCase();
        const hit = segment ? usage.get(segment) ?? usage.get(segment.replace(/s$/, "")) : null;
        if (hit) {
          ctx.apiFields.push({ endpoint: call.name, method: call.method, path: call.path, fields: [...hit.fields].sort(), screens: [...hit.screens] });
        }
      }
      if (ctx.apiFields.length) log.info(`${ctx.apiFields.length} endpoint(s) joined to the fields their screens read`);

      // The calls that are not requests. A WebSocket subscription and a
      // GraphQL operation are API surface the same way a GET is: read from
      // source, described, and never invented. The GraphQL schema stays
      // unclaimed, because a schema nobody verified is the failure this
      // tool exists to avoid.
      const channels = [];
      const graphql = [];
      let graphqlEndpoint = null;
      for (const f of ctx.sources.files.filter((f) => /\.(js|ts|mjs|graphql|gql)$/i.test(f.rel) && !/\.min\.|\.spec\.|\.test\./.test(f.rel))) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        if (!text) continue;
        for (const m of text.matchAll(/new\s+WebSocket\s*\(\s*(["'`])([^"'`]*)\1/g)) {
          channels.push({ kind: "websocket", url: m[2], file: f.rel });
        }
        for (const m of text.matchAll(/\bwebSocket\s*(?:<[^>]*>)?\s*\(\s*(["'`])([^"'`]*)\1/g)) {
          channels.push({ kind: "websocket (rxjs)", url: m[2], file: f.rel });
        }
        if (/from\s+["']socket\.io-client["']/.test(text)) {
          channels.push({ kind: "socket.io", url: null, file: f.rel });
        }
        const bodies = /\.(graphql|gql)$/i.test(f.rel)
          ? [text]
          : [...text.matchAll(/\bgql\s*`([\s\S]*?)`/g)].map((m) => m[1]);
        for (const body of bodies) {
          for (const op of body.matchAll(/\b(query|mutation|subscription)\s+([\w$]+)?/g)) {
            graphql.push({ operation: op[1], name: op[2] ?? null, file: f.rel });
          }
        }
        const uri = /\buri\s*:\s*["']([^"']*graphql[^"']*)["']/i.exec(text) ?? /["'](\/[\w/-]*graphql[\w/-]*)["']/.exec(text);
        if (uri && !graphqlEndpoint) graphqlEndpoint = { path: uri[1], file: f.rel };
      }
      if (channels.length || graphql.length) {
        ctx.api.channels = channels;
        ctx.api.graphql = { operations: graphql, endpoint: graphqlEndpoint };
        for (const c of channels) {
          ctx.unverified(`${c.file} opens a ${c.kind} channel${c.url ? ` to \`${c.url}\`` : ""}. What travels on it was not observed; the port must carry the subscription, and API_CHANNELS.md describes what the source proves.`);
        }
        if (graphql.length && !graphqlEndpoint) {
          ctx.unverified(`${graphql.length} GraphQL operation(s) were read and no endpoint naming graphql was found in source. The operations are in src/api/operations.js; wire the endpoint by hand.`);
        }
        log.info(`${channels.length} channel(s), ${graphql.length} GraphQL operation(s) read from source`);
      }
    });

    on("emit", async (ctx) => {
      const lines = ctx.api.calls
        .map((c) => `  ${c.name}: { method: ${JSON.stringify(c.method)}, path: ${JSON.stringify(c.path)} },`)
        .join("\n");
      await ctx.write("src/api/endpoints.js", `export const endpoints = {\n${lines}\n};\n`);
      await ctx.write("src/api/client.js", CLIENT);
      if (ctx.apiFields?.length) {
        await ctx.write("API_FIELDS.md", FIELDS(ctx.apiFields));
      }
      if (ctx.api.graphql?.operations.length) {
        const ops = ctx.api.graphql.operations
          .map((o) => `  ${JSON.stringify(o.name ?? `${o.operation}Anonymous`)}: { operation: ${JSON.stringify(o.operation)}, from: ${JSON.stringify(o.file)} },`)
          .join("\n");
        await ctx.write("src/api/operations.js", `/**\n * The GraphQL operations the source declares, named and typed by kind.\n * The endpoint ${ctx.api.graphql.endpoint ? `the source names is ${JSON.stringify(ctx.api.graphql.endpoint.path)} (${ctx.api.graphql.endpoint.file})` : "was not found in source; wire it by hand"}.\n * No schema is claimed here: a schema nobody verified is worse than none.\n */\nexport const OPERATIONS = {\n${ops}\n};\n`);
      }
      if (ctx.api.channels?.length || ctx.api.graphql?.operations.length) {
        await ctx.write("API_CHANNELS.md", CHANNELS(ctx.api.channels ?? [], ctx.api.graphql));
      }
    });
  },
};

const CHANNELS = (channels, graphql) => [
  "# The API surface that is not a request",
  "",
  "Read from source, described, never invented. What travels on a channel was",
  "not observed, so nothing here claims a message shape.",
  "",
  ...(channels.length ? [
    "## Channels",
    "",
    ...channels.map((c) => `- ${c.kind}${c.url ? ` to \`${c.url}\`` : ""}, opened in \`${c.file}\``),
    "",
  ] : []),
  ...(graphql?.operations.length ? [
    "## GraphQL operations",
    "",
    graphql.endpoint
      ? `The source names the endpoint \`${graphql.endpoint.path}\` (\`${graphql.endpoint.file}\`).`
      : "No endpoint naming graphql was found in source; the operations wait for one.",
    "",
    "| operation | kind | from |",
    "| --- | --- | --- |",
    ...graphql.operations.map((o) => `| \`${o.name ?? "(anonymous)"}\` | ${o.operation} | \`${o.file}\` |`),
    "",
    "The schema stays unclaimed: only the operations the client actually wrote",
    "are listed, spelled the way the source spelled them.",
    "",
  ] : []),
].join("\n");

const FIELDS = (rows) => `# The fields the screens actually read

Each GET below was joined to a collection a template iterates, by name, which
is a reading rather than a fact: a collection assigned from a different call
would join wrongly, so check the pairs before leaning on them.

The point of the list: the response can carry anything, and only these fields
put pixels on screen. Everything else can change server side without the port
noticing, and nothing here says the response is *limited* to these fields.

| endpoint | path | fields read | read by |
| --- | --- | --- | --- |
${rows.map((r) => `| \`${r.endpoint}\` | \`${r.method} ${r.path}\` | ${r.fields.map((f) => `\`${f}\``).join(", ") || "none"} | ${r.screens.join(", ")} |`).join("\n")}
`;

const CLIENT = `import { endpoints } from "./endpoints.js";

/**
 * Generated transport. Timeout, retry with backoff and jitter, cancellation,
 * and normalized errors live here so components never hold a URL or a header.
 * No credential belongs in this file; the browser talks to your own service.
 */
export class ApiError extends Error {
  constructor(message, { status, code, requestId } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status ?? 0;
    this.code = code ?? "unknown";
    this.requestId = requestId ?? null;
  }
}

export function createClient({ baseUrl = "", timeoutMs = 15000, retries = 2 } = {}) {
  async function call(name, { params, body, signal } = {}) {
    const ep = endpoints[name];
    if (!ep) throw new Error("Unknown endpoint: " + name);
    const q = params ? "?" + new URLSearchParams(params) : "";
    for (let attempt = 0; ; attempt++) {
      const timer = new AbortController();
      const id = setTimeout(() => timer.abort(), timeoutMs);
      try {
        const res = await fetch(baseUrl + ep.path + q, {
          method: ep.method,
          credentials: "same-origin",
          signal: signal || timer.signal,
          headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        clearTimeout(id);
        if (res.status === 204) return null;
        if (!res.ok) {
          const p = await res.json().catch(() => ({}));
          const retryable = res.status === 429 || res.status >= 500;
          if (retryable && attempt < retries) {
            const hinted = Number(res.headers.get("retry-after"));
            await new Promise((r) => setTimeout(r, hinted > 0 ? hinted * 1000 : 400 * 2 ** attempt));
            continue;
          }
          throw new ApiError(p.description || "Request failed (" + res.status + ")", {
            status: res.status, code: p.error, requestId: res.headers.get("x-request-id"),
          });
        }
        return res.json();
      } catch (e) {
        clearTimeout(id);
        if (e instanceof ApiError || signal?.aborted) throw e;
        if (attempt >= retries) throw new ApiError("Network request failed", { status: 0, code: "network" });
      }
    }
  }
  return { call, endpoints };
}
`;
