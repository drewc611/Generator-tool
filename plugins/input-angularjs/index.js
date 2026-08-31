import { readFile } from "node:fs/promises";
import { balanced } from "../dsp-ir/scan.js";
import { parse } from "../dsp-ir/parse.js";

/**
 * The AngularJS reader, for the 1.x apps that never went anywhere.
 *
 * Two shapes of component exist in that world. `.component()` from 1.5 on
 * declared everything portamp wants: a name, a template, bindings. Before
 * that, the boundary was an ng-controller attribute on a region of markup,
 * which is a component in everything but the registration, so each controller
 * region is read as a screen and the controller's $http calls belong to it.
 *
 * Regular expressions and a balanced brace scan, like the other readers of
 * its era, and honest about it in the run.
 */

const kebab = (name) =>
  String(name).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/Controller$|Ctrl$/i, "").replace(/-$/, "").toLowerCase();

const HTTP = [
  // $http.get("/x"), $http.post("/x", body)
  /\$http\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g,
  // $http({ method: "POST", url: "/x" })
  /\$http\s*\(\s*\{([\s\S]{0,300}?)\}\s*\)/g,
  // $resource("/x/:id")
  /\$resource\s*\(\s*(['"`])([^'"`]+)\1/g,
];

export function readScript(text, rel) {
  const calls = [];
  const components = [];
  const controllers = new Map();

  for (const m of text.matchAll(HTTP[0])) {
    calls.push({ method: m[1].toUpperCase(), path: m[3], file: rel, headers: null, body: ["get", "delete"].includes(m[1]) ? null : "unknown" });
  }
  for (const m of text.matchAll(HTTP[1])) {
    const method = /method\s*:\s*['"`](\w+)['"`]/.exec(m[1]);
    const url = /url\s*:\s*['"`]([^'"`]+)['"`]/.exec(m[1]);
    if (url) {
      const verb = (method?.[1] ?? "GET").toUpperCase();
      calls.push({ method: verb, path: url[1], file: rel, headers: null, body: verb === "GET" ? null : "unknown" });
    }
  }
  for (const m of text.matchAll(HTTP[2])) {
    // A $resource is the whole CRUD family on one path. The reads are certain;
    // the writes are the resource's defaults and are marked as assumed.
    const path = m[2].replace(/\/:(\w+)/g, "/:$1");
    calls.push({ method: "GET", path, file: rel, headers: null, body: null });
    calls.push({ method: "POST", path: path.replace(/\/:[\w]+$/, ""), file: rel, headers: null, body: "unknown", assumed: "$resource default" });
  }

  // .component("orderList", { template: `...`, bindings: { region: "<" } })
  for (const m of text.matchAll(/\.component\s*\(\s*['"`]([\w$]+)['"`]\s*,\s*\{/g)) {
    const body = balanced(text, m.index + m[0].length - 1);
    if (!body) continue;
    const template = /template\s*:\s*(['"`])([\s\S]*?)\1\s*[,}]/.exec(body);
    const templateUrl = /templateUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(body);
    const bindings = /bindings\s*:\s*\{([\s\S]*?)\}/.exec(body);
    const inputs = [];
    const outputs = [];
    if (bindings) {
      for (const b of bindings[1].matchAll(/([\w$]+)\s*:\s*['"`]\s*([<@=&])/g)) {
        (b[2] === "&" ? outputs : inputs).push(b[1]);
      }
    }
    components.push({
      name: m[1],
      template: template ? template[2] : null,
      templateUrl: templateUrl ? templateUrl[1] : null,
      inputs, outputs, file: rel,
    });
  }

  // .controller("OrdersCtrl", function ($scope, $http) { ... })
  for (const m of text.matchAll(/\.controller\s*\(\s*['"`]([\w$]+)['"`]\s*,/g)) {
    const open = text.indexOf("{", m.index + m[0].length);
    const body = open > -1 ? balanced(text, open) : null;
    if (!body) continue;
    const scoped = [...body.matchAll(/\$scope\s*\.\s*([\w$]+)\s*=/g)].map((x) => x[1]);
    controllers.set(m[1], { file: rel, scoped: [...new Set(scoped)], body });
  }

  return { calls, components, controllers };
}

/** ng-controller regions in the page markup, each one a screen in disguise. */
export function readRegions(html, rel) {
  const regions = [];
  const walk = (node) => {
    if (node.type !== "element") return;
    const attr = node.attrs?.find((a) => /^(data-)?ng-controller$/.test(a.name));
    if (attr) {
      const name = /^([\w$]+)/.exec(attr.value ?? "")?.[1];
      if (name) regions.push({ controller: name, node, file: rel });
      // A region inside a region belongs to the inner controller; both are
      // recorded, and the person porting decides the nesting.
    }
    (node.children ?? []).forEach(walk);
  };
  parse(html).forEach(walk);
  return regions;
}

/** The markup of a node, printed back out so the IR can read the region alone. */
export function markupOf(node) {
  if (node.type === "text") return node.text;
  if (node.type === "comment") return `<!--${node.text}-->`;
  const attrs = (node.attrs ?? [])
    .filter((a) => !/^(data-)?ng-controller$/.test(a.name))
    .map((a) => (a.value === null ? ` ${a.name}` : ` ${a.name}="${a.value}"`))
    .join("");
  const children = (node.children ?? []).map(markupOf).join("");
  return `<${node.tag}${attrs}>${children}</${node.tag}>`;
}

export default {
  name: "input-angularjs",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const scripts = ctx.sources.files.filter((f) => /\.js$/.test(f.rel) && !/\.min\.js$/.test(f.rel));
      const pages = ctx.sources.files.filter((f) => /\.html?$/.test(f.rel));

      const calls = [];
      const components = [];
      const controllers = new Map();
      let looksAngularJs = false;

      for (const file of scripts) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        if (!/angular\s*\.\s*module|\.controller\s*\(|\$scope|\$http/.test(text)) continue;
        looksAngularJs = true;
        const found = readScript(text, file.rel);
        calls.push(...found.calls);
        components.push(...found.components);
        for (const [k, v] of found.controllers) controllers.set(k, v);
      }
      if (!looksAngularJs) return log.debug("no 1.x app here");

      let screens = 0;

      for (const component of components) {
        let template = component.template;
        if (!template && component.templateUrl) {
          const match = ctx.sources.files.find((f) => f.rel.endsWith(component.templateUrl.replace(/^\.?\//, "")));
          template = match ? await readFile(match.path, "utf8").catch(() => null) : null;
          if (!template) ctx.unverified(`Component ${component.name}: templateUrl ${component.templateUrl} was not found in the tree, so only its states can be ported.`);
        }
        ctx.screens.push({
          selector: kebab(component.name), className: component.name, file: component.file,
          inputs: component.inputs, outputs: component.outputs,
          template, templateOrigin: component.template ? "the component registration" : component.templateUrl,
          usesNgIf: /ng-if/.test(template ?? ""), usesNgFor: /ng-repeat/.test(template ?? ""),
          usesTwoWay: /ng-model/.test(template ?? ""), rxjs: [], readBy: "angularjs",
        });
        screens += 1;
      }

      for (const page of pages) {
        const html = await readFile(page.path, "utf8").catch(() => "");
        if (!html || !/ng-controller/.test(html)) continue;
        for (const region of readRegions(html, page.rel)) {
          const controller = controllers.get(region.controller);
          const template = markupOf(region.node);
          ctx.screens.push({
            selector: kebab(region.controller), className: region.controller, file: controller?.file ?? page.rel,
            inputs: [], outputs: [],
            template, templateOrigin: `an ng-controller region in ${page.rel}`,
            usesNgIf: /ng-if/.test(template), usesNgFor: /ng-repeat/.test(template),
            usesTwoWay: /ng-model/.test(template), rxjs: [],
            scoped: controller?.scoped ?? [], readBy: "angularjs",
          });
          screens += 1;
        }
      }

      ctx.api.calls.push(...calls);
      for (const call of calls.filter((c) => c.assumed)) {
        ctx.unverified(`${call.method} ${call.path} is a $resource default, assumed rather than seen. Confirm the app actually saves.`);
      }
      log.info(`${screens} screen(s), ${calls.length} call(s), read with regular expressions`);
      ctx.unverified("The AngularJS app was read with regular expressions, not a parser. A controller written unusually may have been missed.");
    });
  },
};
