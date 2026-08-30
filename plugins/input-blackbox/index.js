import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";

/**
 * Reads a legacy system from whatever artifacts exist when the source does not.
 * Everything here is passive: files the user already has, nothing driven, nothing
 * decompiled, nothing fetched.
 *
 * Point it at ./artifacts:
 *   *.har                  network recording, from portamp or a browser
 *   *.sql, *.ddl           schema dump, the most honest description of a
 *                          legacy app's real data model
 *   *.json, *.yaml         an OpenAPI or Postman export if one survived
 *   *.csv                  a report export, which reveals field names and formats
 *   *.md, *.txt            whatever documentation exists
 */
export default {
  name: "input-blackbox",
  version: "0.1.0",
  class: "input",
  setup({ on, log, policy }) {
    on("scan", async (ctx) => {
      const dir = ctx.config.artifacts || join(process.cwd(), "artifacts");
      let entries = [];
      try { entries = await readdir(dir); } catch { return log.debug("no artifacts directory"); }

      if (!ctx.authorization)
        throw new Error(
          "Reading a legacy system without its source requires portamp.authorization.json " +
            "naming the system and who owns it."
        );

      for (const e of entries) {
        const p = join(dir, e);
        if (!(await stat(p)).isFile()) continue;
        const ext = extname(e).toLowerCase();
        const text = await readFile(p, "utf8").catch(() => "");
        policy.warnOnFixtureData(text.slice(0, 20000), e);

        if (ext === ".har") {
          const har = JSON.parse(text || "{}");
          const seen = new Set();
          for (const en of har?.log?.entries || []) {
            const u = new URL(en.request.url);
            const key = `${en.request.method} ${u.pathname}`;
            if (seen.has(key)) continue;
            seen.add(key);
            ctx.api.calls.push({
              method: en.request.method,
              path: u.pathname,
              file: e,
              headers: (en.request.headers || [])
                .map((h) => h.name)
                .filter((n) => !["cookie", "authorization"].includes(n.toLowerCase())),
              body: en.request.postData ? "observed, shape not captured" : null,
              observed: true,
            });
          }
          log.info(`${e}: ${seen.size} distinct call(s)`);
        } else if (ext === ".sql" || ext === ".ddl") {
          const tables = [...text.matchAll(/create\s+table\s+[`"\[]?(\w+)/gi)].map((m) => m[1]);
          ctx.sources.specs.push({ kind: "schema", file: e, tables });
          log.info(`${e}: ${tables.length} table(s)`);
        } else if (ext === ".json" || ext === ".yaml" || ext === ".yml") {
          const isOpenApi = /"?(openapi|swagger)"?\s*:/i.test(text);
          ctx.sources.specs.push({ kind: isOpenApi ? "openapi" : "unknown", file: e });
          log.info(`${e}: ${isOpenApi ? "openapi spec" : "json artifact"}`);
        } else if (ext === ".csv") {
          const header = (text.split("\n")[0] || "").split(",").map((s) => s.trim());
          ctx.sources.specs.push({ kind: "report", file: e, fields: header });
          log.info(`${e}: report with ${header.length} column(s)`);
        } else if ([".md", ".txt"].includes(ext)) {
          ctx.sources.specs.push({ kind: "doc", file: e, bytes: text.length });
        }
      }

      if (ctx.api.calls.length && !ctx.sources.files.length)
        ctx.unverified(
          "The API inventory came from observation, not source. Request body shapes and " +
            "error handling are unknown until each call is exercised deliberately."
        );
    });
  },
};
