import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

/**
 * Reads Vue single file components into the same context shape input-angular
 * produces, so nothing downstream has to know which framework it came from.
 * That is the whole claim the plugin classes make, and this is the plugin that
 * tests it: the template translator, the endpoint map and the emitter were all
 * written against Angular and none of them changed to accept this.
 *
 * Regular expressions, like the Angular reader's fallback, and honest about it.
 */

const BLOCK = (tag) => new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
const RXJS = /\b(watch|computed|onMounted|onUnmounted|nextTick|reactive|ref)\b/g;

const kebab = (name) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").toLowerCase();

export function readSfc(text, rel) {
  const template = BLOCK("template").exec(text);
  const script = BLOCK("script").exec(text);
  const body = script?.[2] ?? "";

  const props = new Set();
  // defineProps({ a: String }) or defineProps(['a','b'])
  const defined = /defineProps\s*(?:<[^>]*>)?\s*\(\s*([\s\S]*?)\)\s*;?/.exec(body);
  if (defined) {
    for (const m of defined[1].matchAll(/['"]([\w$]+)['"]\s*(?::|,|\])/g)) props.add(m[1]);
    for (const m of defined[1].matchAll(/(?:^|[{,])\s*([\w$]+)\s*:/g)) props.add(m[1]);
  }
  // props: { a: ... } or props: ['a']
  const optionProps = /\bprops\s*:\s*(\{[\s\S]*?\}|\[[\s\S]*?\])/.exec(body);
  if (optionProps) {
    for (const m of optionProps[1].matchAll(/['"]([\w$]+)['"]/g)) props.add(m[1]);
    for (const m of optionProps[1].matchAll(/(?:^|[{,])\s*([\w$]+)\s*:/g)) props.add(m[1]);
  }

  const emits = new Set();
  const defineEmits = /defineEmits\s*(?:<[^>]*>)?\s*\(\s*\[([\s\S]*?)\]\s*\)/.exec(body);
  if (defineEmits) for (const m of defineEmits[1].matchAll(/['"]([\w$-]+)['"]/g)) emits.add(m[1]);
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
      template: template ? template[2] : null,
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
      log.info(`${found} single file component(s), read with regular expressions`);
      if (found) {
        ctx.unverified(
          "Vue components were read with regular expressions, not a parser. A component written unusually may have been missed."
        );
      }
    });
  },
};
