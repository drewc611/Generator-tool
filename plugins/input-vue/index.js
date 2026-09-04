import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { balanced } from "../dsp-ir/scan.js";
import { objectLiteralEntries } from "../dsp-ir/parse.js";

/**
 * Reads Vue single file components into the same context shape input-angular
 * produces, so nothing downstream has to know which framework it came from.
 * That is the whole claim the plugin classes make, and this is the plugin that
 * tests it: the template translator, the endpoint map and the emitter were all
 * written against Angular and none of them changed to accept this.
 *
 * Structural now, not regular expressions: blocks are found by walking the
 * markup and counting nesting, and props come out of the real object literal
 * through balanced brace scanning. The replacement landed behind the byte
 * identical output gate, which is the only way a reader is allowed to change
 * here. A grammar it still is not: a template block is handed whole to the
 * dialect parser, which was always the plan.
 */

const RXJS = /\b(watch|computed|onMounted|onUnmounted|nextTick|reactive|ref)\b/g;

const kebab = (name) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").toLowerCase();

/**
 * The content of a top level block, found by nesting count rather than by a
 * lazy match. The difference is every template that contains a <template>
 * of its own, which is how Vue spells v-if on a group.
 */
export function sfcBlock(text, tag) {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, "ig");
  const any = new RegExp(`<(/?)${tag}(\\s[^>]*)?>`, "ig");
  const m = open.exec(text);
  if (!m) return null;
  any.lastIndex = open.lastIndex;
  let depth = 1;
  let step;
  while ((step = any.exec(text))) {
    depth += step[1] ? -1 : 1;
    if (depth === 0) return { attrs: m[1] ?? "", body: text.slice(open.lastIndex, step.index) };
  }
  // An unclosed block takes the rest of the file, which is what the compiler
  // would have rejected; reading to the end at least loses nothing.
  return { attrs: m[1] ?? "", body: text.slice(open.lastIndex) };
}

/** Names out of a props declaration, whichever of the three spellings it uses. */
export function propNames(source) {
  const names = new Set();
  const value = String(source ?? "").trim();
  if (value.startsWith("[")) {
    for (const m of value.matchAll(/['"]([\w$]+)['"]/g)) names.add(m[1]);
    return [...names];
  }
  const entries = objectLiteralEntries(value);
  if (entries) for (const e of entries) names.add(e.key.replace(/^['"]|['"]$/g, ""));
  return [...names];
}

/** The argument of a call like defineProps(...), scanned, not guessed at. */
function callArgument(body, name) {
  const m = new RegExp(`${name}\\s*(?:<[^>]*>)?\\s*\\(`).exec(body);
  if (!m) return null;
  const open = body.indexOf("(", m.index + m[0].length - 1);
  const parens = balanced(body, open);
  return parens ? parens.slice(1, -1).trim() : null;
}

/** The value of an option like `props:`, whether it is an object or an array. */
function optionValue(body, name) {
  const m = new RegExp(`\\b${name}\\s*:\\s*([\\[{])`).exec(body);
  if (!m) return null;
  const open = body.indexOf(m[1], m.index + m[0].length - 1);
  return balanced(body, open);
}

export function readSfc(text, rel) {
  const template = sfcBlock(text, "template");
  const script = sfcBlock(text, "script");
  const body = script?.body ?? "";

  const props = new Set();
  for (const source of [callArgument(body, "defineProps"), optionValue(body, "props")]) {
    if (source) for (const name of propNames(source)) props.add(name);
  }

  const emits = new Set();
  const declaredEmits = callArgument(body, "defineEmits");
  if (declaredEmits) for (const m of declaredEmits.matchAll(/['"]([\w$-]+)['"]/g)) emits.add(m[1]);
  for (const m of body.matchAll(/\$?emit\(\s*['"]([\w$-]+)['"]/g)) emits.add(m[1]);

  const name = /\bname\s*:\s*['"]([\w-]+)['"]/.exec(body)?.[1] ?? basename(rel, extname(rel));

  const calls = [];
  // fetch("/x") and axios.get("/x") are the two shapes a Vue app usually uses.
  for (const m of body.matchAll(/\bfetch\(\s*(['"`])([^'"`]+)\1(?:\s*,\s*\{[\s\S]*?method\s*:\s*['"](\w+)['"])?/g)) {
    calls.push({ method: (m[3] ?? "GET").toUpperCase(), path: m[2], file: rel, headers: null, body: null });
  }
  for (const m of body.matchAll(/\baxios\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g)) {
    calls.push({
      method: m[1].toUpperCase(), path: m[3], file: rel, headers: null,
      body: ["get", "delete"].includes(m[1]) ? null : "unknown",
    });
  }

  return {
    screen: {
      selector: kebab(name),
      className: name,
      file: rel,
      inputs: [...props],
      outputs: [...emits],
      template: template ? template.body : null,
      templateOrigin: template ? "the single file component" : null,
      usesNgIf: /\bv-if\b/.test(text),
      usesNgFor: /\bv-for\b/.test(text),
      usesTwoWay: /\bv-model\b/.test(text),
      rxjs: [...new Set([...body.matchAll(RXJS)].map((m) => m[1]))],
      readBy: "vue",
    },
    calls,
  };
}

export default {
  name: "input-vue",
  version: "0.1.0",
  class: "input",
  setup({ on, log }) {
    on("extract", async (ctx) => {
      const files = ctx.sources.files.filter((f) => f.rel.endsWith(".vue"));
      if (!files.length) return log.debug("no single file components");

      let found = 0;
      for (const file of files) {
        const text = await readFile(file.path, "utf8").catch(() => "");
        if (!text) continue;
        const { screen, calls } = readSfc(text, file.rel);
        if (!screen.template) {
          ctx.unverified(`<${screen.selector}> has no template block, so only its states can be ported.`);
        }
        ctx.screens.push(screen);
        ctx.api.calls.push(...calls);
        found += 1;
      }
      log.info(`${found} single file component(s), read structurally`);
    });
  },
};
