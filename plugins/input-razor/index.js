import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { pascal } from "../dsp-ir/emit.js";
import { attrSafe, matchBracket as matchShared } from "../dsp-ir/text.js";

// Quotes are C# strings only where the text is C#: inside a ( ) condition or
// a @{ } block. A { } body is markup, and "Don't" in a paragraph is prose.
const matchBracket = (text, open, code = text[open] !== "{") => matchShared(text, open, { strings: code, ticks: false });

/**
 * Razor, the view language of ASP.NET MVC and ASP.NET Core: C# after an @,
 * markup everywhere else, and a view composed from a layout that renders its
 * body and sections, with partials rendered by name. The control statements
 * that shape markup are lowered onto the dialect: @if with its else if and
 * else chain negated the way the runtime evaluates it, @foreach as a loop
 * naming its variable, @switch and case as the equalities they test; @expr and
 * @(expr) as interpolation, @Html.Raw as bound html, @Html.DisplayFor(m => m.X)
 * as the value it displays; a C# expression as the JS it names (.Count and
 * .Length to .length, .Any() to a length check, string.IsNullOrEmpty to a
 * truth test, is null to a null test); @RenderBody, @RenderSection, @section
 * and @Html.Partial composed the way the view engine composes them, with
 * _ViewStart's Layout applied to every view that names none. Model, ViewBag
 * and ViewData are the inputs the controller supplied.
 *
 * A @{ } code block, @for and @while, @Url.Action and @Html.ActionLink, the
 * form helpers (EditorFor, TextBoxFor, BeginForm), tag helpers and a section
 * the layout did not ask for are named rather than approximated. Razor's
 * parser is a C# parser and this is not one; what it does not read it says.
 */

const NATIVE_HELPERS = /^(EditorFor|TextBoxFor|TextAreaFor|CheckBoxFor|DropDownListFor|HiddenFor|PasswordFor|RadioButtonFor|LabelFor|ValidationMessageFor|ValidationSummary|BeginForm|EndForm|AntiForgeryToken|ActionLink|RouteLink|EditorForModel|DisplayForModel)$/;

/** A C# expression as the JS it names, outside of strings. */
export function csharpToJs(code, note = () => {}) {
  const parts = String(code).split(/(@?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/);
  return parts.map((part, i) => {
    if (i % 2) return part.replace(/^@"/, '"');
    return part
      .replace(/!\s*string\.IsNullOrEmpty\(([^()]+)\)/gi, "!!($1)")
      .replace(/\bstring\.IsNullOrEmpty\(([^()]+)\)/gi, "!($1)")
      .replace(/!\s*string\.IsNullOrWhiteSpace\(([^()]+)\)/gi, "!!($1 && $1.trim())")
      .replace(/\bstring\.IsNullOrWhiteSpace\(([^()]+)\)/gi, "!($1 && $1.trim())")
      .replace(/\.Any\(\)/g, ".length > 0")
      .replace(/\.(Count|Length)\b(?!\()/g, ".length")
      .replace(/\.Count\(\)/g, ".length")
      .replace(/\.ToString\([^)]*\)/g, "")
      .replace(/\.ToUpper(?:Invariant)?\(\)/g, ".toUpperCase()")
      .replace(/\.ToLower(?:Invariant)?\(\)/g, ".toLowerCase()")
      .replace(/\.Trim\(\)/g, ".trim()")
      .replace(/\bis\s+not\s+null\b/g, "!= null")
      .replace(/\bis\s+null\b/g, "== null")
      .replace(/\bnew\s+\w+\s*\{[^}]*\}/g, (m) => { note(`\`${m.slice(0, 40)}\` builds an object in the view; it is left as written.`); return m; });
  }).join("");
}


/** An implicit expression after @: an identifier chain with member access, indexers and calls. */
function implicitExpression(text, at) {
  let i = at;
  const ident = /^[A-Za-z_][\w]*/.exec(text.slice(i));
  if (!ident) return null;
  i += ident[0].length;
  for (;;) {
    if (text[i] === "." && /[A-Za-z_]/.test(text[i + 1] ?? "")) { const m = /^\.[A-Za-z_]\w*/.exec(text.slice(i)); i += m[0].length; continue; }
    if (text[i] === "(" || text[i] === "[") { const e = matchBracket(text, i, true); if (e < 0) break; i = e; continue; }
    if (text[i] === "?" && text[i + 1] === "." && /[A-Za-z_]/.test(text[i + 2] ?? "")) { i += 1; continue; }
    break;
  }
  return [text.slice(at, i), i];
}

const q = attrSafe;

/** Compose a view into its layout and inline its partials; returns Razor with the composition done. */
export function composeRazor(source, resolve, note = () => {}, viewStartLayout = null, depth = 0) {
  let text = String(source ?? "").replace(/@\*[\s\S]*?\*@/g, "");
  let layout = viewStartLayout;
  // The code block that names the layout is the one code block every view carries.
  for (let at = text.indexOf("@{"); at >= 0; at = text.indexOf("@{")) {
    const end = matchBracket(text, at + 1, true);
    if (end < 0) { note("A @{ code block never closes; the rest of the file was kept as text."); break; }
    const body = text.slice(at + 2, end - 1);
    const l = /\bLayout\s*=\s*(?:null|"([^"]*)")/.exec(body);
    if (l) { layout = l[1] === undefined ? null : l[1]; }
    const rest = body.replace(/\bLayout\s*=\s*(?:null|"[^"]*")\s*;?/, "").replace(/\bViewBag\.Title\s*=\s*[^;]+;?/, (t) => { note(`\`${t.trim()}\` set the page title in a code block; the layout reads it and the port must supply it.`); return ""; }).trim();
    if (rest) note("A @{ } code block ran C# while rendering; it was not carried and its values are not in the port.");
    text = text.slice(0, at) + text.slice(end);
  }
  const sections = new Map();
  text = text.replace(/@section\s+(\w+)\s*\{/g, (m, name, offset) => `\u0000SECTION:${name}\u0000{`);
  for (;;) {
    const m = /\u0000SECTION:(\w+)\u0000\{/.exec(text);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const end = matchBracket(text, open, false);
    if (end < 0) { note(`@section ${m[1]} never closes; the rest of the file was kept as text.`); text = text.replace(m[0], ""); break; }
    sections.set(m[1], text.slice(open + 1, end - 1));
    text = text.slice(0, m.index) + text.slice(end);
  }
  if (layout && resolve && depth < 6) {
    const body = resolve(layout);
    if (body != null) {
      let composed = String(body).replace(/@\*[\s\S]*?\*@/g, "");
      for (let at = composed.indexOf("@{"); at >= 0; at = composed.indexOf("@{")) {
        const end = matchBracket(composed, at + 1, true);
        if (end < 0) break;
        composed = composed.slice(0, at) + composed.slice(end);
      }
      composed = composed.replace(/@RenderBody\(\)/g, () => text);
      composed = composed.replace(/@(?:await\s+)?RenderSection(?:Async)?\(\s*"(\w+)"[^)]*\)/g, (m, name) => sections.get(name) ?? "");
      composed = composed.replace(/@IsSectionDefined\(\s*"(\w+)"\s*\)/g, (m, name) => (sections.has(name) ? "true" : "false"));
      for (const name of sections.keys()) if (!new RegExp(`Render(?:Section|SectionAsync)\\(\\s*"${name}"`).test(String(body))) note(`@section ${name} is defined by the view and the layout never renders it; it was dropped.`);
      text = composed;
    } else note(`Layout "${layout}" names a layout this run does not hold; the view stands without it.`);
  } else if (sections.size) {
    for (const name of sections.keys()) note(`@section ${name} has no layout to land in; it was dropped.`);
  }
  if (resolve && depth < 6) {
    const partialCall = /@(?:await\s+)?Html\.(?:Partial|PartialAsync|RenderPartial|RenderPartialAsync)\(/g;
    for (let pm = partialCall.exec(text); pm; pm = partialCall.exec(text)) {
      const open = pm.index + pm[0].length - 1;
      const end = matchBracket(text, open, true);
      if (end < 0) break;
      const inner = text.slice(open + 1, end - 1);
      const nameM = /^\s*"([^"]+)"/.exec(inner);
      const args = nameM ? inner.slice(nameM[0].length) : "";
      let replacement = "";
      if (!nameM) note("A partial rendered by an expression rather than a name cannot be inlined; the call was removed.");
      else {
        const body = resolve(nameM[1]);
        if (body == null) { note(`The partial "${nameM[1]}" is not in this run; the tag was removed and the content stands without it.`); }
        else { if (args.trim()) note(`The partial "${nameM[1]}" was rendered with a model of its own; the port passes it nothing and the partial reads Model as this view's.`); replacement = composeRazor(body, resolve, note, null, depth + 1); }
      }
      const tail = /^\s*;/.exec(text.slice(end));
      text = text.slice(0, pm.index) + replacement + text.slice(end + (tail ? tail[0].length : 0));
      partialCall.lastIndex = pm.index + replacement.length;
    }
    text = text.replace(/<partial\s+name="([^"]+)"[^>]*\/?>/g, (m, b) => {
      const name = b;
      const body = resolve(name);
      if (body == null) { note(`The partial "${name}" is not in this run; the tag was removed and the content stands without it.`); return ""; }
      if (args && args.trim()) note(`The partial "${name}" was rendered with a model of its own; the port passes it nothing and the partial reads Model as this view's.`);
      return composeRazor(body, resolve, note, null, depth + 1);
    });
  }
  return text;
}

/** Lower composed Razor onto the attribute dialect. Returns { template, inputs }. */
export function lowerRazor(source, note = () => {}) {
  const text = String(source ?? "").replace(/@\*[\s\S]*?\*@/g, "");
  const inputs = new Set();
  const expr = (code) => {
    const js = csharpToJs(code, note);
    for (const root of ["Model", "ViewBag", "ViewData", "TempData", "User"]) if (new RegExp(`\\b${root}\\b`).test(js)) inputs.add(root);
    return js;
  };
  const out = [];
  const lower = (t) => {
    let i = 0;
    // A bracket that never closes is a view this reader cannot follow; the rest
    // is kept as text and named, never looped over.
    const bail = (at, what) => { note(`${what} never closes; the rest of the file from there was kept as text.`); out.push(t.slice(at)); return t.length; };
    while (i < t.length) {
      const at = t.indexOf("@", i);
      if (at < 0) { out.push(t.slice(i)); break; }
      out.push(t.slice(i, at));
      i = at + 1;
      if (t[i] === "@") { out.push("@"); i += 1; continue; }
      // help@example.com: Razor treats an @ glued to the word before it as the sign itself.
      if (at > 0 && /[A-Za-z0-9._-]/.test(t[at - 1]) && /[A-Za-z0-9]/.test(t[i] ?? "")) { out.push("@"); continue; }
      if (t[i] === ":") { const nl = t.indexOf("\n", i); lower(t.slice(i + 1, nl < 0 ? t.length : nl)); i = nl < 0 ? t.length : nl; continue; }
      if (t[i] === "(") { const e = matchBracket(t, i, true); if (e < 0) { i = bail(at, "An @( expression"); continue; } out.push(`{{ ${expr(t.slice(i + 1, e - 1).trim())} }}`); i = e; continue; }
      if (t[i] === "{") { const e = matchBracket(t, i, true); if (e < 0) { i = bail(at, "A @{ code block"); continue; } note("A @{ } code block ran C# while rendering; it was not carried and its values are not in the port."); i = e; continue; }
      let word = /^[A-Za-z_]\w*/.exec(t.slice(i))?.[0];
      if (!word) { out.push("@"); continue; }
      // @await Html.PartialAsync(...) or @await Component.InvokeAsync(...): the call is what matters.
      if (word === "await") { const skip = /^await\s+/.exec(t.slice(i)); i += skip ? skip[0].length : 5; word = /^[A-Za-z_]\w*/.exec(t.slice(i))?.[0]; if (!word) { out.push("@"); continue; } }
      // Directives head the file and take the rest of their line; @using with a ( is a block instead.
      if (/^(using|model|inject|addTagHelper|removeTagHelper|inherits|implements|namespace|functions|helper|layout|page|attribute)$/.test(word) && !(word === "using" && /^\s*\(/.test(t.slice(i + 5)))) {
        if (word === "model") { const nl = t.indexOf("\n", i); note(`@model ${t.slice(i + 5, nl < 0 ? t.length : nl).trim()} names the C# type the controller supplied; the port's Model input carries that shape and this tool does not know it.`); i = nl < 0 ? t.length : nl; continue; }
        if (word === "functions" || word === "helper") { const bo = t.indexOf("{", i); const be = bo < 0 ? -1 : matchBracket(t, bo, true); if (be < 0) { i = bail(at, `@${word}`); continue; } note(`@${word} declared C# in the view; it was not carried.`); i = be; continue; }
        const nl = t.indexOf("\n", i); i = nl < 0 ? t.length : nl; continue;
      }

      if (word === "if") { const r = control(t, i + 2, "if"); if (r < 0) { i = bail(at, "An @if block"); continue; } i = r; continue; }
      if (word === "foreach") {
        const open = t.indexOf("(", i); const e = open < 0 ? -1 : matchBracket(t, open, true);
        if (e < 0) { i = bail(at, "A @foreach"); continue; }
        const head = t.slice(open + 1, e - 1).trim();
        const lm = /^(?:var|[\w<>\[\],. ]+?)\s+(\w+)\s+in\s+([\s\S]+)$/.exec(head);
        const bodyOpen = t.indexOf("{", e); const bodyEnd = bodyOpen < 0 ? -1 : matchBracket(t, bodyOpen, false);
        if (bodyEnd < 0) { i = bail(at, "A @foreach body"); continue; }
        if (lm) out.push(`<ng-container ng-repeat="${q(`${lm[1]} in ${expr(lm[2])}`)}">`);
        else { note(`@foreach (${head.slice(0, 40)}) has a shape this reader does not know; its body was kept once, unrepeated.`); out.push("<ng-container>"); }
        lower(t.slice(bodyOpen + 1, bodyEnd - 1));
        out.push("</ng-container>");
        i = bodyEnd; continue;
      }
      if (word === "for" || word === "while" || word === "do" || word === "using" || word === "try" || word === "lock") {
        const braced = word === "do" || word === "try";
        const open = t.indexOf(braced ? "{" : "(", i); const e = open < 0 ? -1 : braced ? open : matchBracket(t, open, true);
        const bodyOpen = e < 0 ? -1 : t.indexOf("{", e); const bodyEnd = bodyOpen < 0 ? -1 : matchBracket(t, bodyOpen, false);
        if (bodyEnd < 0) { i = bail(at, `A @${word} block`); continue; }
        note(`@${word} ran a C# loop or block; its body was kept once and what it did is not in the port.`);
        out.push("<ng-container>"); lower(t.slice(bodyOpen + 1, bodyEnd - 1)); out.push("</ng-container>");
        i = bodyEnd; continue;
      }
      if (word === "switch") {
        const open = t.indexOf("(", i); const e = open < 0 ? -1 : matchBracket(t, open, true);
        const bodyOpen = e < 0 ? -1 : t.indexOf("{", e); const bodyEnd = bodyOpen < 0 ? -1 : matchBracket(t, bodyOpen, false);
        if (bodyEnd < 0) { i = bail(at, "A @switch"); continue; }
        const subject = expr(t.slice(open + 1, e - 1).trim());
        const body = t.slice(bodyOpen + 1, bodyEnd - 1);
        const cases = [...body.matchAll(/\b(case\s+([\s\S]+?)|default)\s*:/g)];
        const tried = [];
        cases.forEach((c, idx) => {
          const start = c.index + c[0].length;
          const stop = cases[idx + 1]?.index ?? body.length;
          const chunk = body.slice(start, stop).replace(/\bbreak\s*;\s*$/, "");
          if (c[2] !== undefined) { const test = `(${subject}) == ${expr(c[2].trim())}`; out.push(`<ng-container ng-if="${q(test)}">`); tried.push(test); }
          else out.push(`<ng-container ng-if="${q(tried.map((x) => `!(${x})`).join(" && ") || "true")}">`);
          lower(chunk); out.push("</ng-container>");
        });
        i = bodyEnd; continue;
      }
      if (word === "Html" || word === "Url" || word === "Component") {
        const im = implicitExpression(t, i);
        const call = im[0];
        const helper = /^Html\.(\w+)/.exec(call)?.[1];
        if (helper === "Raw") { const open = call.indexOf("("); out.push(`<span ng-bind-html="${q(expr(call.slice(open + 1, -1)))}"></span>`); }
        else if (helper === "DisplayFor" || helper === "DisplayTextFor") { const lam = /\(\s*\w+\s*=>\s*\w+\.([\w.]+)\s*\)/.exec(call); if (lam) out.push(`{{ ${expr(`Model.${lam[1]}`)} }}`); else note(`\`@${call.slice(0, 40)}\` displays a value this reader could not name; it was removed.`); }
        else if (helper === "DisplayNameFor") { const lam = /\(\s*\w+\s*=>\s*\w+\.([\w.]+)\s*\)/.exec(call); out.push(lam ? lam[1].split(".").pop() : ""); note("@Html.DisplayNameFor printed a label from the model's attributes; the property name stands in for it."); }
        else if (helper && NATIVE_HELPERS.test(helper)) note(`@Html.${helper}(...) is a form or link helper the server rendered from the model; the port must build that markup on purpose. It was removed.`);
        else if (word === "Url") note(`\`@${call.slice(0, 40)}\` resolved a route on the server; it is removed and the address belongs in the endpoint map.`);
        else if (word === "Component") note(`\`@${call.slice(0, 40)}\` invoked a view component the server rendered; the port must build that piece on purpose. It was removed.`);
        else note(`\`@${call.slice(0, 40)}\` is a helper this reader does not know; it was removed.`);
        i = im[1]; continue;
      }
      const im = implicitExpression(t, i);
      if (!im) { out.push("@"); continue; }
      out.push(`{{ ${expr(im[0])} }}`);
      i = im[1];
    }
  };
  const control = (t, i, kind) => {
    const tried = [];
    let pos = i;
    for (;;) {
      const open = t.indexOf("(", pos); const e = open < 0 ? -1 : matchBracket(t, open, true);
      const bodyOpen = e < 0 ? -1 : t.indexOf("{", e); const bodyEnd = bodyOpen < 0 ? -1 : matchBracket(t, bodyOpen, false);
      if (bodyEnd < 0) return -1;
      const test = expr(t.slice(open + 1, e - 1).trim());
      const nots = tried.map((c) => `!(${c})`);
      out.push(`<ng-container ng-if="${q(tried.length ? [...nots, `(${test})`].join(" && ") : test)}">`);
      tried.push(test);
      lower(t.slice(bodyOpen + 1, bodyEnd - 1)); out.push("</ng-container>");
      pos = bodyEnd;
      const tail = /^\s*else\s+if\s*\(/.exec(t.slice(pos));
      if (tail) { pos += tail[0].length - 1; continue; }
      const els = /^\s*else\s*\{/.exec(t.slice(pos));
      if (els) {
        const bo = pos + els[0].length - 1; const be = matchBracket(t, bo, false);
        if (be < 0) return -1;
        out.push(`<ng-container ng-if="${q(nots.concat(`!(${test})`).join(" && "))}">`);
        lower(t.slice(bo + 1, be - 1)); out.push("</ng-container>");
        pos = be;
      }
      return pos;
    }
  };
  lower(text);
  return { template: out.join(""), inputs: [...inputs].sort() };
}

export default {
  name: "input-razor",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.cshtml$/i.test(f.rel));
      if (!files.length) return log.debug("no Razor views");
      const notes = [];
      const note = (t) => { if (!notes.includes(t)) notes.push(t); };
      const bodies = new Map();
      for (const f of files) bodies.set(f.rel.replace(/^\.\//, ""), await readFile(f.path, "utf8").catch(() => ""));
      // A layout or partial is found the way the view engine finds it: by its
      // path under Views, or by its file name in Shared or beside the view.
      const resolve = (name) => {
        const clean = String(name).replace(/^~\//, "").replace(/^\//, "");
        const base = basename(clean).replace(/\.cshtml$/i, "") + ".cshtml";
        const key = [...bodies.keys()].find((k) => k === clean || k.endsWith(`/${clean}`)) ?? [...bodies.keys()].find((k) => k.endsWith(`/${base}`) || k === base);
        return key ? bodies.get(key) : null;
      };
      const viewStart = [...bodies.entries()].find(([k]) => /(^|\/)_ViewStart\.cshtml$/.test(k));
      const defaultLayout = viewStart ? /\bLayout\s*=\s*"([^"]*)"/.exec(viewStart[1])?.[1] ?? null : null;
      const layouts = new Set();
      for (const [k, text] of bodies) if (/@RenderBody\(\)/.test(text)) layouts.add(k);

      let count = 0;
      for (const file of files) {
        const rel = file.rel.replace(/^\.\//, "");
        const raw = bodies.get(rel) ?? "";
        if (!raw.trim() || /_ViewStart\.cshtml$|_ViewImports\.cshtml$/.test(rel)) continue;
        if (layouts.has(rel)) { note(`${rel} is a layout that renders the views' bodies; it is composed into each of them rather than ported as a screen of its own.`); continue; }
        const own = /\bLayout\s*=\s*(?:null|"([^"]*)")/.exec(raw);
        const layoutName = own ? own[1] ?? null : defaultLayout;
        const layoutBase = layoutName ? layoutName.split("/").pop().replace(/\.cshtml$/i, "") : null;
        const parentKey = layoutBase ? [...layouts].find((k) => k.endsWith(`/${layoutBase}.cshtml`) || k === `${layoutBase}.cshtml`) ?? null : null;
        const composed = composeRazor(raw, resolve, note, defaultLayout);
        let { template, inputs } = lowerRazor(composed, note);
        const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(template);
        if (body) template = body[1];
        template = template.trim();
        if (!template) continue;
        // _Nav is Razor's spelling of a partial; the underscore is not part of the name.
        const selector = rel.replace(/^(.*\/)?Views\//, "").replace(/\.cshtml$/i, "").split("/").map((s) => s.replace(/^_+/, "")).join("-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^\w-]/g, "-").replace(/^-+/, "");
        ctx.screens.push({
          selector,
          className: pascal(selector),
          file: file.rel,
          // _ViewStart chose the layout for a view that names none; it was read into that view as much as the layout was.
          composed: parentKey ? [parentKey, ...(!own && viewStart ? [viewStart[0]] : [])] : [],
          inputs,
          outputs: [],
          template,
          templateOrigin: "a Razor view, composed and lowered",
          usesNgIf: /ng-if/.test(template),
          usesNgFor: /ng-repeat/.test(template),
          usesTwoWay: false,
          rxjs: [],
          readBy: "razor",
        });
        count += 1;
      }
      for (const n of notes) ctx.unverified(n);
      log.info(`${count} Razor view(s) composed and lowered onto the dialect`);
    });
  },
};
