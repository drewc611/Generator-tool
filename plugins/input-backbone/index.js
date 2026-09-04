import { readFile } from "node:fs/promises";
import { balanced } from "../dsp-ir/scan.js";

/**
 * The Backbone reader. A View declares more than jQuery ever did and less than
 * a component framework: an element it owns, an events hash naming what it
 * listens to, and usually a render method that writes into itself. That is a
 * boundary somebody drew on purpose, so unlike the jQuery reader this one does
 * not have to propose boundaries; it reads the ones that are there.
 *
 * What it deliberately does not do is turn a View into a screen. An
 * underscore template full of <%= %> is another dialect for another day, and a
 * View without its template is an inventory entry, not a component.
 */

export function readViews(text, rel) {
  const views = [];
  for (const m of text.matchAll(/(?:var|let|const)?\s*([\w$]+)\s*=\s*Backbone\.View\.extend\s*\(\s*\{/g)) {
    const body = balanced(text, m.index + m[0].length - 1);
    if (!body) continue;

    const el = /\bel\s*:\s*['"`]([^'"`]+)['"`]/.exec(body)?.[1] ?? null;
    const tag = /\btagName\s*:\s*['"`]([\w-]+)['"`]/.exec(body)?.[1] ?? null;
    const cls = /\bclassName\s*:\s*['"`]([\w -]+)['"`]/.exec(body)?.[1] ?? null;

    const events = [];
    const hash = /\bevents\s*:\s*\{/.exec(body);
    if (hash) {
      const block = balanced(body, hash.index + hash[0].length - 1);
      for (const e of (block ?? "").matchAll(/['"`]([\w]+)(?:\s+([^'"`]+))?['"`]\s*:\s*['"`]?([\w$]+)/g)) {
        events.push({ event: e[1], selector: e[2] ?? null, handler: e[3] });
      }
    }

    // template: _.template($("#order-row").html()) names the underscore
    // template this view renders. The id is the join key to the screen the
    // underscore reader makes from the same block.
    const templateId =
      /template\s*:\s*_\.template\(\s*(?:\$|jQuery)\(\s*['"`]#([\w-]+)['"`]/.exec(body)?.[1] ??
      /template\s*:\s*['"`]#([\w-]+)['"`]/.exec(body)?.[1] ?? null;

    views.push({
      name: m[1],
      selector: el ?? (cls ? `.${cls.split(" ")[0]}` : tag ? `<${tag}>` : `(${m[1]})`),
      events,
      templateId,
      rendersWithTemplate: /_\.template|\.template\s*\(/.test(body),
      file: rel,
    });
  }
  return views;
}

export function readSync(text, rel) {
  const calls = [];
  // A Model or Collection's url is the read side of everything Backbone does.
  for (const m of text.matchAll(/Backbone\.(Model|Collection)\.extend\s*\(\s*\{/g)) {
    const body = balanced(text, m.index + m[0].length - 1);
    if (!body) continue;
    const url = /\burl(?:Root)?\s*:\s*['"`]([^'"`]+)['"`]/.exec(body);
    if (url) {
      calls.push({ method: "GET", path: url[1], file: rel, headers: null, body: null });
      // save() and destroy() are the writes Backbone derives from the same
      // url. Assumed from the framework's contract, and marked as such.
      calls.push({ method: "POST", path: url[1], file: rel, headers: null, body: "unknown", assumed: "Backbone.sync default" });
    }
  }
  return calls;
}

export default {
  name: "input-backbone",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const scripts = ctx.sources.files.filter((f) => /\.js$/.test(f.rel) && !/\.min\.js$/.test(f.rel));

      const views = [];
      const calls = [];
      for (const file of scripts) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !/Backbone\.(View|Model|Collection|Router)/.test(text)) continue;
        views.push(...readViews(text, file.rel));
        calls.push(...readSync(text, file.rel));
      }
      if (!views.length && !calls.length) return log.debug("no Backbone here");

      // A View is a boundary somebody drew. It lands in the same inventory the
      // jQuery reader fills, already grouped, so dsp-boundaries can present it
      // without having to infer what was never hidden.
      ctx.widgets = ctx.widgets ?? [];
      ctx.widgetEdges = ctx.widgetEdges ?? [];
      for (const view of views) {
        ctx.widgets.push({ selector: view.selector, file: view.file, events: [...new Set(view.events.map((e) => e.event))], writes: view.rendersWithTemplate ? ["html"] : [] });
        for (const e of view.events.filter((e) => e.selector)) {
          ctx.widgets.push({ selector: `${view.selector} ${e.selector}`, file: view.file, events: [e.event], writes: [] });
          ctx.widgetEdges.push([view.selector, `${view.selector} ${e.selector}`]);
        }
      }
      ctx.api.calls.push(...calls);
      for (const call of calls.filter((c) => c.assumed)) {
        ctx.unverified(`${call.method} ${call.path} is a ${call.assumed}, assumed rather than seen. Confirm the app actually saves.`);
      }

      ctx.backboneViews = views;
      log.info(`${views.length} view(s), ${calls.length} call(s)`);
    });

    // The underscore reader runs later in the same stage, so the join waits
    // for plan: a view that names its template by id claims the screen the
    // underscore reader made from that block, and its events hash rides along.
    on("plan", (ctx) => {
      const views = ctx.backboneViews ?? [];
      if (!views.length) return;
      const normalize = (id) => String(id).toLowerCase().replace(/[^\w-]/g, "-").replace(/-?template-?/g, "") || String(id).toLowerCase();
      let joined = 0;
      for (const view of views.filter((v) => v.templateId)) {
        const screen = ctx.screens.find((s) => s.readBy === "underscore" && s.selector === normalize(view.templateId));
        if (!screen) {
          ctx.unverified(`The Backbone view ${view.name} renders #${view.templateId}, and no template block by that id is in this run. The view's events are in WIDGETS.md; the markup is elsewhere.`);
          continue;
        }
        screen.className = screen.className ?? view.name;
        screen.boundBy = view.name;
        screen.viewEvents = view.events;
        if (view.events.length) {
          ctx.unverified(
            `${view.name}'s events hash listens for ${view.events.map((e) => `\`${e.event}\`${e.selector ? ` on \`${e.selector}\`` : ""} → ${e.handler}`).join(", ")} ` +
            `over the ${screen.selector} screen. The template carries no handler attributes, so wire these ${view.events.length} handler(s) in the port by the selectors given.`
          );
        }
        joined += 1;
      }
      if (joined) log.info(`${joined} view(s) joined to their underscore template screen(s)`);
      const unjoined = views.filter((v) => v.rendersWithTemplate && !v.templateId);
      if (unjoined.length) {
        ctx.unverified(
          `${unjoined.length} Backbone view(s) render a template this reader could not name from the source ` +
          `(${unjoined.map((v) => v.name).join(", ")}). Their events are in WIDGETS.md; join them to their markup by hand.`
        );
      }
    });
  },
};
