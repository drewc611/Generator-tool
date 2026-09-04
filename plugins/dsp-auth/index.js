import { readFile } from "node:fs/promises";

/**
 * How the app proves who is calling, read from its interceptors and its
 * source. The scheme and where the token lives are porting decisions with
 * security consequences; a token value, if one is ever in reach, is never
 * printed, and this pass never asks the network anything.
 */

const SIGNS = [
  { kind: "bearer", re: /Authorization[^\n]{0,60}\bBearer\b/i, means: "a bearer token in the Authorization header" },
  { kind: "basic", re: /Authorization[^\n]{0,60}\bBasic\b/i, means: "HTTP basic credentials" },
  { kind: "api-key-header", re: /['"](?:x-api-key|api-key|x-auth-token)['"]/i, means: "an API key in a custom header" },
  { kind: "cookie", re: /withCredentials\s*[:=]\s*true|credentials\s*:\s*['"]include['"]/, means: "a cookie, sent because the client opts into credentials" },
  { kind: "csrf", re: /['"](?:x-csrf-token|x-xsrf-token)['"]|xsrfCookieName/i, means: "a CSRF token header alongside the session" },
];

const STORES = [
  { kind: "localStorage", re: /localStorage\s*[.[]\s*(?:getItem\s*\(\s*)?['"]([\w.-]*(?:token|jwt|auth|session)[\w.-]*)['"]/i },
  { kind: "sessionStorage", re: /sessionStorage\s*[.[]\s*(?:getItem\s*\(\s*)?['"]([\w.-]*(?:token|jwt|auth|session)[\w.-]*)['"]/i },
  { kind: "cookie (script readable)", re: /document\.cookie/ },
];

export function readAuth(text, rel) {
  const found = [];
  for (const sign of SIGNS) {
    if (sign.re.test(text)) found.push({ kind: sign.kind, means: sign.means, file: rel });
  }
  const storage = [];
  for (const store of STORES) {
    const m = store.re.exec(text);
    if (m) storage.push({ where: store.kind, key: m[1] ?? null, file: rel });
  }
  return { found, storage };
}

export default {
  name: "dsp-auth",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|ts|jsx|tsx|vue)$/i.test(f.rel) && !/\.min\.|\.spec\.|\.test\./.test(f.rel));
      const schemes = [];
      const storage = [];
      const relogin = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const result = readAuth(text, file.rel);
        schemes.push(...result.found);
        storage.push(...result.storage);
        // A file that names 401 and either retries or navigates is the app
        // reacting to an expired session; evidence for the flow, not proof
        // of a refresh protocol.
        if (/\b401\b/.test(text) && /(retry|refresh|logout|login|navigate)/i.test(text)) {
          relogin.push(file.rel);
        }
      }
      if (!schemes.length && !storage.length) {
        if (ctx.api.interceptors.length) {
          ctx.unverified(
            `${ctx.api.interceptors.length} interceptor(s) exist and none shows a recognisable auth scheme. Either requests are anonymous or the scheme is one this scan does not know; confirm before the port ships without one.`
          );
        }
        return log.debug("no auth signs");
      }
      ctx.auth = { schemes, storage, relogin, interceptors: ctx.api.interceptors };
      log.info(`${[...new Set(schemes.map((s) => s.kind))].join(", ") || "no scheme"}${storage.length ? `, token storage in ${[...new Set(storage.map((s) => s.where))].join(" and ")}` : ""}`);
    });

    on("emit", async (ctx) => {
      if (!ctx.auth) return;
      const { schemes, storage, interceptors } = ctx.auth;
      const lines = [
        "# Authentication, as the client does it",
        "",
        "Read from the source. No token value appears in this file and none was",
        "sent anywhere to check.",
        "",
        "## Scheme",
        "",
      ];
      const byKind = new Map();
      for (const s of schemes) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s.file]);
      for (const [kind, files] of byKind) {
        const means = SIGNS.find((s) => s.kind === kind)?.means ?? kind;
        lines.push(`- ${means}, seen in ${[...new Set(files)].map((f) => `\`${f}\``).join(", ")}`);
      }
      if (!byKind.size) lines.push("- Nothing recognisable. The requests may be anonymous.");
      if (interceptors.length) {
        lines.push("", `Interceptors that touch every request: ${interceptors.map((i) => `\`${i.className ?? i.file}\``).join(", ")}.`);
      }
      lines.push("");
      if (storage.length) {
        lines.push("## Where the token lives", "");
        for (const s of storage) {
          lines.push(`- ${s.where}${s.key ? ` under \`${s.key}\`` : ""}, in \`${s.file}\``);
        }
        lines.push(
          "",
          "Script readable storage means any injected script can read the session.",
          "The port should move the token to an httpOnly cookie if the server can",
          "set one; that is a server decision, so it is proposed here and not done.",
          ""
        );
      }
      // The flow as a sequence, drawn only from what the source proved:
      // every arrow names its evidence, and an arrow with none is not drawn.
      const flow = authFlow(ctx.auth, ctx.api.calls);
      if (flow) {
        await ctx.write("AUTH_FLOW.mmd", flow);
        lines.push("## The flow, as evidenced", "", "```mermaid", flow.trim(), "```", "", "An arrow with no evidence is not drawn; a real login flow may hold more steps than the source shows.", "");
      }
      await ctx.write("AUTH.md", lines.join("\n"));
    });
  },
};

/** A sequence diagram where every arrow carries the file that proves it. */
export function authFlow({ schemes, storage, relogin, interceptors }, calls = []) {
  const arrows = [];
  const store = storage[0];
  if (store) {
    arrows.push(`  App->>Store: read${store.key ? ` \`${store.key}\`` : " the token"} from ${store.where.split(" ")[0]} (${store.file})`);
  }
  const scheme = schemes.find((s) => /bearer|basic|api-key/.test(s.kind));
  if (scheme) {
    const via = interceptors.length ? ` via ${interceptors[0].className ?? interceptors[0].file}` : "";
    arrows.push(`  App->>API: request carrying ${scheme.means}${via} (${scheme.file})`);
  }
  const cookie = schemes.find((s) => s.kind === "cookie");
  if (cookie) arrows.push(`  App->>API: request with credentials included (${cookie.file})`);
  const csrf = schemes.find((s) => s.kind === "csrf");
  if (csrf) arrows.push(`  App->>API: CSRF token header beside the session (${csrf.file})`);
  const login = calls.find((c) => /log-?in|auth|session|token/i.test(c.path ?? "") && c.method === "POST");
  if (login) arrows.push(`  App->>API: ${login.method} ${login.path} (${login.file})`);
  for (const file of relogin.slice(0, 1)) {
    arrows.push(`  API-->>App: 401, and the app reacts (${file})`);
  }
  if (!arrows.length) return null;
  return `sequenceDiagram\n  participant App as the port\n${storage.length ? "  participant Store as token storage\n" : ""}  participant API as the service\n${arrows.join("\n")}\n`;
}
