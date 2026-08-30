/**
 * Turns the call inventory into one endpoint map plus a client, so the ported
 * components never contain a URL. Every call the inventory could not fully
 * describe is recorded as unverified rather than guessed at.
 */
const nameFor = (call) => {
  const parts = call.path.split(/[/?]/).filter((p) => p && !p.startsWith("$") && !p.startsWith(":"));
  const tail = parts.slice(-2).map((p) => p.replace(/[^a-z0-9]/gi, "")).filter(Boolean);
  const verb = { GET: "get", POST: "create", PUT: "update", PATCH: "update", DELETE: "remove" }[call.method] || "call";
  return verb + tail.map((t) => t[0].toUpperCase() + t.slice(1)).join("") || "call";
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
    });

    on("emit", async (ctx) => {
      const lines = ctx.api.calls
        .map((c) => `  ${c.name}: { method: ${JSON.stringify(c.method)}, path: ${JSON.stringify(c.path)} },`)
        .join("\n");
      await ctx.write("src/api/endpoints.js", `export const endpoints = {\n${lines}\n};\n`);
      await ctx.write("src/api/client.js", CLIENT);
    });
  },
};

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
