import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";

const KEEP = new Set([".ts", ".js", ".html", ".scss", ".css"]);
const SKIP = new Set(["node_modules", "dist", ".git", "coverage"]);

async function walk(dir, root, out = []) {
  let entries = [];
  try { entries = await readdir(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) await walk(p, root, out);
    else if (KEEP.has(extname(e))) out.push({ path: p, rel: relative(root, p) });
  }
  return out;
}

/** Reads an Angular tree and identifies components, services, and HTTP calls. */
export default {
  name: "input-angular",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("scan", async (ctx) => {
      const files = await walk(ctx.config.src, ctx.config.src);
      ctx.sources.files = files;
      log.info(`${files.length} file(s) under ${ctx.config.src}`);
      if (!files.length) ctx.unverified("No legacy source was found to read.");
    });

    on("extract", async (ctx) => {
      for (const f of ctx.sources.files) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        const cmp = text.match(/@Component\(\s*\{[\s\S]*?selector:\s*['"]([^'"]+)['"]/);
        if (cmp) {
          ctx.screens.push({
            selector: cmp[1],
            file: f.rel,
            inputs: [...text.matchAll(/@Input\(\)\s+(\w+)/g)].map((m) => m[1]),
            outputs: [...text.matchAll(/@Output\(\)\s+(\w+)/g)].map((m) => m[1]),
            usesNgIf: /\*ngIf/.test(text),
            usesNgFor: /\*ngFor/.test(text),
            usesTwoWay: /\[\(ngModel\)\]/.test(text),
            rxjs: [...new Set([...text.matchAll(/\b(switchMap|combineLatest|BehaviorSubject|mergeMap|debounceTime)\b/g)].map((m) => m[1]))],
          });
        }
        if (/@Injectable\(/.test(text) && /HttpClient/.test(text)) {
          for (const m of text.matchAll(/\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*([`'"])([^`'"]+)\2/g)) {
            ctx.api.calls.push({
              method: m[1].toUpperCase(),
              path: m[3],
              file: f.rel,
              headers: null,
              body: ["get", "delete"].includes(m[1]) ? null : "unknown",
            });
          }
        }
        if (/HttpInterceptor/.test(text)) ctx.api.interceptors.push({ file: f.rel });
      }
      log.info(`${ctx.screens.length} component(s), ${ctx.api.calls.length} call(s), ${ctx.api.interceptors.length} interceptor(s)`);
      if (ctx.api.interceptors.length)
        ctx.unverified("Interceptors add headers at no call site. Confirm each is reproduced in the client.");
    });
  },
};
