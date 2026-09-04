import { readFile } from "node:fs/promises";
import { flatten, readRoutes } from "./parse.js";
import { pascal } from "../dsp-ir/emit.js";

/**
 * Recovers the route table, because the address bar is half of an app's
 * contract and nothing else in the pipeline was reading it.
 *
 * The rebuild needs it twice over: dsp-modernize keeps proposing that state
 * belong in the URL, and a port that renders every screen but reaches them
 * differently has quietly broken every bookmark anybody saved.
 *
 * Cross checked both ways: a route whose component is not in the run is a
 * screen the port will not have, and a screen no route reaches is either
 * embedded in another or unreachable, and which of those it is matters.
 */


export default {
  name: "dsp-routes",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const candidates = ctx.sources.files.filter((f) => /\.(ts|js|mjs|vue)$/.test(f.rel) && !/\.min\.js$/.test(f.rel));

      const routes = [];
      let hashRouting = false;
      for (const file of candidates) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        if (/RouterModule|createRouter|new\s+VueRouter|\$routeProvider|\broutes\s*[:=]\s*\[/.test(text)) {
          routes.push(...readRoutes(text, file.rel));
        }
        // "hashchange" as a substring on purpose: window.onhashchange is one
        // word, and a word boundary never fires inside it.
        if (/hashchange|location\.hash\s*=/.test(text)) hashRouting = true;
      }

      if (!routes.length && !hashRouting) return log.debug("no route table found");

      ctx.routes = { table: flatten(routes), hashRouting };
      log.info(
        `${ctx.routes.table.length} route(s)` +
        (hashRouting ? ", plus hand rolled hash routing" : "")
      );

      if (hashRouting) {
        ctx.unverified(
          "The app changes location.hash by hand or listens for hashchange. That is a routing system with " +
          "one user, and the routes it implies cannot be read statically; ROUTES.md lists only the declared ones."
        );
      }
    });

    on("plan", async (ctx) => {
      if (!ctx.routes?.table.length) return;

      // A route names the class, so the class name is the first key. The
      // ported name is the fallback, for a reader that never recorded one.
      const known = new Map();
      for (const screen of ctx.screens) {
        if (screen.className) known.set(screen.className, screen.selector);
        known.set(pascal(screen.selector), screen.selector);
      }
      const normalise = (name) => String(name ?? "").replace(/(Component|View|Page)$/, "");

      for (const route of ctx.routes.table) {
        if (route.component && !route.lazy) {
          route.screen = known.get(route.component) ?? known.get(normalise(route.component)) ?? null;
          if (!route.screen) {
            ctx.unverified(
              `Route ${route.fullPath} renders ${route.component}, which is not among the screens this run ` +
              `read. The port will not have that screen until its source is included.`
            );
          }
        }
      }

      // A parameter in the path is an input the screen receives from the
      // address bar. Naming them makes the port's data flow visible; one the
      // target's template never mentions is only a candidate for dead weight,
      // because a controller can read it where this pass cannot see.
      for (const route of ctx.routes.table) {
        route.params = [...String(route.fullPath ?? "").matchAll(/:([\w$]+)/g)].map((m) => m[1]);
        if (!route.params.length || !route.screen) continue;
        const screen = ctx.screens.find((s) => s.selector === route.screen);
        const unread = route.params.filter((p) => !new RegExp(`\\b${p}\\b`).test(screen?.template ?? ""));
        if (unread.length) {
          ctx.unverified(
            `Route ${route.fullPath} carries ${unread.map((p) => `\`:${p}\``).join(", ")} and the <${route.screen}> template never mentions ${unread.length === 1 ? "it" : "them"}. ` +
            `Read in a controller this pass cannot see, or dead weight in the path; wire it explicitly in the port either way.`
          );
        }
      }

      const routed = new Set(ctx.routes.table.map((r) => r.screen).filter(Boolean));
      const unrouted = ctx.screens.filter((s) => !routed.has(s.selector));
      if (routed.size && unrouted.length) {
        ctx.unverified(
          `${unrouted.length} screen(s) are not the target of any declared route: ` +
          `${unrouted.map((s) => `<${s.selector}>`).join(", ")}. Embedded in another screen, or unreachable; ` +
          `the difference decides whether each needs an address in the port.`
        );
      }
    });

    on("emit", async (ctx) => {
      if (!ctx.routes) return;
      await ctx.write("ROUTES.md", render(ctx.routes, ctx.screens.length));
    });
  },
};

function render({ table, hashRouting }, screenCount) {
  const rows = table.map((r) => {
    const target = r.redirectTo != null
      ? `redirect → \`${r.redirectTo}\``
      : r.lazy
        ? `lazy${r.component ? ` (\`${r.component}\`)` : ""} — not resolvable statically`
        : r.screen
          ? `\`<${r.screen}>\`, in this run`
          : r.component
            ? `\`${r.component}\` — **not in this run**`
            : "nothing portamp could read";
    return `| \`${r.fullPath}\` | ${target} | ${r.params?.length ? r.params.map((p) => `\`:${p}\``).join(", ") : "—"} | ${r.file} |`;
  });

  return `# The route table

The address bar is half of an app's contract: every path below is a bookmark
somebody may have saved, a link in an email somewhere, a tab pinned since 2019.
A port that renders the same screens under different addresses has broken all
of them silently.

${table.length ? `| path | renders | parameters | declared in |
| --- | --- | --- | --- |
${rows.join("\n")}` : "No declared route table was found."}
${hashRouting ? `
## Hand rolled hash routing

The scripts change \`location.hash\` themselves or listen for \`hashchange\`.
Those routes are made of code, not declarations, so this file cannot list them;
walk the handlers, or drive the app with input-explore and read what the address
bar does.
` : ""}
Declared routes: ${table.length}. Screens in this run: ${screenCount}. The
mismatches, if any, are in PORT_NOTES.md, because each one is a decision and
not a fact.
`;
}
