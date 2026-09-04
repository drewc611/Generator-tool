import { readFile } from "node:fs/promises";

/**
 * What a legacy front end reached through the global object. A module port
 * isolates every file's scope, so a property published on `window`, a jQuery
 * plugin registered on the shared `$.fn`, or a bare script scope declaration
 * that other files leaned on stops resolving the moment the code becomes
 * modules. Each one is a hook the port loses in silence unless it is found
 * and contained. This reads them and names what each kind needs; it decides
 * nothing, because how to contain a global is a porting decision.
 */

// Non backtracking patterns: each anchor is followed by a bounded class and a
// single captured identifier, so there is no ambiguous repetition to walk.
const WINDOW_ASSIGN = /\bwindow\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g;
const JQUERY_PLUGIN = /(?:\$|jQuery)\s*\.\s*fn\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g;
const GLOBAL_DECL = /^(?:var|function)\s+([A-Za-z_$][\w$]*)/gm;

const lineOf = (text, index) => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
};

export function readGlobals(text, rel) {
  const findings = [];
  const scan = (re, kind) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      findings.push({ kind, name: m[1], line: lineOf(text, m.index), file: rel });
    }
  };
  scan(WINDOW_ASSIGN, "window-assign");
  scan(JQUERY_PLUGIN, "jquery-plugin");

  // A file that already speaks modules has its top level scoped, so a
  // column-0 var or function there is not a script global.
  const isModule = /^\s*(?:import|export)\s/m.test(text);
  if (!isModule) scan(GLOBAL_DECL, "global-var");

  return findings;
}

export default {
  name: "dsp-globals",
  version: "0.1.0",
  class: "dsp",
  setup({ on, log }) {
    on("plan", async (ctx) => {
      const files = ctx.sources.files.filter((f) => /\.(js|mjs)$/i.test(f.rel) && !/\.min\./i.test(f.rel));
      const findings = [];
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        findings.push(...readGlobals(text, file.rel));
      }
      const byKind = {};
      for (const f of findings) (byKind[f.kind] ??= []).push(f);
      ctx.globals = { findings, byKind };
      if (!findings.length) return log.debug("nothing on the global object");

      log.info(
        `${findings.length} global attachment(s): ${Object.entries(byKind).map(([k, v]) => `${v.length} ${k}`).join(", ")}`
      );
      ctx.unverified(
        `GLOBALS.md lists ${findings.length} thing(s) the app reached through the global object (window, ` +
        `\`$.fn\`, or a script scope declaration). These must be contained as the port modularizes; a module ` +
        `isolates each file, so a hook other code depended on stops resolving unless it is carried forward on purpose.`
      );
    });

    on("emit", async (ctx) => {
      if (!ctx.globals?.findings?.length) return;
      await ctx.write("GLOBALS.md", render(ctx.globals.byKind));
    });
  },
};

const NOTES = {
  "window-assign":
    "Published on `window`. In the port these become module exports, or a small " +
    "namespace object the app imports where it used to read the global.",
  "jquery-plugin":
    "Registered on the shared `$.fn`, so it needs the jQuery the port may not keep. " +
    "Reimplement the behavior, or decide the plugin retires with jQuery.",
  "global-var":
    "A script scope declaration other files could see. It must move into a module " +
    "and be imported where it was read, since module scope no longer shares it.",
};

const LABELS = {
  "window-assign": "Published on the window object",
  "jquery-plugin": "jQuery plugins on the shared $.fn",
  "global-var": "Script scope declarations",
};

function render(byKind) {
  const lines = [
    "# What the app reached through the global object",
    "",
    "A module port isolates each file's scope. Anything the old code published",
    "on the global object, or leaned on there, stops resolving once the files",
    "become modules. Here is what was found, so none of it is lost quietly.",
    "",
  ];
  for (const kind of ["window-assign", "jquery-plugin", "global-var"]) {
    const items = byKind[kind];
    if (!items?.length) continue;
    lines.push(`## ${LABELS[kind]}`, "");
    for (const f of items) lines.push(`- \`${f.file}\` line ${f.line}: ${f.name}`);
    lines.push("", NOTES[kind], "");
  }
  return lines.join("\n");
}
