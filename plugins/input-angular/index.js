import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, extname, dirname, resolve, sep } from "node:path";
import { loadTypeScript, readSourceFile } from "./ast.js";
import { readWithRegex } from "./regex.js";

// One walk serves every reader, so the set spans every era this tool reads:
// framework sources, the old web's server pages and includes, and the assets
// a page renders, which the site engine copies through as the bytes they are.
const KEEP = new Set([
  ".ts", ".js", ".jsx", ".tsx", ".html", ".scss", ".css", ".vue", ".riot", ".tag", ".svelte", ".hbs", ".handlebars", ".marko", ".liquid", ".twig", ".xsl", ".xslt", ".cshtml", ".ftl", ".ftlh", ".vm", ".vtl", ".pug", ".jade", ".tpl", ".jspf", ".jspx", ".cfm", ".cfml", ".haml", ".slim", ".ejs",
  ".htm", ".shtml", ".php", ".asp", ".jsp", ".inc", ".txt", ".xml", ".pdf",
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
]);
const SKIP = new Set(["node_modules", "dist", ".git", "coverage"]);
const RXJS = /\b(switchMap|combineLatest|BehaviorSubject|mergeMap|debounceTime|takeUntil|shareReplay|distinctUntilChanged|catchError|finalize)\b/g;

async function walk(dir, root, out = []) {
  let entries = [];
  try { entries = await readdir(dir); } catch { return out; }
  for (const e of entries.sort()) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) await walk(p, root, out);
    // rel always uses forward slashes, whatever the platform, so every
    // plugin that reads it can split on one separator.
    // .htaccess has no extension to keep; the server's own redirect
    // declarations are exactly the evidence the site engine reads.
    else if (KEEP.has(extname(e)) || e === ".htaccess" || /^\.env(\.[\w.-]+)?$/.test(e)) out.push({ path: p, rel: relative(root, p).split(sep).join("/") });
  }
  return out;
}

/**
 * A component's markup is either in the decorator or in a file beside it.
 * Either way the emitter needs the text, so resolve it here and let everything
 * downstream see one field.
 */
async function attachTemplate(screen, file, files) {
  if (screen.template != null) {
    screen.templateOrigin = "inline";
    return screen;
  }
  if (!screen.templateUrl) {
    screen.templateOrigin = null;
    return screen;
  }
  const wanted = resolve(dirname(file.path), screen.templateUrl);
  const match = files.find((f) => resolve(f.path) === wanted);
  if (!match) {
    screen.templateOrigin = null;
    return screen;
  }
  screen.template = await readFile(match.path, "utf8").catch(() => null);
  screen.templateOrigin = match.rel;
  return screen;
}

/** Reads an Angular tree and identifies components, services, and HTTP calls. */
export default {
  name: "input-angular",
  version: "0.2.0",
  class: "input",
  setup({ on, log }) {
    on("scan", async (ctx) => {
      const files = await walk(ctx.config.src, ctx.config.src);
      ctx.sources.files = files;
      log.info(`${files.length} file(s) under ${ctx.config.src}`);
      if (!files.length) ctx.unverified("No legacy source was found to read.");
    });

    on("extract", async (ctx) => {
      const before = { screens: ctx.screens.length, calls: ctx.api.calls.length, interceptors: ctx.api.interceptors.length };
      const ts = await loadTypeScript();
      if (!ts) {
        const present = loadTypeScript.unusable;
        ctx.unverified(
          present
            ? `typescript ${present} is installed but does not expose the compiler API this pass needs, so the ` +
              "source was read with regular expressions. Install typescript 5 for the exact read."
            : "typescript is not installed, so the source was read with regular expressions. " +
              "Anything unusually formatted may have been missed. Run `npm i -D typescript@5` for the exact read."
        );
      }

      for (const f of ctx.sources.files) {
        const text = await readFile(f.path, "utf8").catch(() => "");
        if (!text) continue;

        const isCode = /\.(ts|js)$/.test(f.rel);
        let found = { screens: [], calls: [], interceptors: [] };
        if (isCode) {
          found = ts ? readSourceFile(ts, text, f.rel) : readWithRegex(text, f.rel);
        }

        for (const screen of found.screens) {
          if (!screen.selector) continue;
          await attachTemplate(screen, f, ctx.sources.files);
          const markup = screen.template ?? "";
          ctx.screens.push({
            selector: screen.selector,
            className: screen.className ?? null,
            file: f.rel,
            inputs: screen.inputs,
            outputs: screen.outputs,
            template: screen.template ?? null,
            templateOrigin: screen.templateOrigin ?? null,
            usesNgIf: /\*ngIf/.test(markup) || /\*ngIf/.test(text),
            usesNgFor: /\*ngFor/.test(markup) || /\*ngFor/.test(text),
            usesTwoWay: /\[\(ngModel\)\]/.test(markup) || /\[\(ngModel\)\]/.test(text),
            rxjs: [...new Set([...text.matchAll(RXJS)].map((m) => m[1]))],
            readBy: ts ? "ast" : "regex",
          });
        }
        ctx.api.calls.push(...found.calls);
        ctx.api.interceptors.push(...found.interceptors);
      }

      for (const screen of ctx.screens) {
        if (!screen.template) {
          ctx.unverified(
            `No template was found for <${screen.selector}>. Its body cannot be translated, only its states.`
          );
        }
      }

      // Count what this plugin found, not what is on the context: another
      // input may have put its own screens there first.
      log.info(
        `${ctx.screens.length - before.screens} component(s), ${ctx.api.calls.length - before.calls} call(s), ` +
          `${ctx.api.interceptors.length - before.interceptors} interceptor(s)` +
          (ts ? "" : ", read with regular expressions")
      );
      if (ctx.api.interceptors.length)
        ctx.unverified("Interceptors add headers at no call site. Confirm each is reproduced in the client.");
    });
  },
};
