import { balanced, topLevelBlocks } from "../dsp-ir/scan.js";

/**
 * Reads a route table out of the source.
 *
 * Angular and Vue spell their route objects almost identically: a path, the
 * component it renders, sometimes children, sometimes a redirect, sometimes a
 * lazy import. One structural parser covers both, which is one more small
 * argument that the interesting shape of these apps is not the framework.
 *
 * Balanced brace scanning, not a grammar. A route file that defeats this is
 * reported as unread rather than half read.
 */

const FIELD = (name) => new RegExp(`\\b${name}\\s*:\\s*(?:['"\`]([^'"\`]*)['"\`]|([\\w$.]+))`);

function routeOf(objectBody, file) {
  // The children's fields must not answer for the parent's, so they are cut
  // out before the parent is read.
  const childrenMatch = /\bchildren\s*:\s*\[/.exec(objectBody);
  let own = objectBody;
  let children = [];
  if (childrenMatch) {
    const array = balanced(objectBody, childrenMatch.index + childrenMatch[0].length - 1);
    if (array) {
      own = objectBody.replace(array, "[]");
      children = topLevelBlocks(array.slice(1, -1), "{").map((o) => routeOf(o, file)).filter(Boolean);
    }
  }

  const path = FIELD("path").exec(own);
  if (!path) return null;

  const component = FIELD("component").exec(own);
  const redirect = FIELD("redirectTo").exec(own) ?? FIELD("redirect").exec(own);
  const lazy = /\b(loadChildren|loadComponent)\b/.test(own) || /\bcomponent\s*:\s*\(\)\s*=>\s*import\(/.test(own);

  return {
    path: path[1] ?? path[2] ?? "",
    component: component ? (component[1] ?? component[2]) : null,
    redirectTo: redirect ? (redirect[1] ?? redirect[2]) : null,
    lazy,
    file,
    children,
  };
}

/** Every route table in one file, however the framework spelled it. */
export function readRoutes(text, file) {
  const arrays = new Set();

  // A named array handed to the router is declared somewhere in the file.
  for (const m of text.matchAll(/RouterModule\s*\.\s*for(?:Root|Child)\s*\(\s*(\w+)?/g)) {
    if (m[1]) {
      const declaration = new RegExp(`\\b${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?::[^=]+)?=\\s*\\[`).exec(text);
      if (declaration) {
        const body = balanced(text, declaration.index + declaration[0].length - 1);
        if (body) arrays.add(body);
      }
    } else {
      const open = text.indexOf("[", m.index);
      if (open > -1) {
        const body = balanced(text, open);
        if (body) arrays.add(body);
      }
    }
  }
  for (const re of [/\broutes\s*[:=]\s*\[/g, /createRouter\s*\(\s*\{[\s\S]{0,200}?routes\s*:\s*\[/g]) {
    for (const m of text.matchAll(re)) {
      const open = m.index + m[0].length - 1;
      const body = balanced(text, open);
      if (body) arrays.add(body);
    }
  }

  const routes = [];
  for (const body of arrays) {
    for (const object of topLevelBlocks(body.slice(1, -1), "{")) {
      const route = routeOf(object, file);
      if (route) routes.push(route);
    }
  }

  // AngularJS declared its table as a chain of calls, not an array. The shape
  // is the same table: a path, what renders there, and a fallback.
  if (/\$routeProvider/.test(text)) {
    for (const m of text.matchAll(/\.when\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{/g)) {
      const body = balanced(text, m.index + m[0].length - 1);
      if (!body) continue;
      const controller = FIELD("controller").exec(body);
      const templateUrl = FIELD("templateUrl").exec(body);
      const redirect = FIELD("redirectTo").exec(body);
      routes.push({
        path: m[1],
        component: controller ? (controller[1] ?? controller[2]) : templateUrl ? (templateUrl[1] ?? templateUrl[2]) : null,
        redirectTo: redirect ? (redirect[1] ?? redirect[2]) : null,
        lazy: false,
        file,
        children: [],
      });
    }
    const otherwise = /\.otherwise\s*\(\s*(?:['"`]([^'"`]+)['"`]|\{)/.exec(text);
    if (otherwise) {
      let target = otherwise[1] ?? null;
      if (!target) {
        const body = balanced(text, otherwise.index + otherwise[0].length - 1);
        const redirect = body && FIELD("redirectTo").exec(body);
        target = redirect ? (redirect[1] ?? redirect[2]) : null;
      }
      if (target) routes.push({ path: "**", component: null, redirectTo: target, lazy: false, file, children: [] });
    }
  }

  return routes;
}

/** The tree, walked flat, with the paths joined the way the router joins them. */
export function flatten(routes, prefix = "") {
  const out = [];
  for (const route of routes) {
    const full = [prefix, route.path].filter(Boolean).join("/").replace(/\/+/g, "/") || "/";
    out.push({ ...route, fullPath: full.startsWith("/") ? full : `/${full}` });
    out.push(...flatten(route.children, full));
  }
  return out;
}
