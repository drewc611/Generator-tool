import { readFile } from "node:fs/promises";
import { balanced, stripScripts } from "../dsp-ir/scan.js";
import { buildIr, DIALECTS } from "../dsp-ir/ir.js";
import { expand } from "./expand.js";

/**
 * The Knockout reader. A viewmodel is the component: its observables are the
 * state, its functions are the handlers, and the markup bound to it is the
 * template. The data-bind attributes expand into a dialect row first, because
 * knockout packs every binding into one attribute and the IR wants one
 * attribute per meaning.
 */

export function readViewModel(text, rel) {
  const observables = [...text.matchAll(/(?:self|this|vm)\.([\w$]+)\s*=\s*ko\.(observable|observableArray|computed)/g)]
    .map((m) => ({ name: m[1], kind: m[2] }));
  const handlers = [...text.matchAll(/(?:self|this|vm)\.([\w$]+)\s*=\s*function/g)].map((m) => m[1]);

  const calls = [];
  for (const m of text.matchAll(/\$\.(get|post|getJSON|ajax)\s*\(\s*(?:\{([\s\S]{0,300}?)\}|(['"`])([^'"`]+)\3)/g)) {
    if (m[4]) {
      calls.push({ method: m[1] === "post" ? "POST" : "GET", path: m[4], file: rel, headers: null, body: m[1] === "post" ? "unknown" : null });
    } else if (m[2]) {
      const url = /url\s*:\s*['"`]([^'"`]+)['"`]/.exec(m[2]);
      const method = /(?:type|method)\s*:\s*['"`](\w+)['"`]/.exec(m[2]);
      if (url) {
        const verb = (method?.[1] ?? "GET").toUpperCase();
        calls.push({ method: verb, path: url[1], file: rel, headers: null, body: verb === "GET" ? null : "unknown" });
      }
    }
  }
  for (const m of text.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*\{[\s\S]{0,200}?method\s*:\s*['"](\w+)['"])?/g)) {
    const verb = (m[3] ?? "GET").toUpperCase();
    calls.push({ method: verb, path: m[2], file: rel, headers: null, body: verb === "GET" ? null : "unknown" });
  }
  return { observables, handlers, calls };
}

/**
 * ko.components.register("order-line", { template: "...", viewModel: ... })
 * declared a real component boundary, unlike applyBindings which bound a
 * page. The template is either inline or an element id resolved against the
 * pages in the run; params become inputs the same way bindings do elsewhere.
 */
export function readComponents(text, rel) {
  const components = [];
  for (const m of text.matchAll(/ko\.components\.register\s*\(\s*['"`]([\w-]+)['"`]\s*,\s*\{/g)) {
    const body = balanced(text, m.index + m[0].length - 1);
    if (!body) continue;
    const inline = /template\s*:\s*(['"`])([\s\S]*?)\1\s*[,}]/.exec(body);
    const byId = /template\s*:\s*\{\s*element\s*:\s*['"`]([\w-]+)['"`]/.exec(body);
    const params = [...body.matchAll(/params\.([\w$]+)/g)].map((p) => p[1]);
    components.push({
      name: m[1],
      template: inline ? inline[2] : null,
      elementId: byId ? byId[1] : null,
      inputs: [...new Set(params)],
      file: rel,
    });
  }
  return components;
}

export default {
  name: "input-knockout",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const scripts = ctx.sources.files.filter((f) => /\.js$/.test(f.rel) && !/\.min\.js$/.test(f.rel));
      const pages = ctx.sources.files.filter((f) => /\.html?$/.test(f.rel));

      let vm = null;
      const calls = [];
      const components = [];
      for (const file of scripts) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text || !/ko\.(observable|applyBindings|computed|components)/.test(text)) continue;
        const found = readViewModel(text, file.rel);
        calls.push(...found.calls);
        components.push(...readComponents(text, file.rel));
        vm = vm
          ? { ...vm, observables: [...vm.observables, ...found.observables], handlers: [...vm.handlers, ...found.handlers] }
          : { file: file.rel, ...found };
      }
      if (!vm && !components.length) return log.debug("no knockout here");

      let screens = 0;

      // Registered components are boundaries somebody drew; each one is a
      // screen of its own, ahead of the bound pages.
      for (const component of components) {
        let template = component.template;
        if (!template && component.elementId) {
          for (const page of pages) {
            const html = await readFile(page.path, "utf8").catch(() => "");
            const el = new RegExp(`<(template|script)\\b[^>]*\\bid\\s*=\\s*["']${component.elementId}["'][^>]*>([\\s\\S]*?)</\\1>`, "i").exec(html);
            if (el) { template = el[2]; break; }
          }
          if (!template) ctx.unverified(`ko component ${component.name}: its template element #${component.elementId} is not in the pages this run read, so only its params can be ported.`);
        }
        const notes = [];
        const expanded = template ? expand(template, (n) => notes.push(n)) : null;
        ctx.screens.push({
          selector: component.name,
          className: null,
          file: component.file,
          inputs: component.inputs,
          outputs: [],
          template: expanded,
          templateOrigin: component.template ? "the ko.components registration" : `the #${component.elementId} template element`,
          usesNgIf: /ko-if/.test(expanded ?? ""),
          usesNgFor: /ko-foreach/.test(expanded ?? ""),
          usesTwoWay: /ko-model/.test(expanded ?? ""),
          rxjs: [],
          readBy: "knockout",
          dialect: "knockout",
        });
        for (const n of new Set(notes)) ctx.unverified(`${component.name}: ${n}`);
        screens += 1;
      }
      if (!vm) {
        ctx.api.calls.push(...calls);
        log.info(`${screens} registered component(s), no page viewmodel`);
        return;
      }
      for (const page of pages) {
        const html = await readFile(page.path, "utf8").catch(() => "");
        if (!html || !/data-bind\s*=/.test(html)) continue;

        const notes = [];
        const expanded = expand(html, (n) => notes.push(n));
        // The bound region is the body; the app is the page. One screen per
        // page is what applyBindings actually meant.
        const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(expanded)?.[1] ?? expanded;
        const template = stripScripts(body);

        ctx.screens.push({
          selector: `ko-${page.rel.replace(/[^a-z0-9]+/gi, "-").replace(/-?html?$/i, "").replace(/^-|-$/g, "").toLowerCase() || "page"}`,
          className: null,
          file: vm.file,
          inputs: [],
          outputs: [],
          template,
          templateOrigin: `the bound markup in ${page.rel}`,
          usesNgIf: /ko-if/.test(template),
          usesNgFor: /ko-foreach/.test(template),
          usesTwoWay: /ko-model/.test(template),
          rxjs: [],
          readBy: "knockout",
          dialect: "knockout",
          observables: vm.observables,
          handlers: vm.handlers,
        });
        for (const n of new Set(notes)) ctx.unverified(`${page.rel}: ${n}`);
        screens += 1;
      }

      ctx.api.calls.push(...calls);
      log.info(`${screens} bound page(s), ${vm.observables.length} observable(s), ${calls.length} call(s)`);
      ctx.unverified("The Knockout app was read with regular expressions, not a parser. A binding written unusually may have been missed.");
    });
  },
};
