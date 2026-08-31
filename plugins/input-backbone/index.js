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

    views.push({
      name: m[1],
      selector: el ?? (cls ? `.${cls.split(" ")[0]}` : tag ? `<${tag}>` : `(${m[1]})`),
      events,
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

      log.info(`${views.length} view(s), ${calls.length} call(s)`);
      if (views.some((v) => v.rendersWithTemplate)) {
        ctx.unverified(
          "Backbone views render underscore templates, which this reader inventories and does not translate. " +
          "The views and their events are in WIDGETS.md and BOUNDARIES.md; the markup inside <%= %> is a " +
          "dialect portamp does not yet read."
        );
      }
    });
  },
};
